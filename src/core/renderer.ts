import type { StrokePath } from './lines/tracer';
import type { InkBlurParams } from './types';

/**
 * Render strokes with per-stroke alpha for luminance-based tonal variation.
 * Each stroke carries its own alpha value based on the source image's brightness
 * at the stroke's origin point.
 */
export function renderStrokes(
    ctx: CanvasRenderingContext2D,
    strokes: StrokePath[],
    _width: number,
    _height: number,
    isBleed: boolean,
    bleedParams: InkBlurParams
) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Set up Bleed effect if requested
    if (isBleed) {
        ctx.filter = `blur(${bleedParams.bleedBlurPx}px)`;
    } else {
        ctx.filter = 'none';
        ctx.shadowBlur = 0;
    }

    for (const stroke of strokes) {
        if (stroke.points.length < 3) continue;

        const { color, alpha } = stroke.style;
        ctx.strokeStyle = `rgb(${color.r},${color.g},${color.b})`;

        // Per-stroke alpha: combines stroke's luminance-based alpha with bleed opacity
        if (isBleed) {
            ctx.globalAlpha = alpha * (bleedParams.bleedOpacityPct / 100);
        } else {
            ctx.globalAlpha = alpha;
        }

        const pts = stroke.points;
        const len = pts.length;

        // Use per-stroke width (already luminance-adjusted by tracer)
        let segWidth = stroke.style.widthMin + (stroke.style.widthMax - stroke.style.widthMin) * 0.65;
        if (isBleed) segWidth += bleedParams.bleedAmountPx;
        segWidth = Math.max(0.2, segWidth);

        ctx.lineWidth = segWidth;
        ctx.beginPath();

        for (let i = 0; i < len - 1; i++) {
            const p0 = pts[i];
            const p1 = pts[i + 1];

            if (i === 0) {
                ctx.moveTo(p0.x, p0.y);
                ctx.lineTo(p1.x, p1.y);
            } else {
                const prevP = pts[i - 1];
                const mx0 = (prevP.x + p0.x) / 2;
                const my0 = (prevP.y + p0.y) / 2;
                const mx1 = (p0.x + p1.x) / 2;
                const my1 = (p0.y + p1.y) / 2;

                ctx.moveTo(mx0, my0);
                ctx.quadraticCurveTo(p0.x, p0.y, mx1, my1);
            }
        }

        ctx.stroke();
    }

    // Restore
    ctx.filter = 'none';
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1.0;
}

export function compositeLayers(
    ctxOut: CanvasRenderingContext2D,
    canvasLines: HTMLCanvasElement,
    canvasBleed: HTMLCanvasElement,
    width: number,
    height: number,
    bleedParams: InkBlurParams
) {
    ctxOut.clearRect(0, 0, width, height);

    // White background
    ctxOut.fillStyle = '#ffffff';
    ctxOut.fillRect(0, 0, width, height);

    // Draw bleed layer
    if (bleedParams.bleedMode === 'Multiply') {
        ctxOut.globalCompositeOperation = 'multiply';
    } else {
        ctxOut.globalCompositeOperation = 'source-over';
    }

    ctxOut.drawImage(canvasBleed, 0, 0);

    // Draw lines layer
    ctxOut.globalCompositeOperation = 'source-over';
    ctxOut.drawImage(canvasLines, 0, 0);

    // Optional final blur
    if (bleedParams.finalBlurPx > 0) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tCtx = tempCanvas.getContext('2d')!;
        tCtx.drawImage(ctxOut.canvas, 0, 0);

        ctxOut.clearRect(0, 0, width, height);
        ctxOut.filter = `blur(${bleedParams.finalBlurPx}px)`;
        ctxOut.drawImage(tempCanvas, 0, 0);
        ctxOut.filter = 'none';
    }

    ctxOut.globalCompositeOperation = 'source-over';
}
