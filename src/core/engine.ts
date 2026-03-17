import type { Params } from './types';
import type { StrokePath } from './lines/tracer';
import { renderStrokes, compositeLayers } from './renderer';
import { exportLinesAsPNG } from './export';

export class AppEngine {
    private worker: Worker | null = null;
    private canvasLines: HTMLCanvasElement;
    private canvasBleed: HTMLCanvasElement;
    private canvasOut: HTMLCanvasElement;
    private canvasMaps: HTMLCanvasElement;
    private currentParams?: Params;
    private renderAbort: number = 0;
    private lastStrokes: StrokePath[] = [];
    private currentFile?: File;

    public onMapsReady?: () => void;
    public onRenderComplete?: () => void;
    public onError?: (err: string) => void;

    constructor(outCanvasId: string, mapsCanvasId?: string) {
        this.canvasLines = document.createElement('canvas');
        this.canvasBleed = document.createElement('canvas');
        this.canvasOut = document.getElementById(outCanvasId) as HTMLCanvasElement || document.createElement('canvas');
        this.canvasMaps = (mapsCanvasId ? document.getElementById(mapsCanvasId) as HTMLCanvasElement : null) || document.createElement('canvas');
        this.initWorker();
    }

    private initWorker() {
        this.worker = new Worker(new URL('./worker/processor.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e) => {
            const res = e.data;
            if (res.type === 'MAPS_READY') {
                const { width, height, gradientMapBuffer } = res.maps;
                if (gradientMapBuffer) {
                    this.canvasMaps.width = width;
                    this.canvasMaps.height = height;
                    const ctx = this.canvasMaps.getContext('2d')!;
                    const imgData = new ImageData(new Uint8ClampedArray(gradientMapBuffer), width, height);
                    ctx.putImageData(imgData, 0, 0);
                }
                console.log('[Engine] Maps ready');
                if (this.onMapsReady) this.onMapsReady();
            } else if (res.type === 'STROKES_READY') {
                const strokes: StrokePath[] = res.strokes;
                this.lastStrokes = strokes;
                console.log(`[Engine] Received ${strokes.length} strokes, avg ${Math.round(strokes.reduce((s, st) => s + st.points.length, 0) / strokes.length)} pts each`);
                if (this.currentParams) {
                    this.renderBatched(strokes, this.currentParams);
                }
            } else if (res.type === 'ERROR') {
                console.error('[Engine] Worker error:', res.error.message);
                if (this.onError) this.onError(res.error.message);
            }
        };
    }

    public processImage(file: File, params: Params) {
        this.currentParams = params;
        this.currentFile = file;
        console.log('[Engine] Processing image...');
        const img = new Image();
        img.onerror = () => {
            console.error("Failed to load image.");
            if (this.onError) this.onError("Failed to decode image file.");
        };
        img.onload = () => {
            const scale = Math.min(params.preview.previewMaxEdge / img.width, params.preview.previewMaxEdge / img.height, 1);
            const pWidth = Math.round(img.width * scale);
            const pHeight = Math.round(img.height * scale);
            console.log(`[Engine] Scaled ${img.width}x${img.height} -> ${pWidth}x${pHeight}`);

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = pWidth;
            tempCanvas.height = pHeight;
            const tCtx = tempCanvas.getContext('2d')!;
            tCtx.drawImage(img, 0, 0, pWidth, pHeight);
            const imageData = tCtx.getImageData(0, 0, pWidth, pHeight);

            this.canvasLines.width = pWidth;
            this.canvasLines.height = pHeight;
            this.canvasBleed.width = pWidth;
            this.canvasBleed.height = pHeight;
            this.canvasOut.width = pWidth;
            this.canvasOut.height = pHeight;

            this.worker?.postMessage({
                type: 'BUILD_MAPS',
                requestId: 'map_' + Date.now(),
                input: {
                    imageBuffer: imageData.data.buffer,
                    width: pWidth,
                    height: pHeight,
                    previewWidth: pWidth,
                    previewHeight: pHeight
                },
                params: params
            }, [imageData.data.buffer]);
        };
        img.src = URL.createObjectURL(file);
    }

    public buildStrokes(params: Params) {
        this.currentParams = params;
        console.log('[Engine] Building strokes...');
        this.worker?.postMessage({
            type: 'BUILD_STROKES',
            requestId: 'strk_' + Date.now(),
            params: params
        });
    }

    public getStrokes(): StrokePath[] {
        return this.lastStrokes;
    }

    public async exportPNG(params: Params): Promise<void> {
        if (!this.currentFile) {
            throw new Error('No image loaded for export.');
        }
        if (this.lastStrokes.length === 0) {
            throw new Error('No strokes generated. Please process image first.');
        }

        console.log(`[Engine] Exporting ${this.lastStrokes.length} strokes at scale ${params.export.scale}...`);

        let blob: Blob;
        try {
            blob = await exportLinesAsPNG(
                this.currentFile,
                this.lastStrokes,
                params,
                params.export.scale,
                params.export.maxEdge
            );
        } catch (err: any) {
            console.error('[Engine] Export rendering failed:', err);
            throw err;
        }

        console.log(`[Engine] Blob created: ${(blob.size / 1024).toFixed(1)} KB, initiating download...`);

        // Download the blob
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'lines.png';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();

        // Deferred cleanup to ensure download completes before URL is revoked
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 3000);

        console.log(`[Engine] Export complete! File size: ${(blob.size / 1024).toFixed(1)} KB`);
    }

    /**
     * Export the gradient map visualization as a PNG file.
     */
    public async exportMapPNG(): Promise<void> {
        if (this.canvasMaps.width === 0 || this.canvasMaps.height === 0) {
            throw new Error('No map generated yet. Please process an image first.');
        }

        console.log(`[Engine] Exporting map ${this.canvasMaps.width}x${this.canvasMaps.height}...`);

        return new Promise((resolve, reject) => {
            this.canvasMaps.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('Map canvas to Blob failed.'));
                    return;
                }

                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'maps_gradient.png';
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();

                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 3000);

                console.log(`[Engine] Map export complete! File size: ${(blob.size / 1024).toFixed(1)} KB`);
                resolve();
            }, 'image/png');
        });
    }

    /**
     * Render strokes in small batches via requestAnimationFrame.
     * Skips bleed pass entirely when bleed opacity is 0.
     */
    private renderBatched(strokes: StrokePath[], params: Params) {
        this.renderAbort++;
        const currentRender = this.renderAbort;

        const width = this.canvasOut.width;
        const height = this.canvasOut.height;
        const ctxLines = this.canvasLines.getContext('2d')!;
        const ctxBleed = this.canvasBleed.getContext('2d')!;
        const ctxOut = this.canvasOut.getContext('2d')!;

        ctxLines.clearRect(0, 0, width, height);
        ctxBleed.clearRect(0, 0, width, height);

        // Show white background immediately
        ctxOut.clearRect(0, 0, width, height);
        ctxOut.fillStyle = '#ffffff';
        ctxOut.fillRect(0, 0, width, height);

        const useBleed = params.inkBlur.bleedOpacityPct > 0;
        const BATCH_SIZE = 1000;
        let offset = 0;

        console.time('[Engine] Render');

        const drawBatch = () => {
            if (currentRender !== this.renderAbort) return;

            const end = Math.min(offset + BATCH_SIZE, strokes.length);
            const batch = strokes.slice(offset, end);

            // Draw lines (always)
            renderStrokes(ctxLines, batch, width, height, false, params.inkBlur);

            // Draw bleed ONLY if enabled
            if (useBleed) {
                renderStrokes(ctxBleed, batch, width, height, true, params.inkBlur);
            }

            offset = end;

            if (offset < strokes.length) {
                requestAnimationFrame(drawBatch);
            } else {
                compositeLayers(ctxOut, this.canvasLines, this.canvasBleed, width, height, params.inkBlur);
                console.timeEnd('[Engine] Render');
                console.log(`[Engine] Done: ${strokes.length} strokes`);
                if (this.onRenderComplete) this.onRenderComplete();
            }
        };

        requestAnimationFrame(drawBatch);
    }
}
