import { LOOKS } from '../store/useAppStore';
import { SAMPLE, loadSample } from '../core/input';

/**
 * The first screen: says what the tool does without a file. The two pictures are shipped with the
 * tool: the sample, and the PRISM drawing SpectraLine made from it.
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
                <p className="note">Open a picture, or try the sample. It is drawn in your browser; nothing is uploaded.</p>
                <div className="opening-actions">
                    <button type="button" className="btn-fill" onClick={() => { void loadSample(); }}>Try a sample</button>
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
            <section className="opening-stage" aria-label="Example">
                <figure>
                    <img src={`${base}sample/example-original.webp`} alt={SAMPLE.alt} width={800} height={800} decoding="async" />
                    <figcaption className="note">The picture</figcaption>
                </figure>
                <figure>
                    <img src={`${base}sample/example-prism.webp`} alt="The same picture drawn as lines in the colours of its light" width={800} height={800} decoding="async" />
                    <figcaption className="note">PRISM</figcaption>
                </figure>
                <p className="note opening-credit">{SAMPLE.credit}</p>
            </section>
        </main>
    );
}
