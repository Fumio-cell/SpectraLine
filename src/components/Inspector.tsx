import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { DEMO_MODE, DEMO_MAX_EDGE, BUY_URL } from '../config';

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

const Inspector = ({ demoLimited = false }: { demoLimited?: boolean }) => {
    const params = useAppStore(state => state.manifest.params);
    const updateParams = useAppStore(state => state.updateParams);

    const handleLinesChange = (field: string, value: unknown) => updateParams('lines', { [field]: value });
    const handleMapsChange = (field: string, value: unknown) => updateParams('maps', { [field]: value });
    const handleExportChange = (field: string, value: unknown) => updateParams('export', { [field]: value });
    const isFlow = params.lines.mode !== 'isolines';
    const isSpectrum = params.lines.mode === 'spectrum';




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
                            onChange={e => handleLinesChange('seed', (parseInt(e.target.value) || 0) >>> 0)}
                        />
                        <button onClick={() => handleLinesChange('seed', Math.floor(Math.random() * 999999) + 1)}>Random</button>
                    </div>
                </div>
            </AccordionSection>

            <AccordionSection title="2. Input / Preview" defaultExpanded>
                <div className="control-group">
                    <label className="control-header">Preview Target Size</label>
                    <select className="select-input" disabled value={params.preview.previewMaxEdge}>
                        <option value="1024">Max Edge 1024px (Fast)</option>
                    </select>
                </div>
            </AccordionSection>

            <AccordionSection title="3. Maps">
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

            </AccordionSection>

            <AccordionSection title="4. Lines" defaultExpanded>
                <div className="control-group">
                    <label className="control-header">Drawing</label>
                    <select
                        className="select-input"
                        value={params.lines.mode}
                        onChange={e => handleLinesChange('mode', e.target.value)}
                    >
                        <option value="flow">Flow (follows edges)</option>
                        <option value="isolines">Isolines (luminance contours)</option>
                        <option value="spectrum">Spectrum (bands of wavelength)</option>
                    </select>
                </div>

                {isFlow ? (
                    <>
                        <div className="control-group">
                            <label className="control-header">Spacing <span>{params.lines.spacing.toFixed(1)}x width</span></label>
                            <input
                                type="range" min="1.5" max="10" step="0.1"
                                value={params.lines.spacing}
                                onChange={e => handleLinesChange('spacing', parseFloat(e.target.value))}
                                className="slider-input"
                            />
                        </div>
                        {isSpectrum && (
                            <div className="control-group">
                                <label className="control-header">Bands <span>{params.lines.bands} + purples</span></label>
                                <input
                                    type="range" min="3" max="12" step="1"
                                    value={params.lines.bands}
                                    onChange={e => handleLinesChange('bands', parseInt(e.target.value))}
                                    className="slider-input"
                                />
                            </div>
                        )}
                        <div className="control-group">
                            <label className="control-header">Length <span>{params.lines.length.toFixed(1)}x</span></label>
                            <input
                                type="range" min="0.3" max="3" step="0.1"
                                value={params.lines.length}
                                onChange={e => handleLinesChange('length', parseFloat(e.target.value))}
                                className="slider-input"
                            />
                        </div>
                        <div className="control-group">
                            <label className="control-header">Flat-area ink <span>{Math.round(params.lines.calm * 100)}%</span></label>
                            <input
                                type="range" min="0" max="1" step="0.02"
                                value={params.lines.calm}
                                onChange={e => handleLinesChange('calm', parseFloat(e.target.value))}
                                className="slider-input"
                            />
                        </div>
                    </>
                ) : (
                    <>
                        <div className="control-group">
                            <label className="control-header">Levels <span>{params.lines.levels}</span></label>
                            <input
                                type="range" min="8" max="90" step="1"
                                value={params.lines.levels}
                                onChange={e => handleLinesChange('levels', parseInt(e.target.value))}
                                className="slider-input"
                            />
                        </div>
                        <div className="control-group">
                            <label className="control-header">Shortest contour <span>{params.lines.minLength} px</span></label>
                            <input
                                type="range" min="4" max="120" step="2"
                                value={params.lines.minLength}
                                onChange={e => handleLinesChange('minLength', parseInt(e.target.value))}
                                className="slider-input"
                            />
                        </div>
                    </>
                )}

                <div className="control-group">
                    <label className="control-header">Line width <span>{params.lines.width.toFixed(1)} px</span></label>
                    <input
                        type="range" min="0.3" max="4" step="0.1"
                        value={params.lines.width}
                        onChange={e => handleLinesChange('width', parseFloat(e.target.value))}
                        className="slider-input"
                    />
                </div>

                <div className="control-group">
                    <label className="control-header">Contrast <span>{params.lines.contrast.toFixed(2)}</span></label>
                    <input
                        type="range" min="0" max="2" step="0.05"
                        value={params.lines.contrast}
                        onChange={e => handleLinesChange('contrast', parseFloat(e.target.value))}
                        className="slider-input"
                    />
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        0 draws every line alike; higher lets strong places glow and calm places fade.
                    </div>
                </div>

                <div className="control-group">
                    <label className="control-header">Background</label>
                    <select
                        className="select-input"
                        value={params.lines.background}
                        onChange={e => handleLinesChange('background', e.target.value)}
                    >
                        <option value="black">Black</option>
                        <option value="transparent">Transparent (PNG alpha)</option>
                    </select>
                </div>
            </AccordionSection>

            <AccordionSection title="5. Export">
                <div className="control-group">
                    <label className="control-header">Export size (long edge)</label>
                    <select
                        className="select-input"
                        value={DEMO_MODE ? 1024 : params.export.edge}
                        onChange={e => handleExportChange('edge', parseInt(e.target.value))}
                    >
                        <option value="1024">1024 px</option>
                        <option value="2048" disabled={DEMO_MODE}>2048 px</option>
                        <option value="4096" disabled={DEMO_MODE}>4096 px</option>
                    </select>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        {DEMO_MODE
                            ? `Demo: capped at ${DEMO_MAX_EDGE} px with a watermark.`
                            : params.lines.background === 'transparent' ? 'PNG with transparent background.' : 'PNG on black.'}
                    </div>
                </div>

                <button
                    style={{ marginTop: '1rem', backgroundColor: 'var(--accent-color)', color: '#fff', width: '100%', padding: '0.75rem' }}
                    onClick={() => {
                        window.dispatchEvent(new CustomEvent('app:export'));
                    }}
                >
                    Export Lines
                </button>
                <button
                    style={{ marginTop: '0.5rem', backgroundColor: 'var(--accent-color)', opacity: 0.8, color: '#fff', width: '100%', padding: '0.75rem', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 500 }}
                    onClick={() => {
                        window.dispatchEvent(new CustomEvent('app:exportMap'));
                    }}
                >
                    Export Map PNG
                </button>
                {DEMO_MODE && demoLimited && (
                    <p className="demo-notice">
                        Demo export is limited to {DEMO_MAX_EDGE} px with a watermark.{' '}
                        <a href={BUY_URL} target="_blank" rel="noopener noreferrer">Get the full version</a>
                    </p>
                )}
            </AccordionSection>

        </div>
    );
};

export default Inspector;
