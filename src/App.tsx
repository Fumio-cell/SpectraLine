import { useCallback, useEffect, useRef, useState } from 'react';
import Opening from './components/Opening';
import Controls from './components/Controls';
import Stage from './components/Stage';
import { AppEngine } from './core/engine';
import { openImage } from './core/input';
import { useAppStore, LOOKS } from './store/useAppStore';
import { DEMO_MODE } from './config';

const ACCEPT = 'image/png,image/jpeg,image/webp';

export default function App() {
    const hasImage = useAppStore(s => !!s.input.file);
    const notice = useAppStore(s => s.notice);
    const [engine, setEngine] = useState<AppEngine | null>(null);
    const [demoLimited, setDemoLimited] = useState(false);
    const [dragging, setDragging] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const onEngineReady = useCallback((e: AppEngine) => setEngine(e), []);
    const openPicker = useCallback(() => fileRef.current?.click(), []);

    const onPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (fileRef.current) fileRef.current.value = '';
        if (file) await openImage(file);
    };

    const handleExport = useCallback(async () => {
        const st = useAppStore.getState();
        if (!engine || !st.input.file || st.isExporting) return;
        const look = LOOKS.find(l => l.presetId === st.activeLookId) ?? LOOKS[0];
        st.setExporting(true);
        try {
            await engine.exportPNG(st.params, ({ width, height }) => `spectraline-${look.slug}-${Math.max(width, height)}.png`);
            if (DEMO_MODE) setDemoLimited(true);
        } catch (err: unknown) {
            useAppStore.getState().setNotice(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            useAppStore.getState().setExporting(false);
        }
    }, [engine]);

    const handleExportVideo = useCallback(async (kind: 'mp4' | 'frames') => {
        const st = useAppStore.getState();
        if (!engine || !st.input.file || st.isExporting) return;
        const look = LOOKS.find(l => l.presetId === st.activeLookId) ?? LOOKS[0];
        const { mode, length } = st.params.motion;
        // The demo build exports 1024 px on the long side, MP4 only; the full build HD or 4K.
        const size = DEMO_MODE ? 'demo' as const : st.videoSize;
        const tag = size === 'demo' ? '1024' : size === 'uhd' ? '4k' : 'hd';
        st.setExporting(true);
        st.setExportKind(kind);
        st.setExportProgress(0);
        const progress = (done: number, total: number) => useAppStore.getState().setExportProgress(done / total);
        try {
            if (kind === 'mp4') await engine.exportMP4(st.params, size, () => `spectraline-${look.slug}-${mode}-${length}s-${tag}.mp4`, progress);
            else await engine.exportFrames(st.params, size, () => `spectraline-${look.slug}-${mode}-${length}s-${tag}-frames.zip`, progress);
        } catch (err: unknown) {
            useAppStore.getState().setNotice(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            useAppStore.getState().setExportProgress(null);
            useAppStore.getState().setExportKind(null);
            useAppStore.getState().setExporting(false);
        }
    }, [engine]);

    // Drop a picture anywhere.
    useEffect(() => {
        const over = (e: DragEvent) => { e.preventDefault(); setDragging(true); };
        const leave = (e: DragEvent) => { if (!e.relatedTarget) setDragging(false); };
        const drop = (e: DragEvent) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer?.files?.[0];
            if (file) void openImage(file);
        };
        window.addEventListener('dragover', over);
        window.addEventListener('dragleave', leave);
        window.addEventListener('drop', drop);
        return () => {
            window.removeEventListener('dragover', over);
            window.removeEventListener('dragleave', leave);
            window.removeEventListener('drop', drop);
        };
    }, []);

    return (
        <div className="app">
            <input ref={fileRef} type="file" accept={ACCEPT} hidden aria-label="Open a picture" onChange={onPicked} />

            {hasImage ? (
                <>
                    <header className="signal-header app-bar">
                        <h1 className="display">SpectraLine</h1>
                        <div className="app-bar-actions">
                            {DEMO_MODE && <span className="control badge">Free preview</span>}
                            <button type="button" className="btn" onClick={openPicker}>Open another picture</button>
                        </div>
                    </header>
                    <div className="workspace">
                        <Controls onExport={handleExport} onExportVideo={handleExportVideo} />
                        <Stage onEngineReady={onEngineReady} demoLimited={demoLimited} />
                    </div>
                </>
            ) : (
                <>
                    <Opening onOpenPicker={openPicker} />
                    {notice && (
                        <div className="notice-bar">
                            <p className="notice" role="alert" data-tone="error">{notice}</p>
                        </div>
                    )}
                </>
            )}

            {dragging && (
                <div className="drop-veil" aria-hidden="true">
                    <p className="display">Drop a picture to draw it</p>
                </div>
            )}
        </div>
    );
}
