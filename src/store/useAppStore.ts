import { create } from 'zustand';
import type { Params, ProjectManifest, Look, LookParams, ProjectInput } from '../core/types';

/** Fixed default so a fresh session is reproducible. Random replaces it with a visible number. */
export const DEFAULT_SEED = 1;

const flow: LookParams = { mode: 'flow', spacing: 2.4, length: 1, calm: 0.12, levels: 46, minLength: 24, width: 1.5 };

const defaultParams: Params = {
    preview: { previewMaxEdge: 1024 },
    maps: {
        colorQuantK: 8,
        colorSmoothing: 0.2,
        gradientGain: 1.5,
        gradientThreshold: 0.05,
        scientificMode: false
    },
    lines: { ...flow, background: 'black', seed: DEFAULT_SEED },
    export: { edge: 2048 }
};

const presets: Look[] = [
    { presetId: 'flow', name: 'FLOW', lines: flow },
    { presetId: 'flow-fine', name: 'FLOW FINE', lines: { ...flow, spacing: 2.4, length: 0.8, width: 0.9 } },
    { presetId: 'flow-bold', name: 'FLOW BOLD', lines: { ...flow, spacing: 2.6, length: 2.2, width: 2.8 } },
    { presetId: 'isolines', name: 'ISOLINES', lines: { ...flow, mode: 'isolines', width: 1.2 } }
];

const LOOK_FIELDS: Array<keyof LookParams> = ['mode', 'spacing', 'length', 'calm', 'levels', 'minLength', 'width'];

interface AppState {
    manifest: ProjectManifest;
    activePresetId: string;
    previewQuality: 'Live' | 'High';
    isProcessing: boolean;
    processingStage: string;
    setManifest: (update: Partial<ProjectManifest>) => void;
    setInput: (input: Partial<ProjectInput>) => void;
    updateParams: (section: keyof Params, update: Record<string, unknown>) => void;
    applyPreset: (presetId: string) => void;
    resetProject: () => void;
    setProcessing: (isProcessing: boolean, stage?: string) => void;
    setPreviewQuality: (quality: 'Live' | 'High') => void;
}

export const useAppStore = create<AppState>((set) => ({
    manifest: {
        version: '1.2',
        projectId: Math.random().toString(36).substring(2, 10),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        input: {},
        params: structuredClone(defaultParams),
        presets: presets
    },
    activePresetId: 'flow',
    previewQuality: 'High',
    isProcessing: false,
    processingStage: '',

    setManifest: (update) => set((state) => ({
        manifest: { ...state.manifest, ...update, updatedAt: new Date().toISOString() }
    })),

    setInput: (inputUpdate) => set((state) => ({
        manifest: {
            ...state.manifest,
            input: { ...state.manifest.input, ...inputUpdate },
            updatedAt: new Date().toISOString()
        }
    })),

    updateParams: (section, update) => set((state) => ({
        manifest: {
            ...state.manifest,
            params: {
                ...state.manifest.params,
                [section]: { ...(state.manifest.params[section] as object), ...update }
            },
            updatedAt: new Date().toISOString()
        },
        // Only a change to the look itself makes it "custom"; seed, background, export do not.
        activePresetId: section === 'lines' && LOOK_FIELDS.some(k => k in update) ? 'custom' : state.activePresetId
    })),

    applyPreset: (presetId) => set((state) => {
        const preset = presets.find(p => p.presetId === presetId);
        if (!preset) return state;

        // A look replaces the drawing settings only; seed, background and export are the user's.
        return {
            activePresetId: presetId,
            manifest: {
                ...state.manifest,
                params: {
                    ...state.manifest.params,
                    lines: { ...state.manifest.params.lines, ...preset.lines }
                },
                updatedAt: new Date().toISOString()
            }
        };
    }),

    resetProject: () => set(() => ({
        activePresetId: 'flow',
        isProcessing: false,
        processingStage: '',
        manifest: {
            version: '1.2',
            projectId: Math.random().toString(36).substring(2, 10),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            input: {},
            params: structuredClone(defaultParams),
            presets: presets
        }
    })),

    setProcessing: (isProcessing, stage = '') => set({ isProcessing, processingStage: stage }),
    setPreviewQuality: (previewQuality) => set({ previewQuality })
}));
