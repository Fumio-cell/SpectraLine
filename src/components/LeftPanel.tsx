import { Upload, Image as ImageIcon, FileOutput } from 'lucide-react';
import React, { useRef } from 'react';
import { useAppStore } from '../store/useAppStore';

const LeftPanel = () => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const setInput = useAppStore(state => state.setInput);
    const inputInfo = useAppStore(state => state.manifest.input);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.size > 26214400) {
                alert('File size exceeds 25MB limit.');
                return;
            }

            const img = new Image();
            img.onload = () => {
                if (img.width > 8192 || img.height > 8192) {
                    alert('Image dimensions exceed 8192px max edge.');
                    return;
                }

                setInput({
                    file: file,
                    filename: file.name,
                    mimeType: file.type as 'image/jpeg' | 'image/png',
                    width: img.width,
                    height: img.height,
                    byteSize: file.size,
                    previewUrl: URL.createObjectURL(file)
                });
            };
            img.src = URL.createObjectURL(file);
        }
    };

    return (
        <div className="left-panel">

            <div style={{ marginBottom: '2rem' }}>
                <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '1rem' }}>File</h3>

                <input
                    type="file"
                    accept="image/png, image/jpeg"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                />

                <div
                    className="upload-card"
                    onClick={() => fileInputRef.current?.click()}
                    style={inputInfo.file ? { borderColor: 'var(--accent-color)', backgroundColor: 'rgba(100, 108, 255, 0.05)' } : {}}
                >
                    {inputInfo.file ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                            <img src={inputInfo.previewUrl} alt="Preview" style={{ maxWidth: '100%', maxHeight: '100px', objectFit: 'contain' }} />
                            <span style={{ fontSize: '0.8rem', fontWeight: 500, wordBreak: 'break-all' }}>{inputInfo.filename}</span>
                            <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>{inputInfo.width}x{inputInfo.height}</span>
                        </div>
                    ) : (
                        <>
                            <Upload className="upload-icon" />
                            <div>
                                <span style={{ display: 'block', fontWeight: 500 }}>Drop an image here</span>
                                <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>or click to browse</span>
                            </div>
                            <span style={{ fontSize: '0.7rem' }}>Max 8192px / 25MB (PNG/JPG)</span>
                        </>
                    )}
                </div>
            </div>

            <div style={{ marginBottom: '2rem' }}>
                <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '1rem' }}>Presets</h3>
                <div className="preset-list">
                    {/* Managed in TopBar now, but keeping layout as specified */}
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Use top bar to select preset</div>
                </div>
            </div>

            <div>
                <h3 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '1rem' }}>Outputs</h3>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <FileOutput size={14} /> lines.png
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <ImageIcon size={14} /> maps_gradient.png
                    </div>
                </div>
            </div>

        </div>
    );
};

export default LeftPanel;
