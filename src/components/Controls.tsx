import { useAppStore, LOOKS } from '../store/useAppStore';
import { DEMO_MODE, DEMO_MAX_EDGE } from '../config';
import type { ExportEdge } from '../core/types';
import type { SpectrumCell } from '../core/lines/spectrum';

interface ControlsProps {
    onExport: () => void;
}

function cellName(cell: SpectrumCell): string {
    return cell.wl === null ? 'Purples' : `${Math.round(cell.wl)} nm`;
}

export default function Controls({ onExport }: ControlsProps) {
    const lines = useAppStore(s => s.params.lines);
    const exportEdge = useAppStore(s => s.params.export.edge);
    const activeLookId = useAppStore(s => s.activeLookId);
    const isExporting = useAppStore(s => s.isExporting);
    const spectrum = useAppStore(s => s.spectrum);
    const applyLook = useAppStore(s => s.applyLook);
    const updateLines = useAppStore(s => s.updateLines);
    const updateExport = useAppStore(s => s.updateExport);
    const toggleBand = useAppStore(s => s.toggleBand);
    const clearSolo = useAppStore(s => s.clearSolo);

    const isPrism = lines.mode === 'spectrum';
    const solo = lines.solo;
    const tallest = spectrum ? Math.max(...spectrum.map(c => c.share), 1e-9) : 1;

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
                        <label className="field-label" htmlFor="scale">Scale</label>
                        <span className="field-value" id="scale-note">Fine to broad</span>
                    </div>
                    <input
                        id="scale" type="range" min="0" max="1" step="0.01"
                        value={lines.scale}
                        aria-describedby="scale-note"
                        aria-valuetext={lines.scale < 0.34 ? 'fine' : lines.scale > 0.66 ? 'broad' : 'medium'}
                        onChange={e => updateLines({ scale: parseFloat(e.target.value) })}
                    />
                </div>

                <div className="field-group">
                    <div className="field-head">
                        <label className="field-label" htmlFor="contrast">Contrast</label>
                        <span className="field-value">{lines.contrast.toFixed(2)}</span>
                    </div>
                    <input
                        id="contrast" type="range" min="0" max="2" step="0.05"
                        value={lines.contrast}
                        onChange={e => updateLines({ contrast: parseFloat(e.target.value) })}
                    />
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

            {isPrism && (
                <section className="section" aria-labelledby="spectrum-title">
                    <div className="field-head">
                        <h2 className="section-title" id="spectrum-title">Spectrum of this picture</h2>
                        <button type="button" className="btn btn-small" aria-pressed={solo.length === 0} onClick={clearSolo}>All</button>
                    </div>
                    <div className="strip" role="group" aria-labelledby="spectrum-title">
                        {spectrum
                            ? spectrum.map((cell, k) => {
                                const picked = solo.includes(k);
                                const dim = solo.length > 0 && !picked;
                                return (
                                    <button
                                        key={k}
                                        type="button"
                                        className="strip-cell"
                                        aria-pressed={picked}
                                        aria-label={`${cellName(cell)}, ${(cell.share * 100).toFixed(1)}% of the picture's light`}
                                        title={`${cellName(cell)}: ${(cell.share * 100).toFixed(1)}%`}
                                        onClick={() => toggleBand(k)}
                                    >
                                        <span
                                            className="strip-bar"
                                            style={{
                                                height: `${Math.max(4, (cell.share / tallest) * 100)}%`,
                                                background: `rgb(${cell.colour[0]} ${cell.colour[1]} ${cell.colour[2]})`,
                                                opacity: dim ? 0.35 : 1
                                            }}
                                        />
                                    </button>
                                );
                            })
                            : <p className="note">Measuring…</p>}
                    </div>
                    <p className="note">430 nm to 630 nm, then purples.</p>
                </section>
            )}

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
