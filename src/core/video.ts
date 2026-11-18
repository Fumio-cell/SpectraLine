import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { FPS, frameCount, frameTime, renderFrame, type MotionPlan, type MotionTables } from './lines/motion';
import type { VideoSize } from './types';

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

// H.264 High profile levels (codec string suffix is the level times 10, in hex) and the limits that decide
// whether a frame size and rate fit: macroblocks (16x16) per frame and per second.
const AVC_HIGH_LEVELS = [
    { level: '4.0', codec: 'avc1.640028', maxFrameMbs: 8192, maxMbsPerSec: 245760 },
    { level: '4.2', codec: 'avc1.64002a', maxFrameMbs: 8704, maxMbsPerSec: 522240 },
    { level: '5.1', codec: 'avc1.640033', maxFrameMbs: 36864, maxMbsPerSec: 983040 },
    { level: '5.2', codec: 'avc1.640034', maxFrameMbs: 36864, maxMbsPerSec: 2073600 }
];

/**
 * Bit rate: a multiple of the 8 Mbit/s of 1080p video, scaled by the pixel count. Line art is hard for H.264:
 * thin coloured lines on black. Measured against the raw frames (see the SL-6 report): HD at 4x gives 34-35 dB
 * RGB (43-45 dB luma). At 4K the same quality needs far fewer bits per pixel: 2x gives 37-39 dB RGB (43-45 dB
 * luma) on a 2160x2160 clip at 36 Mbit/s; 3x gave +1.5 dB, 4x +2.3 dB, 6x +3.5 dB for 1.5, 2 and 3 times the size.
 */
export const RATE_FACTOR: Record<VideoSize, number> = { hd: 4, uhd: 2, demo: 4 };
export const bitrateFor = (w: number, h: number, size: VideoSize) => Math.round((8_000_000 * RATE_FACTOR[size] * w * h) / (1920 * 1080));

async function pickConfig(w: number, h: number, bitrate: number): Promise<{ config: VideoEncoderConfig; level: string }> {
    if (typeof VideoEncoder === 'undefined') {
        throw new ExportUnsupportedError('This browser has no video encoder (WebCodecs). Use a recent Chrome, Edge or Safari.');
    }
    const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);
    const tried: string[] = [];
    for (const l of AVC_HIGH_LEVELS) {
        if (mbs > l.maxFrameMbs || mbs * FPS > l.maxMbsPerSec) continue;
        tried.push(l.level);
        const config: VideoEncoderConfig = { codec: l.codec, width: w, height: h, framerate: FPS, bitrate, bitrateMode: 'variable', latencyMode: 'quality' };
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

export interface Mp4Options {
    size: VideoSize;
    /** Overrides the bit rate (bits per second); for measurements. */
    bitrate?: number;
    /** Applied to every frame before it is encoded (the demo watermark). */
    decorate?: (rgba: Uint8ClampedArray) => void;
    onProgress?: (done: number, total: number) => void;
}

/**
 * Encode the clip: length x 30 frames, no audio. Only the first frame is a key frame: a key frame is coded
 * afresh, so the picture jumps (2.1 times the usual frame-to-frame difference on a hardware encoder, 3 times on
 * a software one); the first frame is the one the loop starts on, and a clip of up to 15 s needs no more.
 */
export async function encodeMp4(plan: MotionPlan, tb: MotionTables, o: Mp4Options): Promise<Mp4Result> {
    const { w, h } = plan;
    const total = frameCount(tb.length);
    const bitrate = o.bitrate ?? bitrateFor(w, h, o.size);
    const { config, level } = await pickConfig(w, h, bitrate);

    const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: w, height: h }, fastStart: 'in-memory' });
    let failure: Error | null = null;
    const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => { failure = e; }
    });
    encoder.configure(config);

    const buffer = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < total; i++) {
        if (failure) throw failure;
        // The VideoFrame copies the pixels, so one buffer serves every frame.
        const rgba = renderFrame(plan, tb, frameTime(tb.mode, tb.length, i), buffer);
        o.decorate?.(rgba);
        const frame = new VideoFrame(rgba, {
            format: 'RGBA', codedWidth: w, codedHeight: h,
            timestamp: Math.round((i / FPS) * 1_000_000), duration: Math.round(1_000_000 / FPS)
        });
        encoder.encode(frame, { keyFrame: i === 0 });
        frame.close();
        // A slow encoder must not queue frames without bound.
        while (encoder.encodeQueueSize > 6) await sleep(2);
        if (i % 6 === 0) { o.onProgress?.(i, total); await sleep(0); }
    }
    await encoder.flush();
    if (failure) throw failure;
    encoder.close();
    muxer.finalize();
    o.onProgress?.(total, total);
    return { bytes: new Uint8Array(muxer.target.buffer), width: w, height: h, frames: total, level };
}
