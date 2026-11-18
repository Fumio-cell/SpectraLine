import type { WorkerRequest, WorkerResponse, WatermarkMask } from './messageTypes';
import type { Params } from '../types';
import { analyse, buildStrokes, drawLines, geometryKey, sigmaOfScale, type Field, type StrokeSet } from '../lines/render';
import { measureBands, spectrumCells } from '../lines/spectrum';
import { encodePNG } from '../lines/png';
import { buildPlan, prepareMotion, renderFrame, type MotionPlan, type MotionTables } from '../lines/motion';
import { encodeMp4, videoSize } from '../video';

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

// Motion: the still with its per-pixel numbers, and the per-stroke timing of the clip. A cache of the settings.
let planCache: { key: string; plan: MotionPlan } | null = null;
let tablesCache: { key: string; tables: MotionTables } | null = null;

function getPlan(lines: Params['lines'], w: number, h: number): { plan: MotionPlan; traceMs: number; planMs: number } {
    const { set, field: f, traceMs } = getStrokes(lines);
    const key = [geometryKey(lines), lines.contrast, lines.solo.join(','), w, h].join('|');
    let planMs = 0;
    if (!planCache || planCache.key !== key) {
        const t0 = performance.now();
        planCache = { key, plan: buildPlan(f, set, lines, w, h) };
        tablesCache = null;
        planMs = Math.round(performance.now() - t0);
    }
    return { plan: planCache.plan, traceMs, planMs };
}

function getTables(plan: MotionPlan, mode: MotionTables['mode'], length: number): MotionTables {
    const key = `${planCache?.key}|${mode}|${length}`;
    if (!tablesCache || tablesCache.key !== key) tablesCache = { key, tables: prepareMotion(plan, mode, length) };
    return tablesCache.tables;
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
            planCache = null;
            tablesCache = null;
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

        else if (req.type === 'RENDER_FRAME') {
            const { plan, planMs } = getPlan(req.lines, req.outW, req.outH);
            const tables = getTables(plan, req.motion.mode, req.motion.length);
            const t0 = performance.now();
            const rgba = renderFrame(plan, tables, req.t);
            post({
                type: 'FRAME_READY', requestId: req.requestId, status: 'ok',
                width: req.outW, height: req.outH, buffer: rgba.buffer,
                ms: { plan: planMs, frame: Math.round((performance.now() - t0) * 10) / 10 }
            } as WorkerResponse, [rgba.buffer]);
        }

        else if (req.type === 'EXPORT_MP4') {
            if (!source) throw new Error('No image loaded');
            const { w, h } = videoSize(source.w, source.h);
            const { plan, traceMs, planMs } = getPlan(req.lines, w, h);
            const tables = getTables(plan, req.motion.mode, req.motion.length);
            const t0 = performance.now();
            const r = await encodeMp4(plan, tables, (done, total) => post({ type: 'MP4_PROGRESS', requestId: req.requestId, done, total } as WorkerResponse));
            post({
                type: 'MP4_READY', requestId: req.requestId, status: 'ok',
                buffer: r.bytes.buffer, width: r.width, height: r.height, frames: r.frames, level: r.level,
                ms: { trace: traceMs, plan: planMs, encode: Math.round(performance.now() - t0) }
            } as WorkerResponse, [r.bytes.buffer]);
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
