import React, { useState, useEffect, useRef } from 'react';
import { ZoomIn, ZoomOut, Maximize, SquareSplitHorizontal, LayoutGrid } from 'lucide-react';
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

    const containerRef = useRef<HTMLDivElement>(null);
    const outCanvasRef = useRef<HTMLCanvasElement>(null);
    const mapsCanvasRef = useRef<HTMLCanvasElement>(null);

    // App Engine reference
    const engineRef = useRef<AppEngine | null>(null);

    // Track whether a full rebuild is pending
    const rebuildPendingRef = useRef(false);

    // Track whether processImage is in progress to prevent double buildStrokes
    const processingRef = useRef(false);

    // Initialize engine once
    useEffect(() => {
        if (!engineRef.current && outCanvasRef.current) {
            engineRef.current = new AppEngine('renderer-canvas', 'maps-canvas');
            if (onEngineReady) onEngineReady(engineRef.current);
        }
    }, [onEngineReady]);

    // Effect: When image or generic map params change, rebuild maps
    useEffect(() => {
        let isCancelled = false;
        rebuildPendingRef.current = true;

        const handleRebuild = async () => {
            if (isCancelled) return;
            rebuildPendingRef.current = false;

            if (!engineRef.current || !input.file) return;

            processingRef.current = true;

            // Set callbacks BEFORE calling processImage to avoid timing issues
            engineRef.current.onMapsReady = () => {
                if (isCancelled) return;
                // Automatically build strokes after maps are ready
                engineRef.current?.buildStrokes(params);
                // Reset processing flag after strokes are queued
                processingRef.current = false;
            };

            engineRef.current.onRenderComplete = () => {
                // Could sync UI state if needed
            };

            engineRef.current.processImage(input.file, params);
        };

        // Debounce to avoid rapid re-triggers
        const timeout = setTimeout(() => handleRebuild(), 500);
        return () => {
            isCancelled = true;
            clearTimeout(timeout);
        };
    }, [input.file, params.maps, params.lines.sourceMode, params.lines.edgeThreshold]);

    // Effect: When line specific params or ink change, just rebuild strokes and render
    // Skip if processImage flow is already handling it
    useEffect(() => {
        const timeout = setTimeout(() => {
            if (engineRef.current && input.file && !processingRef.current && !rebuildPendingRef.current) {
                engineRef.current.buildStrokes(params);
            }
        }, 300);
        return () => clearTimeout(timeout);
    }, [params.lines.strokeDensity, params.lines.randomness, params.lines.wobbleAmp, params.lines.strokeLength, params.lines.widthMin, params.lines.widthMax, params.inkBlur, params.lines.seed]);


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
                <button title="Split Compare"><SquareSplitHorizontal size={16} /></button>
            </div>

            {/* Canvas Area */}
            <div
                ref={containerRef}
                className={`canvas-stage-wrapper ${showChecker ? 'checkerboard' : ''}`}
                style={{ overflow: 'auto' }}
            >
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

                    {/* Maps canvas - gradient/edge visualization */}
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

                    {/* Lines canvas - stroke rendering */}
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

                    {/* Compare view: side-by-side Original and Lines */}
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
