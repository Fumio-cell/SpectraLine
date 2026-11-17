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
    const previewQuality = useAppStore(state => state.previewQuality);
    const setPreviewQuality = useAppStore(state => state.setPreviewQuality);
    const isProcessing = useAppStore(state => state.isProcessing);
    const processingStage = useAppStore(state => state.processingStage);
    const setProcessing = useAppStore(state => state.setProcessing);

    const containerRef = useRef<HTMLDivElement>(null);
    const outCanvasRef = useRef<HTMLCanvasElement>(null);
    const mapsCanvasRef = useRef<HTMLCanvasElement>(null);

    // App Engine reference
    const engineRef = useRef<AppEngine | null>(null);

    // Track previous params to avoid unnecessary full rebuilds
    const prevMapsParamsRef = useRef<string>('');
    const prevLinesParamsRef = useRef<string>('');
    const prevFileRef = useRef<File | null>(null);

    // Maps only depend on the map settings.
    const mapsParamsKey = useMemo(() => JSON.stringify(params.maps), [params.maps]);

    // Lines depend on every drawing setting and on the preview size.
    const linesParamsKey = useMemo(() => JSON.stringify({ lines: params.lines, quality: previewQuality }), [params.lines, previewQuality]);

    // Initialize engine once
    useEffect(() => {
        if (!engineRef.current && outCanvasRef.current) {
            engineRef.current = new AppEngine('renderer-canvas', 'maps-canvas');
            if (onEngineReady) onEngineReady(engineRef.current);
        }
    }, [onEngineReady]);

    // One debounced entry point for everything that needs (re)drawing.
    useEffect(() => {
        if (!engineRef.current || !input.file) return;

        const fileChanged = input.file !== prevFileRef.current;
        const mapsChanged = mapsParamsKey !== prevMapsParamsRef.current;
        const linesChanged = linesParamsKey !== prevLinesParamsRef.current;
        if (!fileChanged && !mapsChanged && !linesChanged) return;

        const timeout = setTimeout(() => {
            const engine = engineRef.current;
            if (!engine || !input.file) return;

            // Remember what has really been sent, so a cancelled timer does not lose a change.
            prevFileRef.current = input.file;
            prevMapsParamsRef.current = mapsParamsKey;
            prevLinesParamsRef.current = linesParamsKey;

            const activeParams = {
                ...params,
                preview: { ...params.preview, previewMaxEdge: previewQuality === 'Live' ? 512 : 1024 }
            };

            if (fileChanged) engine.setImage(input.file);

            if (fileChanged || linesChanged) {
                setProcessing(true, 'Drawing lines...');
                // The engine drops superseded results, so a completion is always for the latest request.
                engine.onRenderComplete = () => setProcessing(false);
                engine.onError = () => setProcessing(false);
                engine.renderLines(activeParams);
            }
            // Queued behind the lines, so the picture appears first.
            if (fileChanged || mapsChanged) engine.buildMaps(activeParams);
        }, fileChanged ? 100 : 450);

        return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [input.file, mapsParamsKey, linesParamsKey]);


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

                <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-color)', margin: '0 8px' }}></div>

                <select 
                    value={previewQuality} 
                    onChange={(e) => setPreviewQuality(e.target.value as 'Live' | 'High')}
                    style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.1)', color: 'var(--text-main)', border: '1px solid var(--panel-border)', fontSize: '0.75rem', outline: 'none' }}
                >
                    <option value="Live">Preview 512 px (Fast)</option>
                    <option value="High">Preview 1024 px</option>
                </select>

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
