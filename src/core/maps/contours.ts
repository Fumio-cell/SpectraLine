/**
 * Marching Squares implementation to generate isolines (contours) from the luminance map.
 */

export interface Polyline {
    points: { x: number; y: number }[];
    isClosed: boolean;
    value: number; // The contour level
}

export function generateContours(
    luminance: Float32Array,
    width: number,
    height: number,
    levels: number,
    _smoothing: number
): Polyline[] {
    const contours: Polyline[] = [];

    // Define target thresholds based on levels
    const thresholds: number[] = [];
    for (let i = 1; i <= levels; i++) {
        thresholds.push(i / (levels + 1));
    }

    // Pre-calculate edge interpolations
    const getInterpolatedPoint = (v1: number, v2: number, t: number, x1: number, y1: number, x2: number, y2: number) => {
        if (Math.abs(v1 - v2) < 0.0001) return { x: x1, y: y1 };
        const fraction = (t - v1) / (v2 - v1);
        return {
            x: x1 + fraction * (x2 - x1),
            y: y1 + fraction * (y2 - y1)
        };
    };

    // For each threshold value, run marching squares
    for (const threshold of thresholds) {
        // Simple segmented implementation (not connected polylines yet, just rendering segments)
        // To generate connected polylines, a more complex vertex tracing is required.
        // For MVP, we will extract raw line segments and connect them naively or just render segments.
        // Given the complexity of full polygon tracing, we will generate disjoint segments 
        // and treat them as short strokes in the stroke generation phase.

        for (let y = 0; y < height - 1; y++) {
            for (let x = 0; x < width - 1; x++) {
                const tl = luminance[y * width + x];
                const tr = luminance[y * width + (x + 1)];
                const bl = luminance[(y + 1) * width + x];
                const br = luminance[(y + 1) * width + (x + 1)];

                let state = 0;
                if (tl >= threshold) state |= 8;
                if (tr >= threshold) state |= 4;
                if (br >= threshold) state |= 2;
                if (bl >= threshold) state |= 1;

                if (state === 0 || state === 15) continue; // All inside or all outside

                // Edge points
                const top = getInterpolatedPoint(tl, tr, threshold, x, y, x + 1, y);
                const right = getInterpolatedPoint(tr, br, threshold, x + 1, y, x + 1, y + 1);
                const bottom = getInterpolatedPoint(bl, br, threshold, x, y + 1, x + 1, y + 1);
                const left = getInterpolatedPoint(tl, bl, threshold, x, y, x, y + 1);

                const segments: { x: number; y: number }[] = [];

                switch (state) {
                    case 1: segments.push(left, bottom); break;
                    case 2: segments.push(bottom, right); break;
                    case 3: segments.push(left, right); break;
                    case 4: segments.push(top, right); break;
                    case 5: segments.push(left, top, bottom, right); break; // Saddle point
                    case 6: segments.push(top, bottom); break;
                    case 7: segments.push(left, top); break;
                    case 8: segments.push(left, top); break;
                    case 9: segments.push(top, bottom); break;
                    case 10: segments.push(left, bottom, top, right); break; // Saddle point
                    case 11: segments.push(top, right); break;
                    case 12: segments.push(left, right); break;
                    case 13: segments.push(bottom, right); break;
                    case 14: segments.push(left, bottom); break;
                }

                // Add to contours as small 2-point polylines
                for (let i = 0; i < segments.length; i += 2) {
                    contours.push({
                        points: [segments[i], segments[i + 1]],
                        isClosed: false,
                        value: threshold
                    });
                }
            }
        }
    }

    // TODO: Add spatial smoothing to the raw contours if needed
    return contours;
}
