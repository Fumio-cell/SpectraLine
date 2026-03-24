import type { LineParams } from '../types';

export interface StrokePath {
    id: string;
    points: Float32Array; // Flattened [x, y, t, p, ...]
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
 * Artist-Driven Multi-Pass Tracer
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

    const densityVal = Math.max(1, params.strokeDensity);
    const rawCount = Math.floor((width * height * densityVal) / 80);
    const maxStrokesTotal = Math.min(rawCount, 15000);

    const darknessMap = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        darknessMap[i] = Math.max(0, 1.0 - luminance[i]);
    }

    const passes = [
        { type: 'outline', angle: 0, minDark: 0.1, maxStrokes: 0.15, length: 1.5, width: 1.0, alpha: 0.8 },
        { type: 'hatch', angle: Math.PI * 0.15, minDark: 0.05, maxStrokes: 0.25, length: 1.0, width: 0.4, alpha: 0.6 },
        { type: 'hatch', angle: Math.PI * 0.65, minDark: 0.22, maxStrokes: 0.25, length: 0.8, width: 0.5, alpha: 0.7 },
        { type: 'hatch', angle: Math.PI * 0.40, minDark: 0.42, maxStrokes: 0.20, length: 0.6, width: 0.7, alpha: 0.8 },
        { type: 'hatch', angle: Math.PI * 0.90, minDark: 0.65, maxStrokes: 0.15, length: 0.4, width: 0.9, alpha: 1.0 }
    ];

    const cellSize = 2;
    const gridW = Math.ceil(width / cellSize);
    const gridH = Math.ceil(height / cellSize);
    let idCounter = 0;

    for (const passConfig of passes) {
        const passMax = Math.floor(maxStrokesTotal * passConfig.maxStrokes);
        const visited = new Uint8Array(gridW * gridH);
        
        for (let i = 0; i < passMax; i++) {
            let sx = Math.floor(rng.nextFloat() * width);
            let sy = Math.floor(rng.nextFloat() * height);
            let idx = sy * width + sx;
            let dark = darknessMap[idx];

            if (dark < passConfig.minDark) {
                let found = false;
                for (let j = 0; j < 40; j++) {
                    sx = Math.floor(rng.nextFloat() * width);
                    sy = Math.floor(rng.nextFloat() * height);
                    idx = sy * width + sx;
                    dark = darknessMap[idx];
                    if (dark >= passConfig.minDark) {
                        const gx = Math.floor(sx / cellSize);
                        const gy = Math.floor(sy / cellSize);
                        if (visited[gy * gridW + gx] < 4) {
                            found = true;
                            break;
                        }
                    }
                }
                if (!found) continue;
            }

            const gx = Math.floor(sx / cellSize);
            const gy = Math.floor(sy / cellSize);
            if (visited[gy * gridW + gx] >= 4) continue;

            const localDark = darknessMap[idx];
            const wScale = (0.1 + localDark * 0.9) * passConfig.width;
            const wMin = Math.max(0.05, params.widthMin * wScale);
            const wMax = Math.max(0.1, params.widthMax * wScale);
            const alpha = Math.max(0.02, Math.min(0.9, localDark * localDark * passConfig.alpha));

            let color = { r: 35, g: 35, b: 35 };
            if (imageData) {
                const pIdx = idx * 4;
                const cScale = 0.05 + localDark * 0.4;
                color = {
                    r: Math.floor(imageData[pIdx] * cScale),
                    g: Math.floor(imageData[pIdx+1] * cScale),
                    b: Math.floor(imageData[pIdx+2] * cScale)
                };
            }

            const steps = Math.floor(params.strokeLength * passConfig.length);
            const points = traceArtistStroke(
                sx, sy, width, height, magnitude, direction, 
                params, rng, 1.8, darknessMap, steps, passConfig.angle, 
                passConfig.type as 'outline' | 'hatch', passConfig.minDark
            );

            if (points.length > 12) { // Minimum 4 points (4 * 3 = 12 floats)
                for (let k = 0; k < points.length; k += 4) {
                    const cx = Math.floor(points[k] / cellSize);
                    const cy = Math.floor(points[k+1] / cellSize);
                    if (cx >= 0 && cx < gridW && cy >= 0 && cy < gridH) {
                        visited[cy * gridW + cx]++;
                    }
                }

                strokes.push({
                    id: `s_${idCounter++}`,
                    points,
                    style: { widthMin: wMin, widthMax: wMax, taper: params.pressureTaper, alpha, color },
                    meta: { source: passConfig.type === 'outline' ? 'edge' : 'hybrid', seedUsed: params.seed }
                });
            }
        }
    }

    return strokes;
}

/**
 * Advanced Dynamic Pressure Trace
 */
function traceArtistStroke(
    sx: number, sy: number,
    width: number, height: number,
    magnitude: Float32Array,
    direction: Float32Array,
    params: LineParams,
    rng: PRNG,
    stepSize: number,
    darknessMap: Float32Array,
    maxSteps: number,
    hatchAngle: number,
    type: 'outline' | 'hatch',
    minDark: number
): Float32Array {
    const raw: number[] = [];
    let cx = sx, cy = sy;
    let prevDir = 0, initialized = false;
    let brightStreak = 0;

    for (let s = 0; s < maxSteps; s++) {
        const ix = Math.floor(cx), iy = Math.floor(cy);
        if (ix < 0 || ix >= width || iy < 0 || iy >= height) break;

        const idx = iy * width + ix;
        const mag = magnitude[idx];
        const dark = darknessMap[idx];

        if (dark < minDark * 0.4) {
            brightStreak++;
            if (brightStreak > 4) break;
        } else {
            brightStreak = 0;
        }

        let targetDir: number;
        if (type === 'outline') {
            targetDir = direction[idx] + Math.PI / 2;
        } else {
            const gradDir = direction[idx] + Math.PI / 2;
            const blend = Math.min(1.0, mag * 2.5);
            targetDir = lerpAngle(hatchAngle, gradDir, blend);
        }

        if (initialized) {
            let diff = targetDir - prevDir;
            while (diff > Math.PI) diff -= 2 * Math.PI;
            while (diff < -Math.PI) diff += 2 * Math.PI;
            targetDir = prevDir + diff * 0.08;
        }
        initialized = true;
        prevDir = targetDir;

        const jitter = (rng.nextFloat() - 0.5) * params.wobbleAmp * 0.05;
        targetDir += jitter;

        const pressure = Math.max(0.1, Math.min(1.0, dark * 1.2));

        cx += Math.cos(targetDir) * stepSize;
        cy += Math.sin(targetDir) * stepSize;

        if (s % 3 === 0) {
            raw.push(cx, cy, s / maxSteps, pressure);
        }
    }

    const pts = new Float32Array(raw);
    const len = pts.length / 4;
    for (let i = 0; i < len; i++) {
        const taper = Math.min(1.0, (i / (len * 0.15))) * Math.min(1.0, ((len - 1 - i) / (len * 0.15)));
        pts[i * 4 + 3] *= (1 - params.pressureTaper) + params.pressureTaper * taper;
    }

    return pts;
}

function lerpAngle(a: number, b: number, t: number): number {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return a + d * t;
}
