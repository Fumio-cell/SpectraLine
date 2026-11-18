import { create } from 'zustand';
import { DEFAULT_CONTRAST } from '../core/lines/raster';
import type { Params, Look, LookParams, ProjectInput } from '../core/types';

/** Fixed default so a fresh session is reproducible. Random replaces it with a visible number. */
export const DEFAULT_SEED = 1;

const flow: LookParams = { mode: 'flow', spacing: 2.4, length: 1, calm: 0.04, bands: 9, levels: 46, minLength: 24, width: 1.5 };

const defaultParams: Params = {
    lines: { ...flow, background: 'black', seed: DEFAULT_SEED, contrast: DEFAULT_CONTRAST },
    export: { edge: 2048 }
};

/**
 * The four looks. The ids (presetId) are the ones SL-1 and SL-2 used and stay stable; only the
 * names the person sees, and the file-name slugs, changed.
 */
export const LOOKS: Look[] = [
    { presetId: 'flow', name: 'CURRENT', note: 'the flow of form', slug: 'current', lines: flow },
    { presetId: 'flow-bold', name: 'RIPTIDE', note: 'only the strongest pull', slug: 'riptide', lines: { ...flow, spacing: 2.6, length: 3, width: 3.4 } },
    { presetId: 'isolines', name: 'TOPO', note: 'light, mapped as terrain', slug: 'topo', lines: { ...flow, mode: 'isolines', width: 1.2 } },
    { presetId: 'spectrum', name: 'PRISM', note: 'light, split by wavelength', slug: 'prism', lines: { ...flow, mode: 'spectrum', calm: 0, width: 1.5 } }
];

interface AppState {
    input: ProjectInput;
    params: Params;
    activeLookId: string;
    isProcessing: boolean;
    isExporting: boolean;
    /** A message shown on the page (errors and notes), or null. */
    notice: string | null;
    setInput: (input: Partial<ProjectInput>) => void;
    updateLines: (update: Partial<Params['lines']>) => void;
    updateExport: (update: Partial<Params['export']>) => void;
    applyLook: (lookId: string) => void;
    setProcessing: (isProcessing: boolean) => void;
    setExporting: (isExporting: boolean) => void;
    setNotice: (notice: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
    input: {},
    params: structuredClone(defaultParams),
    activeLookId: 'flow',
    isProcessing: false,
    isExporting: false,
    notice: null,

    setInput: (input) => set((state) => ({ input: { ...state.input, ...input }, notice: null })),

    updateLines: (update) => set((state) => ({ params: { ...state.params, lines: { ...state.params.lines, ...update } } })),

    updateExport: (update) => set((state) => ({ params: { ...state.params, export: { ...state.params.export, ...update } } })),

    // A look sets the drawing parameters it defines; seed, background, contrast and export size stay as chosen.
    applyLook: (lookId) => set((state) => {
        const look = LOOKS.find(l => l.presetId === lookId);
        if (!look) return {};
        return { activeLookId: lookId, params: { ...state.params, lines: { ...state.params.lines, ...look.lines } } };
    }),

    setProcessing: (isProcessing) => set({ isProcessing }),
    setExporting: (isExporting) => set({ isExporting }),
    setNotice: (notice) => set({ notice })
}));
