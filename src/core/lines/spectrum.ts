import { fieldFromTensor, percentile, structure, type Field } from './field';
import { D65_X, D65_Y, SRGB_TO_XYZ_IEC as MX, locusXY, srgbToLinear, xyToDominant, type Dominant } from '../maps/colorscience';

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

/** Band weight maps are sparse (edges between colour regions), so their energy is normalised at a lower percentile than the picture's. */
const BAND_SCALE_P = 0.94;

/** Bands holding less than this share of the total weight are left out. */
const EMPTY_BAND = 0.002;

/** Stand-in field for a skipped band; it never carries a line (its mass is 0). */
const EMPTY_FIELD = { w: 1, h: 1, s: 1, lum: new Float32Array(0), cr: new Float32Array(0), cg: new Float32Array(0), cb: new Float32Array(0), tx: new Float32Array(1), ty: new Float32Array(1), coh: new Float32Array(1), str: new Float32Array(1), en: new Float32Array(1) } as Field;

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

/**
 * The most saturated colour sRGB can show that keeps the chromaticity's dominant wavelength:
 * mix the monochromatic stimulus with white (which slides along the same ray from white)
 * until the first channel reaches zero, then scale to full brightness.
 */
export function gamutColour(x: number, y: number): [number, number, number] {
    const X = x / y, Y = 1, Z = (1 - x - y) / y;
    const s = [MI[0] * X + MI[1] * Y + MI[2] * Z, MI[3] * X + MI[4] * Y + MI[5] * Z, MI[6] * X + MI[7] * Y + MI[8] * Z];
    let k = 1;
    for (let c = 0; c < 3; c++) if (s[c] < 0) k = Math.min(k, 1 / (1 - s[c]));
    const rgb = s.map(v => (1 - k) + k * v);
    const m = Math.max(rgb[0], rgb[1], rgb[2]);
    return [255 * oetf(rgb[0] / m), 255 * oetf(rgb[1] / m), 255 * oetf(rgb[2] / m)];
}

/** Display colour of a spectral band: its centre wavelength, gamut-mapped. */
export function bandColour(wl: number): [number, number, number] {
    const xy = locusXY(wl);
    return gamutColour(xy[0], xy[1]);
}

export interface Band {
    /** Centre wavelength in nm; null for the non-spectral (purple) band. */
    wl: number | null;
    colour: [number, number, number];
    /** Sum of the band's gradient energy: how much structure it carries. */
    mass: number;
    field: Field;
}

export interface BandSet {
    n: number;
    bands: Band[];
}

/** Build weight maps and structure fields for n spectral bands (+ purple). */
export function buildBands(rgba: Uint8ClampedArray, w: number, h: number, nBands: number, spec?: SpectrumMaps): BandSet {
    const n = Math.max(2, Math.min(16, Math.round(nBands)));
    const sp = spec ?? spectrumOf(rgba, w, h);
    const bw = Math.ceil(w / BAND_DOWN), bh = Math.ceil(h / BAND_DOWN);
    const maps: Float32Array[] = [];
    for (let k = 0; k <= n; k++) maps.push(new Float32Array(bw * bh));
    const span = BAND_HI - BAND_LO;
    // Weighted mean chromaticity of purple pixels, for the colour of the purple band.
    let pw = 0, px = 0, py = 0;

    for (let y = 0; y < h; y++) {
        const by = Math.min(bh - 1, (y / BAND_DOWN) | 0);
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            const wgt = sp.purity[i] * sp.Y[i];
            if (wgt <= 0) continue;
            const bi = by * bw + Math.min(bw - 1, (x / BAND_DOWN) | 0);
            const wl = sp.wl[i];
            if (wl < 0) {
                maps[n][bi] += wgt;
                pw += wgt; px += wgt * sp.cx[i]; py += wgt * sp.cy[i];
            } else if (wl > 0) {
                // Linear (tent) split between the two nearest band centres.
                let u = ((wl - BAND_LO) / span) * (n - 1);
                if (u < 0) u = 0; else if (u > n - 1) u = n - 1;
                const k = Math.min(n - 2, Math.floor(u));
                const f = u - k;
                maps[k][bi] += wgt * (1 - f);
                maps[k + 1][bi] += wgt * f;
            }
        }
    }
    const norm = 1 / (BAND_DOWN * BAND_DOWN);
    for (const m of maps) for (let i = 0; i < m.length; i++) m[i] *= norm;

    const s = Math.max(bw, bh) / 1024;
    // A band that holds next to nothing of the picture has no lines to trace: skip its analysis.
    const sums = maps.map(m => { let t = 0; for (let i = 0; i < m.length; i++) t += m[i]; return t; });
    const total = sums.reduce((a, b) => a + b, 0);
    const active = sums.map(t => t > EMPTY_BAND * total);
    const tensors = maps.map((m, k) => (active[k] ? structure(m, bw, bh, s) : null));
    // One normaliser for all bands (98th percentile of the strongest band at each pixel), so a band
    // that hardly exists in the picture stays faint instead of being stretched to full strength.
    const maxE = new Float32Array(bw * bh);
    for (const t of tensors) if (t) for (let i = 0; i < maxE.length; i++) if (t.energy[i] > maxE[i]) maxE[i] = t.energy[i];
    const scale = percentile(maxE, BAND_SCALE_P);

    const centres = bandCentres(n);
    const bands: Band[] = [];
    for (let k = 0; k <= n; k++) {
        let colour: [number, number, number];
        let wlc: number | null = null;
        if (k < n) {
            wlc = centres[k];
            colour = bandColour(wlc);
        } else if (pw > 0) {
            // Line of purples at the mean purple direction.
            colour = purpleColour(px / pw, py / pw);
        } else colour = [255, 0, 255];
        const tk = tensors[k];
        const field = tk ? fieldFromTensor(tk, bw, bh, s, scale, { fixed: colour }) : EMPTY_FIELD;
        let mass = 0;
        if (tk) for (let i = 0; i < field.en.length; i++) mass += field.en[i];
        bands.push({ wl: wlc, colour, mass, field });
    }
    return { n, bands };
}

/** Colour on the line of purples in the direction of (x, y) from the white point. */
function purpleColour(x: number, y: number): [number, number, number] {
    const dx = x - D65_X, dy = y - D65_Y;
    const d = Math.hypot(dx, dy) || 1;
    // Line of purples: from the 360 nm end to the 830 nm end of the locus.
    const a = locusXY(360), b = locusXY(830);
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const ux = dx / d, uy = dy / d;
    const den = ux * ey - uy * ex;
    const r = Math.abs(den) > 1e-12 ? ((a[0] - D65_X) * ey - (a[1] - D65_Y) * ex) / den : 0.3;
    return gamutColour(D65_X + ux * r, D65_Y + uy * r);
}
