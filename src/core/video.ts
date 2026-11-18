import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { FPS, frameCount, frameTime, renderFrame, type MotionPlan, type MotionTables } from './lines/motion';

/**
 * MP4 export: H.264 through WebCodecs, muxed by mp4-muxer. The pattern is the one SignalType and Image-Flow
 * use (level table, bitrate, a key frame every second); here the frames come from motion.ts, which draws
 * any frame on its own, so the encoder is the only thing in the loop that carries state.
 */

/** Thrown when this browser cannot encode the clip. The message is shown to the person as it is. */
export class ExportUnsupportedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ExportUnsupportedError';
    }
}

/** Long edge of the video, in px. */
export const VIDEO_EDGE = 1080;

// H.264 High profile levels (codec string suffix is the level times 10, in hex) and the limits that decide
// whether a frame size and rate fit: macroblocks (16x16) per frame and per second.
const AVC_HIGH_LEVELS = [
    { level: '4.0', codec: 'avc1.640028', maxFrameMbs: 8192, maxMbsPerSec: 245760 },
    { level: '4.2', codec: 'avc1.64002a', maxFrameMbs: 8704, maxMbsPerSec: 522240 },
    { level: '5.1', codec: 'avc1.640033', maxFrameMbs: 36864, maxMbsPerSec: 983040 }
];

/**
 * Line art is hard for H.264: thin coloured lines on black. Measured against the raw frames (sample-4 CURRENT,
 * PULSE, 1080 px): 9 Mbit/s gave 32-34 dB RGB (38-40 dB luma), 18 Mbit/s gave 34-35 dB (43-45 dB), 27 Mbit/s
 * gave 35-36 dB (45-47 dB). 4x the 8 Mbit/s of 1080p, scaled by pixel count, is where the gain flattens.
 */
const bitrateFor = (w: number, h: number) => Math.round((8_000_000 * w * h) / (1920 * 1080)) * 4;

/** Even dimensions at the video's long edge (H.264 in 4:2:0 needs them). */
export function videoSize(srcW: number, srcH: number): { w: number; h: number } {
    const k = VIDEO_EDGE / Math.max(srcW, srcH);
    const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
    return { w: even(srcW * k), h: even(srcH * k) };
}

async function pickConfig(w: number, h: number): Promise<{ config: VideoEncoderConfig; level: string }> {
    if (typeof VideoEncoder === 'undefined') {
        throw new ExportUnsupportedError('This browser has no video encoder (WebCodecs). Use a recent Chrome, Edge or Safari.');
    }
    const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);
    const tried: string[] = [];
    for (const l of AVC_HIGH_LEVELS) {
        if (mbs > l.maxFrameMbs || mbs * FPS > l.maxMbsPerSec) continue;
        tried.push(l.level);
        const config: VideoEncoderConfig = { codec: l.codec, width: w, height: h, framerate: FPS, bitrate: bitrateFor(w, h), bitrateMode: 'variable', latencyMode: 'quality' };
        if ((await VideoEncoder.isConfigSupported(config)).supported) return { config, level: l.level };
    }
    throw new ExportUnsupportedError(`This browser cannot encode H.264 at ${w}x${h} (levels tried: ${tried.join(', ') || 'none fit'}).`);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface Mp4Result {
    bytes: Uint8Array<ArrayBuffer>;
    width: number;
    height: number;
    frames: number;
    level: string;
}

/** Encode the clip: length x 30 frames, no audio. */
export async function encodeMp4(plan: MotionPlan, tb: MotionTables, onProgress?: (done: number, total: number) => void): Promise<Mp4Result> {
    const { w, h } = plan;
    const total = frameCount(tb.length);
    const { config, level } = await pickConfig(w, h);

    const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: w, height: h }, fastStart: 'in-memory' });
    let failure: Error | null = null;
    const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => { failure = e; }
    });
    encoder.configure(config);

    for (let i = 0; i < total; i++) {
        if (failure) throw failure;
        const rgba = renderFrame(plan, tb, frameTime(tb.mode, tb.length, i));
        const frame = new VideoFrame(rgba, {
            format: 'RGBA', codedWidth: w, codedHeight: h,
            timestamp: Math.round((i / FPS) * 1_000_000), duration: Math.round(1_000_000 / FPS)
        });
        encoder.encode(frame, { keyFrame: i % FPS === 0 });
        frame.close();
        // A slow encoder must not queue frames without bound.
        while (encoder.encodeQueueSize > 6) await sleep(2);
        if (i % 6 === 0) { onProgress?.(i, total); await sleep(0); }
    }
    await encoder.flush();
    if (failure) throw failure;
    encoder.close();
    muxer.finalize();
    onProgress?.(total, total);
    return { bytes: new Uint8Array(muxer.target.buffer), width: w, height: h, frames: total, level };
}
