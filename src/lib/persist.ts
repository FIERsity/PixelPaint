// ============================================================
// PixelPaint · 工程持久化
// 图层像素用 PNG dataURL 编码（比裸 base64 小一个数量级），
// 便于存 localStorage 自动草稿，也便于导出 .pixelpaint.json 工程文件。
// ============================================================

import { uid, type Layer, type PixelDoc } from "./pixelDoc";

export const AUTOSAVE_KEY = "pixelpaint:autosave:v1";
export const PROJECT_EXT = ".pixelpaint.json";
const MAX_AUTOSAVE_BYTES = 4_000_000; // localStorage 通常 ~5MB，留余量

interface SerializedLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  png: string; // dataURL
}

export interface SerializedDoc {
  format: "pixelpaint";
  version: 1;
  width: number;
  height: number;
  savedAt: number;
  layers: SerializedLayer[];
}

function layerToPng(layer: Layer, width: number, height: number): string {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  ctx.putImageData(new ImageData(layer.pixels.slice(), width, height), 0, 0);
  return c.toDataURL("image/png");
}

export function serializeDoc(doc: PixelDoc): SerializedDoc {
  return {
    format: "pixelpaint",
    version: 1,
    width: doc.width,
    height: doc.height,
    savedAt: Date.now(),
    layers: doc.layers.map((l) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      png: layerToPng(l, doc.width, doc.height),
    })),
  };
}

async function pngToPixels(png: string, width: number, height: number): Promise<Uint8ClampedArray> {
  const empty = new Uint8ClampedArray(width * height * 4);
  if (!png) return empty;
  try {
    const blob = await (await fetch(png)).blob();
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d");
    if (!ctx) return empty;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return ctx.getImageData(0, 0, width, height).data;
  } catch {
    return empty;
  }
}

export async function deserializeDoc(data: unknown): Promise<PixelDoc | null> {
  const d = data as SerializedDoc | null;
  if (!d || d.format !== "pixelpaint" || !Array.isArray(d.layers)) return null;
  const width = Math.max(1, Math.min(1024, Math.round(d.width)));
  const height = Math.max(1, Math.min(1024, Math.round(d.height)));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;

  const layers: Layer[] = [];
  for (const sl of d.layers) {
    layers.push({
      id: typeof sl.id === "string" ? sl.id : uid(),
      name: typeof sl.name === "string" ? sl.name : "图层",
      visible: sl.visible !== false,
      opacity: typeof sl.opacity === "number" ? Math.max(0, Math.min(1, sl.opacity)) : 1,
      pixels: await pngToPixels(sl.png, width, height),
    });
  }
  if (layers.length === 0) return null;
  return { width, height, layers };
}

// ---------- 自动草稿（localStorage） ----------
export function saveAutosave(doc: PixelDoc): { ok: boolean; reason?: string } {
  try {
    const json = JSON.stringify(serializeDoc(doc));
    if (json.length > MAX_AUTOSAVE_BYTES) {
      return { ok: false, reason: "画布过大，超出自动保存容量（请用「保存工程」导出文件）" };
    }
    localStorage.setItem(AUTOSAVE_KEY, json);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "保存失败" };
  }
}

export async function loadAutosave(): Promise<PixelDoc | null> {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    return await deserializeDoc(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearAutosave() {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    /* ignore */
  }
}

export function hasAutosave(): boolean {
  try {
    return localStorage.getItem(AUTOSAVE_KEY) !== null;
  } catch {
    return false;
  }
}

// ---------- 工程文件导出 / 导入 ----------
export function downloadProject(doc: PixelDoc, name = "pixelpaint") {
  const json = JSON.stringify(serializeDoc(doc));
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-${doc.width}x${doc.height}${PROJECT_EXT}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function readProjectFile(file: File): Promise<PixelDoc | null> {
  try {
    return await deserializeDoc(JSON.parse(await file.text()));
  } catch {
    return null;
  }
}
