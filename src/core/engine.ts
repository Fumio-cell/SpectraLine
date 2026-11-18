import type { Params } from './types';
import type { WorkerRequest, WorkerResponse } from './worker/messageTypes';
import type { SpectrumCell } from './lines/spectrum';
import { sizeForEdge, WORK_EDGE } from './lines/render';

/** Long edge of the on-screen drawing. */
export const PREVIEW_EDGE = 1024;
import { demoWatermarkMask, downloadBlob } from './export';
import { DEMO_MODE, DEMO_MAX_EDGE } from '../config';

export interface ExportResult {
    width: number;
    height: number;
    bytes: number;
}

interface PendingExport {
    filename: string;
    resolve: (r: ExportResult) => void;
    reject: (e: Error) => void;
}

export class AppEngine {
    private worker: Worker;
    private canvasOut: HTMLCanvasElement;
    private sourcePromise: Promise<void> = Promise.resolve();
    private origW = 0;
    private origH = 0;
    private seq = 0;
    private linesRequestId = '';
    private spectrumRequestId = '';
    private pendingExports = new Map<string, PendingExport>();

    public onRenderComplete?: () => void;
    public onSpectrum?: (cells: SpectrumCell[]) => void;
    public onError?: (err: string) => void;

    constructor(outCanvasId: string) {
        this.canvasOut = document.getElementById(outCanvasId) as HTMLCanvasElement || document.createElement('canvas');
        this.worker = new Worker(new URL('./worker/processor.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handle(e.data);
    }

    private send(req: WorkerRequest, transfer: Transferable[] = []) {
        this.worker.postMessage(req, transfer);
    }

    private handle(res: WorkerResponse) {
        if (res.type === 'ERROR') {
            console.error('[Engine] Worker error:', res.error.message);
            const pending = this.pendingExports.get(res.requestId);
            if (pending) {
                this.pendingExports.delete(res.requestId);
                pending.reject(new Error(res.error.message));
            } else if (this.onError) {
                this.onError(res.error.message);
            }
            return;
        }

        if (res.type === 'PNG_READY') {
            const pending = this.pendingExports.get(res.requestId);
            if (!pending) return;
            this.pendingExports.delete(res.requestId);
            const blob = new Blob([res.buffer], { type: 'image/png' });
            console.log(`[Engine] Export ${res.width}x${res.height}: trace ${res.ms.trace} ms, draw ${res.ms.draw} ms, encode ${res.ms.encode} ms, ${(blob.size / 1024).toFixed(0)} KB`);
            downloadBlob(blob, pending.filename);
            pending.resolve({ width: res.width, height: res.height, bytes: blob.size });
            return;
        }

        if (res.type === 'SPECTRUM_READY') {
            if (res.requestId === this.spectrumRequestId && this.onSpectrum) this.onSpectrum(res.cells);
            return;
        }

        if (res.type === 'LINES_READY') {
            if (res.requestId !== this.linesRequestId) return; // superseded
            const c = this.canvasOut;
            c.width = res.width;
            c.height = res.height;
            const ctx = c.getContext('2d')!;
            ctx.putImageData(new ImageData(new Uint8ClampedArray(res.buffer), res.width, res.height), 0, 0);
            console.log(`[Engine] ${res.strokeCount} lines ${res.width}x${res.height}: trace ${res.ms.trace} ms, draw ${res.ms.draw} ms`);
            if (this.onRenderComplete) this.onRenderComplete();
            return;
        }
    }

    /** Decode the picture once, at working size, and hand it to the worker. */
    public setImage(file: File) {
        this.sourcePromise = new Promise<void>((resolve) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onerror = () => {
                URL.revokeObjectURL(url);
                if (this.onError) this.onError('Failed to decode image file.');
                resolve();
            };
            img.onload = () => {
                URL.revokeObjectURL(url);
                this.origW = img.naturalWidth;
                this.origH = img.naturalHeight;
                const k = Math.min(1, WORK_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
                const w = Math.max(1, Math.round(img.naturalWidth * k));
                const h = Math.max(1, Math.round(img.naturalHeight * k));
                const c = document.createElement('canvas');
                c.width = w;
                c.height = h;
                const ctx = c.getContext('2d')!;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, w, h);
                const data = ctx.getImageData(0, 0, w, h);
                this.send({ type: 'SET_SOURCE', requestId: `src_${++this.seq}`, buffer: data.data.buffer, width: w, height: h }, [data.data.buffer]);
                resolve();
            };
            img.src = url;
        });
    }

    /** Draw the lines at preview size. Completion is reported through onRenderComplete. */
    public renderLines(params: Params) {
        const id = `lines_${++this.seq}`;
        this.linesRequestId = id;
        this.sourcePromise.then(() => {
            if (id !== this.linesRequestId) return;
            const { w, h } = sizeForEdge(this.origW, this.origH, PREVIEW_EDGE);
            this.send({ type: 'RENDER_LINES', requestId: id, lines: params.lines, outW: w, outH: h });
        });
    }

    /** Ask for the picture's measured spectrum (queued behind any drawing). */
    public requestSpectrum() {
        const id = `spectrum_${++this.seq}`;
        this.spectrumRequestId = id;
        this.sourcePromise.then(() => {
            if (id !== this.spectrumRequestId) return;
            this.send({ type: 'GET_SPECTRUM', requestId: id });
        });
    }

    /** Render at the chosen long edge in the worker and download the PNG. */
    public async exportPNG(params: Params, filename: (size: { width: number; height: number }) => string): Promise<ExportResult> {
        await this.sourcePromise;
        if (!this.origW) throw new Error('No image loaded for export.');
        const edge = DEMO_MODE ? Math.min(params.export.edge, DEMO_MAX_EDGE) : params.export.edge;
        const { w, h } = sizeForEdge(this.origW, this.origH, edge);
        const id = `png_${++this.seq}`;
        return new Promise<ExportResult>((resolve, reject) => {
            this.pendingExports.set(id, { filename: filename({ width: w, height: h }), resolve, reject });
            this.send({
                type: 'EXPORT_PNG', requestId: id, lines: params.lines, outW: w, outH: h,
                watermark: DEMO_MODE ? demoWatermarkMask(w, h) : undefined
            });
        });
    }
}
