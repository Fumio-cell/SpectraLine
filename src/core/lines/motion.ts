import type { LineParams, MotionMode } from '../types';
import type { Field } from './field';
import type { StrokeSet } from './trace';
import { rasterize, type RasterAux } from './raster';
import { rasterOptions } from './render';

/**
 * Motion along the lines the still draws.
 *
 * Every frame is a pure function of (picture, settings, time): the still is drawn once and, with it, two
 * numbers for every pixel it paints: which stroke paints it and how long a point travelling along that
 * stroke at the speed of its energy needs to reach it (its travel time). A frame is then the still with
 * each pixel scaled by a gain that depends on nothing but those two numbers and the time. No frame reads
 * another; the still and the per-pixel numbers are a cache of the settings, not a state.
 *
 * Nothing is added: a gain never exceeds 1 and is never applied where the still has no line, so every lit
 * pixel of every frame is a pixel of the still, in its colour (a gain scales a colour, it does not change its hue
 * or purity), and the last frame of EMERGE is the still itself.
 */

export type { MotionMode };

export const FPS = 30;
export const LENGTH_MIN = 3;
export const LENGTH_MAX = 15;
export const LENGTH_DEFAULT = 6;

/**
 * Speed along a line, in px of a 1024 px picture per second, from the measured energy 0..1 where the point is:
 * stronger flow, faster. Linear, so it is monotonic.
 */
export const SPEED_MIN = 120;
export const SPEED_MAX = 420;
export const speedOf = (energy: number) => SPEED_MIN + (SPEED_MAX - SPEED_MIN) * energy;

/** The frames of a clip: its length in seconds at FPS. */
export const frameCount = (length: number) => Math.round(Math.min(LENGTH_MAX, Math.max(LENGTH_MIN, length)) * FPS);

/**
 * Time of frame i. EMERGE ends on the still, so its last frame is the end of the clip; PULSE loops, so its
 * frame N is its frame 0 and the clip stops one frame before the loop closes.
 */
export function frameTime(mode: MotionMode, length: number, i: number): number {
    const n = frameCount(length);
    return mode === 'emerge' ? (i / (n - 1)) * length : (i / n) * length;
}

/** Deterministic hash of a few integers to [0, 1). */
function hash01(a: number, b: number, c: number, d: number): number {
    let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35) ^ Math.imul(d | 0, 0x27d4eb2f);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}

/** Travel time at each vertex of each stroke: the integral of ds / speed(energy) along the stroke (seconds). */
export function vertexPhi(set: StrokeSet, s: number): Float32Array {
    const phi = new Float32Array(set.x.length);
    for (let k = 0; k < set.count; k++) {
        const v0 = set.start[k], v1 = set.start[k + 1];
        let acc = 0;
        if (v1 > v0) phi[v0] = 0;
        for (let i = v0 + 1; i < v1; i++) {
            const ds = Math.hypot(set.x[i] - set.x[i - 1], set.y[i] - set.y[i - 1]) / s; // px at 1024
            const e = (set.e[i] + set.e[i - 1]) / 510;
            acc += ds / speedOf(e);
            phi[i] = acc;
        }
    }
    return phi;
}

export interface MotionPlan {
    w: number;
    h: number;
    /** The still, opaque on black: exactly what the still export draws at this size. */
    still: Uint8ClampedArray;
    black: Uint8ClampedArray;
    /** The pixels the still paints, the stroke that paints each, and its travel time. */
    lit: Uint32Array;
    sid: Int32Array;
    phi: Float32Array;
    /** Travel time to the end of each stroke, and two numbers per stroke from its own data (seed, first vertex, size). */
    total: Float32Array;
    ua: Float32Array;
    ub: Float32Array;
    strokes: number;
}

/** Draw the still at w x h (on black) together with what motion needs to know about each of its pixels. */
export function buildPlan(field: Field, strokes: StrokeSet, p: LineParams, w: number, h: number): MotionPlan {
    const phiV = vertexPhi(strokes, field.s);
    const n = w * h;
    const aux: RasterAux = { vertexPhi: phiV, sid: new Int32Array(n).fill(-1), phi: new Float32Array(n), best: new Float32Array(n) };
    const still = rasterize(strokes, { ...rasterOptions(field, { ...p, background: 'black' }, w, h), aux });

    let count = 0;
    for (let i = 0; i < n; i++) if (aux.sid[i] >= 0) count++;
    const lit = new Uint32Array(count), sid = new Int32Array(count), phi = new Float32Array(count);
    for (let i = 0, j = 0; i < n; i++) {
        if (aux.sid[i] < 0) continue;
        lit[j] = i; sid[j] = aux.sid[i]; phi[j] = aux.phi[i]; j++;
    }

    const total = new Float32Array(strokes.count), ua = new Float32Array(strokes.count), ub = new Float32Array(strokes.count);
    for (let k = 0; k < strokes.count; k++) {
        const v0 = strokes.start[k], v1 = strokes.start[k + 1];
        total[k] = v1 > v0 ? phiV[v1 - 1] : 0;
        // The line's own data: where it starts, how many vertices it has, and the fixed seed.
        const x0 = Math.round(strokes.x[v0] * 16), y0 = Math.round(strokes.y[v0] * 16);
        ua[k] = hash01(p.seed, x0, y0, v1 - v0);
        ub[k] = hash01(p.seed + 7919, y0, x0, v1 - v0);
    }
    const black = new Uint8ClampedArray(n * 4);
    for (let i = 3; i < black.length; i += 4) black[i] = 255;
    return { w, h, still, black, lit, sid, phi, total, ua, ub, strokes: strokes.count };
}

/* ------------------------------------------------------------------ the two motions */

/** EMERGE: the part of the clip in which lines start and grow; the rest is the finished still. */
const EMERGE_GROW_END = 0.88;
/** The slowest-finishing line takes at most this share of the clip to grow. */
const EMERGE_LONGEST = 0.6;
/** Soft head of a growing line, in seconds of travel time (about 10 px at the middle speed). */
const EMERGE_HEAD = 0.04;

/** PULSE: brightness between pulses, as a share of the still (a pulse brings a line back to the still, never above). */
export const PULSE_FLOOR = 0.4;
const PULSE_TAIL = 0.22; // decay of a pulse behind its head, in periods
const PULSE_LEAD = 0.035; // rise ahead of its head, in periods
const LUT_N = 2048;

const pulseLut = (() => {
    const lut = new Float32Array(LUT_N);
    for (let i = 0; i < LUT_N; i++) {
        const u = i / LUT_N; // time since the pulse head passed this point, in periods
        const decay = Math.exp(-u / PULSE_TAIL);
        const x = Math.min(1, Math.max(0, (u - (1 - PULSE_LEAD)) / PULSE_LEAD));
        const rise = x * x * (3 - 2 * x);
        lut[i] = PULSE_FLOOR + (1 - PULSE_FLOOR) * Math.max(decay, rise);
    }
    return lut;
})();

/** The pulse period for a clip of this length: a whole number of pulses fit, so the last frame leads into the first. */
export function pulsePeriod(length: number): number {
    const n = Math.max(1, Math.round(length / 2));
    return length / n;
}

export interface MotionTables {
    mode: MotionMode;
    length: number;
    /** EMERGE: start delay per stroke, and the speed factor shared by all lines. PULSE: phase per stroke. */
    offset: Float32Array;
    kappa: number;
    period: number;
}

/** Per-stroke timing for a clip: O(strokes), derived from the plan and the settings only. */
export function prepareMotion(plan: MotionPlan, mode: MotionMode, length: number): MotionTables {
    const n = plan.strokes;
    const offset = new Float32Array(n);
    let kappa = 1;
    const period = pulsePeriod(length);
    if (mode === 'emerge') {
        let longest = 0;
        for (let k = 0; k < n; k++) if (plan.total[k] > longest) longest = plan.total[k];
        // Lines grow at the speed of their energy, unless the longest would need more than its share of the clip.
        kappa = longest > 0 ? Math.min(1, (EMERGE_LONGEST * length) / longest) : 1;
        for (let k = 0; k < n; k++) offset[k] = plan.ua[k] * Math.max(0, EMERGE_GROW_END * length - kappa * plan.total[k]);
    } else if (mode === 'pulse') {
        for (let k = 0; k < n; k++) offset[k] = plan.ub[k] * period;
    }
    return { mode, length, offset, kappa, period };
}

/** The frame at time t (seconds): the still, every pixel scaled by its gain. */
export function renderFrame(plan: MotionPlan, tb: MotionTables, t: number): Uint8ClampedArray {
    const out = new Uint8ClampedArray(plan.black);
    const { lit, sid, phi, still } = plan;
    const n = lit.length;
    if (tb.mode === 'still') { out.set(still); return out; }
    const off = tb.offset;
    if (tb.mode === 'emerge') {
        const kappa = tb.kappa, inv = 1 / (kappa * EMERGE_HEAD);
        for (let j = 0; j < n; j++) {
            const x = (t - off[sid[j]] - kappa * phi[j]) * inv;
            if (x <= 0) continue;
            const p = lit[j] * 4;
            if (x >= 1) { out[p] = still[p]; out[p + 1] = still[p + 1]; out[p + 2] = still[p + 2]; continue; }
            const g = x * x * (3 - 2 * x);
            out[p] = still[p] * g; out[p + 1] = still[p + 1] * g; out[p + 2] = still[p + 2] * g;
        }
        return out;
    }
    const inv = 1 / tb.period;
    for (let j = 0; j < n; j++) {
        // Time since the pulse head passed this point, in periods, wrapped to [0, 1).
        let u = (t - phi[j] - off[sid[j]]) * inv;
        u -= Math.floor(u);
        const g = pulseLut[(u * LUT_N) | 0];
        const p = lit[j] * 4;
        out[p] = still[p] * g; out[p + 1] = still[p + 1] * g; out[p + 2] = still[p + 2] * g;
    }
    return out;
}
