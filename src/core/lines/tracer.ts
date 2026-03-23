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
 * Multi-pass cross-hatching for realistic pencil/ink drawing.
 *
 * 5 hatching passes build up tone through density layering:
 *   Pass 0: ~32° angle, darkness > 0.05 — lightest base layer
 *   Pass 1: ~110° angle, darkness > 0.18 — early cross-hatching
 *   Pass 2: ~68° angle, darkness > 0.35 — mid-tone density
 *   Pass 3: ~145° angle, darkness > 0.52 — shadow definition
 *   Pass 4: ~20° angle, darkness > 0.72 — deepest shadow fill
 *
 * Each pass has independent visited tracking so layers accumulate.
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

    // Much more generous stroke budget for dense hatching
    const rawCount = Math.floor((width * height * params.strokeDensity) / 200);
    const maxStrokes = Math.min(rawCount, 16000);

    // 5 hatching passes for richer tonal range
    const passes = [
        { angle: Math.PI * 0.18,  minDarkness: 0.05, lengthMul: 1.0,  widthMul: 0.4,  alphaMul: 0.55 },
        { angle: Math.PI * 0.61,  minDarkness: 0.18, lengthMul: 0.90, widthMul: 0.5,  alphaMul: 0.65 },
        { angle: Math.PI * 0.38,  minDarkness: 0.35, lengthMul: 0.80, widthMul: 0.65, alphaMul: 0.75 },
        { angle: Math.PI * 0.81,  minDarkness: 0.52, lengthMul: 0.70, widthMul: 0.80, alphaMul: 0.85 },
        { angle: Math.PI * 0.11,  minDarkness: 0.72, lengthMul: 0.60, widthMul: 1.0,  alphaMul: 1.0  },
    ];

    const cellSize = 3;
    const gridW = Math.ceil(width / cellSize);
    const gridH = Math.ceil(height / cellSize);

    // Pre-compute darkness
    const darknessMap = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        darknessMap[i] = 1.0 - luminance[i];
    }

    let idCounter = 0;
    const stepSize = 2.0; // Fine step for smooth lines
    const strokesPerPass = Math.floor(maxStrokes / passes.length);

    for (const pass of passes) {
        const visited = new Uint8Array(gridW * gridH);
        // Slight per-pass angle variation for natural look
        const hatchAngle = pass.angle + (rng.nextFloat() - 0.5) * 0.06;

        for (let i = 0; i < strokesPerPass; i++) {
            let startX = Math.floor(rng.nextFloat() * width);
            let startY = Math.floor(rng.nextFloat() * height);
            let idx = startY * width + startX;
            let darkness = darknessMap[idx];

            // Find a point dark enough for this pass
            if (darkness < pass.minDarkness) {
                let found = false;
                for (let j = 0; j < 30; j++) {
                    startX = Math.floor(rng.nextFloat() * width);
                    startY = Math.floor(rng.nextFloat() * height);
                    idx = startY * width + startX;
                    darkness = darknessMap[idx];
                    if (darkness >= pass.minDarkness) {
                        const ngx = Math.floor(startX / cellSize);
                        const ngy = Math.floor(startY / cellSize);
                        if (visited[ngy * gridW + ngx] < 6) {
                            found = true;
                            break;
                        }
                    }
                }
                if (!found) continue;
            }

            const gx = Math.floor(startX / cellSize);
            const gy = Math.floor(startY / cellSize);
            if (visited[gy * gridW + gx] >= 6) continue;

            const localDarkness = darknessMap[idx];
            const localMag = magnitude[idx];

            // Stroke length: longer base for visible hatching lines
            const baseLen = params.strokeLength * pass.lengthMul;
            const lenVar = 0.6 + localDarkness * 0.4;
            const adjustedLength = Math.max(12, Math.floor(baseLen * lenVar));

            // Width: very thin for fine hatching, scaling with darkness
            const widthScale = (0.15 + localDarkness * 0.85) * pass.widthMul;
            const adjWidthMin = Math.max(0.1, params.widthMin * widthScale);
            const adjWidthMax = Math.max(0.12, params.widthMax * widthScale);

            // Alpha: gradual buildup for smooth tonal transitions
            const baseAlpha = 0.05 + localDarkness * 0.7;
            const strokeAlpha = Math.max(0.03, Math.min(0.85, baseAlpha * pass.alphaMul));

            // Color: subtle source color tint
            let strokeColor = { r: 40, g: 40, b: 40 };
            if (imageData) {
                const pixIdx = idx * 4;
                const colorScale = 0.05 + localDarkness * 0.4;
                strokeColor = {
                    r: Math.max(5, Math.min(160, Math.floor(imageData[pixIdx] * colorScale))),
                    g: Math.max(5, Math.min(160, Math.floor(imageData[pixIdx + 1] * colorScale))),
                    b: Math.max(5, Math.min(160, Math.floor(imageData[pixIdx + 2] * colorScale)))
                };
            }

            // Trace
            const halfLen = Math.floor(adjustedLength / 2);
            const fwd = traceHatching(
                startX, startY, width, height, magnitude, direction,
                params, rng, stepSize, 1, darknessMap,
                halfLen, hatchAngle, pass.minDarkness
            );
            const bwd = traceHatching(
                startX, startY, width, height, magnitude, direction,
                params, rng, stepSize, -1, darknessMap,
                halfLen, hatchAngle, pass.minDarkness
            );

            // Combine backward (reversed) + forward
            const pts: StrokePoint[] = [];
            for (let b = bwd.length - 1; b > 0; b--) pts.push(bwd[b]);
            for (const fp of fwd) pts.push(fp);

            const totalLen = pts.length;
            for (let p = 0; p < totalLen; p++) {
                pts[p].t = totalLen > 1 ? p / (totalLen - 1) : 0;
            }

            if (pts.length > 2) {
                for (const pt of pts) {
                    const cgx = Math.floor(pt.x / cellSize);
                    const cgy = Math.floor(pt.y / cellSize);
                    if (cgx >= 0 && cgx < gridW && cgy >= 0 && cgy < gridH) {
                        const ci = cgy * gridW + cgx;
                        if (visited[ci] < 255) visited[ci]++;
                    }
                }

                strokes.push({
                    id: `s_${idCounter++}`,
                    points: pts,
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
 * Trace hatching with form-following direction blending.
 * Near edges, strokes follow contours; in flat areas, straight hatching.
 * Very strong smoothing for clean disciplined lines.
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

        // Stop if entering area too bright for this pass
        if (localDarkness < minDarkness * 0.4) {
            brightCount++;
            if (brightCount > 5) break;
        } else {
            brightCount = 0;
        }

        // Direction: contour-following near edges, hatching in flat areas
        const gradDir = (direction[cIdx] + Math.PI / 2) * dirSign;
        let dir: number;

        if (mag > 0.3) {
            dir = gradDir;
        } else if (mag > 0.08) {
            const blend = (mag - 0.08) / 0.22;
            dir = lerpAngle(hatchAngle * dirSign, gradDir, blend);
        } else {
            dir = hatchAngle * dirSign;
        }

        // Strong direction smoothing = disciplined flowing lines
        if (initialized) {
            let angleDiff = dir - prevDir;
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            dir = prevDir + angleDiff * 0.10; // Very strong smoothing
        }
        initialized = true;
        prevDir = dir;

        // Very subtle wobble for natural texture
        const wobble = Math.sin(step * params.wobbleFreq * 0.015) * params.wobbleAmp * 0.08;
        dir += wobble;

        cx += Math.cos(dir) * stepSize;
        cy += Math.sin(dir) * stepSize;

        if (cx < 1 || cx >= width - 1 || cy < 1 || cy >= height - 1) break;

        // Record every 3rd point for smooth Bézier curves
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
