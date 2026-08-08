// ============================================================
// PixelPaint · 背景处理结果的像素边缘处理
// ============================================================

export type CutoutEdgeMode = "hard" | "soft";
export type PixelCutoutScope = "connected" | "global";

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface PixelCutoutOptions {
  /** 0–100, mapped to a perceptual OKLab distance. */
  tolerance: number;
  /** Remove only edge-connected colors, or every matching pixel. */
  scope: PixelCutoutScope;
  /** Number of dominant colors to learn from the image border. */
  maxBackgroundColors?: number;
}

export interface PixelCutoutResult {
  pixels: Uint8ClampedArray;
  mask: Uint8Array;
  backgroundColors: RgbColor[];
  removedPixels: number;
}

export interface CutoutAlphaOptions {
  mode: CutoutEdgeMode;
  threshold: number;
}

function clampThreshold(value: number): number {
  return Math.max(1, Math.min(254, Math.round(value)));
}

function clampTolerance(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

interface OklabColor {
  l: number;
  a: number;
  b: number;
}

interface ColorBin extends RgbColor {
  count: number;
  key: number;
}

interface ColorCluster extends ColorBin {
  lab: OklabColor;
}

function srgbToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

/** OKLab gives more useful distances than raw RGB for noisy pixel backgrounds. */
function rgbToOklab(r: number, g: number, b: number): OklabColor {
  const red = srgbToLinear(r);
  const green = srgbToLinear(g);
  const blue = srgbToLinear(b);
  const l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
  const m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
  const s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);
  return {
    l: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  };
}

function oklabDistance(left: OklabColor, right: OklabColor): number {
  const dl = left.l - right.l;
  const da = left.a - right.a;
  const db = left.b - right.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

function addBorderPixel(
  pixels: Uint8ClampedArray,
  index: number,
  histogram: Map<number, ColorBin>,
): void {
  const alpha = pixels[index + 3];
  if (alpha < 16) return;
  // Four bits per channel make a small, deterministic histogram while still
  // keeping nearby colors available for the perceptual merge below.
  const rBin = pixels[index] >> 4;
  const gBin = pixels[index + 1] >> 4;
  const bBin = pixels[index + 2] >> 4;
  const key = (rBin << 8) | (gBin << 4) | bBin;
  const previous = histogram.get(key);
  if (previous) {
    previous.count += 1;
    previous.r += pixels[index];
    previous.g += pixels[index + 1];
    previous.b += pixels[index + 2];
    return;
  }
  histogram.set(key, {
    key,
    count: 1,
    r: pixels[index],
    g: pixels[index + 1],
    b: pixels[index + 2],
  });
}

function learnBorderColors(pixels: Uint8ClampedArray, width: number, height: number, maxColors: number): ColorCluster[] {
  const histogram = new Map<number, ColorBin>();
  const addRow = (y: number) => {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) addBorderPixel(pixels, row + x * 4, histogram);
  };
  addRow(0);
  if (height > 1) addRow(height - 1);
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width * 4;
    addBorderPixel(pixels, row, histogram);
    if (width > 1) addBorderPixel(pixels, row + (width - 1) * 4, histogram);
  }

  const candidates = Array.from(histogram.values())
    .sort((left, right) => right.count - left.count || left.key - right.key);
  const clusters: ColorCluster[] = [];
  const mergeDistance = 0.045;
  for (const candidate of candidates) {
    const color = {
      r: candidate.r / candidate.count,
      g: candidate.g / candidate.count,
      b: candidate.b / candidate.count,
    };
    const lab = rgbToOklab(color.r, color.g, color.b);
    let nearest: ColorCluster | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const cluster of clusters) {
      const distance = oklabDistance(lab, cluster.lab);
      if (distance < nearestDistance) {
        nearest = cluster;
        nearestDistance = distance;
      }
    }
    if (nearest && nearestDistance <= mergeDistance) {
      const total = nearest.count + candidate.count;
      nearest.r = (nearest.r * nearest.count + color.r * candidate.count) / total;
      nearest.g = (nearest.g * nearest.count + color.g * candidate.count) / total;
      nearest.b = (nearest.b * nearest.count + color.b * candidate.count) / total;
      nearest.count = total;
      nearest.lab = rgbToOklab(nearest.r, nearest.g, nearest.b);
    } else if (clusters.length < maxColors) {
      clusters.push({ ...color, count: candidate.count, key: candidate.key, lab });
    }
  }
  return clusters.sort((left, right) => right.count - left.count || left.key - right.key);
}

function isSimilarToBackground(color: OklabColor, background: ColorCluster[], maxDistance: number): boolean {
  return background.some((candidate) => oklabDistance(color, candidate.lab) <= maxDistance);
}

function removeConnectedBackground(candidate: Uint8Array, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(candidate.length);
  const stack = new Int32Array(candidate.length);
  let stackSize = 0;

  const visit = (index: number) => {
    if (candidate[index] === 0 || mask[index] !== 0) return;
    mask[index] = 1;
    stack[stackSize] = index;
    stackSize += 1;
  };

  for (let x = 0; x < width; x += 1) {
    visit(x);
    if (height > 1) visit((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    visit(y * width);
    if (width > 1) visit(y * width + width - 1);
  }

  while (stackSize > 0) {
    stackSize -= 1;
    const index = stack[stackSize];
    const x = index % width;
    if (x > 0) visit(index - 1);
    if (x + 1 < width) visit(index + 1);
    if (index >= width) visit(index - width);
    if (index + width < candidate.length) visit(index + width);
  }
  return mask;
}

/**
 * Remove a pixel-art background without resizing or introducing soft alpha.
 * The border supplies the background palette; connected mode protects matching
 * colors that are enclosed by the subject, which is common in sprites.
 */
export function removePixelBackground(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: PixelCutoutOptions,
): PixelCutoutResult {
  if (width < 1 || height < 1 || pixels.length !== width * height * 4) {
    throw new Error("像素图尺寸与数据长度不匹配");
  }
  const maxColors = Math.max(1, Math.min(12, Math.round(options.maxBackgroundColors ?? 6)));
  const backgroundColors = learnBorderColors(pixels, width, height, maxColors);
  const tolerance = clampTolerance(options.tolerance);
  const maxDistance = (tolerance / 100) * 0.3;
  const candidate = new Uint8Array(width * height);

  for (let index = 0; index < candidate.length; index += 1) {
    const pixel = index * 4;
    if (pixels[pixel + 3] < 16 || backgroundColors.length === 0) continue;
    const color = rgbToOklab(pixels[pixel], pixels[pixel + 1], pixels[pixel + 2]);
    if (isSimilarToBackground(color, backgroundColors, maxDistance)) candidate[index] = 1;
  }

  const mask = options.scope === "global"
    ? candidate
    : removeConnectedBackground(candidate, width, height);
  const output = pixels.slice();
  let removedPixels = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 0) continue;
    output[index * 4 + 3] = 0;
    removedPixels += 1;
  }

  return {
    pixels: output,
    mask,
    backgroundColors: backgroundColors.map(({ r, g, b }) => ({ r, g, b })),
    removedPixels,
  };
}

/**
 * 把 AI 返回的连续 alpha 蒙版整理成适合像素画的 alpha。
 * sourceAlpha 用于保留输入 PNG 原本的透明区域，避免背景处理时把它们误判为主体。
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

async function encodePng(raster: RasterImage): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器无法创建图像画布");
  const image = ctx.createImageData(raster.width, raster.height);
  image.data.set(raster.pixels);
  ctx.putImageData(image, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("无法生成 PNG 结果"));
    }, "image/png");
  });
}

export async function removePixelBackgroundBlob(
  sourceBlob: Blob,
  options: PixelCutoutOptions,
): Promise<PixelCutoutResult & { blob: Blob }> {
  const source = await readRaster(sourceBlob);
  const result = removePixelBackground(source.pixels, source.width, source.height, options);
  return { ...result, blob: await encodePng({ width: source.width, height: source.height, pixels: result.pixels }) };
}


/**
 * 将背景处理结果重新编码为 PNG，并按像素画规则处理 alpha 边缘。
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

  return encodePng({ width: result.width, height: result.height, pixels });
}
