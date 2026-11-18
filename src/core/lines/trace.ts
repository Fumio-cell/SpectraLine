import type { LineParams } from '../types';
import { energyOf, isoMaps, type Field } from './field';
import { buildBands } from './spectrum';

/**
 * A set of polylines in working-image coordinates (pixel i covers [i, i+1)).
 * Vertices are packed; stroke k owns vertices start[k] .. start[k+1]-1.
 */
export interface StrokeSet {
    count: number;
    start: Uint32Array;
    x: Float32Array;
    y: Float32Array;
    r: Uint8Array;
    g: Uint8Array;
    b: Uint8Array;
    /**
     * Energy of the picture at each vertex, 0..255. The rasteriser turns this, and nothing else,
     * into the brightness and width of the line there.
     */
    e: Uint8Array;
    /** Band index for SPECTRUM (0 for the other looks). */
    tag: Uint8Array;
}

/** Small, fast, seedable PRNG (mulberry32). Same seed -> same sequence on every machine. */
export function makeRng(seed: number): () => number {
    let a = (seed >>> 0) || 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

class Builder {
    private strokes = 0;
    private verts = 0;
    private start = new Uint32Array(1024);
    private x = new Float32Array(1 << 16);
    private y = new Float32Array(1 << 16);
    private r = new Uint8Array(1 << 16);
    private g = new Uint8Array(1 << 16);
    private b = new Uint8Array(1 << 16);
    private e = new Uint8Array(1 << 16);
    private tag = new Uint8Array(1024);

    private growVerts(need: number) {
        if (this.verts + need <= this.x.length) return;
        let cap = this.x.length;
        while (cap < this.verts + need) cap *= 2;
        const grow = <T extends Float32Array | Uint8Array>(a: T): T => {
            const n = new (a.constructor as new (n: number) => T)(cap);
            n.set(a);
            return n;
        };
        this.x = grow(this.x); this.y = grow(this.y);
        this.r = grow(this.r); this.g = grow(this.g); this.b = grow(this.b); this.e = grow(this.e);
    }

    begin(tag: number) {
        if (this.strokes + 2 > this.start.length) {
            const n = this.start.length * 2;
            const s = new Uint32Array(n); s.set(this.start); this.start = s;
            const t = new Uint8Array(n); t.set(this.tag); this.tag = t;
        }
        this.start[this.strokes] = this.verts;
        this.tag[this.strokes] = tag;
    }

    push(x: number, y: number, r: number, g: number, b: number, e: number) {
        this.growVerts(1);
        const v = this.verts++;
        this.x[v] = x; this.y[v] = y;
        this.r[v] = r; this.g[v] = g; this.b[v] = b;
        this.e[v] = Math.round(Math.min(1, Math.max(0, e)) * 255);
    }

    end() {
        this.strokes++;
        this.start[this.strokes] = this.verts;
    }

    finish(): StrokeSet {
        const n = this.strokes, v = this.verts;
        return {
            count: n,
            start: this.start.slice(0, n + 1),
            x: this.x.slice(0, v), y: this.y.slice(0, v),
            r: this.r.slice(0, v), g: this.g.slice(0, v), b: this.b.slice(0, v),
            e: this.e.slice(0, v), tag: this.tag.slice(0, n)
        };
    }
}

/** Bilinear sample of a plane at (x, y) in pixel-centre coordinates. */
export function bilinear(plane: Float32Array, w: number, h: number, x: number, y: number): number {
    let fx = x - 0.5, fy = y - 0.5;
    if (fx < 0) fx = 0; else if (fx > w - 1.001) fx = w - 1.001;
    if (fy < 0) fy = 0; else if (fy > h - 1.001) fy = h - 1.001;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const ax = fx - x0, ay = fy - y0;
    const i = y0 * w + x0;
    return plane[i] * (1 - ax) * (1 - ay) + plane[i + 1] * ax * (1 - ay) + plane[i + w] * (1 - ax) * ay + plane[i + w + 1] * ax * ay;
}

/**
 * Colour and energy a FLOW/SPECTRUM vertex carries. A pure function of the picture and the
 * position: no stroke, seed or random number enters. Exported so it can be checked.
 */
export function vertexEnergy(f: Field, x: number, y: number): number {
    return bilinear(f.en, f.w, f.h, x, y);
}

export function vertexColour(f: Field, x: number, y: number, out: number[]) {
    if (f.fixed) {
        out[0] = f.fixed[0]; out[1] = f.fixed[1]; out[2] = f.fixed[2];
        return;
    }
    const ix = Math.min(f.w - 1, Math.max(0, Math.floor(x)));
    const iy = Math.min(f.h - 1, Math.max(0, Math.floor(y)));
    const i = iy * f.w + ix;
    // Lift the source colour so thin lines glow on black; keep its hue.
    const R = f.cr[i], G = f.cg[i], B = f.cb[i];
    const l = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
    let k = 1.0 + 0.9 * l;
    const m = Math.max(R, G, B) * k;
    if (m > 255) k *= 255 / m;
    const gam = (c: number) => 255 * Math.pow(Math.min(1, (c * k) / 255), 0.8);
    out[0] = gam(R); out[1] = gam(G); out[2] = gam(B);
}

export function vertexAttrs(f: Field, x: number, y: number, out: number[]) {
    vertexColour(f, x, y, out);
    out[3] = vertexEnergy(f, x, y);
}

/* ------------------------------------------------------------------ FLOW */

/**
 * Where the structure tensor has no clear orientation (coherence near 0) the tangent is not defined;
 * lines neither start nor continue there.
 */
export const COHERENCE_MIN = 0.2;

/**
 * The four corner tangents around a point must agree: if they point in clearly different directions
 * (the length of their average falls below this) the point is an orientation singularity and the
 * line ends there instead of turning at random.
 */
export const AGREE_MIN = 0.7;

const sm = { tx: 0, ty: 0, en: 0, coh: 0, agree: 1 };

/** Bilinear sample of the tangent field, orienting each corner towards (rx, ry). */
function sampleField(f: Field, x: number, y: number, rx: number, ry: number) {
    let fx = x - 0.5, fy = y - 0.5;
    if (fx < 0) fx = 0; else if (fx > f.w - 1.001) fx = f.w - 1.001;
    if (fy < 0) fy = 0; else if (fy > f.h - 1.001) fy = f.h - 1.001;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const ax = fx - x0, ay = fy - y0;
    let sx = 0, sy = 0, en = 0, coh = 0;
    for (let k = 0; k < 4; k++) {
        const dx = k & 1, dy = k >> 1;
        const wgt = (dx ? ax : 1 - ax) * (dy ? ay : 1 - ay);
        const i = (y0 + dy) * f.w + (x0 + dx);
        let vx = f.tx[i], vy = f.ty[i];
        if (vx * rx + vy * ry < 0) { vx = -vx; vy = -vy; }
        sx += vx * wgt; sy += vy * wgt;
        en += f.en[i] * wgt;
        coh += f.coh[i] * wgt;
    }
    const len = Math.hypot(sx, sy);
    if (len > 1e-6) { sx /= len; sy /= len; } else { sx = rx; sy = ry; }
    sm.tx = sx; sm.ty = sy; sm.en = en; sm.coh = coh; sm.agree = len;
}

/**
 * Occupancy grid shared by all the lines of one picture. Lines keep a minimum separation: a cell
 * belongs to one line only, a walk stops on reaching another line's cell, and a seed in an
 * occupied cell is refused. This is what keeps strokes reading as lines instead of a solid fill.
 */
interface Grid { w: number; h: number; s: number; cell: number; gw: number; gh: number; owner: Int32Array; made: number }

function makeGrid(w: number, h: number, p: LineParams): Grid {
    const s = Math.max(w, h) / 1024;
    const sep = Math.max(1, p.spacing) * Math.max(0.3, p.width) * s;
    const cell = Math.max(2 * s, 0.5 * sep);
    const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
    return { w, h, s, cell, gw, gh, owner: new Int32Array(gw * gh).fill(-1), made: 0 };
}

const cellOf = (g: Grid, x: number, y: number) =>
    Math.min(g.gh - 1, Math.floor(y / g.cell)) * g.gw + Math.min(g.gw - 1, Math.floor(x / g.cell));

/**
 * Grow lines on one field. The seed (through rng) decides ONLY where a line may start;
 * direction, colour, brightness and width all come from the field.
 */
function flowPass(f: Field, p: LineParams, g: Grid, rng: () => number, out: Builder, tag: number, attempts: number) {
    const scale = g.w / f.w; // field pixel -> output working pixel
    const calm = Math.min(1, Math.max(0, p.calm));
    const stopE = 0.02 + 0.07 * (1 - calm);
    const step = 1.5 * f.s;
    const budget = Math.round(56 * Math.max(0.2, p.length));
    const cohMin = COHERENCE_MIN;

    const maxSteps = budget + 2;
    const fxs = new Float32Array(maxSteps), fys = new Float32Array(maxSteps);
    const bxs = new Float32Array(maxSteps), bys = new Float32Array(maxSteps);
    const attr = [0, 0, 0, 0];
    const lx = new Float32Array(2 * maxSteps + 1), ly = new Float32Array(2 * maxSteps + 1), le = new Float32Array(2 * maxSteps + 1);
    const markDead = (x: number, y: number) => {
        const c = cellOf(g, x * scale, y * scale);
        if (g.owner[c] === -1) g.owner[c] = -2;
    };

    const walk = (x0: number, y0: number, dx0: number, dy0: number, xs: Float32Array, ys: Float32Array): number => {
        const id = g.made;
        let x = x0, y = y0, dx = dx0, dy = dy0, n = 0;
        sampleField(f, x, y, dx, dy);
        for (let i = 0; i < budget; i++) {
            // Midpoint (RK2) integration of the tangent field.
            const k1x = sm.tx, k1y = sm.ty;
            sampleField(f, x + k1x * step * 0.5, y + k1y * step * 0.5, k1x, k1y);
            const vx = sm.tx, vy = sm.ty;
            x += vx * step; y += vy * step;
            dx = vx; dy = vy;
            if (x < 0 || y < 0 || x >= f.w || y >= f.h) break;
            // The new vertex itself is checked (energy, coherence, agreement) before it is kept; the
            // same sample then starts the next step.
            sampleField(f, x, y, dx, dy);
            if (sm.en < stopE || sm.coh < cohMin || sm.agree < AGREE_MIN) break;
            const o = g.owner[cellOf(g, x * scale, y * scale)];
            if (o >= 0 && o !== id) break;
            xs[n] = x; ys[n] = y; n++;
        }
        return n;
    };

    for (let attempt = 0; attempt < attempts; attempt++) {
        // Fixed number of draws per attempt keeps the sequence stable.
        const rx = rng(), ry = rng(), ra = rng();
        const x0 = rx * f.w, y0 = ry * f.h;
        if (g.owner[cellOf(g, x0 * scale, y0 * scale)] !== -1) continue;
        // Orient the corner tangents towards the nearest pixel's own tangent, so the seed direction
        // is consistent with the field it sits in (an arbitrary reference could flip corners).
        const ni = Math.min(f.h - 1, Math.floor(y0)) * f.w + Math.min(f.w - 1, Math.floor(x0));
        sampleField(f, x0, y0, f.tx[ni], f.ty[ni]);
        const en0 = sm.en;
        const t = Math.min(1, Math.max(0, (en0 - 0.03) / 0.45));
        const accept = calm + (1 - calm) * t * t * (3 - 2 * t);
        if (ra > accept || sm.coh < cohMin) continue;
        const tx0 = sm.tx, ty0 = sm.ty;

        const nf = walk(x0, y0, tx0, ty0, fxs, fys);
        const nb = walk(x0, y0, -tx0, -ty0, bxs, bys);
        const nPts = nf + nb + 1;
        const minPts = Math.max(6, Math.round(14 * p.length));
        // A seed that cannot make a line is not tried again: its cell is marked unavailable.
        if (nPts < minPts * 0.6) { markDead(x0, y0); continue; }

        // Positions are stored as float32 in output coordinates; energy and colour are computed from
        // exactly the stored position so that they can be re-derived from the picture alone.
        let k = 0, meanEn = 0;
        const gather = (x: number, y: number) => {
            const ox = Math.fround(x * scale), oy = Math.fround(y * scale);
            lx[k] = ox; ly[k] = oy;
            const e = vertexEnergy(f, ox / scale, oy / scale);
            le[k] = e; meanEn += e; k++;
        };
        for (let i = nb - 1; i >= 0; i--) gather(bxs[i], bys[i]);
        gather(x0, y0);
        for (let i = 0; i < nf; i++) gather(fxs[i], fys[i]);
        meanEn /= nPts;

        // Short lines have to earn their place by the energy they follow (grain makes short,
        // weak fragments; real form makes long or strong ones). Measured, not hidden.
        if (nPts < minPts * (1.9 - 1.3 * Math.min(1, meanEn))) { markDead(x0, y0); continue; }

        out.begin(tag);
        for (let i = 0; i < nPts; i++) {
            vertexColour(f, lx[i] / scale, ly[i] / scale, attr);
            out.push(lx[i], ly[i], attr[0], attr[1], attr[2], le[i]);
        }
        out.end();

        // Claim the cells along the line (several samples per step so no cell is skipped).
        const stamp = (x: number, y: number) => { g.owner[cellOf(g, x, y)] = g.made; };
        let px = lx[0], py = ly[0];
        stamp(px, py);
        for (let i = 1; i < nPts; i++) {
            const n = Math.max(1, Math.ceil(Math.hypot(lx[i] - px, ly[i] - py) / (g.cell * 0.7)));
            for (let q = 1; q <= n; q++) stamp(px + (lx[i] - px) * q / n, py + (ly[i] - py) * q / n);
            px = lx[i]; py = ly[i];
        }
        g.made++;
    }
}

function attemptsFor(g: Grid): number {
    return Math.min(1500000, Math.round(5 * g.gw * g.gh));
}

export function traceFlow(f: Field, p: LineParams): StrokeSet {
    const out = new Builder();
    const g = makeGrid(f.w, f.h, p);
    flowPass(f, p, g, makeRng(p.seed), out, 0, attemptsFor(g));
    return out.finish();
}

/** Number of passes the SPECTRUM bands take turns in, so no band claims all the space first. */
const SPECTRUM_ROUNDS = 4;

export function traceSpectrum(f: Field, p: LineParams): StrokeSet {
    const out = new Builder();
    if (!f.rgba) return out.finish();
    const n = Math.max(2, Math.min(16, Math.round(p.bands)));
    if (!f.spec || f.spec.n !== n) f.spec = buildBands(f.rgba, f.w, f.h, n);
    const bands = f.spec.bands;
    const g = makeGrid(f.w, f.h, p);
    const rng = makeRng(p.seed);
    const total = attemptsFor(g);
    let mass = 0;
    for (const b of bands) mass += b.mass;
    if (mass <= 0) return out.finish();
    // Attempts go where the energy is: each band gets its share of the total in proportion to its mass.
    for (let round = 0; round < SPECTRUM_ROUNDS; round++) {
        for (let k = 0; k < bands.length; k++) {
            const att = Math.round((total * bands[k].mass) / mass / SPECTRUM_ROUNDS);
            if (att > 0) flowPass(bands[k].field, p, g, rng, out, k, att);
        }
    }
    return out.finish();
}

/* ------------------------------------------------------------- ISOLINES */

/** A contour must carry this much energy length, as a fraction of the 'shortest contour' setting. */
export const DUST_ENERGY_LENGTH = 1.2;

// Marching-squares segment table: for each cell case, pairs of edges
// (0 = top, 1 = right, 2 = bottom, 3 = left). Saddles (5, 10) are handled apart.
const CASES: number[][] = [
    [], [3, 0], [0, 1], [3, 1], [1, 2], [], [0, 2], [3, 2],
    [2, 3], [0, 2], [], [1, 2], [3, 1], [0, 1], [3, 0], []
];

export function traceIsolines(f: Field, p: LineParams): StrokeSet {
    const { w, h, s } = f;
    const out = new Builder();
    const { fine: L, slope } = isoMaps(f);
    const N = w * h;
    const nEdges = 2 * N;

    // Each edge touches at most two segments of one level.
    const adjA = new Int32Array(nEdges).fill(-1);
    const adjB = new Int32Array(nEdges).fill(-1);
    const visited = new Uint8Array(nEdges);
    const touched: number[] = [];

    const levels = Math.max(2, Math.round(p.levels));
    const minLen = Math.max(2, p.minLength) * s;

    // Edge id -> intersection point for the current level.
    let level = 0;
    const pointOf = (e: number, out2: Float32Array) => {
        if (e < N) { // horizontal edge between (x,y) and (x+1,y)
            const y = Math.floor(e / w), x = e - y * w;
            const a = L[e], b = L[e + 1];
            const t = (level - a) / (b - a);
            out2[0] = x + 0.5 + t; out2[1] = y + 0.5;
        } else { // vertical edge between (x,y) and (x,y+1)
            const v = e - N;
            const y = Math.floor(v / w), x = v - y * w;
            const a = L[v], b = L[v + w];
            const t = (level - a) / (b - a);
            out2[0] = x + 0.5; out2[1] = y + 0.5 + t;
        }
    };

    const link = (e1: number, e2: number) => {
        if (adjA[e1] < 0 && adjB[e1] < 0) touched.push(e1);
        if (adjA[e2] < 0 && adjB[e2] < 0) touched.push(e2);
        if (adjA[e1] < 0) adjA[e1] = e2; else adjB[e1] = e2;
        if (adjA[e2] < 0) adjA[e2] = e1; else adjB[e2] = e1;
    };

    const pt = new Float32Array(2);
    const eid = new Int32Array(4);
    const chainE: number[] = [];
    const px: number[] = [];
    const py: number[] = [];

    const emitChain = (closed: boolean) => {
        const n = chainE.length;
        px.length = 0; py.length = 0;
        for (let i = 0; i < n; i++) {
            pointOf(chainE[i], pt);
            px.push(pt[0]); py.push(pt[1]);
        }
        if (closed) { px.push(px[0]); py.push(py[0]); }
        if (px.length < 4) return;

        // One light smoothing pass removes the grid stair-stepping.
        const m = px.length;
        const sx = px.slice(), sy = py.slice();
        for (let i = 1; i < m - 1; i++) {
            sx[i] = 0.25 * px[i - 1] + 0.5 * px[i] + 0.25 * px[i + 1];
            sy[i] = 0.25 * py[i - 1] + 0.5 * py[i] + 0.25 * py[i + 1];
        }
        if (closed) {
            sx[0] = sx[m - 1] = 0.25 * px[m - 2] + 0.5 * px[0] + 0.25 * px[1];
            sy[0] = sy[m - 1] = 0.25 * py[m - 2] + 0.5 * py[0] + 0.25 * py[1];
        }

        let len = 0;
        for (let i = 1; i < m; i++) len += Math.hypot(sx[i] - sx[i - 1], sy[i] - sy[i - 1]);
        if (len < minLen * 0.5) return;

        // Energy of ISOLINES = luminance slope where the contour runs, sampled at each vertex.
        const en = new Float32Array(m);
        for (let i = 0; i < m; i++) en[i] = bilinear(slope, w, h, sx[i], sy[i]);

        // Dust: a contour has to earn its place by the energy it carries along its length. The
        // "energy length" is the integral of slope x coherence-gate along the contour; grain makes
        // short loops on gentle, incoherent ground, while form makes contours that are long or steep
        // and coherent. Both factors are measured from the picture.
        let carried = 0;
        for (let i = 1; i < m; i++) {
            const mx = 0.5 * (sx[i] + sx[i - 1]), my = 0.5 * (sy[i] + sy[i - 1]);
            const gate = energyOf(1, bilinear(f.coh, w, h, mx, my));
            carried += Math.hypot(sx[i] - sx[i - 1], sy[i] - sy[i - 1]) * 0.5 * (en[i] + en[i - 1]) * gate;
        }
        if (carried < DUST_ENERGY_LENGTH * Math.max(2, p.minLength) * s) return;

        // Colour: running mean of the blurred source along the contour.
        const cr = new Float32Array(m), cg = new Float32Array(m), cb = new Float32Array(m);
        for (let i = 0; i < m; i++) {
            const ix = Math.min(w - 1, Math.max(0, Math.floor(sx[i])));
            const iy = Math.min(h - 1, Math.max(0, Math.floor(sy[i])));
            const k = iy * w + ix;
            cr[i] = f.cr[k]; cg[i] = f.cg[k]; cb[i] = f.cb[k];
        }
        const half = 16;
        const ps = new Float64Array(m + 1);
        const mean = [new Float32Array(m), new Float32Array(m), new Float32Array(m)];
        [cr, cg, cb].forEach((arr, c) => {
            for (let i = 0; i < m; i++) ps[i + 1] = ps[i] + arr[i];
            for (let i = 0; i < m; i++) {
                const lo = Math.max(0, i - half), hi = Math.min(m - 1, i + half);
                mean[c][i] = (ps[hi + 1] - ps[lo]) / (hi - lo + 1);
            }
        });

        out.begin(0);
        for (let i = 0; i < m; i++) {
            out.push(
                sx[i], sy[i],
                Math.min(255, mean[0][i] * 1.35 + 25),
                Math.min(255, mean[1][i] * 1.35 + 25),
                Math.min(255, mean[2][i] * 1.35 + 25),
                en[i]
            );
        }
        out.end();
    };

    for (let li = 0; li < levels; li++) {
        level = 0.04 + (0.92 * li) / (levels - 1);

        // 1. Segments of this level.
        for (let y = 0; y < h - 1; y++) {
            for (let x = 0; x < w - 1; x++) {
                const i = y * w + x;
                const a = L[i], b = L[i + 1], c = L[i + w + 1], d = L[i + w];
                const idx = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0);
                if (idx === 0 || idx === 15) continue;
                // Edge ids: top H(x,y), right V(x+1,y), bottom H(x,y+1), left V(x,y).
                eid[0] = i; eid[1] = N + i + 1; eid[2] = i + w; eid[3] = N + i;
                if (idx === 5 || idx === 10) {
                    const centre = (a + b + c + d) * 0.25 >= level;
                    const joined = idx === 5 ? centre : !centre;
                    if (joined) { link(eid[0], eid[1]); link(eid[2], eid[3]); }
                    else { link(eid[3], eid[0]); link(eid[1], eid[2]); }
                } else {
                    const cs = CASES[idx];
                    link(eid[cs[0]], eid[cs[1]]);
                }
            }
        }

        // 2. Chain them into polylines: open ends first, then closed loops.
        const walkFrom = (e0: number, closedExpected: boolean) => {
            chainE.length = 0;
            let prev = -1, cur = e0;
            for (;;) {
                visited[cur] = 1;
                chainE.push(cur);
                const a = adjA[cur], b = adjB[cur];
                let next = -1;
                if (a >= 0 && a !== prev && !visited[a]) next = a;
                else if (b >= 0 && b !== prev && !visited[b]) next = b;
                if (next < 0) break;
                prev = cur; cur = next;
            }
            emitChain(closedExpected);
        };
        for (const e of touched) {
            if (visited[e]) continue;
            const deg = (adjA[e] >= 0 ? 1 : 0) + (adjB[e] >= 0 ? 1 : 0);
            if (deg === 1) walkFrom(e, false);
        }
        for (const e of touched) {
            if (visited[e]) continue;
            walkFrom(e, true);
        }

        // 3. Reset only what we touched.
        for (const e of touched) { adjA[e] = -1; adjB[e] = -1; visited[e] = 0; }
        touched.length = 0;
    }
    return out.finish();
}

export function buildStrokes(f: Field, p: LineParams): StrokeSet {
    return p.mode === 'isolines' ? traceIsolines(f, p) : p.mode === 'spectrum' ? traceSpectrum(f, p) : traceFlow(f, p);
}
