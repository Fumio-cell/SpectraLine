import { LOOKS } from '../store/useAppStore';
import { SAMPLES, SAMPLE_CREDIT, loadSample } from '../core/input';

/**
 * The first screen: says what the tool does without a file. It shows the three bundled pictures,
 * each beside the PRISM drawing SpectraLine made from it, so the range is visible before anything loads.
 */
export default function Opening({ onOpenPicker }: { onOpenPicker: () => void }) {
    const base = import.meta.env.BASE_URL;
    return (
        <main className="opening" id="main">
            <section className="opening-text" aria-label="SpectraLine">
                <h1 className="display">SpectraLine</h1>
                <p className="display opening-line">
                    Every picture holds a current and a spectrum.<br />
                    SpectraLine draws them. Nothing added.
                </p>
                <p className="note">Open a picture, or try a sample. It is drawn in your browser; nothing is uploaded.</p>
                <div className="opening-actions">
                    <button type="button" className="btn-fill" onClick={() => { void loadSample('flower'); }}>Try a sample</button>
                    <button type="button" className="btn" onClick={onOpenPicker}>Open a picture</button>
                </div>
                <ul className="looklist" aria-label="The four looks">
                    {LOOKS.map(look => (
                        <li key={look.presetId}>
                            <span className="control look-name">{look.name}</span>
                            <span className="note">{look.note}</span>
                        </li>
                    ))}
                </ul>
            </section>
            <section className="opening-stage" aria-label="Samples">
                <ul className="samples">
                    {SAMPLES.map(sample => (
                        <li key={sample.id} className="sample">
                            <button type="button" className="sample-pick" aria-label={`Try the ${sample.name} sample`} onClick={() => { void loadSample(sample.id); }}>
                                <img src={`${base}sample/example-${sample.id}-original.webp`} alt={sample.alt} width={600} height={600} decoding="async" />
                            </button>
                            <img src={`${base}sample/example-${sample.id}-prism.webp`} alt={`The ${sample.name} sample drawn by PRISM`} width={600} height={600} decoding="async" />
                            <span className="control sample-name">{sample.name}</span>
                        </li>
                    ))}
                </ul>
                <p className="note">{SAMPLE_CREDIT}</p>
            </section>
        </main>
    );
}
