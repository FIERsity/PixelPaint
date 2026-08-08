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
export type MirrorMode = "none" | "x" | "y" | "both";

export type DocAction =
  | { type: "paint" } // 画笔类（含对称）
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

// 把坐标按对称模式映射，返回一组需绘制的坐标
export function mirrorPoints(
  width: number,
  height: number,
  x: number,
  y: number,
  mode: MirrorMode,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [[x, y]];
  if (mode === "x" || mode === "both") pts.push([width - 1 - x, y]);
  if (mode === "y" || mode === "both") pts.push([x, height - 1 - y]);
  if (mode === "both") pts.push([width - 1 - x, height - 1 - y]);
  // 去重
  const seen = new Set<string>();
  return pts.filter(([px, py]) => {
    if (px < 0 || py < 0 || px >= width || py >= height) return false;
    const k = `${px},${py}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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
export function floodFill(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
): Array<[number, number]> {
  const target = getPixel(pixels, width, sx, sy);
  // 目标为全透明：仅当背景透明时填充
  if (target[3] === 0) {
    return floodFillMatching(pixels, width, height, sx, sy, (_r, _g, _b, a) => a === 0);
  }
  return floodFillMatching(pixels, width, height, sx, sy, (_r, _g, _b, a) => a > 0);
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

// ---------- 撤销快照栈 ----------
export class History {
  private undoStack: PixelDoc[] = [];
  private redoStack: PixelDoc[] = [];
  private limit: number;
  constructor(limit = 60) {
    this.limit = limit;
  }

  push(doc: PixelDoc) {
    this.undoStack.push(cloneDoc(doc));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(current: PixelDoc): PixelDoc | null {
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push(cloneDoc(current));
    return prev;
  }

  redo(current: PixelDoc): PixelDoc | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(cloneDoc(current));
    return next;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}
