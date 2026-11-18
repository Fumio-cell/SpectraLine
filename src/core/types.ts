export interface MapParams {
    colorQuantK: number;
    colorSmoothing: number;
    gradientGain: number;
    gradientThreshold: number;
    scientificMode: boolean;
}

/** FLOW follows the edge-tangent field; ISOLINES traces contours of luminance. */
export type LineMode = 'flow' | 'isolines' | 'spectrum';
export type Background = 'black' | 'transparent';

/** The part of the line settings that a "look" defines. */
export interface LookParams {
    mode: LineMode;
    /** FLOW: distance between neighbouring lines, in line widths. */
    spacing: number;
    /** FLOW: length multiplier. */
    length: number;
    /** FLOW: share of ink kept in flat areas (0 = none, 1 = as dense as everywhere). */
    calm: number;
    /** SPECTRUM: number of wavelength bands (a further band holds the purples). */
    bands: number;
    /** ISOLINES: number of luminance levels. */
    levels: number;
    /** ISOLINES: shortest contour kept, in px at a 1024 px long edge. */
    minLength: number;
    /** Line width in px at a 1024 px long edge. */
    width: number;
}

export interface LineParams extends LookParams {
    background: Background;
    /** Same image + settings + seed always give the same pixels. */
    seed: number;
}

export type ExportEdge = 1024 | 2048 | 4096;

export interface Params {
    preview: {
        previewMaxEdge: number;
    };
    maps: MapParams;
    lines: LineParams;
    export: {
        edge: ExportEdge;
    };
}

export interface Look {
    presetId: string;
    name: string;
    lines: LookParams;
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
    presets: Look[];
    outputs?: {
        linesPngKey?: string;
        maps?: {
            gradientPngKey?: string;
            colorPngKey?: string;
            contoursPngKey?: string;
        };
    };
}
