import type { StrokePath } from './lines/tracer';
import type { InkBlurParams } from './types';

/**
 * Dynamic Pressure Renderer
 * 
 * Draws high-resolution smooth curves where line width fluctuates
 * point-by-point based on the "pressure" calculated by the tracer.
 * This simulates a physical pencil where dark/active areas receive more lead.
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

    if (isBleed) {
        ctx.filter = `blur(${bleedParams.bleedBlurPx}px)`;
    } else {
        ctx.filter = 'none';
    }

    // Optimization: avoid frequent state changes
    let currentStyle = '';

    for (const stroke of strokes) {
        const pts = stroke.points;
        const len = pts.length;
        if (len < 4) continue;

        const { color, alpha } = stroke.style;
        const style = `rgba(${color.r},${color.g},${color.b},${isBleed ? alpha * (bleedParams.bleedOpacityPct / 100) : alpha})`;
        
        if (style !== currentStyle) {
            ctx.strokeStyle = style;
            currentStyle = style;
        }

        // Draw segments with point-to-point width/pressure
        // We use quadratic curve for segments to keep it smooth
        for (let i = 1; i < len - 2; i++) {
            const p0 = pts[i-1];
            const p1 = pts[i];
            const p2 = pts[i+1];
            
            // Average pressure for this segment
            const pressure = (p1.pressure + p2.pressure) / 2;
            let w = (stroke.style.widthMin + (stroke.style.widthMax - stroke.style.widthMin) * pressure);
            if (isBleed) w += bleedParams.bleedAmountPx;
            
            ctx.lineWidth = Math.max(0.1, w);
            ctx.beginPath();
            
            const mx = (p1.x + p2.x) / 2;
            const my = (p1.y + p2.y) / 2;
            const mxPrev = (p0.x + p1.x) / 2;
            const myPrev = (p0.y + p1.y) / 2;
            
            ctx.moveTo(mxPrev, myPrev);
            ctx.quadraticCurveTo(p1.x, p1.y, mx, my);
            ctx.stroke();
        }
    }

    ctx.filter = 'none';
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
    ctxOut.fillStyle = '#ffffff';
    ctxOut.fillRect(0, 0, width, height);

    if (bleedParams.bleedMode === 'Multiply') {
        ctxOut.globalCompositeOperation = 'multiply';
    } else {
        ctxOut.globalCompositeOperation = 'source-over';
    }

    ctxOut.drawImage(canvasBleed, 0, 0);

    ctxOut.globalCompositeOperation = 'source-over';
    ctxOut.drawImage(canvasLines, 0, 0);

    if (bleedParams.finalBlurPx > 0) {
        const temp = document.createElement('canvas');
        temp.width = width;
        temp.height = height;
        const tCtx = temp.getContext('2d')!;
        tCtx.drawImage(ctxOut.canvas, 0, 0);

        ctxOut.clearRect(0, 0, width, height);
        ctxOut.filter = `blur(${bleedParams.finalBlurPx}px)`;
        ctxOut.drawImage(temp, 0, 0);
        ctxOut.filter = 'none';
    }
}
