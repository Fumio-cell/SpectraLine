import type { LineParams } from '../types';

export interface StrokePoint {
    x: number;
    y: number;
    t: number; // Normalized position (0 to 1) along the stroke
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

// Pseudo-random number generator for seeded randomness
class PRNG {
    private seed: number;
    constructor(seed: number) { this.seed = seed % 2147483647; if (this.seed <= 0) this.seed += 2147483646; }
    next() { return this.seed = this.seed * 16807 % 2147483647; }
    nextFloat() { return (this.next() - 1) / 2147483646; }
}

/**
 * Build high-quality flowing strokes that trace along gradient flow fields.
 * Produces dense, long, smooth curves similar to pen-and-ink illustration style.
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

    // Density-based stroke count - generous limits for rich output
    const rawCount = Math.floor((width * height * params.strokeDensity) / 400);
    const maxStrokes = Math.min(rawCount, 8000);

    // Coverage tracking
    const cellSize = 3;
    const gridW = Math.ceil(width / cellSize);
    const gridH = Math.ceil(height / cellSize);
    const visited = new Uint8Array(gridW * gridH);

    // Pre-compute luminance-based density map
    // More strokes in darker/more detailed areas
    const densityMap = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        densityMap[i] = Math.max(magnitude[i], (1.0 - luminance[i]) * 0.6);
    }

    let idCounter = 0;
    const stepSize = 3.0; // Larger step = fewer points per stroke = faster rendering

    for (let i = 0; i < maxStrokes; i++) {
        // 1. Pick a random seed point
        let startX = Math.floor(rng.nextFloat() * width);
        let startY = Math.floor(rng.nextFloat() * height);
        let idx = startY * width + startX;

        // Check density at this point
        let density = densityMap[idx];
        const gx = Math.floor(startX / cellSize);
        const gy = Math.floor(startY / cellSize);
        const gridIdx = gy * gridW + gx;

        // Probability-based placement: more likely in high-density areas
        if (density < params.edgeThreshold * 0.1 || visited[gridIdx] >= 6) {
            // Try harder to find a valid spot
            let found = false;
            for (let j = 0; j < 25; j++) {
                startX = Math.floor(rng.nextFloat() * width);
                startY = Math.floor(rng.nextFloat() * height);
                idx = startY * width + startX;
                density = densityMap[idx];
                const ngx = Math.floor(startX / cellSize);
                const ngy = Math.floor(startY / cellSize);
                const ngridIdx = ngy * gridW + ngx;
                if (density >= params.edgeThreshold * 0.1 && visited[ngridIdx] < 6) {
                    found = true;
                    break;
                }
            }
            if (!found) continue;
        }

        // Get color from source image
        let strokeColor = { r: 20, g: 20, b: 20 };
        if (imageData) {
            const pixIdx = idx * 4;
            strokeColor = {
                r: Math.max(0, Math.floor(imageData[pixIdx] * 0.3)),
                g: Math.max(0, Math.floor(imageData[pixIdx + 1] * 0.3)),
                b: Math.max(0, Math.floor(imageData[pixIdx + 2] * 0.3))
            };
        }

        // 2. Trace the path in both directions from the seed point
        const forwardPoints = traceDirection(
            startX, startY, width, height, magnitude, direction,
            params, rng, stepSize, 1, densityMap, visited, gridW, cellSize
        );
        const backwardPoints = traceDirection(
            startX, startY, width, height, magnitude, direction,
            params, rng, stepSize, -1, densityMap, visited, gridW, cellSize
        );

        // Combine: backward (reversed) + forward
        const allPoints: StrokePoint[] = [];
        for (let b = backwardPoints.length - 1; b > 0; b--) {
            allPoints.push(backwardPoints[b]);
        }
        for (const fp of forwardPoints) {
            allPoints.push(fp);
        }

        // Normalize t values
        const totalLen = allPoints.length;
        for (let p = 0; p < totalLen; p++) {
            allPoints[p].t = totalLen > 1 ? p / (totalLen - 1) : 0;
        }

        if (allPoints.length > 2) {
            // Mark cells as visited
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
                    widthMin: params.widthMin,
                    widthMax: params.widthMax,
                    taper: params.pressureTaper,
                    alpha: 1.0,
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
 * Returns an array of smoothly interpolated points.
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
    dirSign: number, // 1 = forward, -1 = backward
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

    // Smooth direction tracking to avoid jitter
    let prevDir = 0;
    let initialized = false;

    for (let step = 0; step < pathLength; step++) {
        const ix = Math.floor(cx);
        const iy = Math.floor(cy);

        if (ix < 0 || ix >= width || iy < 0 || iy >= height) break;

        const cIdx = iy * width + ix;

        // Get gradient direction and flow perpendicular to it
        let dir = direction[cIdx] + Math.PI / 2;
        dir *= dirSign;

        // Smooth direction changes to produce flowing curves
        if (initialized) {
            // Unwrap angle difference
            let angleDiff = dir - prevDir;
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            // Smooth interpolation (stronger smoothing = smoother curves)
            dir = prevDir + angleDiff * 0.3;
        }
        initialized = true;
        prevDir = dir;

        // Wobble perturbation (more subtle for flowing lines)
        const wobble = Math.sin(step * params.wobbleFreq * 0.05) * params.wobbleAmp * 0.3;
        dir += wobble;

        const dx = Math.cos(dir) * stepSize;
        const dy = Math.sin(dir) * stepSize;

        cx += dx;
        cy += dy;

        // Bounds check
        if (cx < 1 || cx >= width - 1 || cy < 1 || cy >= height - 1) break;

        // Stop in very low density areas for 'Edges' mode
        if (params.sourceMode === 'Edges') {
            const newIdx = Math.floor(cy) * width + Math.floor(cx);
            if (densityMap[newIdx] < params.edgeThreshold * 0.05) break;
        }

        // Record every 4th point for performance (smoothed by Bézier in renderer)
        if (step % 4 === 0) {
            points.push({ x: cx, y: cy, t: 0 });
        }
    }

    return points;
}
