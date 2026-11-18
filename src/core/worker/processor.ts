import type { WorkerRequest, WorkerResponse, WatermarkMask } from './messageTypes';
import type { Params } from '../types';
import { analyse, buildStrokes, drawLines, geometryKey, sigmaOfScale, type Field, type StrokeSet } from '../lines/render';
import { measureBands, spectrumCells } from '../lines/spectrum';
import { encodePNG } from '../lines/png';

/** The spectrum is always measured in 9 bands plus the purples. */
const SPECTRUM_BANDS = 9;

// Working state, kept in worker memory.
let source: { w: number; h: number; rgba: Uint8ClampedArray } | null = null;
let field: Field | null = null;
let fieldSigma = 0;
let strokeCache: { key: string; set: StrokeSet } | null = null;

function getStrokes(lines: Params['lines']): { set: StrokeSet; field: Field; traceMs: number } {
    if (!source) throw new Error('No image loaded');
    const t0 = performance.now();
    // The picture is read again only when SCALE changes.
    const sigma = sigmaOfScale(lines.scale);
    if (!field || fieldSigma !== sigma) { field = analyse(source.rgba, source.w, source.h, sigma); fieldSigma = sigma; strokeCache = null; }
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

        else if (req.type === 'GET_SPECTRUM') {
            if (!source) throw new Error('No image loaded');
            const cells = spectrumCells(measureBands(source.rgba, source.w, source.h, SPECTRUM_BANDS));
            post({ type: 'SPECTRUM_READY', requestId: req.requestId, status: 'ok', cells } as WorkerResponse);
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
