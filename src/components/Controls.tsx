import { useAppStore, LOOKS } from '../store/useAppStore';
import { DEMO_MODE, DEMO_MAX_EDGE } from '../config';
import type { ExportEdge, MotionMode } from '../core/types';
import { LENGTH_MAX, LENGTH_MIN } from '../core/lines/motion';
import type { SpectrumCell } from '../core/lines/spectrum';

interface ControlsProps {
    onExport: () => void;
    onExportVideo: () => void;
}

const MOTIONS: { id: MotionMode; label: string; note: string }[] = [
    { id: 'still', label: 'Still', note: 'The drawing, at rest.' },
    { id: 'emerge', label: 'Emerge', note: 'Each line grows along its flow.' },
    { id: 'pulse', label: 'Pulse', note: 'Light travels along each line, and loops.' }
];

function cellName(cell: SpectrumCell): string {
    return cell.wl === null ? 'Purples' : `${Math.round(cell.wl)} nm`;
}

export default function Controls({ onExport, onExportVideo }: ControlsProps) {
    const lines = useAppStore(s => s.params.lines);
    const exportEdge = useAppStore(s => s.params.export.edge);
    const activeLookId = useAppStore(s => s.activeLookId);
    const isExporting = useAppStore(s => s.isExporting);
    const spectrum = useAppStore(s => s.spectrum);
    const motion = useAppStore(s => s.params.motion);
    const exportProgress = useAppStore(s => s.exportProgress);
    const updateMotion = useAppStore(s => s.updateMotion);
    const applyLook = useAppStore(s => s.applyLook);
    const updateLines = useAppStore(s => s.updateLines);
    const updateExport = useAppStore(s => s.updateExport);
    const toggleBand = useAppStore(s => s.toggleBand);
    const clearSolo = useAppStore(s => s.clearSolo);

    const isPrism = lines.mode === 'spectrum';
    const moving = motion.mode !== 'still';
    const videoOn = moving && !DEMO_MODE;
    const exportingVideo = exportProgress !== null;
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

            <section className="section" aria-labelledby="motion-title">
                <div className="field-head">
                    <h2 className="section-title" id="motion-title">Motion</h2>
                    <div className="motion-chips" role="group" aria-labelledby="motion-title">
                        {MOTIONS.map(m => (
                            <button
                                key={m.id}
                                type="button"
                                className="chip"
                                aria-pressed={motion.mode === m.id}
                                title={m.note}
                                onClick={() => updateMotion({ mode: m.id })}
                            >
                                {m.label}
                            </button>
                        ))}
                    </div>
                </div>
                {moving && (
                    <div className="field-group">
                        <div className="field-head">
                            <label className="field-label" htmlFor="length">Length</label>
                            <span className="field-value">{motion.length} s</span>
                        </div>
                        <input
                            id="length" type="range" min={LENGTH_MIN} max={LENGTH_MAX} step="1"
                            value={motion.length}
                            onChange={e => updateMotion({ length: parseInt(e.target.value) })}
                        />
                    </div>
                )}
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
                {videoOn && (
                    <>
                        <p className="note" id="video-note">MP4: 1080 px, 30 fps, no sound, on black.</p>
                        <button
                            type="button"
                            className="btn-fill btn-wide"
                            aria-disabled={isExporting}
                            aria-describedby="video-note"
                            onClick={() => { if (!isExporting) onExportVideo(); }}
                        >
                            {exportingVideo ? `Exporting ${Math.round((exportProgress ?? 0) * 100)} %` : 'Export MP4'}
                        </button>
                    </>
                )}
                {moving && DEMO_MODE && <p className="note">Video export is part of the full version.</p>}
                <button
                    type="button"
                    className={`${videoOn || isExporting ? 'btn' : 'btn-fill'} btn-wide`}
                    aria-disabled={isExporting}
                    onClick={() => { if (!isExporting) onExport(); }}
                >
                    {isExporting && !exportingVideo ? 'Exporting…' : 'Export PNG'}
                </button>
            </section>
        </aside>
    );
}
