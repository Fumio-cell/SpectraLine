import type { StrokePath } from './lines/tracer';
import type { InkBlurParams } from './types';

/**
 * Render strokes as smooth Bézier curves with variable width.
 * Each stroke is rendered as individual segments with lineWidth changing
 * along the path for a natural pen-and-ink look.
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
        ctx.globalAlpha = bleedParams.bleedOpacityPct / 100;
    } else {
        ctx.filter = 'none';
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1.0;
    }

    for (const stroke of strokes) {
        if (stroke.points.length < 3) continue;

        const { color } = stroke.style;
        ctx.strokeStyle = `rgb(${color.r},${color.g},${color.b})`;

        // Optimize: Draw entire stroke in a single path to avoid freezing the main thread
        // (Previously it called ctx.stroke() for every single segment, causing huge lag)
        const pts = stroke.points;
        const len = pts.length;

        // Use average width for the stroke to maintain performance
        let segWidth = stroke.style.widthMin + (stroke.style.widthMax - stroke.style.widthMin) * 0.65; // average taper factor
        if (isBleed) segWidth += bleedParams.bleedAmountPx;
        segWidth = Math.max(0.3, segWidth);

        ctx.lineWidth = segWidth;
        ctx.beginPath();

        for (let i = 0; i < len - 1; i++) {
            const p0 = pts[i];
            const p1 = pts[i + 1];

            // Use quadratic Bézier with midpoints for smooth curves
            if (i === 0) {
                ctx.moveTo(p0.x, p0.y);
                ctx.lineTo(p1.x, p1.y);
            } else {
                const prevP = pts[i - 1];
                // Midpoint for smooth curve
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

    // White background so lines are visible on dark UI
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

    // Ensure composite operation is reset
    ctxOut.globalCompositeOperation = 'source-over';
}
