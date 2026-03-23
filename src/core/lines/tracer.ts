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
 * Build strokes with luminance-aware density and width.
 * 
 * Key principle: Light areas → fewer/thinner/lighter strokes (paper shows through = "light")
 *               Dark areas → more/thicker/darker strokes (heavy ink = "shadow")
 * 
 * This creates natural-looking tonal variation in pen-and-ink style.
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

    const rawCount = Math.floor((width * height * params.strokeDensity) / 600);
    const maxStrokes = Math.min(rawCount, 3000);

    const cellSize = 4;
    const gridW = Math.ceil(width / cellSize);
    const gridH = Math.ceil(height / cellSize);
    const visited = new Uint8Array(gridW * gridH);

    // Density map: combines edge magnitude and darkness
    // Dark areas get high density, bright areas get low density
    const densityMap = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        const darkness = 1.0 - luminance[i];
        // Weight darkness much more heavily so tonal range is preserved
        densityMap[i] = Math.max(magnitude[i] * 0.6, darkness * 0.8);
    }

    let idCounter = 0;
    const stepSize = 4.0;

    for (let i = 0; i < maxStrokes; i++) {
        let startX = Math.floor(rng.nextFloat() * width);
        let startY = Math.floor(rng.nextFloat() * height);
        let idx = startY * width + startX;

        let density = densityMap[idx];
        const localLum = luminance[idx];

        // === LUMINANCE-BASED REJECTION ===
        // Bright areas: probabilistically reject strokes so paper stays white
        // This is the key to expressing highlights/light
        if (localLum > 0.4) {
            // The brighter it is, the more likely we skip this stroke
            // At luminance 0.4: 10% skip chance
            // At luminance 0.7: 60% skip chance
            // At luminance 0.9: 95% skip chance
            const skipProb = Math.pow((localLum - 0.4) / 0.6, 1.5);
            if (rng.nextFloat() < skipProb) continue;
        }

        const gx = Math.floor(startX / cellSize);
        const gy = Math.floor(startY / cellSize);
        const gridIdx = gy * gridW + gx;

        if (density < params.edgeThreshold * 0.15 || visited[gridIdx] >= 5) {
            let found = false;
            for (let j = 0; j < 12; j++) {
                startX = Math.floor(rng.nextFloat() * width);
                startY = Math.floor(rng.nextFloat() * height);
                idx = startY * width + startX;
                density = densityMap[idx];
                const newLum = luminance[idx];

                // Also apply luminance rejection during retry
                if (newLum > 0.4) {
                    const skipProb = Math.pow((newLum - 0.4) / 0.6, 1.5);
                    if (rng.nextFloat() < skipProb) continue;
                }

                const ngx = Math.floor(startX / cellSize);
                const ngy = Math.floor(startY / cellSize);
                const ngridIdx = ngy * gridW + ngx;
                if (density >= params.edgeThreshold * 0.15 && visited[ngridIdx] < 5) {
                    found = true;
                    break;
                }
            }
            if (!found) continue;
        }

        // Recompute luminance at final position
        const finalLum = luminance[idx];

        // === LUMINANCE-BASED COLOR ===
        // Darker source → darker stroke, lighter source → lighter stroke
        let strokeColor = { r: 30, g: 30, b: 30 };
        if (imageData) {
            const pixIdx = idx * 4;
            // Use higher multiplier (0.55) to preserve color/tonal range
            // Dark pixels stay dark, medium pixels become medium gray
            const colorScale = 0.15 + (1.0 - finalLum) * 0.55;
            strokeColor = {
                r: Math.max(0, Math.min(200, Math.floor(imageData[pixIdx] * colorScale))),
                g: Math.max(0, Math.min(200, Math.floor(imageData[pixIdx + 1] * colorScale))),
                b: Math.max(0, Math.min(200, Math.floor(imageData[pixIdx + 2] * colorScale)))
            };
        }

        // === LUMINANCE-BASED WIDTH ===
        // Dark areas get thick strokes, light areas get thin strokes
        const darkness = 1.0 - finalLum;
        const widthScale = 0.3 + darkness * 0.7; // Range: 0.3 (lightest) to 1.0 (darkest)
        const adjustedWidthMin = params.widthMin * widthScale;
        const adjustedWidthMax = params.widthMax * widthScale;

        // === LUMINANCE-BASED ALPHA ===
        // Light areas are more transparent, dark areas are fully opaque
        const strokeAlpha = Math.max(0.15, Math.min(1.0, 0.3 + darkness * 0.7));

        // Trace path
        const forwardPoints = traceDirection(
            startX, startY, width, height, magnitude, direction,
            params, rng, stepSize, 1, densityMap, visited, gridW, cellSize
        );
        const backwardPoints = traceDirection(
            startX, startY, width, height, magnitude, direction,
            params, rng, stepSize, -1, densityMap, visited, gridW, cellSize
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
                meta: { source: 'hybrid', seedUsed: params.seed }
            });
        }
    }

    return strokes;
}

/**
 * Trace a single direction along the flow field.
 */
function traceDirection(
    startX: number,
    startY: number,
    width: number,
    height: number,
    _magnitude: Float32Array,
    direction: Float32Array,
    params: LineParams,
    rng: PRNG,
    stepSize: number,
    dirSign: number,
    densityMap: Float32Array,
    _visited: Uint8Array,
    _gridW: number,
    _cellSize: number
): StrokePoint[] {
    const points: StrokePoint[] = [];
    let cx = startX;
    let cy = startY;

    const randFactor = (rng.nextFloat() * params.randomness) / 100;
    const pathLength = params.strokeLength * (1 - randFactor);

    points.push({ x: cx, y: cy, t: 0 });

    let prevDir = 0;
    let initialized = false;

    for (let step = 0; step < pathLength; step++) {
        const ix = Math.floor(cx);
        const iy = Math.floor(cy);

        if (ix < 0 || ix >= width || iy < 0 || iy >= height) break;

        const cIdx = iy * width + ix;

        let dir = direction[cIdx] + Math.PI / 2;
        dir *= dirSign;

        if (initialized) {
            let angleDiff = dir - prevDir;
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            dir = prevDir + angleDiff * 0.3;
        }
        initialized = true;
        prevDir = dir;

        const wobble = Math.sin(step * params.wobbleFreq * 0.05) * params.wobbleAmp * 0.3;
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

        if (step % 6 === 0) {
            points.push({ x: cx, y: cy, t: 0 });
        }
    }

    return points;
}
