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
    bleedParams: InkBlurParams,
    lineBlendMode: 'normal' | 'multiply' | 'screen' = 'normal'
) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.filter = 'none';
    
    if (isBleed) {
        ctx.globalCompositeOperation = 'source-over'; // bleed logic is handled in compositeLayers
    } else {
        if (lineBlendMode === 'multiply') ctx.globalCompositeOperation = 'multiply';
        else if (lineBlendMode === 'screen') ctx.globalCompositeOperation = 'screen';
        else ctx.globalCompositeOperation = 'source-over';
    }

    let currentStyle = '';

    for (const stroke of strokes) {
        const pts = stroke.points;
        const len = pts.length / 4;
        if (len < 4) continue;

        const { color, alpha } = stroke.style;
        const style = `rgba(${color.r},${color.g},${color.b},${isBleed ? alpha * (bleedParams.bleedOpacityPct / 100) : alpha})`;
        
        if (style !== currentStyle) {
            ctx.strokeStyle = style;
            currentStyle = style;
        }

        let lastW = -1;
        let started = false;

        for (let i = 1; i < len - 2; i++) {
            const i0 = (i - 1) * 4;
            const i1 = i * 4;
            const i2 = (i + 1) * 4;

            const p1x = pts[i1], p1y = pts[i1+1], p1p = pts[i1+3];
            const p2x = pts[i2], p2y = pts[i2+1], p2p = pts[i2+3];
            
            const pressure = (p1p + p2p) / 2;
            let w = (stroke.style.widthMin + (stroke.style.widthMax - stroke.style.widthMin) * pressure);
            if (isBleed) w += bleedParams.bleedAmountPx;
            w = Math.max(0.1, w);

            if (!started || Math.abs(w - lastW) > 0.1) {
                if (started) ctx.stroke();
                
                ctx.beginPath();
                ctx.lineWidth = w;
                lastW = w;
                started = true;
                
                const mxPrev = (pts[i0] + p1x) / 2;
                const myPrev = (pts[i0 + 1] + p1y) / 2;
                ctx.moveTo(mxPrev, myPrev);
            }
            
            const mx = (p1x + p2x) / 2;
            const my = (p1y + p2y) / 2;
            ctx.quadraticCurveTo(p1x, p1y, mx, my);
        }
        
        if (started) {
            ctx.stroke();
        }
    }

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

    // Apply blur ONCE during compositing instead of per-stroke
    if (bleedParams.bleedOpacityPct > 0 && bleedParams.bleedBlurPx > 0) {
        ctxOut.filter = `blur(${bleedParams.bleedBlurPx}px)`;
    }
    ctxOut.drawImage(canvasBleed, 0, 0);
    ctxOut.filter = 'none';

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
