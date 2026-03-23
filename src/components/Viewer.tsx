import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ZoomIn, ZoomOut, Maximize, LayoutGrid, Loader } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { AppEngine } from '../core/engine';

interface ViewerProps {
    activeTab: 'Original' | 'Maps' | 'Lines' | 'Compare';
    onTabChange: (tab: 'Original' | 'Maps' | 'Lines' | 'Compare') => void;
    onEngineReady?: (engine: AppEngine) => void;
}

const Viewer: React.FC<ViewerProps> = ({ activeTab, onTabChange, onEngineReady }) => {
    const [zoom, setZoom] = useState(100);
    const [showChecker, setShowChecker] = useState(true);

    const input = useAppStore(state => state.manifest.input);
    const params = useAppStore(state => state.manifest.params);
    const isProcessing = useAppStore(state => state.isProcessing);
    const processingStage = useAppStore(state => state.processingStage);
    const setProcessing = useAppStore(state => state.setProcessing);

    const containerRef = useRef<HTMLDivElement>(null);
    const outCanvasRef = useRef<HTMLCanvasElement>(null);
    const mapsCanvasRef = useRef<HTMLCanvasElement>(null);

    // App Engine reference
    const engineRef = useRef<AppEngine | null>(null);

    // Track previous maps params to avoid unnecessary full rebuilds
    const prevMapsParamsRef = useRef<string>('');
    const prevFileRef = useRef<File | null>(null);

    // Memoize maps params key to detect real changes
    const mapsParamsKey = useMemo(() => {
        return JSON.stringify({
            maps: params.maps,
            sourceMode: params.lines.sourceMode,
            edgeThreshold: params.lines.edgeThreshold
        });
    }, [params.maps, params.lines.sourceMode, params.lines.edgeThreshold]);

    // Memoize lines params key
    const linesParamsKey = useMemo(() => {
        return JSON.stringify({
            strokeDensity: params.lines.strokeDensity,
            randomness: params.lines.randomness,
            wobbleAmp: params.lines.wobbleAmp,
            strokeLength: params.lines.strokeLength,
            widthMin: params.lines.widthMin,
            widthMax: params.lines.widthMax,
            seed: params.lines.seed,
            inkBlur: params.inkBlur
        });
    }, [params.lines.strokeDensity, params.lines.randomness, params.lines.wobbleAmp,
        params.lines.strokeLength, params.lines.widthMin, params.lines.widthMax,
        params.lines.seed, params.inkBlur]);

    // Initialize engine once
    useEffect(() => {
        if (!engineRef.current && outCanvasRef.current) {
            engineRef.current = new AppEngine('renderer-canvas', 'maps-canvas');
            if (onEngineReady) onEngineReady(engineRef.current);
        }
    }, [onEngineReady]);

    // Effect: When image changes OR maps params change → full rebuild
    useEffect(() => {
        if (!engineRef.current || !input.file) return;

        const fileChanged = input.file !== prevFileRef.current;
        const mapsChanged = mapsParamsKey !== prevMapsParamsRef.current;

        if (!fileChanged && !mapsChanged) return;

        prevFileRef.current = input.file;
        prevMapsParamsRef.current = mapsParamsKey;

        let isCancelled = false;
        setProcessing(true, 'Building maps...');

        const timeout = setTimeout(() => {
            if (isCancelled || !engineRef.current) return;

            engineRef.current.onMapsReady = () => {
                if (isCancelled) return;
                setProcessing(true, 'Tracing strokes...');
                engineRef.current?.buildStrokes(params);
            };

            engineRef.current.onRenderComplete = () => {
                if (isCancelled) return;
                setProcessing(false);
            };

            engineRef.current.processImage(input.file!, params);
        }, fileChanged ? 100 : 400);

        return () => {
            isCancelled = true;
            clearTimeout(timeout);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [input.file, mapsParamsKey]);

    // Effect: When ONLY line/ink params change → rebuild strokes only (skip maps)
    useEffect(() => {
        if (!engineRef.current || !input.file) return;

        // Skip if we haven't done a full build yet
        if (!prevMapsParamsRef.current) return;

        let isCancelled = false;

        const timeout = setTimeout(() => {
            if (isCancelled || !engineRef.current) return;

            setProcessing(true, 'Retracing strokes...');

            engineRef.current.onRenderComplete = () => {
                if (isCancelled) return;
                setProcessing(false);
            };

            engineRef.current.buildStrokes(params);
        }, 350);

        return () => {
            isCancelled = true;
            clearTimeout(timeout);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [linesParamsKey]);


    return (
        <div className="center-viewer">

            {/* Tabs */}
            <div className="viewer-tabs">
                {(['Original', 'Maps', 'Lines', 'Compare'] as const).map(tab => (
                    <button
                        key={tab}
                        className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
                        onClick={() => onTabChange(tab)}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            {/* Toolbar */}
            <div className="viewer-toolbar">
                <button title="Zoom Out" onClick={() => setZoom(Math.max(25, zoom - 25))}><ZoomOut size={16} /></button>
                <span style={{ fontSize: '0.85rem', minWidth: '40px', textAlign: 'center' }}>{zoom}%</span>
                <button title="Zoom In" onClick={() => setZoom(Math.min(400, zoom + 25))}><ZoomIn size={16} /></button>
                <button title="Fit to Screen" onClick={() => setZoom(100)}><Maximize size={16} /></button>

                <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-color)', margin: '0 8px' }}></div>

                <button
                    title="Toggle Transparency Checker"
                    onClick={() => setShowChecker(!showChecker)}
                    style={{ backgroundColor: showChecker ? 'var(--bg-tertiary)' : '' }}
                >
                    <LayoutGrid size={16} />
                </button>

                {/* Processing indicator */}
                {isProcessing && (
                    <div style={{
                        marginLeft: 'auto',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '0.75rem',
                        color: 'var(--accent-color)',
                        padding: '3px 10px',
                        borderRadius: '12px',
                        backgroundColor: 'rgba(100, 108, 255, 0.1)',
                        border: '1px solid rgba(100, 108, 255, 0.2)'
                    }}>
                        <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />
                        {processingStage || 'Processing...'}
                    </div>
                )}
            </div>

            {/* Canvas Area */}
            <div
                ref={containerRef}
                className={`canvas-stage-wrapper ${showChecker ? 'checkerboard' : ''}`}
                style={{ overflow: 'auto', position: 'relative' }}
            >
                {/* Processing overlay */}
                {isProcessing && (
                    <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'rgba(15, 17, 23, 0.5)',
                        zIndex: 10,
                        pointerEvents: 'none'
                    }}>
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '12px',
                            padding: '24px 32px',
                            borderRadius: '16px',
                            backgroundColor: 'rgba(30, 35, 50, 0.9)',
                            border: '1px solid rgba(100, 108, 255, 0.3)',
                            backdropFilter: 'blur(8px)'
                        }}>
                            <Loader size={28} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-color)' }} />
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>
                                {processingStage || 'Processing...'}
                            </span>
                        </div>
                    </div>
                )}

                <div style={{
                    transform: `scale(${zoom / 100})`,
                    transformOrigin: 'center center',
                    transition: 'transform 0.2s',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    minWidth: '100%',
                    minHeight: '100%'
                }}>

                    {!input.file && (
                        <span style={{ color: 'var(--text-muted)' }}>Import an image to start</span>
                    )}

                    {/* Original image preview */}
                    <img
                        src={input.previewUrl}
                        alt="Original"
                        style={{
                            display: (activeTab === 'Original' && input.previewUrl) ? 'block' : 'none',
                            maxWidth: '100%',
                            maxHeight: '100%',
                            objectFit: 'contain'
                        }}
                    />

                    {/* Maps canvas */}
                    <canvas
                        id="maps-canvas"
                        ref={mapsCanvasRef}
                        style={{
                            display: activeTab === 'Maps' ? 'block' : 'none',
                            maxWidth: '100%',
                            maxHeight: '100%',
                            objectFit: 'contain'
                        }}
                    />

                    {/* Lines canvas */}
                    <canvas
                        id="renderer-canvas"
                        ref={outCanvasRef}
                        style={{
                            display: activeTab === 'Lines' ? 'block' : 'none',
                            maxWidth: '100%',
                            maxHeight: '100%',
                            objectFit: 'contain'
                        }}
                    />

                    {/* Compare view */}
                    {activeTab === 'Compare' && input.file && (
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1, textAlign: 'center' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Original</div>
                                <img
                                    src={input.previewUrl}
                                    alt="Original"
                                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                                />
                            </div>
                            <div style={{ width: '2px', backgroundColor: 'var(--accent-color)', alignSelf: 'stretch' }}></div>
                            <div style={{ flex: 1, textAlign: 'center' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Lines</div>
                                <canvas
                                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                                    ref={(el) => {
                                        if (el && outCanvasRef.current) {
                                            const src = outCanvasRef.current;
                                            el.width = src.width;
                                            el.height = src.height;
                                            const ctx = el.getContext('2d');
                                            if (ctx) ctx.drawImage(src, 0, 0);
                                        }
                                    }}
                                />
                            </div>
                        </div>
                    )}

                    {activeTab === 'Compare' && !input.file && (
                        <span style={{ color: 'var(--text-muted)' }}>Import an image to compare</span>
                    )}

                    {activeTab === 'Maps' && !input.file && (
                        <span style={{ color: 'var(--text-muted)' }}>Import an image to see maps</span>
                    )}

                </div>
            </div>

        </div>
    );
};

export default Viewer;
