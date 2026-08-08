// ============================================================
// PixelPaint · 转像素核心算法
// 流程：降采样 → 颜色量化(median-cut) → 抖动 → 输出 RGBA
// 所有函数均为纯计算，可在 Worker 中运行。
// ============================================================

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

  // 收集颜色（忽略全透明）
  const map = new Map<number, number>(); // rgb packed -> count
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    const key = (out[i] << 16) | (out[i + 1] << 8) | out[i + 2];
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  const colors: Array<{ r: number; g: number; b: number; count: number }> = [];
  for (const [key, count] of map) {
    colors.push({ r: (key >> 16) & 255, g: (key >> 8) & 255, b: key & 255, count });
  }
  if (colors.length <= maxColors) return { pixels: out, palette: colors.map((c) => [c.r, c.g, c.b]) };

  // 中值切分：优先劈开颜色跨度最大的盒子（保留不同色相），像素数做平局裁决
  let boxes: Array<typeof colors> = [colors];
  while (boxes.length < maxColors) {
    let bestIdx = -1;
    let bestRange = -1;
    let bestWeight = -1;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.length < 2) continue;
      const range = boxRange(box);
      const weight = box.reduce((s, c) => s + c.count, 0);
      if (range > bestRange || (range === bestRange && weight > bestWeight)) {
        bestRange = range;
        bestWeight = weight;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break; // 没有可再劈的盒子
    const split = splitBox(boxes[bestIdx]);
    if (!split) break;
    boxes.splice(bestIdx, 1, ...split);
  }

  // 每个盒子取加权平均色，重映射
  const lut = new Map<number, [number, number, number]>();
  for (const box of boxes) {
    let r = 0, g = 0, b = 0, w = 0;
    for (const c of box) { r += c.r * c.count; g += c.g * c.count; b += c.b * c.count; w += c.count; }
    const avg: [number, number, number] = [Math.round(r / w), Math.round(g / w), Math.round(b / w)];
    for (const c of box) lut.set((c.r << 16) | (c.g << 8) | c.b, avg);
  }

  const palette: Array<[number, number, number]> = [];
  const palSeen = new Set<string>();
  for (const avg of lut.values()) {
    const k = avg.join(",");
    if (!palSeen.has(k)) { palSeen.add(k); palette.push(avg); }
  }

  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    const key = (out[i] << 16) | (out[i + 1] << 8) | out[i + 2];
    const avg = lut.get(key);
    if (avg) { out[i] = avg[0]; out[i + 1] = avg[1]; out[i + 2] = avg[2]; }
  }
  return { pixels: out, palette };
}

function boxRange(box: Array<{ r: number; g: number; b: number; count: number }>): number {
  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
  for (const c of box) {
    if (c.r < minR) minR = c.r; if (c.r > maxR) maxR = c.r;
    if (c.g < minG) minG = c.g; if (c.g > maxG) maxG = c.g;
    if (c.b < minB) minB = c.b; if (c.b > maxB) maxB = c.b;
  }
  return (maxR - minR) + (maxG - minG) + (maxB - minB);
}

function splitBox(box: Array<{ r: number; g: number; b: number; count: number }>): [typeof box, typeof box] | null {
  if (box.length < 2) return null;
  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
  for (const c of box) {
    minR = Math.min(minR, c.r); maxR = Math.max(maxR, c.r);
    minG = Math.min(minG, c.g); maxG = Math.max(maxG, c.g);
    minB = Math.min(minB, c.b); maxB = Math.max(maxB, c.b);
  }
  const rangeR = maxR - minR, rangeG = maxG - minG, rangeB = maxB - minB;
  const channel = rangeR >= rangeG && rangeR >= rangeB ? "r" : rangeG >= rangeB ? "g" : "b";
  const sorted = [...box].sort((a, b) => a[channel] - b[channel]);

  // 感知色隙：在主导通道找“显著断层”（明显大于簇内典型间隔），
  // 在断层处劈开，把不同色相簇分开而不是混在一起取平均
  const gaps: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) gaps.push(sorted[i + 1][channel] - sorted[i][channel]);
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)] || 0;
  const maxGap = sortedGaps[sortedGaps.length - 1];
  let splitAt = -1;
  if (maxGap >= 12 && maxGap >= medianGap * 3 + 1) {
    splitAt = gaps.indexOf(maxGap) + 1;
  }

  // 无显著断层（平滑渐变）或断层在边缘：退回按像素数对半劈
  if (splitAt <= 0 || splitAt >= sorted.length) {
    const total = sorted.reduce((s, c) => s + c.count, 0);
    let acc = 0, mid = 0;
    for (let i = 0; i < sorted.length; i++) {
      acc += sorted[i].count;
      if (acc * 2 >= total) { mid = i + 1; break; }
    }
    splitAt = mid;
  }
  if (splitAt <= 0 || splitAt >= sorted.length) return null;
  return [sorted.slice(0, splitAt), sorted.slice(splitAt)];
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
  let px = downsample(src, srcW, srcH, opts.outWidth, opts.outHeight);

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
      px = dither(px, opts.outWidth, opts.outHeight, opts.dither, mapColor);
    } else {
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] === 0) continue;
        const [r, g, b] = mapColor(px[i], px[i + 1], px[i + 2]);
        px[i] = r; px[i + 1] = g; px[i + 2] = b;
      }
    }
  } else if (opts.maxColors > 0) {
    // median-cut
    const { pixels: q, palette } = quantize(px, opts.maxColors);
    px = q;
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
      px = dither(px, opts.outWidth, opts.outHeight, opts.dither, mapColor);
    }
  }
  // maxColors<=0 且无调色板：直接输出（只降采样）
  return { pixels: px, palette: paletteColors };
}
