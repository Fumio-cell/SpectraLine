import { useAppStore, LOOKS } from '../store/useAppStore';
import { DEMO_MODE, DEMO_MAX_EDGE } from '../config';
import type { ExportEdge } from '../core/types';

interface ControlsProps {
    onExport: () => void;
}

export default function Controls({ onExport }: ControlsProps) {
    const lines = useAppStore(s => s.params.lines);
    const exportEdge = useAppStore(s => s.params.export.edge);
    const activeLookId = useAppStore(s => s.activeLookId);
    const isExporting = useAppStore(s => s.isExporting);
    const applyLook = useAppStore(s => s.applyLook);
    const updateLines = useAppStore(s => s.updateLines);
    const updateExport = useAppStore(s => s.updateExport);

    const isPrism = lines.mode === 'spectrum';

    return (
        <aside className="controls" aria-label="Controls">
            <section className="section" aria-labelledby="look-title">
                <h2 className="section-title" id="look-title">Look</h2>
                <div className="looks" role="group" aria-labelledby="look-title">
                    {LOOKS.map(look => (
                        <button
                            key={look.presetId}
                            type="button"
                            className="chip chip-look"
                            aria-pressed={activeLookId === look.presetId}
                            onClick={() => applyLook(look.presetId)}
                        >
                            <span className="chip-name">{look.name}</span>
                            <span className="chip-note note">{look.note}</span>
                        </button>
                    ))}
                </div>
            </section>

            <section className="section" aria-labelledby="draw-title">
                <h2 className="section-title" id="draw-title">Draw</h2>

                <div className="field-group">
                    <div className="field-head">
                        <label className="field-label" htmlFor="contrast">Contrast</label>
                        <span className="field-value">{lines.contrast.toFixed(2)}</span>
                    </div>
                    <input
                        id="contrast" type="range" min="0" max="2" step="0.05"
                        value={lines.contrast}
                        aria-describedby="contrast-note"
                        onChange={e => updateLines({ contrast: parseFloat(e.target.value) })}
                    />
                    <p className="note" id="contrast-note">Higher: strong places glow, calm fade.</p>
                </div>

                {isPrism && (
                    <div className="field-group">
                        <div className="field-head">
                            <label className="field-label" htmlFor="bands">Bands</label>
                            <span className="field-value">{lines.bands} + purples</span>
                        </div>
                        <input
                            id="bands" type="range" min="3" max="12" step="1"
                            value={lines.bands}
                            onChange={e => updateLines({ bands: parseInt(e.target.value) })}
                        />
                    </div>
                )}

                <div className="field-group">
                    <label className="field-label" htmlFor="seed">Seed</label>
                    <div className="field-row">
                        <input
                            id="seed" type="number" className="field" min="0" step="1"
                            value={lines.seed}
                            aria-describedby="seed-note"
                            onChange={e => updateLines({ seed: (parseInt(e.target.value) || 0) >>> 0 })}
                        />
                        <button type="button" className="btn" onClick={() => updateLines({ seed: Math.floor(Math.random() * 999999) + 1 })}>Random</button>
                    </div>
                    <p className="note" id="seed-note">Where lines start. TOPO ignores it.</p>
                </div>

                <div className="field-group">
                    <label className="field-label" htmlFor="background">Background</label>
                    <select
                        id="background" className="field"
                        value={lines.background}
                        aria-describedby={lines.background === 'transparent' ? 'background-note' : undefined}
                        onChange={e => updateLines({ background: e.target.value as 'black' | 'transparent' })}
                    >
                        <option value="black">Black</option>
                        <option value="transparent">Transparent</option>
                    </select>
                    {lines.background === 'transparent' && (
                        <p className="note" id="background-note">No background in the PNG. Shown on black here.</p>
                    )}
                </div>
            </section>

            <section className="section" aria-labelledby="export-title">
                <h2 className="section-title" id="export-title">Export</h2>
                <div className="field-group">
                    <label className="field-label" htmlFor="export-size">Size</label>
                    <select
                        id="export-size" className="field"
                        value={DEMO_MODE ? 1024 : exportEdge}
                        aria-describedby={DEMO_MODE ? 'export-note' : undefined}
                        onChange={e => updateExport({ edge: parseInt(e.target.value) as ExportEdge })}
                    >
                        <option value="1024">1024 px, longest side</option>
                        <option value="2048" disabled={DEMO_MODE}>2048 px, longest side</option>
                        <option value="4096" disabled={DEMO_MODE}>4096 px, longest side</option>
                    </select>
                    {DEMO_MODE && <p className="note" id="export-note">{`Demo: ${DEMO_MAX_EDGE} px, with a watermark.`}</p>}
                </div>
                <button
                    type="button"
                    className={`${isExporting ? 'btn' : 'btn-fill'} btn-wide`}
                    aria-disabled={isExporting}
                    onClick={() => { if (!isExporting) onExport(); }}
                >
                    {isExporting ? 'Exporting…' : 'Export PNG'}
                </button>
            </section>
        </aside>
    );
}
