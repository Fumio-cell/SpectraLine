/** flow = CURRENT and RIPTIDE, isolines = TOPO, spectrum = PRISM (ids stay as they were). */
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
    /** Exponent of the energy -> brightness/width curve (0 = flat). Display only: never retraces. */
    contrast: number;
    /** Same image + settings + seed always give the same pixels. */
    seed: number;
}

export type ExportEdge = 1024 | 2048 | 4096;

export interface Params {
    lines: LineParams;
    export: {
        edge: ExportEdge;
    };
}

export interface Look {
    /** Stable id (flow, flow-bold, isolines, spectrum); the shown name is `name`. */
    presetId: string;
    name: string;
    /** One line under the name. */
    note: string;
    /** File-name part of the exported PNG. */
    slug: string;
    lines: LookParams;
}

export interface ProjectInput {
    file?: File;
    filename?: string;
    width?: number;
    height?: number;
    /** Object URL of the picture, for the Original view. */
    previewUrl?: string;
    /** True while the picture is the bundled sample (its credit is shown). */
    isSample?: boolean;
}
