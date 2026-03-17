/**
 * Applies a fast K-Means clustering algorithm for color quantization on an ImageData buffer.
 * Processes directly on Uint8ClampedArray for performance.
 */

export function quantizeColors(data: Uint8ClampedArray, width: number, height: number, k: number, _smoothing: number): { labels: Uint8Array; palette: [number, number, number][] } {
    // 1. Initialize palette by randomly selecting K distinct pixels
    const palette: [number, number, number][] = [];
    const numPixels = width * height;

    // Try to pick distinct colors
    for (let i = 0; i < k; i++) {
        let randIdx = Math.floor(Math.random() * numPixels) * 4;
        palette.push([data[randIdx], data[randIdx + 1], data[randIdx + 2]]);
    }

    const labels = new Uint8Array(numPixels);
    const maxIterations = 10; // Keep it low for fast preview iteration

    let changed = true;
    for (let iter = 0; iter < maxIterations && changed; iter++) {
        changed = false;
        const clusterSums = Array(k).fill(0).map(() => [0, 0, 0, 0]); // r, g, b, count

        // Assign pixels to nearest cluster
        for (let i = 0; i < numPixels; i++) {
            const idx = i * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];

            let minDst = Infinity;
            let nearestCluster = 0;

            for (let c = 0; c < k; c++) {
                const pr = palette[c][0];
                const pg = palette[c][1];
                const pb = palette[c][2];
                const dst = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
                if (dst < minDst) {
                    minDst = dst;
                    nearestCluster = c;
                }
            }

            if (labels[i] !== nearestCluster) {
                labels[i] = nearestCluster;
                changed = true;
            }

            clusterSums[nearestCluster][0] += r;
            clusterSums[nearestCluster][1] += g;
            clusterSums[nearestCluster][2] += b;
            clusterSums[nearestCluster][3] += 1;
        }

        // Update palette
        for (let c = 0; c < k; c++) {
            const count = clusterSums[c][3];
            if (count > 0) {
                palette[c] = [
                    Math.round(clusterSums[c][0] / count),
                    Math.round(clusterSums[c][1] / count),
                    Math.round(clusterSums[c][2] / count)
                ];
            }
        }
    }

    // TODO: Implement spatial smoothing (Mode filter or Median over labels) if smoothing > 0

    return { labels, palette };
}
