import type { Params } from '../types';
import type { StrokePath } from '../lines/tracer';

export type WorkerRequest =
    | { type: 'BUILD_MAPS'; requestId: string; input: { imageBuffer: ArrayBuffer; width: number; height: number; previewWidth: number; previewHeight: number }; params: Params }
    | { type: 'BUILD_STROKES'; requestId: string; params: Params }
    | { type: 'CANCEL'; requestId: string };

export type WorkerResponse =
    | { type: 'MAPS_READY'; requestId: string; status: 'ok'; maps: any }
    | { type: 'STROKES_READY'; requestId: string; status: 'ok'; strokes: StrokePath[] }
    | { type: 'PROGRESS'; requestId: string; status: 'ok'; progress: number }
    | { type: 'ERROR'; requestId: string; status: 'error'; error: { code: string; message: string } };
