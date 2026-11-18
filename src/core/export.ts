import type { WatermarkMask } from './worker/messageTypes';

/**
 * Demo watermark as a coverage mask. Text is drawn once on a small canvas and
 * handed to the worker, which composites it into the exported pixels.
 */
export function demoWatermarkMask(width: number, height: number): WatermarkMask {
    const fontSize = Math.max(12, Math.round(Math.min(width, height) * 0.022));
    const margin = Math.round(fontSize * 0.8);
    const label = 'SpectraLine (demo)';
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d')!;
    const font = `700 ${fontSize}px Archivo, system-ui, sans-serif`;
    ctx.font = font;
    const textW = Math.ceil(ctx.measureText(label).width);
    const boxW = Math.min(width, textW + 4);
    const boxH = Math.min(height, Math.ceil(fontSize * 1.4));
    c.width = boxW;
    c.height = boxH;
    ctx.font = font;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#fff';
    ctx.fillText(label, boxW - 2, boxH - Math.round(fontSize * 0.15));
    const px = ctx.getImageData(0, 0, boxW, boxH).data;
    const alpha = new Uint8ClampedArray(boxW * boxH);
    for (let i = 0; i < alpha.length; i++) alpha[i] = px[i * 4 + 3];
    return {
        x: Math.max(0, width - margin - boxW),
        y: Math.max(0, height - margin - boxH),
        w: boxW,
        h: boxH,
        alpha
    };
}

export function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 3000);
}
