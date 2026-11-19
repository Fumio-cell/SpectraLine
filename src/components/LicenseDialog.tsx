import { useEffect, useRef, useState } from 'react';
import { useLicense, activate, deactivate, CHECKOUT_URL } from '../lib/license';

interface LicenseDialogProps {
    onClose: () => void;
}

export default function LicenseDialog({ onClose }: LicenseDialogProps) {
    const unlocked = useLicense(s => s.unlocked);
    const keyTail = useLicense(s => s.keyTail);
    const busy = useLicense(s => s.busy);
    const error = useLicense(s => s.error);
    const [key, setKey] = useState('');
    const headingRef = useRef<HTMLHeadingElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Focus goes into the dialog when it opens, and again when the view changes (unlocked or locked).
    useEffect(() => {
        (unlocked ? headingRef : inputRef).current?.focus();
    }, [unlocked]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        void activate(key);
    };

    return (
        <div className="dialog-scrim" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="dialog license-dialog" role="dialog" aria-modal="true" aria-labelledby="license-title">
                <h2 className="section-title" id="license-title" tabIndex={-1} ref={headingRef}>
                    {unlocked ? 'Full version' : 'Unlock SpectraLine'}
                </h2>

                {unlocked ? (
                    <>
                        <p>The full version is active on this computer.</p>
                        <p className="note">License key ending in {keyTail}</p>
                        <div className="license-actions">
                            <button type="button" className="btn" aria-disabled={busy} onClick={() => { void deactivate(); }}>
                                {busy ? 'Deactivating…' : 'Deactivate on this computer'}
                            </button>
                        </div>
                    </>
                ) : (
                    <form onSubmit={submit} noValidate>
                        <p>Enter your license key to export at full size, without the watermark.</p>
                        <div className="field-group">
                            <label className="field-label" htmlFor="license-key">License key</label>
                            <input
                                id="license-key" ref={inputRef} className="field" type="text"
                                autoComplete="off" autoCapitalize="off" spellCheck={false}
                                value={key} onChange={e => setKey(e.target.value)}
                            />
                        </div>
                        <div className="license-actions">
                            <button type="submit" className="btn-fill" aria-disabled={busy}>{busy ? 'Checking…' : 'Activate'}</button>
                            <a className="btn" href={CHECKOUT_URL} target="_blank" rel="noopener noreferrer">Buy SpectraLine</a>
                        </div>
                    </form>
                )}

                {error && <p className="notice" data-tone="error" role="alert">{error}</p>}

                {!unlocked && (
                    <p className="note">
                        Your images never leave your computer. To check a key, the app sends only the key to Lemon Squeezy, our payment provider.
                    </p>
                )}

                <div className="license-actions">
                    <button type="button" className="btn" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
}
