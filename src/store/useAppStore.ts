import { create } from 'zustand';
import type { Params, ProjectManifest, Preset, ProjectInput } from '../core/types';

const defaultParams: Params = {
    preview: { previewMaxEdge: 2048 },
    maps: {
        colorQuantK: 8,
        colorSmoothing: 0.2,
        gradientGain: 1.0,
        gradientThreshold: 0.05,
        contoursEnabled: false,
        contourLevels: 12,
        contourSmoothing: 0.4,
        scientificMode: false
    },
    lines: {
        sourceMode: 'Hybrid',
        edgeThreshold: 0.08,
        strokeDensity: 1.0,
        strokeLength: 150,
        widthMin: 0.5,
        widthMax: 1.5,
        pressureTaper: 0.6,
        wobbleAmp: 0.4,
        wobbleFreq: 2.0,
        randomness: 10,
        seed: 0
    },
    inkBlur: {
        bleedAmountPx: 0,
        bleedBlurPx: 0,
        bleedOpacityPct: 0,
        bleedMode: 'Normal',
        finalBlurPx: 0
    },
    export: {
        scale: 1,
        maxEdge: 8192,
        targets: ['lines']
    }
};

const presets: Preset[] = [
    { presetId: 'default', name: 'Default', params: defaultParams },
    {
        presetId: 'clean-ink',
        name: 'Clean Ink',
        params: {
            ...defaultParams,
            lines: { ...defaultParams.lines, strokeDensity: 2.0, strokeLength: 300, wobbleAmp: 0.1, randomness: 3, widthMin: 0.3, widthMax: 1.0 },
            inkBlur: { ...defaultParams.inkBlur, bleedAmountPx: 0, bleedBlurPx: 0, bleedOpacityPct: 0 }
        }
    },
    {
        presetId: 'pencil-sketch',
        name: 'Pencil Sketch',
        params: {
            ...defaultParams,
            lines: { ...defaultParams.lines, strokeDensity: 5.0, strokeLength: 500, widthMin: 0.3, widthMax: 1.2, wobbleAmp: 0.6, randomness: 15 },
            inkBlur: { ...defaultParams.inkBlur, bleedAmountPx: 0.3, bleedBlurPx: 0.5, bleedOpacityPct: 8 }
        }
    },
    {
        presetId: 'topo-map',
        name: 'Topo Map',
        params: {
            ...defaultParams,
            maps: { ...defaultParams.maps, contoursEnabled: true, contourLevels: 24 },
            lines: { ...defaultParams.lines, sourceMode: 'Contours', strokeDensity: 1.4, wobbleAmp: 0.4, randomness: 8 },
            inkBlur: { ...defaultParams.inkBlur, bleedAmountPx: 1, bleedBlurPx: 1, bleedOpacityPct: 10 }
        }
    },
    {
        presetId: 'glitchy',
        name: 'Glitchy Analog',
        params: {
            ...defaultParams,
            lines: { ...defaultParams.lines, wobbleAmp: 2.2, wobbleFreq: 7, randomness: 55, strokeDensity: 1.3 },
            inkBlur: { ...defaultParams.inkBlur, bleedAmountPx: 2, bleedBlurPx: 2.5, bleedOpacityPct: 20 }
        }
    },
    {
        presetId: 'wet-ink',
        name: 'Wet Ink',
        params: {
            ...defaultParams,
            lines: { ...defaultParams.lines, widthMax: 5.5, pressureTaper: 0.7, strokeDensity: 1.0 },
            inkBlur: { ...defaultParams.inkBlur, bleedAmountPx: 6, bleedBlurPx: 6, bleedOpacityPct: 45, bleedMode: 'Multiply' }
        }
    }
];

interface AppState {
    manifest: ProjectManifest;
    activePresetId: string;
    setManifest: (update: Partial<ProjectManifest>) => void;
    setInput: (input: Partial<ProjectInput>) => void;
    updateParams: (section: keyof Params, update: any) => void;
    applyPreset: (presetId: string) => void;
    resetProject: () => void;
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
    activePresetId: 'default',

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
                [section]: { ...(state.manifest.params as any)[section], ...update }
            },
            updatedAt: new Date().toISOString()
        },
        activePresetId: 'custom' // mark as custom when manually changed
    })),

    applyPreset: (presetId) => set((state) => {
        const preset = presets.find(p => p.presetId === presetId);
        if (!preset) return state;

        return {
            activePresetId: presetId,
            manifest: {
                ...state.manifest,
                params: structuredClone(preset.params),
                updatedAt: new Date().toISOString()
            }
        };
    }),

    resetProject: () => set(() => ({
        activePresetId: 'default',
        manifest: {
            version: '1.2',
            projectId: Math.random().toString(36).substring(2, 10),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            input: {},
            params: structuredClone(defaultParams),
            presets: presets
        }
    }))
}));
