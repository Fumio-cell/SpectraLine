/**
 * Structure analysis of the source picture.
 *
 * Everything here is pure typed-array code (no DOM) so it can run in the
 * worker, and every length is expressed relative to a 1024 px long edge so a
 * picture looks the same whatever resolution it was analysed at.
 */

export interface Field {
    w: number;
    h: number;
    /** Scale of this analysis relative to the 1024 px reference. */
    s: number;
    /** Luminance 0..1. */
    lum: Float32Array;
    /** Blurred source colour, planar, 0..255. */
    cr: Float32Array;
    cg: Float32Array;
    cb: Float32Array;
    /** Unit edge-tangent vector (lines run ALONG edges, not across them). */
    tx: Float32Array;
    ty: Float32Array;
    /** Anisotropy of the structure tensor, 0 (no direction) .. 1 (pure edge). */
    coh: Float32Array;
    /** Structure strength 0..1 (RMS gradient energy, normalised to its 98th percentile). */
    str: Float32Array;
    /** Lazily built maps for ISOLINES. */
    iso?: { fine: Float32Array; weight: Float32Array };
}

export function gaussianKernel(sigma: number): Float32Array {
    const r = Math.max(1, Math.ceil(sigma * 3));
    const k = new Float32Array(2 * r + 1);
    let sum = 0;
    for (let i = -r; i <= r; i++) {
        const v = Math.exp(-(i * i) / (2 * sigma * sigma));
        k[i + r] = v;
        sum += v;
    }
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    return k;
}

/** Separable Gaussian blur with clamped borders. */
export function blur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
    const k = gaussianKernel(sigma);
    const r = (k.length - 1) >> 1;
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);

    for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
            let acc = 0;
            if (x >= r && x < w - r) {
                const base = row + x - r;
                for (let i = 0; i < k.length; i++) acc += k[i] * src[base + i];
            } else {
                for (let i = -r; i <= r; i++) {
                    let xx = x + i;
                    if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1;
                    acc += k[i + r] * src[row + xx];
                }
            }
            tmp[row + x] = acc;
        }
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let acc = 0;
            if (y >= r && y < h - r) {
                let idx = (y - r) * w + x;
                for (let i = 0; i < k.length; i++, idx += w) acc += k[i] * tmp[idx];
            } else {
                for (let i = -r; i <= r; i++) {
                    let yy = y + i;
                    if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1;
                    acc += k[i + r] * tmp[yy * w + x];
                }
            }
            out[y * w + x] = acc;
        }
    }
    return out;
}

function percentile(values: Float32Array, p: number): number {
    let max = 0;
    for (let i = 0; i < values.length; i++) if (values[i] > max) max = values[i];
    if (max <= 0) return 1e-6;
    const BINS = 2048;
    const hist = new Uint32Array(BINS);
    for (let i = 0; i < values.length; i++) {
        hist[Math.min(BINS - 1, Math.floor((values[i] / max) * BINS))]++;
    }
    const target = values.length * p;
    let acc = 0;
    for (let b = 0; b < BINS; b++) {
        acc += hist[b];
        if (acc >= target) return Math.max(1e-6, ((b + 1) / BINS) * max);
    }
    return max;
}

export function analyse(rgba: Uint8ClampedArray, w: number, h: number): Field {
    const n = w * h;
    const s = Math.max(w, h) / 1024;

    const lum = new Float32Array(n);
    const r = new Float32Array(n);
    const g = new Float32Array(n);
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const R = rgba[i * 4], G = rgba[i * 4 + 1], B = rgba[i * 4 + 2];
        r[i] = R; g[i] = G; b[i] = B;
        lum[i] = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
    }

    // Colour that the lines will carry: the source, lightly blurred.
    const cs = Math.max(0.6, 1.5 * s);
    const cr = blur(r, w, h, cs);
    const cg = blur(g, w, h, cs);
    const cb = blur(b, w, h, cs);

    // Gradient of the smoothed luminance.
    const gl = blur(lum, w, h, 3 * s);
    const gxx = new Float32Array(n);
    const gyy = new Float32Array(n);
    const gxy = new Float32Array(n);
    for (let y = 0; y < h; y++) {
        const ym = y > 0 ? y - 1 : 0, yp = y < h - 1 ? y + 1 : h - 1;
        for (let x = 0; x < w; x++) {
            const xm = x > 0 ? x - 1 : 0, xp = x < w - 1 ? x + 1 : w - 1;
            const gx = (gl[y * w + xp] - gl[y * w + xm]) * 0.5;
            const gy = (gl[yp * w + x] - gl[ym * w + x]) * 0.5;
            const i = y * w + x;
            gxx[i] = gx * gx;
            gyy[i] = gy * gy;
            gxy[i] = gx * gy;
        }
    }

    // Structure tensor, integrated over a neighbourhood.
    const jxx = blur(gxx, w, h, 6 * s);
    const jyy = blur(gyy, w, h, 6 * s);
    const jxy = blur(gxy, w, h, 6 * s);

    const tx = new Float32Array(n);
    const ty = new Float32Array(n);
    const coh = new Float32Array(n);
    const energy = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const c2 = jxx[i] - jyy[i];
        const s2 = 2 * jxy[i];
        const rr = Math.sqrt(c2 * c2 + s2 * s2);
        const tr = jxx[i] + jyy[i];
        energy[i] = Math.sqrt(Math.max(0, tr));
        coh[i] = tr > 1e-12 ? rr / tr : 0;
        if (rr < 1e-12) { tx[i] = 1; ty[i] = 0; continue; }
        // Dominant gradient direction theta = 0.5*atan2(s2, c2); the tangent is theta + 90deg.
        const cg2 = Math.sqrt(Math.max(0, (1 + c2 / rr) * 0.5));
        const sg2 = Math.sqrt(Math.max(0, (1 - c2 / rr) * 0.5)) * (s2 < 0 ? -1 : 1);
        tx[i] = -sg2;
        ty[i] = cg2;
    }

    const p98 = percentile(energy, 0.98);
    const str = new Float32Array(n);
    for (let i = 0; i < n; i++) str[i] = Math.min(1, energy[i] / p98);

    return { w, h, s, lum, cr, cg, cb, tx, ty, coh, str };
}

/** Luminance maps used by ISOLINES, built on first use. */
export function isoMaps(field: Field): { fine: Float32Array; weight: Float32Array } {
    if (field.iso) return field.iso;
    const { w, h, s, lum, str } = field;
    const fine = blur(lum, w, h, 2.2 * s);
    const coarse = blur(lum, w, h, 7 * s);
    const weight = blur(str, w, h, 5 * s);
    // Where the picture has structure keep the fine map; where it is flat, fall
    // back to the heavily smoothed one so noise does not turn into contour dust.
    const mixed = new Float32Array(w * h);
    for (let i = 0; i < mixed.length; i++) {
        const t = Math.min(1, Math.max(0, (weight[i] - 0.08) / 0.30));
        const k = t * t * (3 - 2 * t);
        mixed[i] = coarse[i] + (fine[i] - coarse[i]) * k;
    }
    field.iso = { fine: mixed, weight };
    return field.iso;
}
