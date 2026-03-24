import type { Params } from './types';
import type { StrokePath } from './lines/tracer';
import { renderStrokes } from './renderer';
import type { InkBlurParams } from './types';

/**
 * Executes a full high-resolution render for export.
 * Uses a single canvas and async chunked rendering to minimise memory and prevent freezing.
 */
export async function exportLinesAsPNG(
    originalImage: Blob,
    strokes: StrokePath[],
    params: Params,
    scale: number,
    maxEdge: number
): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                // 1. Calculate final dimensions
                let outWidth = img.width * scale;
                let outHeight = img.height * scale;

                const maxDim = Math.max(outWidth, outHeight);
                if (maxDim > maxEdge) {
                    const reduceScale = maxEdge / maxDim;
                    outWidth = Math.floor(outWidth * reduceScale);
                    outHeight = Math.floor(outHeight * reduceScale);
                }

                console.log(`[Export] Output dimensions: ${outWidth}x${outHeight}`);

                // 2. Setup single canvas (saves ~66% RAM vs 3 canvases)
                const canvas = document.createElement('canvas');
                canvas.width = outWidth;
                canvas.height = outHeight;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Failed to get canvas 2d context.'));
                    return;
                }

                // 3. Calculate scale from preview to export
                const prevScale = Math.min(
                    params.preview.previewMaxEdge / img.width,
                    params.preview.previewMaxEdge / img.height,
                    1
                );
                const prevWidth = Math.round(img.width * prevScale);
                const prevHeight = Math.round(img.height * prevScale);

                const geoScaleX = outWidth / prevWidth;
                const geoScaleY = outHeight / prevHeight;
                const geoScaleAvg = (geoScaleX + geoScaleY) / 2;

                console.log(`[Export] Preview ${prevWidth}x${prevHeight} -> Export ${outWidth}x${outHeight}, geoScale: ${geoScaleX.toFixed(3)}x${geoScaleY.toFixed(3)}`);

                // 5. Scale strokes for output resolution
                const scaledStrokes: StrokePath[] = strokes.map(s => {
                    const scaledPoints = new Float32Array(s.points.length);
                    for (let k = 0; k < s.points.length; k += 4) {
                        scaledPoints[k] = s.points[k] * geoScaleX;
                        scaledPoints[k+1] = s.points[k+1] * geoScaleY;
                        scaledPoints[k+2] = s.points[k+2]; // t doesn't change
                        scaledPoints[k+3] = s.points[k+3]; // pressure doesn't change
                    }
                    return {
                        ...s,
                        points: scaledPoints,
                        style: {
                            ...s.style,
                            widthMin: s.style.widthMin * geoScaleAvg,
                            widthMax: s.style.widthMax * geoScaleAvg
                        }
                    };
                });

                // Adjust ink blur params for scale
                const scaledBleedParams: InkBlurParams = {
                    ...params.inkBlur,
                    bleedAmountPx: params.inkBlur.bleedAmountPx * geoScaleAvg,
                    bleedBlurPx: params.inkBlur.bleedBlurPx * geoScaleAvg,
                    finalBlurPx: params.inkBlur.finalBlurPx * geoScaleAvg,
                };

                // 6. Setup rendering phases
                const BATCH_SIZE = 100;
                let offset = 0;
                const useBleed = scaledBleedParams.bleedOpacityPct > 0;
                
                // Bleed is rendered to a temporary canvas to apply blur ONCE
                const canvasBleed = useBleed ? document.createElement('canvas') : null;
                if (canvasBleed) {
                    canvasBleed.width = outWidth;
                    canvasBleed.height = outHeight;
                }
                const bleedCtx = canvasBleed?.getContext('2d');

                // Phases: 'bleed' then 'lines'
                type Phase = 'bleed' | 'lines';
                let phase: Phase = useBleed ? 'bleed' : 'lines';

                console.log(`[Export] Starting chunked render of ${scaledStrokes.length} strokes (bleed: ${useBleed})...`);
                console.time('[Export] Render');

                const drawBatch = () => {
                    try {
                        const end = Math.min(offset + BATCH_SIZE, scaledStrokes.length);
                        const batch = scaledStrokes.slice(offset, end);

                        if (phase === 'bleed' && bleedCtx) {
                            renderStrokes(bleedCtx, batch, outWidth, outHeight, true, scaledBleedParams);
                        } else {
                            renderStrokes(ctx, batch, outWidth, outHeight, false, scaledBleedParams);
                        }

                        offset = end;

                        if (offset < scaledStrokes.length) {
                            setTimeout(drawBatch, 0);
                        } else if (phase === 'bleed') {
                            // Bleed phase done: composite onto main canvas with blur and opacity
                            if (canvasBleed) {
                                if (scaledBleedParams.bleedMode === 'Multiply') {
                                    ctx.globalCompositeOperation = 'multiply';
                                } else {
                                    ctx.globalCompositeOperation = 'source-over';
                                }
                                
                                if (scaledBleedParams.bleedBlurPx > 0) {
                                    ctx.filter = `blur(${scaledBleedParams.bleedBlurPx}px)`;
                                }
                                ctx.drawImage(canvasBleed, 0, 0);
                                ctx.filter = 'none';
                                ctx.globalCompositeOperation = 'source-over';
                            }
                            
                            phase = 'lines';
                            offset = 0;
                            setTimeout(drawBatch, 0);
                        } else {
                            // All phases done
                            if (scaledBleedParams.finalBlurPx > 0) {
                                const tempCanvas = document.createElement('canvas');
                                tempCanvas.width = outWidth;
                                tempCanvas.height = outHeight;
                                const tCtx = tempCanvas.getContext('2d')!;
                                tCtx.drawImage(canvas, 0, 0);
                                ctx.clearRect(0, 0, outWidth, outHeight);
                                ctx.filter = `blur(${scaledBleedParams.finalBlurPx}px)`;
                                ctx.drawImage(tempCanvas, 0, 0);
                                ctx.filter = 'none';
                            }

                            console.timeEnd('[Export] Render');
                            console.log(`[Export] Converting to PNG blob...`);

                            canvas.toBlob((blob) => {
                                if (blob) {
                                    console.log(`[Export] PNG blob created: ${(blob.size / 1024).toFixed(1)} KB`);
                                    resolve(blob);
                                } else {
                                    reject(new Error('Canvas to Blob conversion failed.'));
                                }
                            }, 'image/png');
                        }
                    } catch (err: any) {
                        reject(new Error(`Export render error: ${err.message}`));
                    }
                };

                // White background
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, outWidth, outHeight);

                // Kick off
                setTimeout(drawBatch, 0);
            } catch (err: any) {
                reject(new Error(`Export setup error: ${err.message}`));
            }
        };

        img.onerror = () => reject(new Error('Failed to load original image for export.'));
        img.src = URL.createObjectURL(originalImage);
    });
}
