import { useAppStore } from '../store/useAppStore';

/** The one bundled picture. Credited the way Image-Flow credits its samples. */
export const SAMPLE = {
    path: 'sample/sample-4.webp',
    filename: 'sample-4.webp',
    credit: 'Sample image by Miho Morita.',
    alt: 'A painted pink flower with gold petals'
};

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_EDGE = 8192;

/** Check a picture and make it the current one. Problems become a message on the page. */
export async function openImage(file: File, isSample = false): Promise<void> {
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
    setInput({ file, filename: file.name, width: size.w, height: size.h, previewUrl: url, isSample });
}

/** Load the bundled sample from this site (no other host is involved). */
export async function loadSample(): Promise<void> {
    const { setNotice } = useAppStore.getState();
    try {
        const res = await fetch(`${import.meta.env.BASE_URL}${SAMPLE.path}`);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        await openImage(new File([blob], SAMPLE.filename, { type: blob.type || 'image/webp' }), true);
    } catch {
        setNotice('The sample could not be loaded.');
    }
}
