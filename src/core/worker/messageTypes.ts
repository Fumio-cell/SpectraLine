import type { LineParams, MotionParams } from '../types';
import type { SpectrumCell } from '../lines/spectrum';

export interface WatermarkMask {
    x: number;
    y: number;
    w: number;
    h: number;
    /** Coverage 0..255, w*h. */
    alpha: Uint8ClampedArray;
}

export type WorkerRequest =
    | { type: 'SET_SOURCE'; requestId: string; buffer: ArrayBuffer; width: number; height: number }
    | { type: 'GET_SPECTRUM'; requestId: string }
    | { type: 'RENDER_LINES'; requestId: string; lines: LineParams; outW: number; outH: number }
    | { type: 'RENDER_FRAME'; requestId: string; lines: LineParams; motion: MotionParams; outW: number; outH: number; t: number }
    | { type: 'EXPORT_MP4'; requestId: string; lines: LineParams; motion: MotionParams }
    | { type: 'EXPORT_PNG'; requestId: string; lines: LineParams; outW: number; outH: number; watermark?: WatermarkMask };

export type WorkerResponse =
    | { type: 'SPECTRUM_READY'; requestId: string; status: 'ok'; cells: SpectrumCell[] }
    | { type: 'LINES_READY'; requestId: string; status: 'ok'; width: number; height: number; buffer: ArrayBuffer; strokeCount: number; ms: { trace: number; draw: number } }
    | { type: 'PNG_READY'; requestId: string; status: 'ok'; buffer: ArrayBuffer; width: number; height: number; ms: { trace: number; draw: number; encode: number } }
    | { type: 'FRAME_READY'; requestId: string; status: 'ok'; width: number; height: number; buffer: ArrayBuffer; ms: { plan: number; frame: number } }
    | { type: 'MP4_PROGRESS'; requestId: string; done: number; total: number }
    | { type: 'MP4_READY'; requestId: string; status: 'ok'; buffer: ArrayBuffer; width: number; height: number; frames: number; level: string; ms: { trace: number; plan: number; encode: number } }
    | { type: 'ERROR'; requestId: string; status: 'error'; error: { code: string; message: string } };
