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

    const densityVal = Math.max(0.1, params.strokeDensity);
    const rawCount = Math.floor((width * height * densityVal) / 40);
    // 上限を150,000本から400,000本へ大幅解放し、高密度のハッチングが画面全体を埋め尽くせるようにする
    const maxStrokesTotal = Math.min(rawCount, 400000);

    const darknessMap = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        darknessMap[i] = Math.max(0, 1.0 - luminance[i]);
    }

    const EXACT_EDGE_THRESHOLD = 0.20; 
    const MAX_EXACT_EDGES = 150000;
    
    // 画像サイズに応じて「全体へ均等にまばらに」点を打つための確率
    // ピクセル全数に対してMAX_EXACT_EDGESがどれくらいかを求め、
    // 描画密度(densityVal)と掛け合わせて確率を算出します。
    // これにより画面の途中で突然スキャンが切れる（真横にぶった切られる）のを防止します。
    const targetEdges = Math.min(MAX_EXACT_EDGES, maxStrokesTotal * 1.5);
    const dropProbability = Math.min(1.0, (targetEdges / (width * height * 0.1)) * (densityVal / 5.0));
    
    let exactCount = 0;

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const idx = y * width + x;
            if (magnitude[idx] >= EXACT_EDGE_THRESHOLD) {
                // 均等にエッジを間引く（画面全体に行き渡らせる）
                if (rng.nextFloat() > dropProbability) continue;
                
                // 既にストローク（オブジェクト生成）限界なら終了
                if (exactCount >= MAX_EXACT_EDGES) break;
                
                const mag = Math.min(1.0, magnitude[idx] * 1.5);
                
                // エッジに沿ったごく短い線分（点描のように機能する）
                const angle = direction[idx] + Math.PI / 2;
                // Magnitudeが強いほど少し線の長さを伸ばして滑らかにする
                const len = 1.0 + mag * 3.0; 
                const dx = Math.cos(angle) * len;
                const dy = Math.sin(angle) * len;
                
                // renderer.ts は 3点(len < 4)以下のだとスキップしないが、念のため4点構成にする
                // [x, y, t, p] のまとまり
                const pts = new Float32Array([
                    x - dx*0.5, y - dy*0.5, 0.0, mag * 0.8,
                    x, y, 0.5, mag,
                    x + dx*0.5, y + dy*0.5, 1.0, mag * 0.8,
                    x + dx, y + dy, 1.0, 0.0
                ]);
                
                let color = { r: 15, g: 15, b: 20 };
                if (params.colorMode === 'Prism') {
                    color = hslToRgb(((direction[idx] + Math.PI) / (Math.PI * 2)) % 1.0, 1.0, 0.55);
                } else if (params.colorMode === 'Monochrome') {
                    color = { r: 15, g: 15, b: 20 };
                } else if (imageData) {
                    const pIdx = idx * 4;
                    // 暗い部分のクロッキー鉛筆色
                    color = {
                        r: Math.floor(imageData[pIdx] * 0.2),
                        g: Math.floor(imageData[pIdx+1] * 0.2),
                        b: Math.floor(imageData[pIdx+2] * 0.2)
                    };
                }

                strokes.push({
                    id: `exact_${exactCount}`,
                    points: pts,
                    style: { 
                        widthMin: Math.max(0.1, params.widthMin * 0.5), 
                        widthMax: Math.max(0.3, params.widthMax * 1.2), 
                        taper: 0.8, 
                        alpha: 0.95, 
                        color 
                    },
                    meta: { source: 'edge', seedUsed: params.seed }
                });
                
                exactCount++;
            }
        }
        if (exactCount >= MAX_EXACT_EDGES) break;
    }

    const passes = [
        // 形を抜き出すための決定的な「強いエッジ（輪郭）」パス (長くて力強い線)
        { type: 'edge_trace', angle: 0, minMag: 0.04, minDark: 0.0, maxStrokes: 0.25, length: 3.5, width: 1.2, alpha: 0.95 },
        // シャドウ・ハッチング（影）パス (ベタ塗りの暗闇を避けつつ、服のシワなどの微妙なノイズ情報は拾うように minMag を限界まで下げる)
        { type: 'hatch', angle: Math.PI * 0.15, minMag: 0.005, minDark: 0.05, maxStrokes: 0.30, length: 1.8, width: 0.4, alpha: 0.5 },
        { type: 'hatch', angle: Math.PI * 0.70, minMag: 0.008, minDark: 0.15, maxStrokes: 0.20, length: 1.2, width: 0.5, alpha: 0.6 },
        { type: 'hatch', angle: Math.PI * 0.45, minMag: 0.012, minDark: 0.30, maxStrokes: 0.15, length: 0.8, width: 0.7, alpha: 0.8 },
        { type: 'hatch', angle: Math.PI * 0.85, minMag: 0.015, minDark: 0.50, maxStrokes: 0.10, length: 0.6, width: 0.9, alpha: 1.0 }
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
            let mag = magnitude[idx];

            let found = false;
            // --- Source Mode に応じたパスのフィルタリング ---
            // 'Contours' モードなら、内部のストロークロジック(Edges/Hatch)は走らせない
            if (params.sourceMode === 'Contours') continue;
            // 'Edges' モードなら、Hatch(陰影)パスは走らせない
            if (params.sourceMode === 'Edges' && passConfig.type === 'hatch') continue;

            // 輪郭スキャン（edge_trace）の場合は、暗さではなくエッジ強度（magnitude）を最優先で始点を決める
            if (passConfig.type === 'edge_trace') {
                if (mag >= passConfig.minMag) found = true;
                else {
                    for (let j = 0; j < 50; j++) {
                        sx = Math.floor(rng.nextFloat() * width);
                        sy = Math.floor(rng.nextFloat() * height);
                        idx = sy * width + sx;
                        if (magnitude[idx] >= passConfig.minMag) {
                            found = true;
                            break;
                        }
                    }
                }
            } else {
                // ハッチング（陰影塗り）の場合は暗さと同時に、ベタ塗りの無地(何も情報がない闇)を避けるためエッジ強度(minMag)も要求する
                if (dark >= passConfig.minDark && mag >= passConfig.minMag) found = true;
                else {
                    for (let j = 0; j < 40; j++) {
                        sx = Math.floor(rng.nextFloat() * width);
                        sy = Math.floor(rng.nextFloat() * height);
                        idx = sy * width + sx;
                        dark = darknessMap[idx];
                        if (dark >= passConfig.minDark && magnitude[idx] >= passConfig.minMag) {
                            found = true;
                            break;
                        }
                    }
                }
            }

            if (!found) continue;

            const gx = Math.floor(sx / cellSize);
            const gy = Math.floor(sy / cellSize);
            // 同一ピクセル付近からの発生上限を大幅に緩和（密度に応じて限界突破可能にする）
            if (visited[gy * gridW + gx] >= 8 + densityVal * 3) continue;

            const localDark = darknessMap[idx];
            const wScale = (0.1 + localDark * 0.9) * passConfig.width;
            const wMin = Math.max(0.05, params.widthMin * wScale);
            const wMax = Math.max(0.1, params.widthMax * wScale);
            const alpha = Math.max(0.02, Math.min(0.9, localDark * localDark * passConfig.alpha));

            let color = { r: 35, g: 35, b: 35 };
            if (params.colorMode === 'Prism') {
                const gradDir = direction[idx] + Math.PI / 2;
                color = hslToRgb(((gradDir + Math.PI) / (Math.PI * 2)) % 1.0, 1.0, 0.6);
            } else if (params.colorMode === 'Monochrome') {
                color = { r: 35, g: 35, b: 35 };
            } else if (imageData) {
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
                passConfig.type as 'edge_trace' | 'hatch', passConfig.minDark
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
                    meta: { source: passConfig.type === 'edge_trace' ? 'edge' : 'hybrid', seedUsed: params.seed }
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
    type: 'edge_trace' | 'outline' | 'hatch',
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

        if (dark < minDark * 0.4 && type !== 'edge_trace') {
            brightStreak++;
            if (brightStreak > 4) break;
        } else {
            brightStreak = 0;
        }

        // --- ストロークがエッジから外れたら早期終了（輪郭追跡専用） ---
        if (type === 'edge_trace' && mag < 0.05) {
            break;
        }

        let targetDir: number;
        if (type === 'edge_trace') {
            // エッジの接線方向に直進させる（contour lines）
            targetDir = direction[idx] + Math.PI / 2;
        } else {
            const gradDir = direction[idx] + Math.PI / 2;
            // ハッチングは輪郭に巻き付きすぎず（最大でも40%の影響）、基本の角度を保って「斜線塗り」の質感を維持する
            const blend = Math.min(0.4, mag * 1.2);
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

        let waveOffsetX = 0;
        let waveOffsetY = 0;
        if (params.waveAmp && params.waveAmp > 0) {
            const normalDir = targetDir + Math.PI / 2;
            const wave = Math.sin(s * (params.waveFreq || 0.1)) * params.waveAmp;
            waveOffsetX = Math.cos(normalDir) * wave;
            waveOffsetY = Math.sin(normalDir) * wave;
        }

        cx += Math.cos(targetDir) * stepSize;
        cy += Math.sin(targetDir) * stepSize;

        if (s % 3 === 0) {
            let jx = 0;
            let jy = 0;
            let pNoise = 1.0;
            
            if (params.roughness && params.roughness > 0) {
                // Spatial jitter (paper bumpiness)
                jx = (rng.nextFloat() - 0.5) * params.roughness * 1.5;
                jy = (rng.nextFloat() - 0.5) * params.roughness * 1.5;
                // Pressure jitter (scratches / dry spots)
                pNoise = 1.0 - (rng.nextFloat() * params.roughness * 0.15);
            }
            
            raw.push(cx + waveOffsetX + jx, cy + waveOffsetY + jy, s / maxSteps, Math.max(0, pressure * pNoise));
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

function hslToRgb(h: number, s: number, l: number): { r: number, g: number, b: number } {
    let r, g, b;
    if (s === 0) {
        r = g = b = l; // achromatic
    } else {
        const hue2rgb = (p: number, q: number, t: number) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        
        // Ensure h is properly bounded positive [0, 1) before calculating
        h = (h % 1.0 + 1.0) % 1.0;

        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}
