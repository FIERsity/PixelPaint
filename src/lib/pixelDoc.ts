// ============================================================
// PixelPaint · 像素文档模型 + 画笔工具（纯函数，无 React 依赖）
// ============================================================

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0..1
  pixels: Uint8ClampedArray; // width * height * 4 (RGBA)
}

export interface PixelDoc {
  width: number;
  height: number;
  layers: Layer[];
}

export type Tool = "pencil" | "eraser" | "picker" | "fill" | "line" | "rect";

// 笔刷覆盖的相对偏移（1 = 单像素，n = n×n）
export function brushOffsets(size: number): Array<[number, number]> {
  const n = Math.max(1, Math.round(size));
  const start = -Math.floor((n - 1) / 2);
  const out: Array<[number, number]> = [];
  for (let dy = 0; dy < n; dy++) {
    for (let dx = 0; dx < n; dx++) out.push([start + dx, start + dy]);
  }
  return out;
}

// 矩形轮廓点
export function rectPoints(
  x0: number, y0: number, x1: number, y1: number, filled: boolean,
): Array<[number, number]> {
  const ax = Math.min(x0, x1), ay = Math.min(y0, y1);
  const bx = Math.max(x0, x1), by = Math.max(y0, y1);
  const pts: Array<[number, number]> = [];
  if (filled) {
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) pts.push([x, y]);
  } else {
    for (let x = ax; x <= bx; x++) { pts.push([x, ay]); if (by !== ay) pts.push([x, by]); }
    for (let y = ay + 1; y <= by - 1; y++) { pts.push([ax, y]); if (bx !== ax) pts.push([bx, y]); }
  }
  return pts;
}

export type DocAction =
  | { type: "paint" } // 画笔类
  | { type: "fill" }
  | { type: "set-canvas" }
  | { type: "layer-add" }
  | { type: "layer-remove" }
  | { type: "layer-move" }
  | { type: "layer-toggle" }
  | { type: "layer-opacity" }
  | { type: "import" };

export function createDoc(width: number, height: number, name = "图层 1"): PixelDoc {
  return {
    width,
    height,
    layers: [{ id: uid(), name, visible: true, opacity: 1, pixels: new Uint8ClampedArray(width * height * 4) }],
  };
}

let seq = 0;
export function uid(): string {
  seq += 1;
  return `l${Date.now().toString(36)}-${seq}`;
}

// 位图 (RGBA) -> 像素文档（转像素 / 抠图结果导入画板）
export function docFromPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  name = "图层 1",
): PixelDoc {
  return {
    width,
    height,
    layers: [{ id: uid(), name, visible: true, opacity: 1, pixels: pixels.slice() }],
  };
}

export function cloneLayer(l: Layer): Layer {
  return { ...l, pixels: l.pixels.slice() };
}

export function cloneDoc(d: PixelDoc): PixelDoc {
  return { ...d, layers: d.layers.map(cloneLayer) };
}

// ---------- 合成所有可见图层为一张 RGBA 位图 ----------
export function composite(doc: PixelDoc): Uint8ClampedArray {
  const { width, height, layers } = doc;
  const out = new Uint8ClampedArray(width * height * 4);
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    const src = layer.pixels;
    const a = layer.opacity;
    for (let i = 0; i < out.length; i += 4) {
      const sa = (src[i + 3] / 255) * a;
      if (sa <= 0) continue;
      const da = out[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa <= 0) continue;
      out[i] = (src[i] * sa + out[i] * da * (1 - sa)) / oa;
      out[i + 1] = (src[i + 1] * sa + out[i + 1] * da * (1 - sa)) / oa;
      out[i + 2] = (src[i + 2] * sa + out[i + 2] * da * (1 - sa)) / oa;
      out[i + 3] = oa * 255;
    }
  }
  return out;
}

export function putPixel(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
) {
  const i = (y * width + x) * 4;
  pixels[i] = r;
  pixels[i + 1] = g;
  pixels[i + 2] = b;
  pixels[i + 3] = a;
}

export function getPixel(pixels: Uint8ClampedArray, width: number, x: number, y: number) {
  const i = (y * width + x) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]] as const;
}

export function drawLinePoints(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  for (;;) {
    pts.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return pts;
}

// 洪水填充（返回需修改的坐标集合）
// 洪水填充：只填充与起点【同色】的连通区域（RGBA 完全相等）
export function floodFill(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
): Array<[number, number]> {
  const t = getPixel(pixels, width, sx, sy);
  // 全透明像素只比 alpha（RGB 无意义）；否则四通道精确匹配
  const match = t[3] === 0
    ? (_r: number, _g: number, _b: number, a: number) => a === 0
    : (r: number, g: number, b: number, a: number) =>
        r === t[0] && g === t[1] && b === t[2] && a === t[3];
  return floodFillMatching(pixels, width, height, sx, sy, match);
}

function floodFillMatching(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
  match: (r: number, g: number, b: number, a: number) => boolean,
): Array<[number, number]> {
  const start = getPixel(pixels, width, sx, sy);
  if (!match(start[0], start[1], start[2], start[3])) return [];
  const visited = new Uint8Array(width * height);
  const stack: Array<[number, number]> = [[sx, sy]];
  const out: Array<[number, number]> = [];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    const idx = y * width + x;
    if (visited[idx]) continue;
    visited[idx] = 1;
    const c = getPixel(pixels, width, x, y);
    if (!match(c[0], c[1], c[2], c[3])) continue;
    out.push([x, y]);
    if (x > 0) stack.push([x - 1, y]);
    if (x < width - 1) stack.push([x + 1, y]);
    if (y > 0) stack.push([x, y - 1]);
    if (y < height - 1) stack.push([x, y + 1]);
  }
  return out;
}

// 调整画布尺寸（保留已有内容，左上对齐；变小则裁切）
export function resizeDoc(doc: PixelDoc, width: number, height: number): PixelDoc {
  const copyW = Math.min(doc.width, width);
  const copyH = Math.min(doc.height, height);
  return {
    width,
    height,
    layers: doc.layers.map((l) => {
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < copyH; y++) {
        const srcStart = y * doc.width * 4;
        const src = l.pixels.subarray(srcStart, srcStart + copyW * 4);
        pixels.set(src, y * width * 4);
      }
      return { ...l, pixels };
    }),
  };
}

// ---------- 增量撤销（只记录变更的像素，不再整幅快照） ----------
export type Rgba = [number, number, number, number];

export interface PixelChange {
  idx: number; // 像素索引（相对图层起点）
  before: Rgba;
  after: Rgba;
}

export type UndoEntry =
  | { kind: "pixels"; layerId: string; changes: PixelChange[] }
  | { kind: "doc"; doc: PixelDoc };

// 笔画记录器：一边画一边记录每个被改动像素的 before/after
// 内存与“笔画画了几个像素”成正比，而不是与画布大小成正比
export class StrokeRecorder {
  private map = new Map<number, { before: Rgba; after: Rgba }>();
  private layerId: string;

  constructor(layerId: string) {
    this.layerId = layerId;
  }

  touch(idx: number, before: Rgba, after: Rgba) {
    const existing = this.map.get(idx);
    if (existing) existing.after = after;
    else this.map.set(idx, { before, after });
  }

  get size() {
    return this.map.size;
  }

  entry(): UndoEntry | null {
    if (this.map.size === 0) return null;
    const changes: PixelChange[] = [];
    for (const [idx, v] of this.map) changes.push({ idx, before: v.before, after: v.after });
    return { kind: "pixels", layerId: this.layerId, changes };
  }
}

// 把像素条目应用到文档的某个图层（before=撤销 / after=重做）
export function applyPixelChanges(
  doc: PixelDoc,
  layerId: string,
  changes: PixelChange[],
  mode: "before" | "after",
): boolean {
  const layer = doc.layers.find((l) => l.id === layerId);
  if (!layer) return false;
  for (const c of changes) {
    const v = mode === "before" ? c.before : c.after;
    const i = c.idx * 4;
    layer.pixels[i] = v[0];
    layer.pixels[i + 1] = v[1];
    layer.pixels[i + 2] = v[2];
    layer.pixels[i + 3] = v[3];
  }
  return true;
}

export class History {
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private limit: number;
  constructor(limit = 80) {
    this.limit = limit;
  }

  // 结构性操作（图层增删/移动/画布调整/导入）：整幅快照（低频，可接受）
  pushDoc(doc: PixelDoc) {
    this.push({ kind: "doc", doc: cloneDoc(doc) });
  }

  push(entry: UndoEntry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  // 弹出最近一条撤销（不自动入重做栈，由调用方决定）
  popUndo(): UndoEntry | null {
    return this.undoStack.pop() ?? null;
  }

  popRedo(): UndoEntry | null {
    return this.redoStack.pop() ?? null;
  }

  pushRedo(entry: UndoEntry) {
    this.redoStack.push(entry);
    if (this.redoStack.length > this.limit) this.redoStack.shift();
  }

  reset() {
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}
