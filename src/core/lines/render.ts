import type { LineParams } from '../types';
import { analyse, sigmaOfScale, widthFactor, type Field } from './field';
import { buildStrokes, type StrokeSet } from './trace';
import { rasterize } from './raster';

export { analyse, buildStrokes, rasterize, sigmaOfScale };
export type { Field, StrokeSet };

/** Long edge, in px, at which the picture is analysed and lines are traced. */
export const WORK_EDGE = 1024;

/** Settings that change the geometry (width matters for FLOW spacing); background just re-draws it. */
export function geometryKey(p: LineParams): string {
    // ISOLINES are deterministic contours: the seed does not enter, so it never forces a retrace.
    return p.mode === 'isolines'
        ? JSON.stringify([p.mode, p.levels, p.minLength, p.scale])
        : JSON.stringify([p.mode, p.spacing, p.width, p.length, p.calm, p.seed, p.scale, p.mode === 'spectrum' ? p.bands : 0]);
}

/** Pixel size for a picture of the given proportions at a chosen long edge. */
export function sizeForEdge(srcW: number, srcH: number, edge: number): { w: number; h: number } {
    const k = edge / Math.max(srcW, srcH);
    return { w: Math.max(1, Math.round(srcW * k)), h: Math.max(1, Math.round(srcH * k)) };
}

/** Draw a stroke set at the given output size. */
export function drawLines(field: Field, strokes: StrokeSet, p: LineParams, outW: number, outH: number): Uint8ClampedArray {
    return rasterize(strokes, {
        srcW: field.w, srcH: field.h, outW, outH,
        // The line width follows the reading scale, exactly as the tracer assumed.
        width: p.width * widthFactor(field.sigma), background: p.background, contrast: p.contrast,
        solo: p.mode === 'spectrum' && p.solo && p.solo.length ? p.solo : undefined
    });
}
