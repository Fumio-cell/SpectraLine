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
    /** Reading scale, as the sigma (px at 1024) of the gradient blur; the tensor is read at twice this. */
    sigma: number;
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
    /**
     * Energy 0..1: strength gated by coherence. This is the one number that decides how
     * bright and how wide a FLOW line is at a point; it is a pure function of the picture.
     */
    en: Float32Array;
    /**
     * SPECTRUM band fields take their colour from the band's hue at the purity measured at the
     * point, instead of sampling the picture's RGB.
     */
    tint?: Tint;
    /** SPECTRUM band fields: 1 on each pixel whose dominant wavelength belongs to the band (lines live only there). */
    member?: Uint8Array;
    /** Width of `member`: it is kept at the picture's own resolution, not the band field's. */
    memberW?: number;
    /** The analysed picture (SPECTRUM reads it) and the band set built from it, cached by band count. */
    rgba?: Uint8ClampedArray;
    spec?: import('./spectrum').BandSet;
    /** Lazily built maps for ISOLINES. */
    iso?: { fine: Float32Array; weight: Float32Array; slope: Float32Array };
}


/*
 * SCALE: the one variable that sets how coarsely the picture is read. The gradient is taken from the
 * picture blurred at sigma, the structure tensor is integrated at twice that. Line width, length and the
 * contour smoothing follow from it, so the drawing stays balanced at every position.
 * Nothing is added at any scale: every line is still read from the picture, only coarser or finer.
 */
export const SIGMA_FINE = 1.0;
export const SIGMA_BROAD = 20;
/** The sigma that SL-1..SL-3 read the field at; widths and lengths of the looks are tuned for it. */
export const SIGMA_REFERENCE = 3;

/** SCALE shown when a picture is opened (see the SL-4 evidence). */
export const DEFAULT_SCALE = 0.7;

/** SCALE position 0 (fine) .. 1 (broad) -> sigma in px at 1024, continuous and logarithmic. */
export function sigmaOfScale(u: number): number {
    const t = Math.min(1, Math.max(0, u));
    return SIGMA_FINE * Math.pow(SIGMA_BROAD / SIGMA_FINE, t);
}

/** Line width grows with the reading scale: 1 + sigma/4 (relative to the reference). */
export const widthFactor = (sigma: number) => (1 + sigma / 4) / (1 + SIGMA_REFERENCE / 4);

/** Lines get longer as the field is read more broadly (more steps along the tangent). */
export const lengthFactor = (sigma: number) => Math.pow(sigma / SIGMA_REFERENCE, 0.8);

/** Coherence gate: grain (low coherence) is not energy even when its gradient is large. */
export function energyOf(str: number, coh: number): number {
    const t = Math.min(1, Math.max(0, (coh - 0.10) / 0.60));
    return str * (0.2 + 0.8 * t * t * (3 - 2 * t));
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

/** Exact separable Gaussian blur with clamped borders (small sigma). */
function gaussBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
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


/** One horizontal box pass of radius r with clamped borders, O(1) per pixel. */
function boxH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
    const inv = 1 / (2 * r + 1);
    for (let y = 0; y < h; y++) {
        const row = y * w;
        let acc = 0;
        for (let j = -r; j <= r; j++) acc += src[row + (j < 0 ? 0 : j >= w ? w - 1 : j)];
        dst[row] = acc * inv;
        for (let x = 1; x < w; x++) {
            const a = x + r, b = x - r - 1;
            acc += src[row + (a >= w ? w - 1 : a)] - src[row + (b < 0 ? 0 : b)];
            dst[row + x] = acc * inv;
        }
    }
}

/** One vertical box pass, running sums kept per column so memory is read row by row. */
function boxV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
    const inv = 1 / (2 * r + 1);
    const acc = new Float64Array(w);
    for (let j = -r; j <= r; j++) {
        const row = (j < 0 ? 0 : j >= h ? h - 1 : j) * w;
        for (let x = 0; x < w; x++) acc[x] += src[row + x];
    }
    for (let x = 0; x < w; x++) dst[x] = acc[x] * inv;
    for (let y = 1; y < h; y++) {
        const a = (y + r >= h ? h - 1 : y + r) * w, b = (y - r - 1 < 0 ? 0 : y - r - 1) * w, o = y * w;
        for (let x = 0; x < w; x++) {
            acc[x] += src[a + x] - src[b + x];
            dst[o + x] = acc[x] * inv;
        }
    }
}

/**
 * Gaussian blur. Small sigma uses the exact kernel; larger sigma uses three box passes whose widths
 * give the same variance (error under 3%), which costs the same at every sigma. That is what makes a
 * continuous SCALE affordable: the broad end would otherwise need kernels over 190 taps wide.
 */
export function blur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
    if (sigma < 2.5) return gaussBlur(src, w, h, sigma);
    const n = 3;
    const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
    let wl = Math.floor(ideal); if (wl % 2 === 0) wl--;
    const wu = wl + 2;
    const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
    let a = src;
    const t1 = new Float32Array(w * h);
    const t2 = new Float32Array(w * h);
    for (let i = 0; i < n; i++) {
        const r = ((i < m ? wl : wu) - 1) >> 1;
        boxH(a, t1, w, h, r);
        boxV(t1, t2, w, h, r);
        a = t2;
    }
    return t2;
}

export function percentile(values: Float32Array, p: number): number {
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

/** Colour of a SPECTRUM band: its hue, as a table over excitation purity 0..1, plus the measured purity. */
export interface Tint {
    /** 65 entries (purity 0, 1/64 .. 1) of r, g, b in 0..255. */
    lut: Float32Array;
    /** Measured purity of the band at each field pixel, 0..1. */
    purity: Float32Array;
}

export interface Tensor {
    /** The map blurred at the gradient sigma (the gradient is taken from it). */
    smooth: Float32Array;
    tx: Float32Array; ty: Float32Array; coh: Float32Array;
    /** sqrt(trace of the structure tensor): raw gradient energy, unnormalised. */
    energy: Float32Array;
}

/**
 * Structure tensor of a scalar map: gradient of the map blurred at sigma*s, tensor blurred at twice
 * that (s = analysis size / 1024). The tangent is the dominant gradient direction + 90 degrees,
 * computed algebraically.
 */
export function structure(map: Float32Array, w: number, h: number, s: number, sigma = SIGMA_REFERENCE): Tensor {
    const n = w * h;
    const gl = blur(map, w, h, sigma * s);
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
    const jxx = blur(gxx, w, h, 2 * sigma * s);
    const jyy = blur(gyy, w, h, 2 * sigma * s);
    const jxy = blur(gxy, w, h, 2 * sigma * s);

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
    return { smooth: gl, tx, ty, coh, energy };
}

/** Gradient energy is normalised to 0..1 at this percentile of the picture: the top few percent saturate. */
export const ENERGY_PERCENTILE = Number(0.92);

export function energyScale(energy: Float32Array): number {
    return percentile(energy, ENERGY_PERCENTILE);
}

/** Build a Field from a tensor and a normaliser (shared between bands so they stay comparable). */
export function fieldFromTensor(t: Tensor, w: number, h: number, s: number, sigma: number, scale: number, base: Partial<Field>): Field {
    const n = w * h;
    const str = new Float32Array(n);
    const en = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        str[i] = Math.min(1, t.energy[i] / scale);
        en[i] = energyOf(str[i], t.coh[i]);
    }
    const none = new Float32Array(0);
    return {
        lum: none, cr: none, cg: none, cb: none, ...base,
        w, h, s, sigma, tx: t.tx, ty: t.ty, coh: t.coh, str, en
    } as Field;
}

interface Planes { lum: Float32Array; cr: Float32Array; cg: Float32Array; cb: Float32Array }
const planeCache = new WeakMap<Uint8ClampedArray, Planes>();

/** Luminance and the lightly blurred colour the lines carry; independent of SCALE, so cached per picture. */
export function planesOf(rgba: Uint8ClampedArray, w: number, h: number): Planes {
    const hit = planeCache.get(rgba);
    if (hit) return hit;
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
    const cs = Math.max(0.6, 1.5 * s);
    const planes = { lum, cr: blur(r, w, h, cs), cg: blur(g, w, h, cs), cb: blur(b, w, h, cs) };
    planeCache.set(rgba, planes);
    return planes;
}

/** Read the picture's field at a reading scale (sigma in px at 1024; see sigmaOfScale). */
export function analyse(rgba: Uint8ClampedArray, w: number, h: number, sigma = SIGMA_REFERENCE): Field {
    const s = Math.max(w, h) / 1024;
    const { lum, cr, cg, cb } = planesOf(rgba, w, h);
    const t = structure(lum, w, h, s, sigma);
    return fieldFromTensor(t, w, h, s, sigma, energyScale(t.energy), { lum, cr, cg, cb, rgba });
}

/** Luminance maps used by ISOLINES, built on first use. */
export function isoMaps(field: Field): { fine: Float32Array; weight: Float32Array; slope: Float32Array } {
    if (field.iso) return field.iso;
    const { w, h, s, lum, str } = field;
    // TOPO reads the luminance at the same SCALE: the contours are cut from a map smoothed in proportion.
    const k = field.sigma / SIGMA_REFERENCE;
    const fine = blur(lum, w, h, 2.2 * k * s);
    const coarse = blur(lum, w, h, 7 * k * s);
    const weight = blur(str, w, h, 5 * k * s);
    // Where the picture has structure keep the fine map; where it is flat, fall
    // back to the heavily smoothed one so noise does not turn into contour dust.
    const mixed = new Float32Array(w * h);
    for (let i = 0; i < mixed.length; i++) {
        const t = Math.min(1, Math.max(0, (weight[i] - 0.08) / 0.30));
        const k = t * t * (3 - 2 * t);
        mixed[i] = coarse[i] + (fine[i] - coarse[i]) * k;
    }

    // Luminance slope of the map the contours are cut from: the energy of ISOLINES.
    const grad = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        const ym = y > 0 ? y - 1 : 0, yp = y < h - 1 ? y + 1 : h - 1;
        for (let x = 0; x < w; x++) {
            const xm = x > 0 ? x - 1 : 0, xp = x < w - 1 ? x + 1 : w - 1;
            const gx = (mixed[y * w + xp] - mixed[y * w + xm]) * 0.5;
            const gy = (mixed[yp * w + x] - mixed[ym * w + x]) * 0.5;
            grad[y * w + x] = Math.sqrt(gx * gx + gy * gy);
        }
    }
    const sl = blur(grad, w, h, 2 * k * s);
    const p = percentile(sl, 0.98);
    const slope = new Float32Array(w * h);
    for (let i = 0; i < slope.length; i++) slope[i] = Math.min(1, sl[i] / p);
    field.iso = { fine: mixed, weight, slope };
    return field.iso;
}
