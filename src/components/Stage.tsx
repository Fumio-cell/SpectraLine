import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore, LOOKS } from '../store/useAppStore';
import { AppEngine } from '../core/engine';
import { SAMPLES, SAMPLE_CREDIT } from '../core/input';
import { DEMO_MODE, DEMO_MAX_EDGE, BUY_URL } from '../config';

type View = 'drawing' | 'original' | 'compare';

/** After EMERGE completes the finished drawing stays for this long before the clip starts again. */
const EMERGE_HOLD = 1.2;

const VIEWS: { id: View; label: string }[] = [
    { id: 'original', label: 'Original' },
    { id: 'drawing', label: 'Drawing' },
    { id: 'compare', label: 'Side by side' }
];

interface StageProps {
    onEngineReady: (engine: AppEngine) => void;
    demoLimited: boolean;
}

export default function Stage({ onEngineReady, demoLimited }: StageProps) {
    const [view, setView] = useState<View>('drawing');

    const input = useAppStore(s => s.input);
    const params = useAppStore(s => s.params);
    const activeLookId = useAppStore(s => s.activeLookId);
    const isProcessing = useAppStore(s => s.isProcessing);
    const notice = useAppStore(s => s.notice);
    const spectrum = useAppStore(s => s.spectrum);
    const playing = useAppStore(s => s.playing);
    const isExporting = useAppStore(s => s.isExporting);
    const setPlaying = useAppStore(s => s.setPlaying);
    const setProcessing = useAppStore(s => s.setProcessing);
    const setSpectrum = useAppStore(s => s.setSpectrum);

    const engineRef = useRef<AppEngine | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const prevLinesRef = useRef('');
    const prevFileRef = useRef<File | null>(null);
    const stillFileRef = useRef<File | null>(null);
    // Where the clip is, in seconds: `base` at the moment playing last (re)started at `start` (performance.now()).
    const clockRef = useRef({ base: 0, start: 0 });
    const motion = params.motion;
    const moving = motion.mode !== 'still';

    // The drawing depends on every drawing setting (contrast only redraws; the worker decides).
    const linesKey = useMemo(() => JSON.stringify(params.lines), [params.lines]);

    useEffect(() => {
        if (!engineRef.current && canvasRef.current) {
            engineRef.current = new AppEngine('renderer-canvas');
            onEngineReady(engineRef.current);
        }
    }, [onEngineReady]);

    // PRISM shows the picture's own spectrum: ask for it once per picture, queued behind the drawing.
    useEffect(() => {
        const engine = engineRef.current;
        if (!engine || !input.file || activeLookId !== 'spectrum' || spectrum) return;
        engine.onSpectrum = (cells) => setSpectrum(cells);
        engine.requestSpectrum();
    }, [input.file, activeLookId, spectrum, setSpectrum]);

    // The picture goes to the worker once, as soon as it is chosen.
    useEffect(() => {
        const engine = engineRef.current;
        if (!engine || !input.file || input.file === prevFileRef.current) return;
        prevFileRef.current = input.file;
        engine.setImage(input.file);
    }, [input.file]);

    // STILL: one debounced entry point for everything that needs (re)drawing. Motion draws its own frames.
    useEffect(() => {
        const engine = engineRef.current;
        if (!engine || !input.file) return;
        if (moving) { prevLinesRef.current = ''; return; } // coming back to STILL draws it again

        const fileChanged = input.file !== stillFileRef.current;
        const linesChanged = linesKey !== prevLinesRef.current;
        if (!fileChanged && !linesChanged) return;

        const timeout = setTimeout(() => {
            if (!input.file) return;
            // Remember what has really been sent, so a cancelled timer does not lose a change.
            stillFileRef.current = input.file;
            prevLinesRef.current = linesKey;

            setProcessing(true);
            // The engine drops superseded results, so a completion is always for the latest request.
            engine.onRenderComplete = () => setProcessing(false);
            engine.onError = () => setProcessing(false);
            engine.renderLines(params);
        }, fileChanged ? 100 : 450);

        return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [input.file, linesKey, moving]);

    // MOTION: draw the frame for the time it is, as fast as the worker returns them. Each frame is drawn on its
    // own, so skipping ahead when a frame is slow costs nothing. Paused, it draws the held frame once.
    useEffect(() => {
        const engine = engineRef.current;
        if (!engine || !input.file || !moving || view === 'original' || isExporting) return;
        const { mode, length } = motion;
        const clock = clockRef.current;
        const running = playing;
        if (running) clock.start = performance.now();
        const elapsed = () => clock.base + (running ? (performance.now() - clock.start) / 1000 : 0);
        const timeOf = (el: number) => mode === 'pulse' ? el % length : Math.min(el % (length + EMERGE_HOLD), length);

        let alive = true;
        let raf = 0;
        let busy = false;
        let first = true;
        engine.onError = () => setProcessing(false);
        const draw = () => {
            if (!alive || busy) return;
            busy = true;
            if (first) setProcessing(true);
            void engine.renderFrame(params, motion, timeOf(elapsed())).then(() => {
                busy = false;
                if (first) { first = false; if (alive) setProcessing(false); }
                if (alive && running) raf = requestAnimationFrame(draw);
            });
        };
        draw();

        return () => {
            alive = false;
            cancelAnimationFrame(raf);
            if (running) clock.base += (performance.now() - clock.start) / 1000;
            setProcessing(false);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [input.file, linesKey, moving, motion.mode, motion.length, playing, view, isExporting]);

    const look = LOOKS.find(l => l.presetId === activeLookId) ?? LOOKS[0];
    const showOriginal = view !== 'drawing';
    const showDrawing = view !== 'original';
    const drawingLabel = `${look.name}: your picture drawn by SpectraLine`;
    const sample = SAMPLES.find(x => x.id === input.sampleId);
    const originalAlt = sample ? sample.alt : `Your picture${input.filename ? `, ${input.filename}` : ''}`;

    return (
        <main className="stage" id="main">
            <div className="stage-bar">
                <div className="view-chips" role="group" aria-label="View">
                    {VIEWS.map(v => (
                        <button
                            key={v.id}
                            type="button"
                            className="chip"
                            aria-pressed={view === v.id}
                            onClick={() => setView(v.id)}
                        >
                            {v.label}
                        </button>
                    ))}
                </div>
                <div className="stage-bar-end">
                    {moving && view !== 'original' && (
                        <button type="button" className="btn btn-small" onClick={() => setPlaying(!playing)} disabled={isExporting}>
                            {playing ? 'Pause' : 'Play'}
                        </button>
                    )}
                    <p className="note stage-status" role="status">{isProcessing ? 'Drawing…' : ''}</p>
                </div>
            </div>

            {notice && (
                <div className="notice-bar">
                    <p className="notice" role="alert" data-tone="error">{notice}</p>
                </div>
            )}

            <div className="stage-view">
                <div className="stage-cell" hidden={!showOriginal}>
                    {view === 'compare' && <p className="note cell-label">Original</p>}
                    <div className="cell-body">
                        {input.previewUrl && <img src={input.previewUrl} alt={originalAlt} />}
                    </div>
                </div>
                <div className="stage-cell" hidden={!showDrawing}>
                    {view === 'compare' && <p className="note cell-label">{look.name}</p>}
                    <div className="cell-body">
                        <canvas id="renderer-canvas" ref={canvasRef} role="img" aria-label={drawingLabel} />
                    </div>
                </div>
            </div>

            <div className="stage-foot">
                {look.presetId === 'spectrum' && (
                    <p className="note">
                        PRISM colours are CIE dominant wavelengths computed from the picture&apos;s RGB. A photo does not hold its
                        physical light spectrum, and SpectraLine does not claim to recover it.
                    </p>
                )}
                {DEMO_MODE && demoLimited && (
                    <p className="note" role="status">
                        Demo export: {DEMO_MAX_EDGE} px with a watermark. <a href={BUY_URL} target="_blank" rel="noopener noreferrer">Get the full version</a>
                    </p>
                )}
                {sample && <p className="note">{SAMPLE_CREDIT}</p>}
            </div>
        </main>
    );
}
