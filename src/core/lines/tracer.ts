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
 * Build strokes with strong luminance-aware density, width, and alpha.
 *
 * Light areas → very few thin faint strokes (white paper = highlights)
 * Dark areas  → dense thick opaque strokes (heavy ink = shadows)
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

    // Density map: darkness-weighted
    const densityMap = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        const darkness = 1.0 - luminance[i];
        densityMap[i] = Math.max(magnitude[i] * 0.5, darkness * darkness * 1.2);
    }

    let idCounter = 0;
    const stepSize = 4.0;

    for (let i = 0; i < maxStrokes; i++) {
        let startX = Math.floor(rng.nextFloat() * width);
        let startY = Math.floor(rng.nextFloat() * height);
        let idx = startY * width + startX;

        let density = densityMap[idx];
        const localLum = luminance[idx];

        // === AGGRESSIVE LUMINANCE REJECTION ===
        // Start rejecting very early (lum > 0.2) with steep curve
        // lum 0.2 → ~2% skip   |  lum 0.4 → ~20% skip
        // lum 0.6 → ~52% skip  |  lum 0.8 → ~85% skip
        // lum 0.95 → ~98% skip
        if (localLum > 0.2) {
            const normalized = (localLum - 0.2) / 0.8;
            const skipProb = Math.pow(normalized, 1.3);
            if (rng.nextFloat() < skipProb) continue;
        }

        const gx = Math.floor(startX / cellSize);
        const gy = Math.floor(startY / cellSize);
        const gridIdx = gy * gridW + gx;

        // Higher density threshold to skip very flat/bright areas
        if (density < 0.02 || visited[gridIdx] >= 5) {
            let found = false;
            for (let j = 0; j < 15; j++) {
                startX = Math.floor(rng.nextFloat() * width);
                startY = Math.floor(rng.nextFloat() * height);
                idx = startY * width + startX;
                density = densityMap[idx];
                const newLum = luminance[idx];

                // Apply luminance rejection during retry too
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

        // === LUMINANCE-BASED STROKE LENGTH ===
        // Dark areas get full-length strokes, bright areas get shorter ones
        const lengthScale = 0.3 + darkness * 0.7;
        const adjustedLength = Math.max(10, Math.floor(params.strokeLength * lengthScale));

        // === LUMINANCE-BASED COLOR ===
        let strokeColor = { r: 30, g: 30, b: 30 };
        if (imageData) {
            const pixIdx = idx * 4;
            // Scale color based on darkness - preserve tonal range
            const colorScale = 0.1 + darkness * 0.6;
            strokeColor = {
                r: Math.max(0, Math.min(220, Math.floor(imageData[pixIdx] * colorScale))),
                g: Math.max(0, Math.min(220, Math.floor(imageData[pixIdx + 1] * colorScale))),
                b: Math.max(0, Math.min(220, Math.floor(imageData[pixIdx + 2] * colorScale)))
            };
        }

        // === LUMINANCE-BASED WIDTH ===
        const widthScale = 0.15 + darkness * 0.85;
        const adjustedWidthMin = Math.max(0.2, params.widthMin * widthScale);
        const adjustedWidthMax = Math.max(0.3, params.widthMax * widthScale);

        // === LUMINANCE-BASED ALPHA ===
        const strokeAlpha = Math.max(0.08, Math.min(1.0, darkness * darkness * 1.5 + 0.08));

        // Trace path with adjusted length
        const forwardPoints = traceDirection(
            startX, startY, width, height, magnitude, direction,
            params, rng, stepSize, 1, densityMap, luminance,
            Math.floor(adjustedLength / 2)
        );
        const backwardPoints = traceDirection(
            startX, startY, width, height, magnitude, direction,
            params, rng, stepSize, -1, densityMap, luminance,
            Math.floor(adjustedLength / 2)
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
 * Trace direction with magnitude-based early termination.
 * Strokes stop when entering very low-magnitude flat areas,
 * preventing long straight-line artifacts.
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
    luminance: Float32Array,
    maxSteps: number
): StrokePoint[] {
    const points: StrokePoint[] = [];
    let cx = startX;
    let cy = startY;

    const randFactor = (rng.nextFloat() * params.randomness) / 100;
    const pathLength = Math.min(maxSteps, params.strokeLength) * (1 - randFactor);

    points.push({ x: cx, y: cy, t: 0 });

    let prevDir = 0;
    let initialized = false;
    let lowMagCount = 0; // Track consecutive low-magnitude steps

    for (let step = 0; step < pathLength; step++) {
        const ix = Math.floor(cx);
        const iy = Math.floor(cy);

        if (ix < 0 || ix >= width || iy < 0 || iy >= height) break;

        const cIdx = iy * width + ix;

        // === EARLY TERMINATION IN FLAT/BRIGHT AREAS ===
        // Stop tracing if we enter very low-density or very bright areas
        const localDensity = densityMap[cIdx];
        const localLum = luminance[cIdx];

        if (localDensity < 0.01 || localLum > 0.92) {
            lowMagCount++;
            if (lowMagCount > 3) break; // Stop after 3 consecutive low-density steps
        } else {
            lowMagCount = 0;
        }

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

        if (step % 5 === 0) {
            points.push({ x: cx, y: cy, t: 0 });
        }
    }

    return points;
}
