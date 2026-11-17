import type { LineParams } from '../types';
import { isoMaps, type Field } from './field';

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
    /** Per-stroke width multiplier and opacity. */
    wMul: Float32Array;
    alpha: Float32Array;
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
    private wMul = new Float32Array(1024);
    private alpha = new Float32Array(1024);

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
        this.r = grow(this.r); this.g = grow(this.g); this.b = grow(this.b);
    }

    begin(wMul: number, alpha: number) {
        if (this.strokes + 2 > this.start.length) {
            const n = this.start.length * 2;
            const s = new Uint32Array(n); s.set(this.start); this.start = s;
            const w = new Float32Array(n); w.set(this.wMul); this.wMul = w;
            const a = new Float32Array(n); a.set(this.alpha); this.alpha = a;
        }
        this.start[this.strokes] = this.verts;
        this.wMul[this.strokes] = wMul;
        this.alpha[this.strokes] = alpha;
    }

    push(x: number, y: number, r: number, g: number, b: number) {
        this.growVerts(1);
        const v = this.verts++;
        this.x[v] = x; this.y[v] = y;
        this.r[v] = r; this.g[v] = g; this.b[v] = b;
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
            wMul: this.wMul.slice(0, n), alpha: this.alpha.slice(0, n)
        };
    }
}

/* ------------------------------------------------------------------ FLOW */

const sm = { tx: 0, ty: 0, str: 0, coh: 0 };

/** Bilinear sample of the tangent field, orienting each corner towards (rx, ry). */
function sampleField(f: Field, x: number, y: number, rx: number, ry: number) {
    let fx = x - 0.5, fy = y - 0.5;
    if (fx < 0) fx = 0; else if (fx > f.w - 1.001) fx = f.w - 1.001;
    if (fy < 0) fy = 0; else if (fy > f.h - 1.001) fy = f.h - 1.001;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const ax = fx - x0, ay = fy - y0;
    let sx = 0, sy = 0, str = 0, coh = 0;
    for (let k = 0; k < 4; k++) {
        const dx = k & 1, dy = k >> 1;
        const wgt = (dx ? ax : 1 - ax) * (dy ? ay : 1 - ay);
        const i = (y0 + dy) * f.w + (x0 + dx);
        let vx = f.tx[i], vy = f.ty[i];
        if (vx * rx + vy * ry < 0) { vx = -vx; vy = -vy; }
        sx += vx * wgt; sy += vy * wgt;
        str += f.str[i] * wgt;
        coh += f.coh[i] * wgt;
    }
    const len = Math.hypot(sx, sy);
    if (len > 1e-6) { sx /= len; sy /= len; } else { sx = rx; sy = ry; }
    sm.tx = sx; sm.ty = sy; sm.str = str; sm.coh = coh;
}

export function traceFlow(f: Field, p: LineParams): StrokeSet {
    const { w, h, s } = f;
    const rng = makeRng(p.seed);
    const out = new Builder();

    // Lines keep a minimum separation: a cell can belong to one line only, a walk stops on
    // reaching another line's cell, and a seed in an occupied cell is refused. This is what
    // keeps strokes reading as lines instead of piling up into a solid fill.
    const sep = Math.max(1, p.spacing) * Math.max(0.3, p.width) * s;
    const cell = Math.max(2 * s, 0.5 * sep);
    const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
    const owner = new Int32Array(gw * gh).fill(-1);
    const cellOf = (x: number, y: number) => Math.min(gh - 1, Math.floor(y / cell)) * gw + Math.min(gw - 1, Math.floor(x / cell));
    const maxAttempts = Math.min(1500000, Math.round(5 * gw * gh));
    const calm = Math.min(1, Math.max(0, p.calm));
    const stopStr = 0.03 + 0.10 * (1 - calm);
    const step = 1.5 * s;

    // Scratch for the two half-lines.
    const maxSteps = Math.ceil(90 * Math.max(0.2, p.length)) + 2;
    const fxs = new Float32Array(maxSteps), fys = new Float32Array(maxSteps);
    const bxs = new Float32Array(maxSteps), bys = new Float32Array(maxSteps);

    let made = 0;
    const walk = (x0: number, y0: number, dx0: number, dy0: number, steps: number, xs: Float32Array, ys: Float32Array): number => {
        const id = made;
        let x = x0, y = y0, dx = dx0, dy = dy0, n = 0;
        for (let i = 0; i < steps; i++) {
            // Midpoint (RK2) integration of the tangent field.
            sampleField(f, x, y, dx, dy);
            const k1x = sm.tx, k1y = sm.ty;
            sampleField(f, x + k1x * step * 0.5, y + k1y * step * 0.5, k1x, k1y);
            const vx = sm.tx, vy = sm.ty;
            x += vx * step; y += vy * step;
            dx = vx; dy = vy;
            if (x < 0 || y < 0 || x >= w || y >= h) break;
            if (sm.str < stopStr || sm.coh < 0.10) break;
            const o = owner[cellOf(x, y)];
            if (o >= 0 && o !== id) break;
            xs[n] = x; ys[n] = y; n++;
        }
        return n;
    };

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // Fixed number of draws per attempt keeps the sequence stable.
        const rx = rng(), ry = rng(), ra = rng();
        const x0 = rx * w, y0 = ry * h;
        if (owner[cellOf(x0, y0)] >= 0) continue;
        sampleField(f, x0, y0, 1, 0);
        const str0 = sm.str;
        const t = Math.min(1, Math.max(0, (str0 - 0.05) / 0.50));
        const accept = calm + (1 - calm) * t * t * (3 - 2 * t);
        if (ra > accept || sm.coh < 0.10) continue;
        const tx0 = sm.tx, ty0 = sm.ty;

        const steps = Math.max(3, Math.round((16 + 64 * Math.sqrt(str0)) * p.length));
        const nf = walk(x0, y0, tx0, ty0, steps, fxs, fys);
        const nb = walk(x0, y0, -tx0, -ty0, steps, bxs, bys);
        if (nf + nb < Math.max(6, Math.round(14 * p.length))) continue;

        const a = 0.82 + 0.18 * Math.sqrt(str0);
        out.begin(0.75 + 0.5 * str0, a);
        const emit = (x: number, y: number) => {
            const ix = Math.min(w - 1, Math.max(0, Math.floor(x)));
            const iy = Math.min(h - 1, Math.max(0, Math.floor(y)));
            const i = iy * w + ix;
            // Lift the source colour so thin lines glow on black; keep its hue.
            const R = f.cr[i], G = f.cg[i], B = f.cb[i];
            const l = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
            let k = 1.0 + 0.9 * l;
            const m = Math.max(R, G, B) * k;
            if (m > 255) k *= 255 / m;
            const gam = (c: number) => 255 * Math.pow(Math.min(1, (c * k) / 255), 0.8);
            out.push(x, y, gam(R), gam(G), gam(B));
        };
        for (let i = nb - 1; i >= 0; i--) emit(bxs[i], bys[i]);
        emit(x0, y0);
        for (let i = 0; i < nf; i++) emit(fxs[i], fys[i]);
        out.end();

        // Claim the cells along the line (several samples per step so no cell is skipped).
        const stamp = (x: number, y: number) => { owner[cellOf(x, y)] = made; };
        const line: number[] = [];
        for (let i = nb - 1; i >= 0; i--) line.push(bxs[i], bys[i]);
        line.push(x0, y0);
        for (let i = 0; i < nf; i++) line.push(fxs[i], fys[i]);
        let px = line[0], py = line[1];
        stamp(px, py);
        for (let i = 2; i < line.length; i += 2) {
            const n = Math.max(1, Math.ceil(Math.hypot(line[i] - px, line[i + 1] - py) / (cell * 0.7)));
            for (let k = 1; k <= n; k++) stamp(px + (line[i] - px) * k / n, py + (line[i + 1] - py) * k / n);
            px = line[i]; py = line[i + 1];
        }
        made++;
    }
    return out.finish();
}

/* ------------------------------------------------------------- ISOLINES */

// Marching-squares segment table: for each cell case, pairs of edges
// (0 = top, 1 = right, 2 = bottom, 3 = left). Saddles (5, 10) are handled apart.
const CASES: number[][] = [
    [], [3, 0], [0, 1], [3, 1], [1, 2], [], [0, 2], [3, 2],
    [2, 3], [0, 2], [], [1, 2], [3, 1], [0, 1], [3, 0], []
];

export function traceIsolines(f: Field, p: LineParams): StrokeSet {
    const { w, h, s } = f;
    const out = new Builder();
    const { fine: L } = isoMaps(f);
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
        if (len < minLen) return;

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

        out.begin(1, 0.95);
        for (let i = 0; i < m; i++) {
            out.push(
                sx[i], sy[i],
                Math.min(255, mean[0][i] * 1.35 + 25),
                Math.min(255, mean[1][i] * 1.35 + 25),
                Math.min(255, mean[2][i] * 1.35 + 25)
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
    return p.mode === 'isolines' ? traceIsolines(f, p) : traceFlow(f, p);
}
