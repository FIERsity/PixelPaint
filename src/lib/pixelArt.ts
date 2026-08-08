export interface PixelArtAnalysis {
  isPixelArt: boolean;
  uniqueColors: number;
  uniqueColorRatio: number;
  semiTransparentRatio: number;
  maxDimension: number;
  reason: "invalid" | "too-large" | "empty" | "too-many-colors" | "soft-edges" | "low-repetition" | "ok";
}

const MAX_DIMENSION = 512;
const MAX_UNIQUE_COLORS = 128;
const MAX_SEMI_TRANSPARENT_RATIO = 0.08;
const MAX_UNIQUE_COLOR_RATIO = 0.35;

/**
 * 用几个对像素画友好的特征做导入前提示，而不是声称可以百分之百识别像素画：
 * 原尺寸不能太大、颜色调色板不能过于丰富、颜色需要有明显重复，且不能有大量抗锯齿边缘。
 */
export function analyzePixelArt(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): PixelArtAnalysis {
  const maxDimension = Math.max(width, height);
  const empty: PixelArtAnalysis = {
    isPixelArt: false,
    uniqueColors: 0,
    uniqueColorRatio: 0,
    semiTransparentRatio: 0,
    maxDimension,
    reason: "invalid",
  };

  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return empty;
  if (pixels.length !== width * height * 4) return empty;
  if (maxDimension > MAX_DIMENSION) return { ...empty, reason: "too-large" };

  const colors = new Set<number>();
  let opaquePixels = 0;
  let semiTransparentPixels = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const a = pixels[i + 3];
    if (a === 0) {
      // 所有完全透明像素视为同一种颜色，忽略透明像素中没有意义的 RGB。
      colors.add(0);
      continue;
    }
    opaquePixels += 1;
    if (a < 255) semiTransparentPixels += 1;
    colors.add((((r * 256 + g) * 256 + b) * 256 + a) >>> 0);
  }

  const pixelCount = width * height;
  const uniqueColors = colors.size;
  const uniqueColorRatio = uniqueColors / Math.max(1, opaquePixels);
  const semiTransparentRatio = semiTransparentPixels / pixelCount;
  const base = {
    isPixelArt: false,
    uniqueColors,
    uniqueColorRatio,
    semiTransparentRatio,
    maxDimension,
  };

  if (opaquePixels === 0) return { ...base, reason: "empty" };
  if (uniqueColors > MAX_UNIQUE_COLORS) return { ...base, reason: "too-many-colors" };
  if (semiTransparentRatio > MAX_SEMI_TRANSPARENT_RATIO) return { ...base, reason: "soft-edges" };
  if (uniqueColorRatio > MAX_UNIQUE_COLOR_RATIO && !(pixelCount <= 256 && uniqueColors <= 32)) {
    return { ...base, reason: "low-repetition" };
  }
  return { ...base, isPixelArt: true, reason: "ok" };
}
