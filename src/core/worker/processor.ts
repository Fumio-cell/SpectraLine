import type { WorkerRequest, WorkerResponse } from './messageTypes';
import { computeGradients } from '../maps/gradient';
import { buildStrokes } from '../lines/tracer';

// Store mapped state in worker memory
let currentMaps: any = null;

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
    const req = e.data;

    try {
        if (req.type === 'BUILD_MAPS') {
            const { imageBuffer, width, height } = req.input;
            const params = req.params;

            // Report start
            self.postMessage({ type: 'PROGRESS', requestId: req.requestId, status: 'ok', progress: 0.1 } as WorkerResponse);

            // Reconstruct buffer
            const imageData = new Uint8ClampedArray(imageBuffer);

            // 1. Gradients and direction
            const { magnitude, direction, luminance } = computeGradients(
                imageData, width, height, params.maps.gradientGain, params.maps.gradientThreshold, params.maps.scientificMode
            );
            self.postMessage({ type: 'PROGRESS', requestId: req.requestId, status: 'ok', progress: 0.7 } as WorkerResponse);

            // 2. Build gradient map visualization (RGBA buffer for Maps tab)
            const gradMapBuffer = new Uint8ClampedArray(width * height * 4);
            for (let i = 0; i < width * height; i++) {
                const mag = magnitude[i];
                const dir = direction[i];
                // Encode: magnitude as brightness, direction as hue
                const h = (dir + Math.PI) / (2 * Math.PI);
                const s = mag > 0 ? 1.0 : 0;
                const l = 0.1 + mag * 0.8;

                let r: number, g: number, b: number;
                if (s === 0) {
                    r = g = b = l;
                } else {
                    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                    const p = 2 * l - q;

                    let tR = h + 1 / 3;
                    if (tR < 0) tR += 1; if (tR > 1) tR -= 1;
                    if (tR < 1 / 6) r = p + (q - p) * 6 * tR;
                    else if (tR < 1 / 2) r = q;
                    else if (tR < 2 / 3) r = p + (q - p) * (2 / 3 - tR) * 6;
                    else r = p;

                    let tG = h;
                    if (tG < 0) tG += 1; if (tG > 1) tG -= 1;
                    if (tG < 1 / 6) g = p + (q - p) * 6 * tG;
                    else if (tG < 1 / 2) g = q;
                    else if (tG < 2 / 3) g = p + (q - p) * (2 / 3 - tG) * 6;
                    else g = p;

                    let tB = h - 1 / 3;
                    if (tB < 0) tB += 1; if (tB > 1) tB -= 1;
                    if (tB < 1 / 6) b = p + (q - p) * 6 * tB;
                    else if (tB < 1 / 2) b = q;
                    else if (tB < 2 / 3) b = p + (q - p) * (2 / 3 - tB) * 6;
                    else b = p;
                }

                gradMapBuffer[i * 4] = r * 255;
                gradMapBuffer[i * 4 + 1] = g * 255;
                gradMapBuffer[i * 4 + 2] = b * 255;
                gradMapBuffer[i * 4 + 3] = 255;
            }

            currentMaps = {
                width, height,
                magnitude, direction, luminance,
                imageData // Keep source image data for stroke coloring
            };

            // Send gradient map data back for Maps tab visualization
            (self as unknown as Worker).postMessage({
                type: 'MAPS_READY',
                requestId: req.requestId,
                status: 'ok',
                maps: { width, height, gradientMapBuffer: gradMapBuffer.buffer }
            } as WorkerResponse, [gradMapBuffer.buffer]);
        }

        else if (req.type === 'BUILD_STROKES') {
            if (!currentMaps) {
                throw new Error('Maps must be built before strokes');
            }

            self.postMessage({ type: 'PROGRESS', requestId: req.requestId, status: 'ok', progress: 0.1 } as WorkerResponse);

            const strokes = buildStrokes(
                currentMaps.width,
                currentMaps.height,
                currentMaps.magnitude,
                currentMaps.direction,
                currentMaps.luminance,
                req.params.lines,
                currentMaps.imageData
            );

            // Use Structured Clone (postMessage default) instead of JSON serialization
            self.postMessage({
                type: 'STROKES_READY',
                requestId: req.requestId,
                status: 'ok',
                strokes: strokes
            } as WorkerResponse);
        }
    } catch (err: any) {
        self.postMessage({
            type: 'ERROR',
            requestId: req.requestId,
            status: 'error',
            error: { code: 'PROCESSING_FAILED', message: err.message }
        } as WorkerResponse);
    }
};
