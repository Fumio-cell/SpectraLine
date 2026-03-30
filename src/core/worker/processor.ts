import type { WorkerRequest, WorkerResponse } from './messageTypes';
import { computeGradients } from '../maps/gradient';
import { buildStrokes } from '../lines/tracer';
import { quantizeColors } from '../maps/quantize';
import { generateContours } from '../maps/contours';

// Store mapped state in worker memory
let currentMaps: any = null;

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
    const req = e.data;

    try {
        if (req.type === 'BUILD_MAPS') {
            const { imageBuffer, width, height } = req.input;
            const params = req.params;

            // Report start
            self.postMessage({ type: 'PROGRESS', requestId: req.requestId, status: 'ok', progress: 0.1 } as WorkerResponse);

            // Reconstruct buffer
            let imageData = new Uint8ClampedArray(imageBuffer);

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
            const { magnitude, direction, luminance } = computeGradients(
                imageData, width, height, scaledGain, params.maps.gradientThreshold, params.maps.scientificMode
            );
            self.postMessage({ type: 'PROGRESS', requestId: req.requestId, status: 'ok', progress: 0.7 } as WorkerResponse);

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

            currentMaps = {
                width, height,
                magnitude, direction, luminance,
                imageData // Keep source image data for stroke coloring
            };

            // Send gradient map data back for Maps tab visualization
            (self as unknown as Worker).postMessage({
                type: 'MAPS_READY',
                requestId: req.requestId,
                status: 'ok',
                maps: { width, height, gradientMapBuffer: gradMapBuffer.buffer }
            } as WorkerResponse, [gradMapBuffer.buffer]);
        }

        else if (req.type === 'BUILD_STROKES') {
            if (!currentMaps) {
                throw new Error('Maps must be built before strokes');
            }

            const strokes = buildStrokes(
                currentMaps.width,
                currentMaps.height,
                currentMaps.magnitude,
                currentMaps.direction,
                currentMaps.luminance,
                req.params.lines,
                currentMaps.imageData
            );

            // ---- Contours (等高線) の結合 ----
            if (req.params.maps && req.params.maps.contoursEnabled) {
                const levels = req.params.maps.contourLevels || 12;
                const polylines = generateContours(
                    currentMaps.luminance,
                    currentMaps.width,
                    currentMaps.height,
                    levels,
                    req.params.maps.contourSmoothing || 0
                );

                // 膨大な数の等高線セグメント（数十万個）によるスプレッド構文(unshift(...))の
                // Call stack size exceeded エラーとブラウザのフリーズを防ぐため、
                // 最大描画数を制限し、安全に配列に結合します。
                const MAX_CONTOURS = 20000; 
                const step = Math.max(1, Math.floor(polylines.length / MAX_CONTOURS));
                const contourStrokes = [];

                for (let i = 0; i < polylines.length; i += step) {
                    const pl = polylines[i];
                    const raw = [];
                    for (let j = 0; j < pl.points.length; j++) {
                        raw.push(pl.points[j].x, pl.points[j].y, 1.0, 0.9);
                    }
                    contourStrokes.push({
                        id: `contour_${Date.now()}_${i}`,
                        points: new Float32Array(raw),
                        style: {
                            widthMin: req.params.lines.widthMin || 0.5,
                            widthMax: req.params.lines.widthMin || 1.0, 
                            taper: 0,
                            alpha: 0.85,
                            color: { r: 25, g: 25, b: 35 }
                        },
                        meta: { source: 'contour', seedUsed: 0 }
                    });
                }
                
                // スプレッド構文ではなく安全なループで追加、または splice
                // contourStrokes が最大 20,000 に抑えられているので、unshift.apply でも安全ですが
                // 確実に安全な Array.prototype.unshift.apply を使用せずループで追加します
                for (let i = contourStrokes.length - 1; i >= 0; i--) {
                    strokes.unshift(contourStrokes[i] as any);
                }
            }

            // Collect all Float32Array buffers for zero-copy transfer
            const pointBuffers = strokes.map(s => s.points.buffer);

            self.postMessage({
                type: 'STROKES_READY',
                requestId: req.requestId,
                status: 'ok',
                strokes: strokes
            } as WorkerResponse, pointBuffers as any);
        }
    } catch (err: any) {
        self.postMessage({
            type: 'ERROR',
            requestId: req.requestId,
            status: 'error',
            error: { code: 'PROCESSING_FAILED', message: err.message }
        } as WorkerResponse);
    }
};
