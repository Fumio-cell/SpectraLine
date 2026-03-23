import type { LineParams } from '../types';

export interface StrokePoint {
    x: number;
    y: number;
    t: number;
}

export interface StrokePath {
    id: string;
    points: StrokePoint[];
    style: {
        widthMin: number;
        widthMax: number;
        taper: number;
        alpha: number;
        color: { r: number; g: number; b: number };
    };
    meta: {
        source: 'edge' | 'contour' | 'hybrid';
        seedUsed: number;
    };
}

class PRNG {
    private seed: number;
    constructor(seed: number) { this.seed = seed % 2147483647; if (this.seed <= 0) this.seed += 2147483646; }
    next() { return this.seed = this.seed * 16807 % 2147483647; }
    nextFloat() { return (this.next() - 1) / 2147483646; }
}

// Fixed hatching angles for organized tonal lines (like real cross-hatching)
const HATCH_ANGLE_PRIMARY = Math.PI * 0.2;   // ~36° diagonal
const HATCH_ANGLE_SECONDARY = Math.PI * 0.7; // ~126° cross-hatch

/**
 * Attempt to linearly interpolate between two angles, handling wrapping.
 */
function lerpAngle(a: number, b: number, t: number): number {
    let diff = b - a;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return a + diff * t;
}

/**
 * Build strokes that produce croquis/line-drawing style output.
 *
 * Key improvements for line-drawing aesthetics:
 * 1. Low-gradient areas use fixed hatching angles → organized parallel shading
 * 2. High-gradient (edge) areas follow contours → clean edge definition
 * 3. Aggressive luminance-based density → clear light/shadow separation
 * 4. Strong direction smoothing → long, flowing, confident lines
 */
export function buildStrokes(
    width: number,
    height: number,
    magnitude: Float32Array,
    direction: Float32Array,
    luminance: Float32Array,
    params: LineParams,
    imageData?: Uint8ClampedArray
): StrokePath[] {
    const strokes: StrokePath[] = [];
    const rng = new PRNG(params.seed === 0 ? Math.floor(Math.random() * 10000) : params.seed);

    const rawCount = Math.floor((width * height * params.strokeDensity) / 500);
    const maxStrokes = Math.min(rawCount, 3500);

    const cellSize = 4;
    const gridW = Math.ceil(width / cellSize);
    const gridH = Math.ceil(height / cellSize);
    const visited = new Uint8Array(gridW * gridH);

    // Density map: strong darkness weighting
    const densityMap = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        const darkness = 1.0 - luminance[i];
        densityMap[i] = Math.max(magnitude[i] * 0.4, darkness * darkness * 1.2);
    }

    let idCounter = 0;
    const stepSize = 3.0; // Smaller step = smoother curves

    for (let i = 0; i < maxStrokes; i++) {
        let startX = Math.floor(rng.nextFloat() * width);
        let startY = Math.floor(rng.nextFloat() * height);
        let idx = startY * width + startX;

        let density = densityMap[idx];
        const localLum = luminance[idx];

        // Aggressive luminance rejection for highlights
        if (localLum > 0.2) {
            const normalized = (localLum - 0.2) / 0.8;
            const skipProb = Math.pow(normalized, 1.3);
            if (rng.nextFloat() < skipProb) continue;
        }

        const gx = Math.floor(startX / cellSize);
        const gy = Math.floor(startY / cellSize);
        const gridIdx = gy * gridW + gx;

        if (density < 0.02 || visited[gridIdx] >= 5) {
            let found = false;
            for (let j = 0; j < 15; j++) {
                startX = Math.floor(rng.nextFloat() * width);
                startY = Math.floor(rng.nextFloat() * height);
                idx = startY * width + startX;
                density = densityMap[idx];
                const newLum = luminance[idx];

                if (newLum > 0.2) {
                    const normalized = (newLum - 0.2) / 0.8;
                    const skipProb = Math.pow(normalized, 1.3);
                    if (rng.nextFloat() < skipProb) continue;
                }

                const ngx = Math.floor(startX / cellSize);
                const ngy = Math.floor(startY / cellSize);
                const ngridIdx = ngy * gridW + ngx;
                if (density >= 0.02 && visited[ngridIdx] < 5) {
                    found = true;
                    break;
                }
            }
            if (!found) continue;
        }

        const finalLum = luminance[idx];
        const darkness = Math.max(0, 1.0 - finalLum);
        const localMag = magnitude[idx];

        // Determine stroke type: contour lines (high mag) or hatching (low mag)
        // Choose hatching angle: alternate between primary and cross-hatch
        const useHatch = idCounter % 3 !== 0 ? HATCH_ANGLE_PRIMARY : HATCH_ANGLE_SECONDARY;
        // Add slight random variation to hatching angle for natural look
        const hatchAngle = useHatch + (rng.nextFloat() - 0.5) * 0.15;

        // Stroke length: longer for organized hatching, shorter for edge following
        const lengthScale = 0.3 + darkness * 0.7;
        const baseLength = localMag > 0.15 ? params.strokeLength * 0.7 : params.strokeLength;
        const adjustedLength = Math.max(15, Math.floor(baseLength * lengthScale));

        // Color
        let strokeColor = { r: 30, g: 30, b: 30 };
        if (imageData) {
            const pixIdx = idx * 4;
            const colorScale = 0.1 + darkness * 0.6;
            strokeColor = {
                r: Math.max(0, Math.min(220, Math.floor(imageData[pixIdx] * colorScale))),
                g: Math.max(0, Math.min(220, Math.floor(imageData[pixIdx + 1] * colorScale))),
                b: Math.max(0, Math.min(220, Math.floor(imageData[pixIdx + 2] * colorScale)))
            };
        }

        // Width: thinner in light, thicker in dark
        const widthScale = 0.15 + darkness * 0.85;
        const adjustedWidthMin = Math.max(0.2, params.widthMin * widthScale);
        const adjustedWidthMax = Math.max(0.3, params.widthMax * widthScale);

        // Alpha: darkness² curve
        const strokeAlpha = Math.max(0.06, Math.min(1.0, darkness * darkness * 1.5 + 0.06));

        // Trace with hatching-aware direction
        const forwardPoints = traceDirectionHatching(
            startX, startY, width, height, magnitude, direction,
            params, rng, stepSize, 1, densityMap, luminance,
            Math.floor(adjustedLength / 2), hatchAngle
        );
        const backwardPoints = traceDirectionHatching(
            startX, startY, width, height, magnitude, direction,
            params, rng, stepSize, -1, densityMap, luminance,
            Math.floor(adjustedLength / 2), hatchAngle
        );

        const allPoints: StrokePoint[] = [];
        for (let b = backwardPoints.length - 1; b > 0; b--) {
            allPoints.push(backwardPoints[b]);
        }
        for (const fp of forwardPoints) {
            allPoints.push(fp);
        }

        const totalLen = allPoints.length;
        for (let p = 0; p < totalLen; p++) {
            allPoints[p].t = totalLen > 1 ? p / (totalLen - 1) : 0;
        }

        if (allPoints.length > 2) {
            for (const pt of allPoints) {
                const cgx = Math.floor(pt.x / cellSize);
                const cgy = Math.floor(pt.y / cellSize);
                if (cgx >= 0 && cgx < gridW && cgy >= 0 && cgy < gridH) {
                    const ci = cgy * gridW + cgx;
                    if (visited[ci] < 255) visited[ci]++;
                }
            }

            strokes.push({
                id: `s_${idCounter++}`,
                points: allPoints,
                style: {
                    widthMin: adjustedWidthMin,
                    widthMax: adjustedWidthMax,
                    taper: params.pressureTaper,
                    alpha: strokeAlpha,
                    color: strokeColor
                },
                meta: {
                    source: localMag > 0.15 ? 'edge' : 'hybrid',
                    seedUsed: params.seed
                }
            });
        }
    }

    return strokes;
}

/**
 * Trace direction with hatching-aware blending.
 *
 * In high-gradient areas: follow the gradient perpendicular (contour lines)
 * In low-gradient areas: follow fixed hatching angle (organized shading)
 * Blend smoothly between the two for natural transitions.
 *
 * Direction smoothing is very strong (0.6) to produce long flowing lines.
 */
function traceDirectionHatching(
    startX: number,
    startY: number,
    width: number,
    height: number,
    magnitude: Float32Array,
    direction: Float32Array,
    params: LineParams,
    rng: PRNG,
    stepSize: number,
    dirSign: number,
    densityMap: Float32Array,
    luminance: Float32Array,
    maxSteps: number,
    hatchAngle: number
): StrokePoint[] {
    const points: StrokePoint[] = [];
    let cx = startX;
    let cy = startY;

    const randFactor = (rng.nextFloat() * params.randomness) / 100;
    const pathLength = Math.min(maxSteps, params.strokeLength) * (1 - randFactor);

    points.push({ x: cx, y: cy, t: 0 });

    let prevDir = 0;
    let initialized = false;
    let lowMagCount = 0;

    for (let step = 0; step < pathLength; step++) {
        const ix = Math.floor(cx);
        const iy = Math.floor(cy);

        if (ix < 0 || ix >= width || iy < 0 || iy >= height) break;

        const cIdx = iy * width + ix;
        const localDensity = densityMap[cIdx];
        const localLum = luminance[cIdx];
        const mag = magnitude[cIdx];

        // Early termination in very flat/bright areas
        if (localDensity < 0.01 || localLum > 0.93) {
            lowMagCount++;
            if (lowMagCount > 4) break;
        } else {
            lowMagCount = 0;
        }

        // === HATCHING-AWARE DIRECTION ===
        // High magnitude → follow gradient flow (along edges/contours)
        // Low magnitude → use fixed hatching angle (organized shading)
        const gradDir = (direction[cIdx] + Math.PI / 2) * dirSign;

        let dir: number;
        if (mag > 0.2) {
            // Strong edge: follow contour
            dir = gradDir;
        } else if (mag > 0.05) {
            // Transition zone: blend between hatching and contour
            const blend = (mag - 0.05) / 0.15;
            dir = lerpAngle(hatchAngle * dirSign, gradDir, blend);
        } else {
            // Flat area: organized hatching
            dir = hatchAngle * dirSign;
        }

        // Strong direction smoothing for flowing lines (0.6 = very smooth)
        if (initialized) {
            let angleDiff = dir - prevDir;
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            dir = prevDir + angleDiff * 0.15; // Very strong smoothing
        }
        initialized = true;
        prevDir = dir;

        // Minimal wobble for clean lines
        const wobble = Math.sin(step * params.wobbleFreq * 0.03) * params.wobbleAmp * 0.15;
        dir += wobble;

        const dx = Math.cos(dir) * stepSize;
        const dy = Math.sin(dir) * stepSize;

        cx += dx;
        cy += dy;

        if (cx < 1 || cx >= width - 1 || cy < 1 || cy >= height - 1) break;

        if (params.sourceMode === 'Edges') {
            const newIdx = Math.floor(cy) * width + Math.floor(cx);
            if (densityMap[newIdx] < params.edgeThreshold * 0.05) break;
        }

        // Record every 4th point for smoother Bézier curves
        if (step % 4 === 0) {
            points.push({ x: cx, y: cy, t: 0 });
        }
    }

    return points;
}
