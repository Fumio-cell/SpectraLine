import type { LineParams, MotionMode, VideoSize } from '../types';
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
 * pixel of every frame is a pixel of the still, in its colour, and the last frame of EMERGE is the still
 * itself. On a black background a gain scales the colour (the line, over black); on a transparent one it
 * scales the alpha and leaves the colour as it is.
 */

export type { MotionMode, VideoSize };

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
 * How EMERGE + PULSE divides its length. EMERGE draws the picture for 30 % of the clip (a whole number of frames,
 * so one frame is exactly the finished still). Then the base eases down to the pulse floor while the pulses show: the
 * EASE is 30 % of the length, at least 1.4 s and at most 3 s. PULSE takes the rest. The ease cannot be shorter:
 * the light the picture loses is fixed by the picture, not by the clip, so a faster ease makes the frames in
 * it differ from each other by more than the pulses do (at 12 s with a 1.9 s ease the largest step was 1.3 to 1.4
 * times the median; at 3 s with a 0.5 s ease, 2.6 times). With this rule it is at most 1.48 times for every length from
 * 3 to 15 s on sample-4 and sample-5. EMERGE draws at a steady rate: the share of the still's light that has arrived grows linearly with time.
 */
export const BOTH_EMERGE_SHARE = 0.3;
export function bothTimeline(length: number): { emerge: number; ease: number } {
    const emerge = Math.round(BOTH_EMERGE_SHARE * length * FPS) / FPS;
    const ease = Math.round(Math.min(3.0, Math.max(1.4, 0.3 * length)) * FPS) / FPS;
    return { emerge, ease };
}

/** Pulse period of EMERGE + PULSE (it does not loop, so nothing has to divide its length). */
const BOTH_PERIOD = 2;

/**
 * Time of frame i. EMERGE ends on the still, so its last frame is the end of the clip; PULSE loops, so its
 * frame N is its frame 0 and the clip stops one frame before the loop closes. EMERGE + PULSE does not loop.
 */
export function frameTime(mode: MotionMode, length: number, i: number): number {
    const n = frameCount(length);
    return mode === 'emerge' ? (i / (n - 1)) * length : (i / n) * length;
}

/** The pixel size of a video: HD and UHD by the short side, DEMO by the long side; the aspect kept, sides even. */
export function videoDims(srcW: number, srcH: number, size: VideoSize): { w: number; h: number } {
    const k = size === 'demo' ? 1024 / Math.max(srcW, srcH) : (size === 'uhd' ? 2160 : 1080) / Math.min(srcW, srcH);
    const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
    return { w: even(srcW * k), h: even(srcH * k) };
}

/**
 * A PNG sequence at 4K is 95 to 182 MB per second of clip on a 2160x2160 picture (and 1.8 times that at 3840x2160): 15 s would
 * need up to 4.9 GB, over the 4 GiB a ZIP file can hold. 8 s is the longest offered: at most 2.6 GB.
 */
export const FRAMES_UHD_MAX_SECONDS = 8;

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
    /** True when the still has a transparent background: a gain then scales the alpha, not the colour. */
    alpha: boolean;
    /** The still: exactly what the still export draws at this size (opaque on black, or straight RGBA when transparent). */
    still: Uint8ClampedArray;
    /** What an unlit pixel is: opaque black, or fully transparent. */
    blank: Uint8ClampedArray;
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

/** Draw the still at w x h together with what motion needs to know about each of its pixels. */
export function buildPlan(field: Field, strokes: StrokeSet, p: LineParams, w: number, h: number): MotionPlan {
    const phiV = vertexPhi(strokes, field.s);
    const n = w * h;
    const aux: RasterAux = { vertexPhi: phiV, sid: new Int32Array(n).fill(-1), phi: new Float32Array(n), best: new Float32Array(n) };
    const alpha = p.background === 'transparent';
    const still = rasterize(strokes, { ...rasterOptions(field, p, w, h), aux });

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
    const blank = new Uint8ClampedArray(n * 4);
    if (!alpha) for (let i = 3; i < blank.length; i += 4) blank[i] = 255;
    return { w, h, alpha, still, blank, lit, sid, phi, total, ua, ub, strokes: strokes.count };
}

/* ------------------------------------------------------------------ the motions */

/** EMERGE: the part of the clip in which lines start and grow; the rest is the finished still. */
const EMERGE_GROW_END = 0.88;
/** The slowest-finishing line takes at most this share of the clip to grow. */
const EMERGE_LONGEST = 0.6;
/** Soft head of a growing line, in seconds of travel time (about 10 px at the middle speed). */
const EMERGE_HEAD = 0.04;

/**
 * PULSE: brightness between pulses, as a share of the still. A pulse brings a line back to the still, never above
 * it. SL-5 had 0.4 here (a pulse head 2.5 times the base) and a long tail; the owner asked for a larger difference.
 */
export const PULSE_FLOOR = 0.15;
/** A pulse is a comet: it rises ahead of its head and decays behind it; both in periods. */
const PULSE_LEAD = 0.03;
const PULSE_TAIL = 0.12;
const LUT_N = 2048;

/** Comet shape over u = time since the head passed this point, in periods [0, 1): 1 at the head, 0 far from it. */
const cometLut = (() => {
    const lut = new Float32Array(LUT_N);
    for (let i = 0; i < LUT_N; i++) {
        const u = i / LUT_N;
        const decay = Math.exp(-u / PULSE_TAIL);
        const x = Math.min(1, Math.max(0, (u - (1 - PULSE_LEAD)) / PULSE_LEAD));
        const rise = x * x * (3 - 2 * x);
        lut[i] = Math.max(decay, rise);
    }
    return lut;
})();

/** The pulse period for a clip of this length: a whole number of pulses fit, so the last frame leads into the first. */
export function pulsePeriod(length: number): number {
    const n = Math.max(1, Math.round(length / 2));
    return length / n;
}

const WARP_N = 1024;

export interface MotionTables {
    mode: MotionMode;
    length: number;
    /** EMERGE: start delay per stroke, and the speed factor shared by all lines. PULSE: phase per stroke. */
    offset: Float32Array;
    kappa: number;
    period: number;
    /** EMERGE + PULSE: seconds of EMERGE, seconds of ease, and the time warp that makes light arrive at a steady rate. */
    emerge: number;
    ease: number;
    warp: Float32Array | null;
}

/**
 * Per-stroke timing for a clip: O(strokes) (and one pass over the lit pixels for EMERGE + PULSE),
 * derived from the plan and the settings only.
 */
export function prepareMotion(plan: MotionPlan, mode: MotionMode, length: number): MotionTables {
    const n = plan.strokes;
    const offset = new Float32Array(n);
    let kappa = 1;
    let period = pulsePeriod(length);
    let emerge = 0, ease = 0;
    let warp: Float32Array | null = null;
    if (mode === 'emerge' || mode === 'both') {
        // EMERGE + PULSE grows its lines in the share of the clip that belongs to EMERGE.
        const span = mode === 'both' ? bothTimeline(length).emerge : length;
        let longest = 0;
        for (let k = 0; k < n; k++) if (plan.total[k] > longest) longest = plan.total[k];
        // Lines grow at the speed of their energy, unless the longest would need more than its share of the clip.
        kappa = longest > 0 ? Math.min(1, (EMERGE_LONGEST * span) / longest) : 1;
        for (let k = 0; k < n; k++) offset[k] = plan.ua[k] * Math.max(0, EMERGE_GROW_END * span - kappa * plan.total[k]);
        if (mode === 'both') {
            ({ emerge, ease } = bothTimeline(length));
            period = BOTH_PERIOD;
            warp = arrivalWarp(plan, offset, kappa);
        }
    } else if (mode === 'pulse') {
        for (let k = 0; k < n; k++) offset[k] = plan.ub[k] * period;
    }
    return { mode, length, offset, kappa, period, emerge, ease, warp };
}

/**
 * EMERGE + PULSE draws the picture at a steady rate: the share of the still's light that has arrived grows
 * linearly with time. The warp maps the clip's EMERGE time (0..1) onto the arrival times of the pixels so that
 * it does. It is monotonic, so every line still grows from its start in order, and it comes from the plan alone.
 */
function arrivalWarp(plan: MotionPlan, offset: Float32Array, kappa: number): Float32Array {
    const { lit, sid, phi, still } = plan;
    const n = lit.length;
    let last = 0;
    for (let j = 0; j < n; j++) { const t = offset[sid[j]] + kappa * phi[j]; if (t > last) last = t; }
    const end = last + kappa * EMERGE_HEAD * (1 + 1e-4);
    const BINS = 1024;
    const light = new Float64Array(BINS);
    let sum = 0;
    for (let j = 0; j < n; j++) {
        const p = lit[j] * 4;
        const t = offset[sid[j]] + kappa * phi[j];
        const w = (still[p] + still[p + 1] + still[p + 2]) * (plan.alpha ? still[p + 3] / 255 : 1);
        light[Math.min(BINS - 1, Math.floor((t / end) * BINS))] += w;
        sum += w;
    }
    const warp = new Float32Array(WARP_N + 1);
    if (sum <= 0) { for (let i = 0; i <= WARP_N; i++) warp[i] = (i / WARP_N) * end; return warp; }
    let acc = 0, b = 0;
    warp[0] = 0;
    for (let i = 1; i <= WARP_N; i++) {
        const target = (i / WARP_N) * sum;
        while (b < BINS - 1 && acc + light[b] < target) { acc += light[b]; b++; }
        const frac = light[b] > 0 ? Math.min(1, Math.max(0, (target - acc) / light[b])) : 1;
        warp[i] = ((b + frac) / BINS) * end;
    }
    warp[WARP_N] = end;
    return warp;
}

/** The frame at time t (seconds): the still, every pixel scaled by its gain. `out` (plan.w x plan.h x 4) may be reused. */
export function renderFrame(plan: MotionPlan, tb: MotionTables, t: number, out?: Uint8ClampedArray): Uint8ClampedArray {
    const frame = out ?? new Uint8ClampedArray(plan.blank.length);
    frame.set(plan.blank);
    const { lit, sid, phi, still } = plan;
    const n = lit.length;
    const alpha = plan.alpha;
    if (tb.mode === 'still') { frame.set(still); return frame; }
    const off = tb.offset;

    // Writes a pixel of the still with a gain g in (0, 1]: black background scales the colour, transparent scales the alpha.
    const put = (p: number, g: number) => {
        if (g >= 1) { frame[p] = still[p]; frame[p + 1] = still[p + 1]; frame[p + 2] = still[p + 2]; frame[p + 3] = still[p + 3]; return; }
        if (alpha) { frame[p] = still[p]; frame[p + 1] = still[p + 1]; frame[p + 2] = still[p + 2]; frame[p + 3] = still[p + 3] * g; }
        else { frame[p] = still[p] * g; frame[p + 1] = still[p + 1] * g; frame[p + 2] = still[p + 2] * g; }
    };

    const growing = tb.mode === 'emerge' || (tb.mode === 'both' && t <= tb.emerge + 1e-9);
    if (growing) {
        let tt = t;
        if (tb.mode === 'both' && tb.warp) {
            const f = Math.min(1, Math.max(0, t / tb.emerge)) * WARP_N;
            const i = Math.min(WARP_N - 1, Math.floor(f));
            tt = tb.warp[i] + (tb.warp[i + 1] - tb.warp[i]) * (f - i);
        }
        const kappa = tb.kappa, inv = 1 / (kappa * EMERGE_HEAD);
        for (let j = 0; j < n; j++) {
            const x = (tt - off[sid[j]] - kappa * phi[j]) * inv;
            if (x <= 0) continue;
            put(lit[j] * 4, x >= 1 ? 1 : x * x * (3 - 2 * x));
        }
        return frame;
    }

    // PULSE (and the PULSE part of EMERGE + PULSE): a comet travels along every line; between comets a line sits at the base.
    // In EMERGE + PULSE the base eases from the finished still (1) down to the pulse floor, so no frame jumps.
    const both = tb.mode === 'both';
    let base = PULSE_FLOOR;
    let time = t;
    if (both) {
        const x = Math.min(1, Math.max(0, (t - tb.emerge) / tb.ease));
        // Half linear, half smoothstep: it starts gently, and no frame loses more light than the pulses move.
        base = 1 - (1 - PULSE_FLOOR) * (0.5 * x + 0.5 * x * x * (3 - 2 * x));
        time = t - tb.emerge;
    }
    const gain = new Float32Array(LUT_N);
    for (let i = 0; i < LUT_N; i++) gain[i] = base + (1 - base) * cometLut[i];
    const inv = 1 / tb.period;
    for (let j = 0; j < n; j++) {
        // Time since the pulse head passed this point, in periods, wrapped to [0, 1).
        let u = (time - phi[j] - (both ? plan.ub[sid[j]] * tb.period : off[sid[j]])) * inv;
        u -= Math.floor(u);
        put(lit[j] * 4, gain[(u * LUT_N) | 0]);
    }
    return frame;
}
