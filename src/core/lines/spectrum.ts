import { blur, fieldFromTensor, percentile, structure, type Field } from './field';
import { D65_X, D65_Y, SRGB_TO_XYZ_IEC as MX, locusXY, srgbToLinear, xyToDominant, type Dominant } from './colorscience';

/**
 * SPECTRUM: the picture split into bands of dominant wavelength.
 *
 * Every pixel gets a CIE dominant wavelength and excitation purity (see colorscience.ts).
 * A band's weight map is  purity x luminance  spread over the wavelength axis; each band is
 * traced on the structure of its own weight map and drawn in that band's spectral colour.
 * Purple pixels have no dominant wavelength; they keep their complementary wavelength
 * (marked by its sign) and form one extra, non-spectral band drawn in the colour of the
 * line of purples they point at.
 */

/**
 * Wavelength range the bands span, nm. Chosen from the data, not from the textbook 380..700:
 * on the five sample pictures 99% of the purity x luminance weight lies inside it, and the
 * ends of the visible spectrum carry almost nothing in an sRGB picture. Wavelengths outside
 * fall into the end bands.
 */
export const BAND_LO = 430;
export const BAND_HI = 630;

/**
 * Band weight maps are sparse (edges between colour regions); their energy is normalised like the picture's
 * (see ENERGY_MEDIAN_MULTIPLE), by a multiple of the median of the strongest band at each pixel. The multiple
 * reproduces SL-4's normaliser (94th percentile) on average at the default scale: mean over the five samples
 * of p94 / median = 2.87.
 */
const BAND_MEDIAN_MULTIPLE = 2.87;

/** Bands holding less than this share of the total weight are left out. */
const EMPTY_BAND = 0.002;

/**
 * A pixel counts towards the spectrum only if purity x luminance (the weight itself) is at least this.
 * Below it the dominant wavelength is not a measurement: an 8-bit picture moves by one code value and the
 * wavelength jumps. Measured on the five samples, moving every channel by +-1 code value shifts the
 * dominant wavelength by more than half a band spacing (12.5 nm) in 76% of the pixels under 0.0005, 25% at
 * 0.0005..0.001, 19% at 0.001..0.002, 17% at 0.002..0.005, but in 7% at 0.005..0.01, 3% at 0.02..0.05 and
 * 0.5% above 0.05. 0.005 is where the unstable share first falls below a tenth. The pixels under it are 14%
 * of the pixels with any weight and 0.9% of the weight.
 */
export const WEIGHT_FLOOR = 0.005;

/**
 * A band is present at a point when it holds at least this share of the light there, read at the scale of
 * the field: the band's weight map blurred with the SCALE sigma, over the sum of all bands' blurred maps.
 * Two fifths, so that at most two bands can be present at one point (three would need 0.33), and a band that
 * is clearly the leading one always is. A lower share lets bands overlap more and a higher one leaves
 * places where no band is present; on sample-3 at SCALE 0 vs 1 the PRISM SSIM is 0.386 at 0.33, 0.392 at 0.4,
 * 0.407 at 0.5 and 0.454 at 0.6.
 */
export const PRESENCE_SHARE = 0.4;

/** Stand-in field for a skipped band; it never carries a line (its mass is 0). */
const EMPTY_FIELD = { w: 1, h: 1, s: 1, sigma: 3, lum: new Float32Array(0), cr: new Float32Array(0), cg: new Float32Array(0), cb: new Float32Array(0), tx: new Float32Array(1), ty: new Float32Array(1), coh: new Float32Array(1), str: new Float32Array(1), en: new Float32Array(1) } as Field;

/** Resolution factor of the band analysis (weights are summed 2x2; tensors are smooth anyway). */
const BAND_DOWN = 2;

export interface SpectrumMaps {
    w: number;
    h: number;
    /** Dominant wavelength in nm, negative = complementary (purple), 0 = achromatic. */
    wl: Float32Array;
    purity: Float32Array;
    /** Relative luminance Y (0..1). */
    Y: Float32Array;
    /** CIE xy chromaticity of each pixel (0 where black). */
    cx: Float32Array;
    cy: Float32Array;
}

/** Per-pixel dominant wavelength, purity and luminance. */
export function spectrumOf(rgba: Uint8ClampedArray, w: number, h: number): SpectrumMaps {
    const n = w * h;
    const wl = new Float32Array(n);
    const purity = new Float32Array(n);
    const Y = new Float32Array(n);
    const cx = new Float32Array(n);
    const cy = new Float32Array(n);
    const lin = new Float32Array(256);
    for (let i = 0; i < 256; i++) lin[i] = srgbToLinear(i);
    const dom: Dominant = { wl: 0, purity: 0 };
    for (let i = 0; i < n; i++) {
        const r = lin[rgba[i * 4]], g = lin[rgba[i * 4 + 1]], b = lin[rgba[i * 4 + 2]];
        const X = MX[0] * r + MX[1] * g + MX[2] * b;
        const y = MX[3] * r + MX[4] * g + MX[5] * b;
        const Z = MX[6] * r + MX[7] * g + MX[8] * b;
        Y[i] = y;
        const sum = X + y + Z;
        if (sum < 1e-6) continue;
        cx[i] = X / sum; cy[i] = y / sum;
        xyToDominant(cx[i], cy[i], dom);
        wl[i] = dom.wl;
        purity[i] = dom.purity;
    }
    return { w, h, wl, purity, Y, cx, cy };
}

export function bandCentres(n: number): number[] {
    const c: number[] = [];
    for (let k = 0; k < n; k++) c.push(n === 1 ? (BAND_LO + BAND_HI) / 2 : BAND_LO + ((BAND_HI - BAND_LO) * k) / (n - 1));
    return c;
}

/** Inverse of the linear-sRGB -> XYZ matrix used above. */
const M = MX;
const MI = (() => {
    const [a, b, c, d, e, f, g, h, i] = M;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    return [
        A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
        B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
        C / det, -(a * h - b * g) / det, (a * e - b * d) / det
    ];
})();

function oetf(c: number): number {
    const v = Math.min(1, Math.max(0, c));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

const LUT_STEPS = 64;

/**
 * Colour table for one hue: the stimulus whose chromaticity lies at excitation purity p on the ray
 * from the D65 white point towards (hx, hy), for p = 0 (white) .. 1 (the locus or line of purples).
 * Purities sRGB cannot show are limited to the gamut edge, which keeps the hue. Each entry is
 * scaled to full brightness (the line's brightness comes from the picture's energy, not from here).
 */
export function tintLut(hx: number, hy: number): Float32Array {
    const rgbAt = (p: number, out: number[]) => {
        const x = D65_X + p * (hx - D65_X), y = D65_Y + p * (hy - D65_Y);
        const X = x / y, Z = (1 - x - y) / y;
        out[0] = MI[0] * X + MI[1] + MI[2] * Z;
        out[1] = MI[3] * X + MI[4] + MI[5] * Z;
        out[2] = MI[6] * X + MI[7] + MI[8] * Z;
    };
    const c = [0, 0, 0];
    rgbAt(1, c);
    let pmax = 1;
    if (Math.min(c[0], c[1], c[2]) < 0) {
        let lo = 0, hi = 1;
        for (let i = 0; i < 40; i++) {
            const mid = 0.5 * (lo + hi);
            rgbAt(mid, c);
            if (Math.min(c[0], c[1], c[2]) >= 0) lo = mid; else hi = mid;
        }
        pmax = lo;
    }
    const lut = new Float32Array((LUT_STEPS + 1) * 3);
    for (let j = 0; j <= LUT_STEPS; j++) {
        rgbAt(Math.min(j / LUT_STEPS, pmax), c);
        const m = Math.max(c[0], c[1], c[2]);
        for (let k = 0; k < 3; k++) lut[j * 3 + k] = 255 * oetf(Math.max(0, c[k]) / m);
    }
    return lut;
}

/** Colour from a tint table at a measured purity. */
export function tintColour(lut: Float32Array, purity: number, out: number[]) {
    const f = Math.min(1, Math.max(0, purity)) * LUT_STEPS;
    const i = Math.min(LUT_STEPS - 1, Math.floor(f)), t = f - i;
    for (let k = 0; k < 3; k++) out[k] = lut[i * 3 + k] + (lut[(i + 1) * 3 + k] - lut[i * 3 + k]) * t;
}

export interface Band {
    /** Centre wavelength in nm; null for the non-spectral (purple) band. */
    wl: number | null;
    /** Luminance-weighted mean purity of the band over the whole picture (the fallback where a band has no weight). */
    meanPurity: number;
    /** Sum of the band's gradient energy: how much structure it carries. */
    mass: number;
    field: Field;
}

export interface BandSet {
    n: number;
    bands: Band[];
}

/**
 * What the picture measures per band, independent of SCALE (so it is computed once per picture):
 * the weight maps (purity x luminance, summed 2x2 to 512 px), the luminance maps, which pixels belong
 * to each band, the band hues and their colour tables, and the totals the spectrum strip shows.
 */
export interface BandMeasure {
    n: number;
    bw: number;
    bh: number;
    maps: Float32Array[];
    lum: Float32Array[];
    /** Width of the picture the measure was taken from (band membership is built at that resolution). */
    mw: number;
    mh: number;
    /** Sum of the weight (purity x luminance) of every band, and of luminance alone. */
    sums: number[];
    lsums: number[];
    /** Hue of each band as an xy chromaticity on the locus (or the line of purples), and its colour table. */
    hue: [number, number][];
    lut: Float32Array[];
    meanPurity: number[];
    centre: (number | null)[];
    active: boolean[];
    total: number;
}

const measureCache = new WeakMap<Uint8ClampedArray, Map<number, BandMeasure>>();

/** Measure the picture's spectrum: n spectral bands (violet to red) plus one for the purples. */
export function measureBands(rgba: Uint8ClampedArray, w: number, h: number, nBands: number): BandMeasure {
    const n = Math.max(2, Math.min(16, Math.round(nBands)));
    const byN = measureCache.get(rgba) ?? new Map<number, BandMeasure>();
    const hit = byN.get(n);
    if (hit) return hit;

    const sp = spectrumOf(rgba, w, h);
    const bw = Math.ceil(w / BAND_DOWN), bh = Math.ceil(h / BAND_DOWN);
    const maps: Float32Array[] = [];
    const lum: Float32Array[] = [];
    for (let k = 0; k <= n; k++) { maps.push(new Float32Array(bw * bh)); lum.push(new Float32Array(bw * bh)); }
    const span = BAND_HI - BAND_LO;
    // Weighted mean chromaticity of purple pixels, for the hue of the purple band.
    let pw = 0, px = 0, py = 0;

    for (let y = 0; y < h; y++) {
        const by = Math.min(bh - 1, (y / BAND_DOWN) | 0);
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            const wgt = sp.purity[i] * sp.Y[i];
            if (wgt < WEIGHT_FLOOR) continue;
            const bi = by * bw + Math.min(bw - 1, (x / BAND_DOWN) | 0);
            const wl = sp.wl[i];
            if (wl < 0) {
                maps[n][bi] += wgt; lum[n][bi] += sp.Y[i];
                pw += wgt; px += wgt * sp.cx[i]; py += wgt * sp.cy[i];
            } else if (wl > 0) {
                // Linear (tent) split between the two nearest band centres.
                let u = ((wl - BAND_LO) / span) * (n - 1);
                if (u < 0) u = 0; else if (u > n - 1) u = n - 1;
                const k = Math.min(n - 2, Math.floor(u));
                const f = u - k;
                maps[k][bi] += wgt * (1 - f); lum[k][bi] += sp.Y[i] * (1 - f);
                maps[k + 1][bi] += wgt * f; lum[k + 1][bi] += sp.Y[i] * f;
            }
        }
    }
    const norm = 1 / (BAND_DOWN * BAND_DOWN);
    for (const m of maps) for (let i = 0; i < m.length; i++) m[i] *= norm;
    for (const m of lum) for (let i = 0; i < m.length; i++) m[i] *= norm;

    const sums = maps.map(m => { let t = 0; for (let i = 0; i < m.length; i++) t += m[i]; return t; });
    const lsums = lum.map(m => { let t = 0; for (let i = 0; i < m.length; i++) t += m[i]; return t; });
    const total = sums.reduce((a, b) => a + b, 0);
    const centres = bandCentres(n);
    const hue: [number, number][] = [];
    const lut: Float32Array[] = [];
    const meanPurity: number[] = [];
    const centre: (number | null)[] = [];
    for (let k = 0; k <= n; k++) {
        let hx: number, hy: number;
        if (k < n) { const xy = locusXY(centres[k]); hx = xy[0]; hy = xy[1]; centre.push(centres[k]); }
        else { centre.push(null); [hx, hy] = pw > 0 ? purplePoint(px / pw, py / pw) : [0.45, 0.2]; }
        hue.push([hx, hy]);
        lut.push(tintLut(hx, hy));
        meanPurity.push(lsums[k] > 0 ? Math.min(1, sums[k] / lsums[k]) : 0);
    }
    const m: BandMeasure = { n, bw, bh, maps, lum, mw: w, mh: h, sums, lsums, hue, lut, meanPurity, centre, active: sums.map(t => t > EMPTY_BAND * total), total };
    byN.set(n, m);
    measureCache.set(rgba, byN);
    return m;
}

/** Read every band's weight map at a reading scale (sigma, px at 1024) and give it its colour table and membership. */
export function buildBands(m: BandMeasure, sigma: number): BandSet {
    const { n, bw, bh } = m;
    const s = Math.max(bw, bh) / 1024;
    // A band that holds next to nothing of the picture has no lines to trace: skip its analysis.
    const tensors = m.maps.map((map, k) => (m.active[k] ? structure(map, bw, bh, s, sigma) : null));
    // One normaliser for all bands (percentile of the strongest band at each pixel), so a band
    // that hardly exists in the picture stays faint instead of being stretched to full strength.
    const maxE = new Float32Array(bw * bh);
    for (const t of tensors) if (t) for (let i = 0; i < maxE.length; i++) if (t.energy[i] > maxE[i]) maxE[i] = t.energy[i];
    const scale = BAND_MEDIAN_MULTIPLE * percentile(maxE, 0.5);

    // Where each band is present, read at the same scale as the field: the band's weight map blurred with the
    // SCALE sigma (the very map its gradient is taken from) as a share of all bands' blurred maps. It is kept at the
    // picture's own resolution so a line is tested at the pixel it is on.
    const sumSm = new Float32Array(bw * bh);
    for (const t of tensors) if (t) for (let i = 0; i < sumSm.length; i++) sumSm[i] += t.smooth[i];
    const presence = (t: { smooth: Float32Array }): Uint8Array => {
        const small = new Uint8Array(bw * bh);
        for (let i = 0; i < small.length; i++) small[i] = sumSm[i] >= WEIGHT_FLOOR && t.smooth[i] >= PRESENCE_SHARE * sumSm[i] ? 1 : 0;
        const full = new Uint8Array(m.mw * m.mh);
        for (let y = 0; y < m.mh; y++) {
            const row = Math.min(bh - 1, (y / BAND_DOWN) | 0) * bw;
            for (let x = 0; x < m.mw; x++) full[y * m.mw + x] = small[row + Math.min(bw - 1, (x / BAND_DOWN) | 0)];
        }
        return full;
    };

    const bands: Band[] = [];
    for (let k = 0; k <= n; k++) {
        const tk = tensors[k];
        let field: Field = EMPTY_FIELD;
        let mass = 0;
        if (tk) {
            // Purity measured at each point: luminance-weighted mean purity of the band's light,
            // smoothed at the scale the structure is measured at. weight / luminance = purity.
            const lumSm = blur(m.lum[k], bw, bh, sigma * s);
            const purity = new Float32Array(bw * bh);
            let peak = 0;
            for (let i = 0; i < purity.length; i++) if (lumSm[i] > peak) peak = lumSm[i];
            const floor = 0.01 * peak;
            const fb = m.meanPurity[k];
            for (let i = 0; i < purity.length; i++) {
                purity[i] = lumSm[i] > floor ? Math.min(1, tk.smooth[i] / lumSm[i]) : fb;
            }
            field = fieldFromTensor(tk, bw, bh, s, sigma, scale, { tint: { lut: m.lut[k], purity }, member: presence(tk), memberW: m.mw });
            for (let i = 0; i < field.en.length; i++) mass += field.en[i];
        }
        bands.push({ wl: m.centre[k], meanPurity: m.meanPurity[k], mass, field });
    }
    return { n, bands };
}

/** One cell of the spectrum strip: a band, its share of the picture's weight, its colour at the measured purity. */
export interface SpectrumCell {
    /** Centre wavelength in nm, or null for the purples. */
    wl: number | null;
    /** Share of the picture's total weight (purity x luminance), 0..1. */
    share: number;
    /** The band's colour at its measured mean purity, 0..255. */
    colour: [number, number, number];
}

export function spectrumCells(m: BandMeasure): SpectrumCell[] {
    const cells: SpectrumCell[] = [];
    const c = [0, 0, 0];
    for (let k = 0; k <= m.n; k++) {
        tintColour(m.lut[k], m.meanPurity[k], c);
        cells.push({ wl: m.centre[k], share: m.total > 0 ? m.sums[k] / m.total : 0, colour: [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])] });
    }
    return cells;
}

/** Point on the line of purples in the direction of (x, y) from the white point. */
function purplePoint(x: number, y: number): [number, number] {
    const dx = x - D65_X, dy = y - D65_Y;
    const d = Math.hypot(dx, dy) || 1;
    // Line of purples: from the 360 nm end to the 830 nm end of the locus.
    const a = locusXY(360), b = locusXY(830);
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const ux = dx / d, uy = dy / d;
    const den = ux * ey - uy * ex;
    const r = Math.abs(den) > 1e-12 ? ((a[0] - D65_X) * ey - (a[1] - D65_Y) * ex) / den : 0.3;
    return [D65_X + ux * r, D65_Y + uy * r];
}
