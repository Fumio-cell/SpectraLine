/**
 * CIE Color Science Module
 * 
 * Provides sRGB → CIE XYZ → CIE L*a*b* conversion and CIEDE2000 perceptual color difference.
 * 
 * References:
 *  - sRGB → XYZ: IEC 61966-2-1:1999 (D65 illuminant)
 *  - CIE L*a*b*: ISO/CIE 11664-4:2019
 *  - CIEDE2000: CIE Technical Report 142-2001
 */

// D65 white point reference
const Xn = 0.95047;
const Yn = 1.00000;
const Zn = 1.08883;

// --- sRGB → Linear RGB ---
function srgbToLinear(c: number): number {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// --- Linear RGB → CIE XYZ (D65) ---
export function rgbToXyz(r: number, g: number, b: number): [number, number, number] {
    const rl = srgbToLinear(r);
    const gl = srgbToLinear(g);
    const bl = srgbToLinear(b);

    // sRGB matrix (IEC 61966-2-1)
    const x = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl;
    const y = 0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl;
    const z = 0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl;

    return [x, y, z];
}

// --- CIE XYZ → CIE L*a*b* ---
function labF(t: number): number {
    const delta = 6 / 29;
    return t > delta * delta * delta
        ? Math.cbrt(t)
        : t / (3 * delta * delta) + 4 / 29;
}

export function xyzToLab(x: number, y: number, z: number): [number, number, number] {
    const fx = labF(x / Xn);
    const fy = labF(y / Yn);
    const fz = labF(z / Zn);

    const L = 116 * fy - 16;         // Lightness [0, 100]
    const a = 500 * (fx - fy);       // Green-Red axis
    const b = 200 * (fy - fz);       // Blue-Yellow axis

    return [L, a, b];
}

// --- Convenience: sRGB → L*a*b* ---
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
    const [x, y, z] = rgbToXyz(r, g, b);
    return xyzToLab(x, y, z);
}

/**
 * CIEDE2000 Perceptual Color Difference
 * 
 * Returns ΔE₀₀ — a scientifically accurate measure of perceived color difference.
 * Values < 1.0 are imperceptible; 1–2 is noticeable; > 5 is clearly distinct.
 */
export function ciede2000(
    L1: number, a1: number, b1: number,
    L2: number, a2: number, b2: number
): number {
    const PI = Math.PI;
    const RAD = PI / 180;
    const DEG = 180 / PI;

    // Step 1: Calculate C' and h'
    const C1 = Math.sqrt(a1 * a1 + b1 * b1);
    const C2 = Math.sqrt(a2 * a2 + b2 * b2);
    const Cab = (C1 + C2) / 2;
    const Cab7 = Math.pow(Cab, 7);
    const G = 0.5 * (1 - Math.sqrt(Cab7 / (Cab7 + 6103515625))); // 25^7

    const a1p = a1 * (1 + G);
    const a2p = a2 * (1 + G);
    const C1p = Math.sqrt(a1p * a1p + b1 * b1);
    const C2p = Math.sqrt(a2p * a2p + b2 * b2);

    let h1p = Math.atan2(b1, a1p) * DEG;
    if (h1p < 0) h1p += 360;
    let h2p = Math.atan2(b2, a2p) * DEG;
    if (h2p < 0) h2p += 360;

    // Step 2: Calculate ΔL', ΔC', ΔH'
    const dLp = L2 - L1;
    const dCp = C2p - C1p;

    let dhp: number;
    if (C1p * C2p === 0) {
        dhp = 0;
    } else {
        let dh = h2p - h1p;
        if (dh > 180) dh -= 360;
        else if (dh < -180) dh += 360;
        dhp = dh;
    }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp / 2 * RAD);

    // Step 3: Weighting functions
    const Lp = (L1 + L2) / 2;
    const Cp = (C1p + C2p) / 2;

    let hp: number;
    if (C1p * C2p === 0) {
        hp = h1p + h2p;
    } else {
        if (Math.abs(h1p - h2p) <= 180) {
            hp = (h1p + h2p) / 2;
        } else {
            hp = (h1p + h2p + 360) / 2;
            if (hp >= 360) hp -= 360;
        }
    }

    const T = 1
        - 0.17 * Math.cos((hp - 30) * RAD)
        + 0.24 * Math.cos(2 * hp * RAD)
        + 0.32 * Math.cos((3 * hp + 6) * RAD)
        - 0.20 * Math.cos((4 * hp - 63) * RAD);

    const SL = 1 + 0.015 * (Lp - 50) * (Lp - 50) / Math.sqrt(20 + (Lp - 50) * (Lp - 50));
    const SC = 1 + 0.045 * Cp;
    const SH = 1 + 0.015 * Cp * T;

    const Cp7 = Math.pow(Cp, 7);
    const RC = 2 * Math.sqrt(Cp7 / (Cp7 + 6103515625));
    const dtheta = 30 * Math.exp(-((hp - 275) / 25) * ((hp - 275) / 25));
    const RT = -Math.sin(2 * dtheta * RAD) * RC;

    // Parametric factors (all 1.0 for reference conditions)
    const kL = 1, kC = 1, kH = 1;

    const dE = Math.sqrt(
        (dLp / (kL * SL)) ** 2 +
        (dCp / (kC * SC)) ** 2 +
        (dHp / (kH * SH)) ** 2 +
        RT * (dCp / (kC * SC)) * (dHp / (kH * SH))
    );

    return dE;
}

/**
 * Batch-convert an sRGB image buffer to CIE L*a*b* arrays.
 * Returns separate Float32Arrays for L, a, b channels.
 */
export function imageToLab(
    data: Uint8ClampedArray,
    width: number,
    height: number
): { L: Float32Array; a: Float32Array; b: Float32Array } {
    const n = width * height;
    const L = new Float32Array(n);
    const a = new Float32Array(n);
    const b = new Float32Array(n);

    for (let i = 0; i < n; i++) {
        const idx = i * 4;
        const [li, ai, bi] = rgbToLab(data[idx], data[idx + 1], data[idx + 2]);
        L[i] = li;
        a[i] = ai;
        b[i] = bi;
    }

    return { L, a, b };
}

/**
 * Estimate the correlated color temperature (CCT) of the image.
 * Uses McCamy's approximation from the average chromaticity coordinates.
 * Returns the estimated color temperature in Kelvin.
 */
export function estimateColorTemperature(
    data: Uint8ClampedArray,
    width: number,
    height: number
): number {
    let sumX = 0, sumY = 0, sumZ = 0;
    const n = width * height;

    for (let i = 0; i < n; i++) {
        const idx = i * 4;
        const [x, y, z] = rgbToXyz(data[idx], data[idx + 1], data[idx + 2]);
        sumX += x;
        sumY += y;
        sumZ += z;
    }

    // Chromaticity coordinates
    const total = sumX + sumY + sumZ;
    if (total === 0) return 6500; // default daylight
    const cx = sumX / total;
    const cy = sumY / total;

    // McCamy's approximation
    const n_val = (cx - 0.3320) / (0.1858 - cy);
    const CCT = 449 * n_val * n_val * n_val + 3525 * n_val * n_val + 6823.3 * n_val + 5520.33;

    return Math.round(Math.max(1000, Math.min(40000, CCT)));
}
