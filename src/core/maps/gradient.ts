/**
 * Gradient computation with optional Scientific Mode (CIE L*a*b* + CIEDE2000).
 * 
 * Standard mode: BT.601 luminance + Sobel magnitude
 * Scientific mode: CIE L* perceptual lightness + CIEDE2000 color difference
 */

import { imageToLab, ciede2000 } from './colorscience';

export interface GradientResult {
    magnitude: Float32Array;
    direction: Float32Array;
    luminance: Float32Array;
    labL?: Float32Array;
    labA?: Float32Array;
    labB?: Float32Array;
}

export function computeGradients(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    gain: number,
    threshold: number,
    scientificMode: boolean = false
): GradientResult {
    const numPixels = width * height;
    const luminance = new Float32Array(numPixels);
    const magnitude = new Float32Array(numPixels);
    const direction = new Float32Array(numPixels);

    if (scientificMode) {
        // ---- SCIENTIFIC MODE: CIE L*a*b* + CIEDE2000 ----
        console.log('[Gradient] Scientific mode: CIE L*a*b* + CIEDE2000');

        const { L, a, b } = imageToLab(data, width, height);

        // Use CIE L* as luminance (normalized to 0–1 from 0–100)
        for (let i = 0; i < numPixels; i++) {
            luminance[i] = L[i] / 100;
        }

        // Compute perceptual gradients using CIEDE2000
        // Use wider 3-pixel neighborhood for richer gradient capture
        for (let y = 2; y < height - 2; y++) {
            const rowOff = y * width;

            for (let x = 2; x < width - 2; x++) {
                const idx = rowOff + x;

                // Center pixel
                const cL = L[idx], ca = a[idx], cb = b[idx];

                // 4-directional ΔE from center to neighbors (distance 1 and 2)
                const dE_R = ciede2000(cL, ca, cb, L[idx + 1], a[idx + 1], b[idx + 1]);
                const dE_L = ciede2000(cL, ca, cb, L[idx - 1], a[idx - 1], b[idx - 1]);
                const dE_D = ciede2000(cL, ca, cb, L[idx + width], a[idx + width], b[idx + width]);
                const dE_U = ciede2000(cL, ca, cb, L[idx - width], a[idx - width], b[idx - width]);

                // Diagonal neighbors for additional sensitivity
                const dE_TR = ciede2000(cL, ca, cb, L[idx - width + 1], a[idx - width + 1], b[idx - width + 1]);
                const dE_TL = ciede2000(cL, ca, cb, L[idx - width - 1], a[idx - width - 1], b[idx - width - 1]);
                const dE_BR = ciede2000(cL, ca, cb, L[idx + width + 1], a[idx + width + 1], b[idx + width + 1]);
                const dE_BL = ciede2000(cL, ca, cb, L[idx + width - 1], a[idx + width - 1], b[idx + width - 1]);

                // Sobel-style weighted combination in X and Y
                const gx = (-dE_TL + dE_TR) + 2 * (-dE_L + dE_R) + (-dE_BL + dE_BR);
                const gy = (-dE_TL - 2 * dE_U - dE_TR) + (dE_BL + 2 * dE_D + dE_BR);

                // ΔE between adjacent pixels is typically 0.5–10
                // Normalize by 10 (not 100!) to preserve sensitivity
                let mag = Math.sqrt(gx * gx + gy * gy) / 10 * gain;
                if (mag < threshold) mag = 0;
                if (mag > 1.0) mag = 1.0;

                magnitude[idx] = mag;
                direction[idx] = Math.atan2(gy, gx);
            }
        }

        return { magnitude, direction, luminance, labL: L, labA: a, labB: b };
    } else {
        // ---- STANDARD MODE: BT.601 Luma + Sobel ----

        // 1. Convert to Luminance (0.0 to 1.0)
        for (let i = 0; i < numPixels; i++) {
            const idx = i * 4;
            const luma = (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]) / 255.0;
            luminance[i] = luma;
        }

        // 2. Sobel Operator (unrolled)
        for (let y = 1; y < height - 1; y++) {
            const rowOff = y * width;
            const rowUp = (y - 1) * width;
            const rowDown = (y + 1) * width;

            for (let x = 1; x < width - 1; x++) {
                const pTL = luminance[rowUp + x - 1];
                const pT = luminance[rowUp + x];
                const pTR = luminance[rowUp + x + 1];

                const pL = luminance[rowOff + x - 1];
                const pR = luminance[rowOff + x + 1];

                const pBL = luminance[rowDown + x - 1];
                const pB = luminance[rowDown + x];
                const pBR = luminance[rowDown + x + 1];

                const gx = -pTL + pTR - (2 * pL) + (2 * pR) - pBL + pBR;
                const gy = -pTL - (2 * pT) - pTR + pBL + (2 * pB) + pBR;

                const idx = y * width + x;
                let mag = Math.sqrt(gx * gx + gy * gy) * gain;

                if (mag < threshold) mag = 0;
                if (mag > 1.0) mag = 1.0;

                magnitude[idx] = mag;
                direction[idx] = Math.atan2(gy, gx);
            }
        }

        return { magnitude, direction, luminance };
    }
}
