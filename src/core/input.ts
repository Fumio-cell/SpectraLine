import { useAppStore } from '../store/useAppStore';

/** The credit line for the bundled pictures, as Image-Flow credits them. */
export const SAMPLE_CREDIT = 'Sample image by Miho Morita.';

/** Three bundled pictures of different character. */
export const SAMPLES = [
    { id: 'flower', name: 'Flower', file: 'sample-4.webp', alt: 'A painted pink flower with gold petals' },
    { id: 'portrait', name: 'Portrait', file: 'sample-5.webp', alt: 'A pale painted portrait of a face with red lips' },
    { id: 'fluid', name: 'Fluid', file: 'sample-3.webp', alt: 'Swirling blue, cyan and orange fluid on a dark ground' }
] as const;

export type SampleId = typeof SAMPLES[number]['id'];

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_EDGE = 8192;

/** Check a picture and make it the current one. Problems become a message on the page. */
export async function openImage(file: File, sampleId?: SampleId): Promise<void> {
    const { setInput, setNotice } = useAppStore.getState();
    if (!file.type.startsWith('image/')) {
        setNotice('That file is not a picture. Open a PNG, JPEG or WebP.');
        return;
    }
    if (file.size > MAX_BYTES) {
        setNotice('That picture is larger than 25 MB.');
        return;
    }
    const url = URL.createObjectURL(file);
    const size = await new Promise<{ w: number; h: number } | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve(null);
        img.src = url;
    });
    if (!size) {
        URL.revokeObjectURL(url);
        setNotice('That picture could not be read.');
        return;
    }
    if (size.w > MAX_EDGE || size.h > MAX_EDGE) {
        URL.revokeObjectURL(url);
        setNotice('That picture is larger than 8192 px on its long side.');
        return;
    }
    const previous = useAppStore.getState().input.previewUrl;
    if (previous) URL.revokeObjectURL(previous);
    setInput({ file, filename: file.name, width: size.w, height: size.h, previewUrl: url, sampleId });
}

/** Load a bundled sample from this site (no other host is involved). */
export async function loadSample(id: SampleId = 'flower'): Promise<void> {
    const { setNotice } = useAppStore.getState();
    const sample = SAMPLES.find(x => x.id === id) ?? SAMPLES[0];
    try {
        const res = await fetch(`${import.meta.env.BASE_URL}sample/${sample.file}`);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        await openImage(new File([blob], sample.file, { type: blob.type || 'image/webp' }), sample.id);
    } catch {
        setNotice('The sample could not be loaded.');
    }
}
