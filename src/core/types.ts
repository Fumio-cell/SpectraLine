export interface MapParams {
    colorQuantK: number;
    colorSmoothing: number;
    gradientGain: number;
    gradientThreshold: number;
    contoursEnabled: boolean;
    contourLevels: number;
    contourSmoothing: number;
    scientificMode: boolean;
}

export interface LineParams {
    sourceMode: 'Edges' | 'Contours' | 'Hybrid';
    edgeThreshold: number;
    strokeDensity: number;
    strokeLength: number;
    widthMin: number;
    widthMax: number;
    pressureTaper: number;
    wobbleAmp: number;
    wobbleFreq: number;
    randomness: number;
    seed: number;
}

export interface InkBlurParams {
    bleedAmountPx: number;
    bleedBlurPx: number;
    bleedOpacityPct: number;
    bleedMode: 'Normal' | 'Multiply';
    finalBlurPx: number;
}

export interface Params {
    preview: {
        previewMaxEdge: number;
    };
    maps: MapParams;
    lines: LineParams;
    inkBlur: InkBlurParams;
    export: {
        scale: 1 | 2 | 3 | 4;
        maxEdge: 8192;
        targets: Array<'lines' | 'mapGradient' | 'mapColor' | 'mapContours'>;
    };
}

export interface Preset {
    presetId: string;
    name: string;
    params: Params;
}

export interface ProjectInput {
    assetKey?: string; // Blob/IDB key for original image
    file?: File; // Runtime reference
    filename?: string;
    mimeType?: 'image/jpeg' | 'image/png';
    width?: number;
    height?: number;
    byteSize?: number;
    previewUrl?: string; // Base64 or Object URl
}

export interface ProjectManifest {
    version: '1.2';
    projectId: string;
    createdAt: string;
    updatedAt: string;
    input: ProjectInput;
    params: Params;
    presets: Preset[];
    outputs?: {
        linesPngKey?: string;
        maps?: {
            gradientPngKey?: string;
            colorPngKey?: string;
            contoursPngKey?: string;
        };
    };
}
