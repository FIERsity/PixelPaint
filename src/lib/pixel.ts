// ============================================================
// PixelPaint · 转像素核心算法
// 流程：降采样 → 颜色量化(median-cut) → 抖动 → 输出 RGBA
// 所有函数均为纯计算，可在 Worker 中运行。
// ============================================================

import { clampDimension } from "./dimensions";

export type DitherMode = "none" | "floyd" | "bayer2" | "bayer4" | "atkinson";

export interface ToPixelOptions {
  outWidth: number;
  outHeight: number;
  maxColors: number; // 0 = 不限
  palette: string[] | null; // hex 数组或 null
  dither: DitherMode;
}

// ---------- 双线性降采样 ----------
export function downsample(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
): Uint8ClampedArray {
  if (outW < 1 || outH < 1 || srcW < 1 || srcH < 1) return new Uint8ClampedArray(0);
  const out = new Uint8ClampedArray(outW * outH * 4);
  const xRatio = srcW / outW;
  const yRatio = srcH / outH;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const sx = x * xRatio;
      const sy = y * yRatio;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(srcW - 1, x0 + 1);
      const y1 = Math.min(srcH - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;

      const i00 = (y0 * srcW + x0) * 4;
      const i10 = (y0 * srcW + x1) * 4;
      const i01 = (y1 * srcW + x0) * 4;
      const i11 = (y1 * srcW + x1) * 4;

      const oi = (y * outW + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx;
        const bot = src[i01 + c] * (1 - fx) + src[i11 + c] * fx;
        out[oi + c] = top * (1 - fy) + bot * fy;
      }
    }
  }
  return out;
}

// ---------- 中值切分 (median cut) 颜色量化 ----------
export function quantize(
  pixels: Uint8ClampedArray,
  maxColors: number,
): { pixels: Uint8ClampedArray; palette: Array<[number, number, number]> } {
  const out = pixels.slice();

  if (maxColors <= 0 || maxColors >= 4096) {
    return { pixels: out, palette: [] };
  }

  // 收集颜色（忽略全透明）。自动调色板来自这张图，而不是一组固定的通用颜色。
  const map = new Map<number, number>(); // rgb packed -> count
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    const key = (out[i] << 16) | (out[i + 1] << 8) | out[i + 2];
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  const colors: WeightedColor[] = [];
  for (const [key, count] of map) {
    colors.push({ r: (key >> 16) & 255, g: (key >> 8) & 255, b: key & 255, count });
  }
  if (colors.length <= maxColors) return { pixels: out, palette: colors.map(toRgb) };

  // 先把照片中的细碎噪声压缩成最多 32³ 个颜色桶，避免大图让 Worker 计算过重。
  const candidates = colors.length > 32768 ? bucketColors(colors) : colors;
  const palette = clusterPalette(candidates, maxColors);

  // 对原始颜色建立查找表，避免每个像素重复做最近色搜索。
  const lut = new Map<number, [number, number, number]>();
  for (const c of colors) {
    lut.set((c.r << 16) | (c.g << 8) | c.b, nearestColor(c, palette));
  }
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    const avg = lut.get((out[i] << 16) | (out[i + 1] << 8) | out[i + 2]);
    if (avg) { out[i] = avg[0]; out[i + 1] = avg[1]; out[i + 2] = avg[2]; }
  }
  return { pixels: out, palette };
}

type WeightedColor = { r: number; g: number; b: number; count: number };
type RgbColor = [number, number, number];

function toRgb(c: WeightedColor): RgbColor {
  return [c.r, c.g, c.b];
}

function bucketColors(colors: WeightedColor[]): WeightedColor[] {
  const buckets = new Map<number, { r: number; g: number; b: number; count: number }>();
  for (const c of colors) {
    const br = c.r >> 3, bg = c.g >> 3, bb = c.b >> 3;
    const key = (br << 10) | (bg << 5) | bb;
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0 };
    bucket.r += c.r * c.count;
    bucket.g += c.g * c.count;
    bucket.b += c.b * c.count;
    bucket.count += c.count;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].map((b) => ({
    r: Math.round(b.r / b.count),
    g: Math.round(b.g / b.count),
    b: Math.round(b.b / b.count),
    count: b.count,
  }));
}

function colorDistance(a: RgbColor, b: RgbColor): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function nearestColor(c: WeightedColor | RgbColor, palette: RgbColor[]): RgbColor {
  const rgb: RgbColor = Array.isArray(c) ? c : [c.r, c.g, c.b];
  return palette[nearestColorIndex(rgb, palette)];
}

function nearestColorIndex(rgb: RgbColor, palette: RgbColor[]): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const distance = colorDistance(rgb, p);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

// 带权重的 k-means++：第一颜色偏向主色，后续颜色优先保留相距很远的点，
// 因此少量但明显不同的主体颜色不会被主色调吞掉。
function clusterPalette(colors: WeightedColor[], maxColors: number): RgbColor[] {
  const first = colors.reduce((best, c) => c.count > best.count ? c : best, colors[0]);
  const centers: RgbColor[] = [toRgb(first)];
  while (centers.length < maxColors) {
    let candidate: WeightedColor | null = null;
    let bestScore = -1;
    for (const c of colors) {
      const distance = colorDistance([c.r, c.g, c.b], nearestColor(c, centers));
      const score = distance * Math.sqrt(c.count);
      if (score > bestScore) {
        bestScore = score;
        candidate = c;
      }
    }
    if (!candidate || bestScore <= 0) break;
    centers.push(toRgb(candidate));
  }

  for (let iteration = 0; iteration < 8; iteration++) {
    const sums = centers.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
    for (const c of colors) {
      const rgb: RgbColor = [c.r, c.g, c.b];
      const sum = sums[nearestColorIndex(rgb, centers)];
      sum.r += c.r * c.count;
      sum.g += c.g * c.count;
      sum.b += c.b * c.count;
      sum.count += c.count;
    }
    let changed = false;
    for (let i = 0; i < centers.length; i++) {
      if (sums[i].count === 0) continue;
      const next: RgbColor = [
        Math.round(sums[i].r / sums[i].count),
        Math.round(sums[i].g / sums[i].count),
        Math.round(sums[i].b / sums[i].count),
      ];
      if (colorDistance(next, centers[i]) > 0) changed = true;
      centers[i] = next;
    }
    if (!changed) break;
  }

  const seen = new Set<string>();
  const distinct: RgbColor[] = [];
  return centers.filter((c) => {
    const key = c.join(",");
    if (seen.has(key)) return false;
    // 自动预设不堆叠几乎看不出差别的颜色；把名额留给更明显的色相/明度。
    if (distinct.some((p) => colorDistance(c, p) < 18 ** 2)) return false;
    seen.add(key);
    distinct.push(c);
    return true;
  });
}

// ---------- 抖动 ----------
export function dither(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  mode: DitherMode,
  quantizeColor: (r: number, g: number, b: number) => [number, number, number],
): Uint8ClampedArray {
  if (mode === "none") return pixels;
  const out = pixels.slice();
  const work = pixels.slice(); // 工作副本，带误差累积
  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;

  const setErr = (x: number, y: number, er: number, eg: number, eb: number, factor: number) => {
    if (!inBounds(x, y)) return;
    const i = (y * width + x) * 4;
    if (work[i + 3] === 0) return;
    work[i] = Math.max(0, Math.min(255, work[i] + er * factor));
    work[i + 1] = Math.max(0, Math.min(255, work[i + 1] + eg * factor));
    work[i + 2] = Math.max(0, Math.min(255, work[i + 2] + eb * factor));
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (work[i + 3] === 0) continue;
      const [nr, ng, nb] = quantizeColor(work[i], work[i + 1], work[i + 2]);
      const er = work[i] - nr;
      const eg = work[i + 1] - ng;
      const eb = work[i + 2] - nb;
      work[i] = nr; work[i + 1] = ng; work[i + 2] = nb;
      out[i] = nr; out[i + 1] = ng; out[i + 2] = nb;

      if (mode === "floyd") {
        setErr(x + 1, y, er, eg, eb, 7 / 16);
        setErr(x - 1, y + 1, er, eg, eb, 3 / 16);
        setErr(x, y + 1, er, eg, eb, 5 / 16);
        setErr(x + 1, y + 1, er, eg, eb, 1 / 16);
      } else if (mode === "atkinson") {
        // Atkinson：误差分 6 份，只扩散 1/8
        for (const [dx, dy] of [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]] as const) {
          setErr(x + dx, y + dy, er, eg, eb, 1 / 8);
        }
      } else {
        // Bayer 有序抖动（模式为 bayer2 / bayer4）
        const n = mode === "bayer2" ? 2 : 4;
        const bayer = makeBayerMatrix(n);
        const threshold = bayer[y % n][x % n] / (n * n) - 0.5;
        const qc = (v: number, old: number) => (old + threshold * 255 < v ? Math.min(255, v + 128) : Math.max(0, v - 128));
        const qr = Math.max(0, Math.min(255, Math.round(qc(work[i], nr))));
        const qg = Math.max(0, Math.min(255, Math.round(qc(work[i + 1], ng))));
        const qb = Math.max(0, Math.min(255, Math.round(qc(work[i + 2], nb))));
        out[i] = qr; out[i + 1] = qg; out[i + 2] = qb;
      }
    }
  }
  return out;
}

function makeBayerMatrix(n: number): number[][] {
  let m = [[0]];
  while (m.length < n) {
    const s = m.length * 2;
    const next: number[][] = Array.from({ length: s }, () => new Array(s).fill(0));
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m.length; x++) {
        next[y][x] = m[y][x] * 4;
        next[y][x + m.length] = m[y][x] * 4 + 2;
        next[y + m.length][x] = m[y][x] * 4 + 3;
        next[y + m.length][x + m.length] = m[y][x] * 4 + 1;
      }
    }
    m = next;
  }
  return m;
}

// ---------- 完整转换管线 ----------
export function imageToPixels(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  opts: ToPixelOptions,
): { pixels: Uint8ClampedArray; palette: Array<[number, number, number]> } {
  // UI 会拦截非法输入，这里再做一次兜底，保证 Worker 收到 0 或小数时也不会崩溃。
  const outWidth = clampDimension(opts.outWidth);
  const outHeight = clampDimension(opts.outHeight);
  let px = downsample(src, srcW, srcH, outWidth, outHeight);

  // 强制调色板量化
  let paletteColors: Array<[number, number, number]> = [];
  if (opts.palette && opts.palette.length > 0) {
    paletteColors = opts.palette.map((h) => {
      const v = parseInt(h.replace("#", ""), 16);
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    });
    const mapColor = (r: number, g: number, b: number) => {
      let best = paletteColors[0];
      let bestD = Infinity;
      for (const c of paletteColors) {
        const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      return best;
    };
    if (opts.dither !== "none") {
      px = dither(px, outWidth, outHeight, opts.dither, mapColor);
    } else {
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] === 0) continue;
        const [r, g, b] = mapColor(px[i], px[i + 1], px[i + 2]);
        px[i] = r; px[i + 1] = g; px[i + 2] = b;
      }
    }
  } else if (opts.maxColors > 0) {
    // 自动提取图片自身的颜色簇
    const sourcePx = px;
    const { pixels: q, palette } = quantize(sourcePx, opts.maxColors);
    paletteColors = palette;
    if (opts.dither !== "none") {
      const mapColor = (r: number, g: number, b: number) => {
        let best = palette[0];
        let bestD = Infinity;
        for (const c of palette) {
          const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
          if (d < bestD) { bestD = d; best = c; }
        }
        return best;
      };
      // 抖动要从降采样后的原色开始，而不是从已经量化过的 q 开始，否则误差已经被吃掉。
      px = dither(sourcePx, outWidth, outHeight, opts.dither, mapColor);
    } else {
      px = q;
    }
  }
  // maxColors<=0 且无调色板：直接输出（只降采样）
  return { pixels: px, palette: paletteColors };
}
