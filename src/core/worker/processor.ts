import type { WorkerRequest, WorkerResponse, WatermarkMask } from './messageTypes';
import type { Params } from '../types';
import { computeGradients } from '../maps/gradient';
import { quantizeColors } from '../maps/quantize';
import { analyse, buildStrokes, drawLines, geometryKey, type Field, type StrokeSet } from '../lines/render';
import { encodePNG } from '../lines/png';

// Working state, kept in worker memory.
let source: { w: number; h: number; rgba: Uint8ClampedArray } | null = null;
let field: Field | null = null;
let strokeCache: { key: string; set: StrokeSet } | null = null;

function getStrokes(lines: Params['lines']): { set: StrokeSet; field: Field; traceMs: number } {
    if (!source) throw new Error('No image loaded');
    const t0 = performance.now();
    if (!field) field = analyse(source.rgba, source.w, source.h);
    const key = geometryKey(lines);
    if (!strokeCache || strokeCache.key !== key) {
        strokeCache = { key, set: buildStrokes(field, lines) };
    }
    return { set: strokeCache.set, field, traceMs: Math.round(performance.now() - t0) };
}

function applyWatermark(rgba: Uint8ClampedArray, width: number, mark: WatermarkMask) {
    // Mid-grey at 75 % opacity, composited with straight alpha.
    for (let y = 0; y < mark.h; y++) {
        for (let x = 0; x < mark.w; x++) {
            const m = mark.alpha[y * mark.w + x];
            if (!m) continue;
            const a = (m / 255) * 0.75;
            const k = ((mark.y + y) * width + (mark.x + x)) * 4;
            const da = rgba[k + 3] / 255;
            const oa = a + da * (1 - a);
            for (let c = 0; c < 3; c++) {
                rgba[k + c] = (128 * a + rgba[k + c] * da * (1 - a)) / oa;
            }
            rgba[k + 3] = oa * 255;
        }
    }
}

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
    (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
    const req = e.data;

    try {
        if (req.type === 'SET_SOURCE') {
            source = { w: req.width, h: req.height, rgba: new Uint8ClampedArray(req.buffer) };
            field = null;
            strokeCache = null;
        }

        else if (req.type === 'BUILD_MAPS') {
            if (!source) throw new Error('No image loaded');
            const { w: width, h: height } = source;
            const params = req.params;

            // The quantiser works in place, so give it its own copy.
            const imageData = new Uint8ClampedArray(source.rgba);

            // 0. Color Quantization (減色処理によるノイズ削減とシンプルな面構成化)
            // K数が有効な範囲（2〜128等）であれば適用
            const k = params.maps.colorQuantK || 0;
            if (k > 1 && k < 256) {
                const { labels, palette } = quantizeColors(
                    imageData, width, height, k, params.maps.colorSmoothing || 0
                );
                // 減色結果でイメージバッファを上書き（ポスタライズ）
                for (let i = 0; i < width * height; i++) {
                    const color = palette[labels[i]];
                    imageData[i * 4] = color[0];
                    imageData[i * 4 + 1] = color[1];
                    imageData[i * 4 + 2] = color[2];
                }
            }

            // 1. Gradients and direction
            // ※ Gain のスケーリングが強すぎて白飛びするのを防ぐため、内部で 0.3 倍程度に抑える
            const scaledGain = params.maps.gradientGain * 0.3;
            const { magnitude, direction } = computeGradients(
                imageData, width, height, scaledGain, params.maps.gradientThreshold, params.maps.scientificMode
            );

            // 2. Build gradient map visualization (RGBA buffer for Maps tab)
            const gradMapBuffer = new Uint8ClampedArray(width * height * 4);
            for (let i = 0; i < width * height; i++) {
                const mag = magnitude[i];
                const dir = direction[i];
                // Encode: magnitude as brightness, direction as hue
                const h = (dir + Math.PI) / (2 * Math.PI);
                
                // ノイズ（弱いエッジ）を完全に無視するため、一定以下のmagは0として切り捨てる
                // これにより背景の「微小な砂嵐ノイズ」が真っ黒になり、見やすくなります
                const visualMag = Math.max(0, mag - 0.15) * 1.2;

                // 弱いエッジは色（彩度）をつけず無彩色にし、強いエッジだけ鮮やかにする
                const s = visualMag > 0.05 ? Math.min(1.0, visualMag * 2.0) : 0;
                // ベースは「完全な黒(0.0)」とし、強いエッジだけが浮かび上がるようにする（最高0.65）
                const l = visualMag > 0.0 ? Math.min(0.65, visualMag * 0.8) : 0.0;

                let r: number, g: number, b: number;
                if (s === 0) {
                    r = g = b = l;
                } else {
                    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                    const p = 2 * l - q;

                    let tR = h + 1 / 3;
                    if (tR < 0) tR += 1; if (tR > 1) tR -= 1;
                    if (tR < 1 / 6) r = p + (q - p) * 6 * tR;
                    else if (tR < 1 / 2) r = q;
                    else if (tR < 2 / 3) r = p + (q - p) * (2 / 3 - tR) * 6;
                    else r = p;

                    let tG = h;
                    if (tG < 0) tG += 1; if (tG > 1) tG -= 1;
                    if (tG < 1 / 6) g = p + (q - p) * 6 * tG;
                    else if (tG < 1 / 2) g = q;
                    else if (tG < 2 / 3) g = p + (q - p) * (2 / 3 - tG) * 6;
                    else g = p;

                    let tB = h - 1 / 3;
                    if (tB < 0) tB += 1; if (tB > 1) tB -= 1;
                    if (tB < 1 / 6) b = p + (q - p) * 6 * tB;
                    else if (tB < 1 / 2) b = q;
                    else if (tB < 2 / 3) b = p + (q - p) * (2 / 3 - tB) * 6;
                    else b = p;
                }

                gradMapBuffer[i * 4] = r * 255;
                gradMapBuffer[i * 4 + 1] = g * 255;
                gradMapBuffer[i * 4 + 2] = b * 255;
                gradMapBuffer[i * 4 + 3] = 255;
            }

            // Send gradient map data back for Maps tab visualization
            post({
                type: 'MAPS_READY',
                requestId: req.requestId,
                status: 'ok',
                maps: { width, height, gradientMapBuffer: gradMapBuffer.buffer }
            } as WorkerResponse, [gradMapBuffer.buffer]);
        }

        else if (req.type === 'RENDER_LINES') {
            const { set, field: f, traceMs } = getStrokes(req.lines);
            const t0 = performance.now();
            const rgba = drawLines(f, set, req.lines, req.outW, req.outH);
            const drawMs = Math.round(performance.now() - t0);
            post({
                type: 'LINES_READY', requestId: req.requestId, status: 'ok',
                width: req.outW, height: req.outH, buffer: rgba.buffer, strokeCount: set.count,
                ms: { trace: traceMs, draw: drawMs }
            } as WorkerResponse, [rgba.buffer]);
        }

        else if (req.type === 'EXPORT_PNG') {
            const { set, field: f, traceMs } = getStrokes(req.lines);
            const t0 = performance.now();
            const rgba = drawLines(f, set, req.lines, req.outW, req.outH);
            if (req.watermark) applyWatermark(rgba, req.outW, req.watermark);
            const t1 = performance.now();
            const png = await encodePNG(rgba, req.outW, req.outH);
            const t2 = performance.now();
            post({
                type: 'PNG_READY', requestId: req.requestId, status: 'ok',
                buffer: png.buffer, width: req.outW, height: req.outH,
                ms: { trace: traceMs, draw: Math.round(t1 - t0), encode: Math.round(t2 - t1) }
            } as WorkerResponse, [png.buffer as ArrayBuffer]);
        }
    } catch (err: unknown) {
        post({
            type: 'ERROR',
            requestId: req.requestId,
            status: 'error',
            error: { code: 'PROCESSING_FAILED', message: err instanceof Error ? err.message : String(err) }
        } as WorkerResponse);
    }
};
