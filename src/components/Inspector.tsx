import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

interface AccordionSectionProps {
    title: string;
    defaultExpanded?: boolean;
    children: React.ReactNode;
}

const AccordionSection: React.FC<AccordionSectionProps> = ({ title, defaultExpanded = false, children }) => {
    const [expanded, setExpanded] = useState(defaultExpanded);

    return (
        <div className="accordion-section">
            <div className="accordion-header" onClick={() => setExpanded(!expanded)}>
                <span>{title}</span>
                {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </div>
            {expanded && <div className="accordion-content">{children}</div>}
        </div>
    );
};

const Inspector = () => {
    const params = useAppStore(state => state.manifest.params);
    const updateParams = useAppStore(state => state.updateParams);

    const handleLinesChange = (field: string, value: any) => updateParams('lines', { [field]: value });
    const handleMapsChange = (field: string, value: any) => updateParams('maps', { [field]: value });
    const handleInkBlurChange = (field: string, value: any) => updateParams('inkBlur', { [field]: value });
    const handleExportChange = (field: string, value: any) => updateParams('export', { [field]: value });

    const [isPro, setIsPro] = useState(false);

    useEffect(() => {
        const handleAuth = (e: any) => setIsPro(e.detail.isPro);
        window.addEventListener('auth:status', handleAuth as EventListener);
        return () => window.removeEventListener('auth:status', handleAuth as EventListener);
    }, []);

    return (
        <div className="right-inspector">

            <AccordionSection title="1. Project" defaultExpanded>
                <div className="control-group">
                    <label className="control-header">Project Seed</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                            type="number"
                            className="number-input"
                            value={params.lines.seed}
                            onChange={e => handleLinesChange('seed', parseInt(e.target.value) || 0)}
                        />
                        <button onClick={() => handleLinesChange('seed', Math.floor(Math.random() * 999999))}>Random</button>
                    </div>
                </div>
            </AccordionSection>

            <AccordionSection title="2. Input / Preview" defaultExpanded>
                <div className="control-group">
                    <label className="control-header">Preview Target Size</label>
                    <select className="select-input" disabled value={params.preview.previewMaxEdge}>
                        <option value="2048">Max Edge 2048px (Fast)</option>
                    </select>
                </div>
            </AccordionSection>

            <AccordionSection title="3. Maps" defaultExpanded>
                <div className="control-group" style={{
                    padding: '8px',
                    borderRadius: '6px',
                    backgroundColor: params.maps.scientificMode ? 'rgba(100, 140, 255, 0.1)' : 'transparent',
                    border: params.maps.scientificMode ? '1px solid rgba(100, 140, 255, 0.3)' : '1px solid transparent',
                    transition: 'all 0.2s'
                }}>
                    <label className="control-header" style={{ cursor: 'pointer' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input
                                type="checkbox"
                                checked={params.maps.scientificMode}
                                onChange={e => handleMapsChange('scientificMode', e.target.checked)}
                            /> Scientific Mode
                        </span>
                        <Info size={14} />
                    </label>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: '1.4' }}>
                        {params.maps.scientificMode
                            ? '🔬 CIE L*a*b* + CIEDE2000 perceptual color difference'
                            : 'Standard: BT.601 luminance + Sobel operator'}
                    </div>
                </div>

                <div className="control-group">
                    <label className="control-header">
                        Color Quantization (K)
                        <span style={{ color: 'var(--accent-color)' }}>{params.maps.colorQuantK}</span>
                    </label>
                    <input
                        type="range" min="2" max="16"
                        value={params.maps.colorQuantK}
                        onChange={e => handleMapsChange('colorQuantK', parseInt(e.target.value))}
                        className="slider-input"
                    />
                </div>

                <div className="control-group">
                    <label className="control-header">
                        Gradient Gain
                        <span style={{ color: 'var(--accent-color)' }}>{params.maps.gradientGain.toFixed(1)}</span>
                    </label>
                    <input
                        type="range" min="0" max="10" step="0.1"
                        value={params.maps.gradientGain}
                        onChange={e => handleMapsChange('gradientGain', parseFloat(e.target.value))}
                        className="slider-input"
                    />
                </div>

                <div className="control-group" style={{ marginTop: '0.5rem' }}>
                    <label className="control-header" style={{ cursor: 'pointer' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input
                                type="checkbox"
                                checked={params.maps.contoursEnabled}
                                onChange={e => handleMapsChange('contoursEnabled', e.target.checked)}
                            /> Enable Contours
                        </span>
                        <Info size={14} />
                    </label>
                </div>

                <div className="control-group" style={{ opacity: params.maps.contoursEnabled ? 1 : 0.5 }}>
                    <label className="control-header">Contour Levels <span>{params.maps.contourLevels}</span></label>
                    <input
                        type="range" min="3" max="40"
                        value={params.maps.contourLevels}
                        onChange={e => handleMapsChange('contourLevels', parseInt(e.target.value))}
                        disabled={!params.maps.contoursEnabled}
                        className="slider-input"
                    />
                </div>
            </AccordionSection>

            <AccordionSection title="4. Lines">
                <div className="control-group">
                    <label className="control-header">Source Mode</label>
                    <select
                        className="select-input"
                        value={params.lines.sourceMode}
                        onChange={e => handleLinesChange('sourceMode', e.target.value)}
                    >
                        <option value="Edges">Edges Only</option>
                        <option value="Contours">Contours Only</option>
                        <option value="Hybrid">Hybrid</option>
                    </select>
                </div>

                <div className="control-group">
                    <label className="control-header">Stroke Density <span>{params.lines.strokeDensity.toFixed(1)}</span></label>
                    <input
                        type="range" min="0.1" max="8" step="0.1"
                        value={params.lines.strokeDensity}
                        onChange={e => handleLinesChange('strokeDensity', parseFloat(e.target.value))}
                        className="slider-input"
                    />
                </div>

                <div className="control-group">
                    <label className="control-header">Randomness <span>{params.lines.randomness}%</span></label>
                    <input
                        type="range" min="0" max="100"
                        value={params.lines.randomness}
                        onChange={e => handleLinesChange('randomness', parseInt(e.target.value))}
                        className="slider-input"
                    />
                </div>
                <div className="control-group">
                    <label className="control-header">Wobble Amp <span>{params.lines.wobbleAmp.toFixed(1)}</span></label>
                    <input
                        type="range" min="0" max="3" step="0.1"
                        value={params.lines.wobbleAmp}
                        onChange={e => handleLinesChange('wobbleAmp', parseFloat(e.target.value))}
                        className="slider-input"
                    />
                </div>
            </AccordionSection>

            <AccordionSection title="5. Ink & Blur">
                <div className="control-group">
                    <label className="control-header">Bleed Amount (px) <span>{params.inkBlur.bleedAmountPx.toFixed(1)}</span></label>
                    <input
                        type="range" min="0" max="10" step="0.5"
                        value={params.inkBlur.bleedAmountPx}
                        onChange={e => handleInkBlurChange('bleedAmountPx', parseFloat(e.target.value))}
                        className="slider-input"
                    />
                </div>
                <div className="control-group">
                    <label className="control-header">Bleed Blur (px) <span>{params.inkBlur.bleedBlurPx.toFixed(1)}</span></label>
                    <input
                        type="range" min="0" max="8" step="0.5"
                        value={params.inkBlur.bleedBlurPx}
                        onChange={e => handleInkBlurChange('bleedBlurPx', parseFloat(e.target.value))}
                        className="slider-input"
                    />
                </div>

                <div className="control-group">
                    <label className="control-header">Bleed Mode</label>
                    <select
                        className="select-input"
                        value={params.inkBlur.bleedMode}
                        onChange={e => handleInkBlurChange('bleedMode', e.target.value)}
                    >
                        <option value="Normal">Normal</option>
                        <option value="Multiply">Multiply</option>
                    </select>
                </div>
            </AccordionSection>

            <AccordionSection title="6. Export">
                <div className="control-group">
                    <label className="control-header">Export Scale</label>
                    <select
                        className="select-input"
                        value={params.export.scale}
                        onChange={e => handleExportChange('scale', parseInt(e.target.value))}
                    >
                        <option value="1">1x (Original Size)</option>
                        <option value="2">2x</option>
                        <option value="3">3x</option>
                        <option value="4">4x</option>
                    </select>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        Will be capped at 8192px maximum edge.
                    </div>
                </div>

                <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
                        <input
                            type="checkbox"
                            checked={params.export.targets.includes('lines')}
                            onChange={e => {
                                const target = 'lines';
                                const targets = e.target.checked
                                    ? [...params.export.targets, target]
                                    : params.export.targets.filter(t => t !== target);
                                handleExportChange('targets', targets);
                            }}
                        /> Export Lines (Transparent PNG)
                    </label>
                </div>

                <button
                    className={!isPro ? 'gated' : ''}
                    title={!isPro ? 'Upgrade to PRO to unlock' : ''}
                    style={{ marginTop: '1rem', backgroundColor: 'var(--accent-color)', color: '#fff', width: '100%', padding: '0.75rem' }}
                    onClick={() => {
                        // Trigger download flow
                        window.dispatchEvent(new CustomEvent('app:export'));
                    }}
                >
                    Export Lines
                </button>
                <button
                    className={!isPro ? 'gated' : ''}
                    title={!isPro ? 'Upgrade to PRO to unlock' : ''}
                    style={{ marginTop: '0.5rem', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', width: '100%', padding: '0.75rem', border: '1px solid var(--border-color)' }}
                    onClick={() => {
                        window.dispatchEvent(new CustomEvent('app:exportMap'));
                    }}
                >
                    Export Map PNG
                </button>
            </AccordionSection>

        </div>
    );
};

export default Inspector;
