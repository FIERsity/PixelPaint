// ============================================================
// PixelPaint · 抠图结果的像素边缘处理
// ============================================================

export type CutoutEdgeMode = "hard" | "soft";

export interface CutoutAlphaOptions {
  mode: CutoutEdgeMode;
  threshold: number;
}

function clampThreshold(value: number): number {
  return Math.max(1, Math.min(254, Math.round(value)));
}

/**
 * 把 AI 返回的连续 alpha 蒙版整理成适合像素画的 alpha。
 * sourceAlpha 用于保留输入 PNG 原本的透明区域，避免重新抠图把它们误判为主体。
 */
export function normalizeCutoutAlpha(
  pixels: Uint8ClampedArray,
  sourceAlpha: Uint8ClampedArray | null,
  options: CutoutAlphaOptions,
): Uint8ClampedArray {
  const out = pixels.slice();
  const hasSourceAlpha = sourceAlpha !== null && sourceAlpha.length === out.length;
  const threshold = clampThreshold(options.threshold);

  for (let i = 3; i < out.length; i += 4) {
    const source = hasSourceAlpha ? sourceAlpha[i] : 255;
    const alpha = Math.min(out[i], source);
    out[i] = options.mode === "hard"
      ? (alpha >= threshold ? 255 : 0)
      : alpha;
  }
  return out;
}

interface RasterImage {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

async function readRaster(blob: Blob): Promise<RasterImage> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("当前浏览器无法创建图像画布");
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { width: canvas.width, height: canvas.height, pixels: image.data };
}


/**
 * 将抠图结果重新编码为 PNG，并按像素画规则处理 alpha 边缘。
 * 结果保持输入图像的像素尺寸，不做额外缩放。
 */
export async function normalizeCutoutBlob(
  sourceBlob: Blob,
  resultBlob: Blob,
  options: CutoutAlphaOptions,
): Promise<Blob> {
  const [source, result] = await Promise.all([readRaster(sourceBlob), readRaster(resultBlob)]);
  const sourceAlpha = source.width === result.width && source.height === result.height
    ? source.pixels
    : null;
  const pixels = normalizeCutoutAlpha(result.pixels, sourceAlpha, options);

  const canvas = document.createElement("canvas");
  canvas.width = result.width;
  canvas.height = result.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器无法创建图像画布");
  const image = ctx.createImageData(result.width, result.height);
  image.data.set(pixels);
  ctx.putImageData(image, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("无法生成 PNG 结果"));
    }, "image/png");
  });
}
