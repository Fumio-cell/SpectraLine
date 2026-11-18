import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore, LOOKS } from '../store/useAppStore';
import { AppEngine } from '../core/engine';
import { SAMPLE } from '../core/input';
import { DEMO_MODE, DEMO_MAX_EDGE, BUY_URL } from '../config';

type View = 'drawing' | 'original' | 'compare';

const VIEWS: { id: View; label: string }[] = [
    { id: 'drawing', label: 'Drawing' },
    { id: 'original', label: 'Original' },
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
    const setProcessing = useAppStore(s => s.setProcessing);

    const engineRef = useRef<AppEngine | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const prevLinesRef = useRef('');
    const prevFileRef = useRef<File | null>(null);

    // The drawing depends on every drawing setting (contrast only redraws; the worker decides).
    const linesKey = useMemo(() => JSON.stringify(params.lines), [params.lines]);

    useEffect(() => {
        if (!engineRef.current && canvasRef.current) {
            engineRef.current = new AppEngine('renderer-canvas');
            onEngineReady(engineRef.current);
        }
    }, [onEngineReady]);

    // One debounced entry point for everything that needs (re)drawing.
    useEffect(() => {
        const engine = engineRef.current;
        if (!engine || !input.file) return;

        const fileChanged = input.file !== prevFileRef.current;
        const linesChanged = linesKey !== prevLinesRef.current;
        if (!fileChanged && !linesChanged) return;

        const timeout = setTimeout(() => {
            if (!input.file) return;
            // Remember what has really been sent, so a cancelled timer does not lose a change.
            prevFileRef.current = input.file;
            prevLinesRef.current = linesKey;

            if (fileChanged) engine.setImage(input.file);
            setProcessing(true);
            // The engine drops superseded results, so a completion is always for the latest request.
            engine.onRenderComplete = () => setProcessing(false);
            engine.onError = () => setProcessing(false);
            engine.renderLines(params);
        }, fileChanged ? 100 : 450);

        return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [input.file, linesKey]);

    const look = LOOKS.find(l => l.presetId === activeLookId) ?? LOOKS[0];
    const showOriginal = view !== 'drawing';
    const showDrawing = view !== 'original';
    const drawingLabel = `${look.name}: your picture drawn by SpectraLine`;
    const originalAlt = input.isSample ? SAMPLE.alt : `Your picture${input.filename ? `, ${input.filename}` : ''}`;

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
                <p className="note stage-status" role="status">{isProcessing ? 'Drawing…' : ''}</p>
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
                {input.isSample && <p className="note">{SAMPLE.credit}</p>}
            </div>
        </main>
    );
}
