import { create } from 'zustand';
import { DEFAULT_CONTRAST } from '../core/lines/raster';
import { DEFAULT_SCALE } from '../core/lines/field';
import { LENGTH_DEFAULT } from '../core/lines/motion';
import type { Params, Look, LookParams, ProjectInput } from '../core/types';
import type { SpectrumCell } from '../core/lines/spectrum';

/** Fixed default so a fresh session is reproducible. Random replaces it with a visible number. */
export const DEFAULT_SEED = 1;

const flow: LookParams = { mode: 'flow', spacing: 2.4, length: 1, calm: 0.04, bands: 9, levels: 46, minLength: 24, width: 1.5 };

const defaultParams: Params = {
    lines: { ...flow, background: 'black', seed: DEFAULT_SEED, contrast: DEFAULT_CONTRAST, scale: DEFAULT_SCALE, solo: [] },
    motion: { mode: 'still', length: LENGTH_DEFAULT },
    export: { edge: 2048 }
};

/**
 * The four looks. The ids (presetId) are the ones SL-1 and SL-2 used and stay stable; only the
 * names the person sees, and the file-name slugs, changed.
 */
export const LOOKS: Look[] = [
    { presetId: 'flow', name: 'CURRENT', note: 'the flow of form', slug: 'current', lines: flow },
    { presetId: 'flow-bold', name: 'RIPTIDE', note: 'only the strongest pull', slug: 'riptide', lines: { ...flow, spacing: 2.3, length: 3, width: 3.4 } },
    { presetId: 'isolines', name: 'TOPO', note: 'light, mapped as terrain', slug: 'topo', lines: { ...flow, mode: 'isolines', width: 1.2 } },
    { presetId: 'spectrum', name: 'PRISM', note: 'light, split by wavelength', slug: 'prism', lines: { ...flow, mode: 'spectrum', spacing: 2.2, calm: 0, width: 1.5 } }
];

interface AppState {
    input: ProjectInput;
    params: Params;
    activeLookId: string;
    isProcessing: boolean;
    isExporting: boolean;
    /** MOTION: the stage is playing (false = paused on the current frame). */
    playing: boolean;
    /** Progress of a video export, 0..1, or null when none is running. */
    exportProgress: number | null;
    /** A message shown on the page (errors and notes), or null. */
    notice: string | null;
    /** PRISM: the picture's own measured spectrum (one cell per band), once the worker has it. */
    spectrum: SpectrumCell[] | null;
    setInput: (input: Partial<ProjectInput>) => void;
    updateLines: (update: Partial<Params['lines']>) => void;
    updateExport: (update: Partial<Params['export']>) => void;
    updateMotion: (update: Partial<Params['motion']>) => void;
    setPlaying: (playing: boolean) => void;
    setExportProgress: (p: number | null) => void;
    applyLook: (lookId: string) => void;
    setProcessing: (isProcessing: boolean) => void;
    setExporting: (isExporting: boolean) => void;
    setNotice: (notice: string | null) => void;
    setSpectrum: (cells: SpectrumCell[] | null) => void;
    toggleBand: (band: number) => void;
    clearSolo: () => void;
}

export const useAppStore = create<AppState>((set) => ({
    input: {},
    params: structuredClone(defaultParams),
    activeLookId: 'flow',
    isProcessing: false,
    isExporting: false,
    playing: true,
    exportProgress: null,
    notice: null,
    spectrum: null,

    // A new picture clears the notice, the measured spectrum and any soloed bands.
    setInput: (input) => set((state) => ({
        input: { ...state.input, ...input },
        notice: null,
        spectrum: null,
        params: { ...state.params, lines: { ...state.params.lines, solo: [] } }
    })),

    updateLines: (update) => set((state) => ({ params: { ...state.params, lines: { ...state.params.lines, ...update } } })),

    updateExport: (update) => set((state) => ({ params: { ...state.params, export: { ...state.params.export, ...update } } })),

    updateMotion: (update) => set((state) => ({ params: { ...state.params, motion: { ...state.params.motion, ...update } } })),
    setPlaying: (playing) => set({ playing }),
    setExportProgress: (exportProgress) => set({ exportProgress }),

    // A look sets the drawing parameters it defines; seed, background, contrast and export size stay as chosen.
    applyLook: (lookId) => set((state) => {
        const look = LOOKS.find(l => l.presetId === lookId);
        if (!look) return {};
        return { activeLookId: lookId, params: { ...state.params, lines: { ...state.params.lines, ...look.lines } } };
    }),

    setProcessing: (isProcessing) => set({ isProcessing }),
    setExporting: (isExporting) => set({ isExporting }),
    setNotice: (notice) => set({ notice }),
    setSpectrum: (spectrum) => set({ spectrum }),

    // Click a band to draw only it; click more to add; click a shown one to take it out; none = every band.
    toggleBand: (band) => set((state) => {
        const cur = state.params.lines.solo;
        const next = cur.length === 0 ? [band] : cur.includes(band) ? cur.filter(b => b !== band) : [...cur, band].sort((a, b) => a - b);
        return { params: { ...state.params, lines: { ...state.params.lines, solo: next } } };
    }),
    clearSolo: () => set((state) => ({ params: { ...state.params, lines: { ...state.params.lines, solo: [] } } }))
}));
