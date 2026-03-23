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

/**
 * Multi-pass cross-hatching system for realistic pencil/ink drawing.
 *
 * Real pencil drawings build tone through layered hatching:
 *  - Light areas: single sparse layer at one angle
 *  - Mid-tones: two layers at different angles (cross-hatching)
 *  - Dark areas: three or more layers creating dense shading
 *  - Highlights: no strokes at all (pure white paper)
 *
 * Each pass targets a minimum darkness threshold, so darker areas
 * naturally accumulate more hatching layers = deeper tone.
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

    const rawCount = Math.floor((width * height * params.strokeDensity) / 400);
    const maxStrokes = Math.min(rawCount, 5000);

    // Multi-pass hatching: each pass targets increasingly darker areas
    // and uses a different angle to create cross-hatching
    const passes = [
        { angle: Math.PI * 0.18,  minDarkness: 0.08, lengthMul: 1.0,  widthMul: 0.5,  alphaMul: 0.7  },
        { angle: Math.PI * 0.68,  minDarkness: 0.25, lengthMul: 0.85, widthMul: 0.6,  alphaMul: 0.8  },
        { angle: Math.PI * 0.43,  minDarkness: 0.45, lengthMul: 0.7,  widthMul: 0.75, alphaMul: 0.9  },
        { angle: Math.PI * 0.88,  minDarkness: 0.65, lengthMul: 0.6,  widthMul: 1.0,  alphaMul: 1.0  },
    ];

    const cellSize = 3;
    const gridW = Math.ceil(width / cellSize);
    const gridH = Math.ceil(height / cellSize);

    // Pre-compute darkness map (inverted luminance)
    const darknessMap = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        darknessMap[i] = 1.0 - luminance[i];
    }

    let idCounter = 0;
    const stepSize = 2.5;
    const strokesPerPass = Math.floor(maxStrokes / passes.length);

    for (const pass of passes) {
        // Fresh visited grid per pass (allows layering)
        const visited = new Uint8Array(gridW * gridH);
        const hatchAngle = pass.angle + (rng.nextFloat() - 0.5) * 0.08;

        for (let i = 0; i < strokesPerPass; i++) {
            let startX = Math.floor(rng.nextFloat() * width);
            let startY = Math.floor(rng.nextFloat() * height);
            let idx = startY * width + startX;
            let darkness = darknessMap[idx];

            // Skip if this area isn't dark enough for this pass
            if (darkness < pass.minDarkness) {
                // Try to find a valid point
                let found = false;
                for (let j = 0; j < 20; j++) {
                    startX = Math.floor(rng.nextFloat() * width);
                    startY = Math.floor(rng.nextFloat() * height);
                    idx = startY * width + startX;
                    darkness = darknessMap[idx];
                    if (darkness >= pass.minDarkness) {
                        const ngx = Math.floor(startX / cellSize);
                        const ngy = Math.floor(startY / cellSize);
                        const ngridIdx = ngy * gridW + ngx;
                        if (visited[ngridIdx] < 4) {
                            found = true;
                            break;
                        }
                    }
                }
                if (!found) continue;
            }

            const gx = Math.floor(startX / cellSize);
            const gy = Math.floor(startY / cellSize);
            const gridIdx = gy * gridW + gx;
            if (visited[gridIdx] >= 4) continue;

            // === TONAL-AWARE STROKE PROPERTIES ===
            const localDarkness = darknessMap[idx];
            const localMag = magnitude[idx];

            // Stroke length: shorter strokes for finer hatching texture
            const baseLen = params.strokeLength * pass.lengthMul;
            const lenVar = 0.5 + localDarkness * 0.5;
            const adjustedLength = Math.max(8, Math.floor(baseLen * lenVar));

            // Width: thin lines, thicker in darker areas
            const widthScale = (0.2 + localDarkness * 0.8) * pass.widthMul;
            const adjWidthMin = Math.max(0.1, params.widthMin * widthScale);
            const adjWidthMax = Math.max(0.15, params.widthMax * widthScale);

            // Alpha: builds up with darkness and pass depth
            const baseAlpha = localDarkness * localDarkness;
            const strokeAlpha = Math.max(0.04, Math.min(0.95, baseAlpha * pass.alphaMul + 0.04));

            // Color: grayscale with subtle source color
            let strokeColor = { r: 35, g: 35, b: 35 };
            if (imageData) {
                const pixIdx = idx * 4;
                const colorScale = 0.05 + localDarkness * 0.45;
                strokeColor = {
                    r: Math.max(0, Math.min(180, Math.floor(imageData[pixIdx] * colorScale))),
                    g: Math.max(0, Math.min(180, Math.floor(imageData[pixIdx + 1] * colorScale))),
                    b: Math.max(0, Math.min(180, Math.floor(imageData[pixIdx + 2] * colorScale)))
                };
            }

            // Trace stroke
            const halfLen = Math.floor(adjustedLength / 2);
            const forwardPts = traceHatching(
                startX, startY, width, height, magnitude, direction,
                params, rng, stepSize, 1, darknessMap, luminance,
                halfLen, hatchAngle, pass.minDarkness
            );
            const backwardPts = traceHatching(
                startX, startY, width, height, magnitude, direction,
                params, rng, stepSize, -1, darknessMap, luminance,
                halfLen, hatchAngle, pass.minDarkness
            );

            // Combine
            const allPoints: StrokePoint[] = [];
            for (let b = backwardPts.length - 1; b > 0; b--) {
                allPoints.push(backwardPts[b]);
            }
            for (const fp of forwardPts) {
                allPoints.push(fp);
            }

            const totalLen = allPoints.length;
            for (let p = 0; p < totalLen; p++) {
                allPoints[p].t = totalLen > 1 ? p / (totalLen - 1) : 0;
            }

            if (allPoints.length > 2) {
                // Mark visited
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
                        widthMin: adjWidthMin,
                        widthMax: adjWidthMax,
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
    }

    return strokes;
}

/**
 * Trace hatching stroke with intelligent direction:
 * - Near strong edges: follow contour for form definition
 * - In flat areas: use fixed hatching angle for organized tone
 * - Strong smoothing for clean, disciplined lines
 * - Early termination when entering bright areas (preserve highlights)
 */
function traceHatching(
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
    darknessMap: Float32Array,
    _luminance: Float32Array,
    maxSteps: number,
    hatchAngle: number,
    minDarkness: number
): StrokePoint[] {
    const points: StrokePoint[] = [];
    let cx = startX;
    let cy = startY;

    const randFactor = (rng.nextFloat() * params.randomness) / 100;
    const pathLength = Math.min(maxSteps, params.strokeLength) * (1 - randFactor);

    points.push({ x: cx, y: cy, t: 0 });

    let prevDir = 0;
    let initialized = false;
    let brightCount = 0;

    for (let step = 0; step < pathLength; step++) {
        const ix = Math.floor(cx);
        const iy = Math.floor(cy);

        if (ix < 0 || ix >= width || iy < 0 || iy >= height) break;

        const cIdx = iy * width + ix;
        const localDarkness = darknessMap[cIdx];
        const mag = magnitude[cIdx];

        // Stop tracing if we enter an area too bright for this pass
        if (localDarkness < minDarkness * 0.5) {
            brightCount++;
            if (brightCount > 3) break;
        } else {
            brightCount = 0;
        }

        // Direction: blend between hatching angle and gradient contour
        const gradDir = (direction[cIdx] + Math.PI / 2) * dirSign;
        let dir: number;

        if (mag > 0.25) {
            // Strong edge: follow contour
            dir = gradDir;
        } else if (mag > 0.08) {
            // Blend zone
            const blend = (mag - 0.08) / 0.17;
            dir = lerpAngle(hatchAngle * dirSign, gradDir, blend);
        } else {
            // Flat area: organized hatching
            dir = hatchAngle * dirSign;
        }

        // Very strong direction smoothing for disciplined lines
        if (initialized) {
            let angleDiff = dir - prevDir;
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            dir = prevDir + angleDiff * 0.12;
        }
        initialized = true;
        prevDir = dir;

        // Minimal wobble
        const wobble = Math.sin(step * params.wobbleFreq * 0.02) * params.wobbleAmp * 0.1;
        dir += wobble;

        cx += Math.cos(dir) * stepSize;
        cy += Math.sin(dir) * stepSize;

        if (cx < 1 || cx >= width - 1 || cy < 1 || cy >= height - 1) break;

        // Record every 3rd point for smooth Bézier
        if (step % 3 === 0) {
            points.push({ x: cx, y: cy, t: 0 });
        }
    }

    return points;
}

function lerpAngle(a: number, b: number, t: number): number {
    let diff = b - a;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return a + diff * t;
}
