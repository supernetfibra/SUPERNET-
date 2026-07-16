/**
 * Extract the dominant color from an image URL.
 * Uses an off-screen canvas to sample pixel data and find the most common hue.
 * Returns a hex color string (e.g., "#3b82f6") or null if extraction fails.
 */

export function extractDominantColor(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }

        // Sample a grid of pixels for performance
        const sampleSize = 40;
        const w = Math.min(img.naturalWidth, 200);
        const h = Math.min(img.naturalHeight, 200);
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);

        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;

        // Quantize colors into buckets
        const colorBuckets: Map<string, { r: number; g: number; b: number; count: number }> =
          new Map();

        for (let i = 0; i < data.length; i += 4 * sampleSize) {
          const r = Math.round(data[i] / 32) * 32;
          const g = Math.round(data[i + 1] / 32) * 32;
          const b = Math.round(data[i + 2] / 32) * 32;
          const a = data[i + 3];

          // Skip transparent pixels
          if (a < 128) continue;

          // Skip very dark (near-black) and very light (near-white) pixels
          const brightness = (r + g + b) / 3;
          if (brightness < 30 || brightness > 225) continue;

          const key = `${r},${g},${b}`;
          const existing = colorBuckets.get(key);
          if (existing) {
            existing.count++;
          } else {
            colorBuckets.set(key, { r, g, b, count: 1 });
          }
        }

        if (colorBuckets.size === 0) {
          resolve(null);
          return;
        }

        // Find the most frequent color bucket
        let maxCount = 0;
        let dominant = { r: 59, g: 130, b: 246 }; // fallback: blue

        for (const bucket of colorBuckets.values()) {
          if (bucket.count > maxCount) {
            maxCount = bucket.count;
            dominant = bucket;
          }
        }

        // Skip grayish colors (low saturation)
        const max = Math.max(dominant.r, dominant.g, dominant.b);
        const min = Math.min(dominant.r, dominant.g, dominant.b);
        const saturation = max - min;

        if (saturation < 20) {
          // Too gray — try the next most frequent non-gray color
          let bestSaturation = 0;
          let bestColor = dominant;

          for (const bucket of colorBuckets.values()) {
            const bMax = Math.max(bucket.r, bucket.g, bucket.b);
            const bMin = Math.min(bucket.r, bucket.g, bucket.b);
            const bSat = bMax - bMin;

            // Prioritize saturated colors with decent count
            const score = bucket.count * (bSat / 255);
            if (score > bestSaturation) {
              bestSaturation = score;
              bestColor = bucket;
            }
          }

          dominant = bestColor;
        }

        const toHex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
        resolve(`#${toHex(dominant.r)}${toHex(dominant.g)}${toHex(dominant.b)}`);
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => resolve(null);

    img.src = url;
  });
}
