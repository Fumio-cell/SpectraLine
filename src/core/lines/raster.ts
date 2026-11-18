import type { Background } from '../types';
import type { StrokeSet } from './trace';

/**
 * Software anti-aliased line rasteriser.
 *
 * Written by hand (rather than using canvas 2D) so the pixels are a pure
 * function of the strokes: no browser anti-aliasing, GPU or font differences,
 * and it runs in the worker at any size. Compositing is done in 16 bit
 * premultiplied RGBA and converted to 8 bit once at the end.
 */

/**
 * How the energy of the picture at a vertex becomes the line there. These functions are the only
 * place a line's width and brightness come from; the input is a measured value, 0..1.
 *
 * The curve is e^contrast: monotonic for every contrast >= 0, so a weaker point is never brighter
 * or wider than a stronger one and nothing is added. Contrast 0 is flat (every vertex alike, as
 * in SL-1); larger values make strong places glow and calm places fade.
 */
export const DEFAULT_CONTRAST = 0.75;
export const energyCurve = (e: number, contrast: number) => Math.pow(e, contrast);
export const energyWidth = (e: number, contrast: number) => 0.5 + 0.9 * energyCurve(e, contrast);
export const energyAlpha = (e: number, contrast: number) => 0.06 + 0.94 * energyCurve(e, contrast);

/**
 * What motion needs to know about every pixel the still paints, filled while the still is drawn:
 * which stroke paints it most, and how far along that stroke it lies in travel time (see motion.ts).
 * Reading these never changes a pixel of the still.
 */
export interface RasterAux {
    /** Travel time at each stroke vertex, in the units of motion.ts (one number per vertex of the StrokeSet). */
    vertexPhi: Float32Array;
    /** Per output pixel: the stroke that paints it most (-1 where nothing is painted), its travel time, and its weight. */
    sid: Int32Array;
    phi: Float32Array;
    best: Float32Array;
}

export interface RasterOptions {
    /** Source (working) size the strokes live in. */
    srcW: number;
    srcH: number;
    outW: number;
    outH: number;
    /** Line width in px at a 1024 px long edge. */
    width: number;
    background: Background;
    /** Exponent of the energy curve (see energyCurve); default DEFAULT_CONTRAST. */
    contrast?: number;
    /** SPECTRUM: draw only the strokes of these bands. */
    solo?: number[];
    /** Motion: record, per pixel, the stroke and travel time that paint it. */
    aux?: RasterAux;
}

export function rasterize(set: StrokeSet, o: RasterOptions): Uint8ClampedArray {
    const { outW, outH } = o;
    const kx = outW / o.srcW, ky = outH / o.srcH;
    const contrast = o.contrast ?? DEFAULT_CONTRAST;
    const keep = o.solo ? new Uint8Array(256) : null;
    if (keep && o.solo) for (const b of o.solo) keep[b & 255] = 1;
    const scale = Math.max(outW, outH) / 1024;
    const acc = new Uint16Array(outW * outH * 4);
    const aux = o.aux;

    // Catmull-Rom subdivision keeps big exports smooth: ~one sub-segment per 1.5 px of preview.
    const sub = Math.max(1, Math.round(scale / 1.5));

    let ptsX = new Float32Array(256), ptsY = new Float32Array(256);
    let ptsR = new Float32Array(256), ptsG = new Float32Array(256), ptsB = new Float32Array(256);
    let ptsW = new Float32Array(256), ptsA = new Float32Array(256);
    let ptsP = new Float32Array(256);

    for (let s = 0; s < set.count; s++) {
        if (keep && !keep[set.tag[s]]) continue;
        const v0 = set.start[s], v1 = set.start[s + 1];
        const n = v1 - v0;
        if (n < 2) continue;
        const cap = (n - 1) * sub + 1;
        if (cap > ptsX.length) {
            const c = cap * 2;
            ptsX = new Float32Array(c); ptsY = new Float32Array(c);
            ptsR = new Float32Array(c); ptsG = new Float32Array(c); ptsB = new Float32Array(c);
            ptsW = new Float32Array(c); ptsA = new Float32Array(c);
            ptsP = new Float32Array(c);
        }

        // Build (sub-divided) point list in output space with per-point width.
        const baseW = Math.max(0.05, o.width) * scale * 0.5; // radius at energy 1 is 1.4x this
        let m = 0;
        for (let i = 0; i < n - 1; i++) {
            const a = v0 + i;
            const b = a + 1;
            const pa = i > 0 ? a - 1 : a;
            const pb = i < n - 2 ? b + 1 : b;
            for (let j = 0; j < sub; j++) {
                const t = j / sub;
                let x: number, y: number;
                if (sub === 1) {
                    x = set.x[a]; y = set.y[a];
                } else {
                    const t2 = t * t, t3 = t2 * t;
                    x = 0.5 * ((2 * set.x[a]) + (-set.x[pa] + set.x[b]) * t + (2 * set.x[pa] - 5 * set.x[a] + 4 * set.x[b] - set.x[pb]) * t2 + (-set.x[pa] + 3 * set.x[a] - 3 * set.x[b] + set.x[pb]) * t3);
                    y = 0.5 * ((2 * set.y[a]) + (-set.y[pa] + set.y[b]) * t + (2 * set.y[pa] - 5 * set.y[a] + 4 * set.y[b] - set.y[pb]) * t2 + (-set.y[pa] + 3 * set.y[a] - 3 * set.y[b] + set.y[pb]) * t3);
                }
                ptsX[m] = x * kx; ptsY[m] = y * ky;
                ptsR[m] = set.r[a] + (set.r[b] - set.r[a]) * t;
                ptsG[m] = set.g[a] + (set.g[b] - set.g[a]) * t;
                ptsB[m] = set.b[a] + (set.b[b] - set.b[a]) * t;
                const e = (set.e[a] + (set.e[b] - set.e[a]) * t) / 255;
                ptsW[m] = baseW * energyWidth(e, contrast);
                ptsA[m] = energyAlpha(e, contrast);
                if (aux) ptsP[m] = aux.vertexPhi[a] + (aux.vertexPhi[b] - aux.vertexPhi[a]) * t;
                m++;
            }
        }
        ptsX[m] = set.x[v1 - 1] * kx; ptsY[m] = set.y[v1 - 1] * ky;
        ptsR[m] = set.r[v1 - 1]; ptsG[m] = set.g[v1 - 1]; ptsB[m] = set.b[v1 - 1];
        ptsW[m] = baseW * energyWidth(set.e[v1 - 1] / 255, contrast);
        ptsA[m] = energyAlpha(set.e[v1 - 1] / 255, contrast);
        if (aux) ptsP[m] = aux.vertexPhi[v1 - 1];
        m++;

        for (let i = 0; i < m - 1; i++) {
            drawSegment(
                acc, outW, outH,
                ptsX[i], ptsY[i], ptsX[i + 1], ptsY[i + 1],
                ptsW[i], ptsW[i + 1],
                ptsR[i], ptsG[i], ptsB[i], ptsR[i + 1], ptsG[i + 1], ptsB[i + 1],
                ptsA[i], ptsA[i + 1], i === 0, i === m - 2,
                aux, s, ptsP[i], ptsP[i + 1]
            );
        }
    }

    // 16 bit premultiplied -> 8 bit straight RGBA.
    const out = new Uint8ClampedArray(outW * outH * 4);
    const opaque = o.background === 'black';
    for (let i = 0; i < outW * outH; i++) {
        const k = i * 4;
        const a = acc[k + 3];
        if (opaque) {
            // Premultiplied colour over black is just the premultiplied colour.
            out[k] = Math.round(acc[k] / 257);
            out[k + 1] = Math.round(acc[k + 1] / 257);
            out[k + 2] = Math.round(acc[k + 2] / 257);
            out[k + 3] = 255;
        } else if (a > 0) {
            out[k] = Math.round((acc[k] / a) * 255);
            out[k + 1] = Math.round((acc[k + 1] / a) * 255);
            out[k + 2] = Math.round((acc[k + 2] / a) * 255);
            out[k + 3] = Math.round(a / 257);
        }
    }
    return out;
}

function drawSegment(
    acc: Uint16Array, W: number, H: number,
    x0: number, y0: number, x1: number, y1: number,
    r0: number, r1: number,
    cr0: number, cg0: number, cb0: number, cr1: number, cg1: number, cb1: number,
    al0: number, al1: number, first: boolean, last: boolean,
    aux?: RasterAux, sid?: number, ph0?: number, ph1?: number
) {
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) return;
    const rMax = Math.max(r0, r1) + 1;
    const xa = Math.max(0, Math.floor(Math.min(x0, x1) - rMax));
    const xb = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + rMax));
    const ya = Math.max(0, Math.floor(Math.min(y0, y1) - rMax));
    const yb = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + rMax));

    for (let py = ya; py <= yb; py++) {
        const qy = py + 0.5 - y0;
        for (let px = xa; px <= xb; px++) {
            const qx = px + 0.5 - x0;
            const t = (qx * dx + qy * dy) / len2;
            // Segments own the strip between their end normals, so a joint is
            // never composited twice. Only the two ends of the line get round caps.
            if (t < 0 && !first) continue;
            if (t >= 1 && !last) continue;
            const tc = t < 0 ? 0 : t > 1 ? 1 : t;
            const ex = qx - tc * dx, ey = qy - tc * dy;
            const d = Math.sqrt(ex * ex + ey * ey);
            const r = r0 + (r1 - r0) * tc;
            let cov = r + 0.5 - d;
            if (cov <= 0) continue;
            if (cov > 1) cov = 1;
            const a = cov * (al0 + (al1 - al0) * tc);
            const k = (py * W + px) * 4;
            const cr = (cr0 + (cr1 - cr0) * tc) * 257;
            const cg = (cg0 + (cg1 - cg0) * tc) * 257;
            const cb = (cb0 + (cb1 - cb0) * tc) * 257;
            acc[k] = acc[k] + (cr - acc[k]) * a + 0.5;
            acc[k + 1] = acc[k + 1] + (cg - acc[k + 1]) * a + 0.5;
            acc[k + 2] = acc[k + 2] + (cb - acc[k + 2]) * a + 0.5;
            acc[k + 3] = acc[k + 3] + (65535 - acc[k + 3]) * a + 0.5;
            if (aux) {
                const q = py * W + px;
                if (a >= aux.best[q]) { aux.best[q] = a; aux.sid[q] = sid!; aux.phi[q] = ph0! + (ph1! - ph0!) * tc; }
            }
        }
    }
}
