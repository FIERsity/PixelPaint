// ============================================================
// PixelPaint · 工程持久化
// 图层像素用 PNG dataURL 编码（比裸 base64 小一个数量级），
// 便于存 localStorage 自动草稿，也便于导出 .pixelpaint.json 工程文件。
// ============================================================

import { uid, type Layer, type PixelDoc } from "./pixelDoc";
import type { PixelAnim } from "./anim";

export const AUTOSAVE_KEY = "pixelpaint:autosave:v2";
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

// v2：多帧工程
export interface SerializedProject {
  format: "pixelpaint";
  version: 2;
  fps: number;
  savedAt: number;
  frames: SerializedDoc[];
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

// ---------- 多帧工程 ----------
export function serializeAnim(anim: PixelAnim): SerializedProject {
  return {
    format: "pixelpaint",
    version: 2,
    fps: anim.fps,
    savedAt: Date.now(),
    frames: anim.frames.map((f) => serializeDoc(f)),
  };
}

export async function deserializeAnim(data: unknown): Promise<PixelAnim | null> {
  const d = data as { format?: string; version?: number; fps?: number; frames?: SerializedDoc[] } | null;
  if (!d || d.format !== "pixelpaint") return null;

  // v1 单帧兼容：把旧工程当成单帧动画
  if ((d.version ?? 1) < 2 || !Array.isArray(d.frames) || d.frames.length === 0) {
    const doc = await deserializeDoc(d as SerializedDoc);
    if (!doc) return null;
    return { frames: [doc], fps: 8 };
  }

  const frames: PixelDoc[] = [];
  for (const f of d.frames) {
    const doc = await deserializeDoc(f);
    if (doc) frames.push(doc);
  }
  if (frames.length === 0) return null;
  const fps = typeof d.fps === "number" && d.fps >= 1 && d.fps <= 60 ? Math.round(d.fps) : 8;
  return { frames, fps };
}

// ---------- 自动草稿（localStorage） ----------
export function saveAutosave(anim: PixelAnim): { ok: boolean; reason?: string } {
  try {
    const json = JSON.stringify(serializeAnim(anim));
    if (json.length > MAX_AUTOSAVE_BYTES) {
      return { ok: false, reason: "工程过大，超出自动保存容量（请用「保存工程」导出文件）" };
    }
    localStorage.setItem(AUTOSAVE_KEY, json);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "保存失败" };
  }
}

export async function loadAutosave(): Promise<PixelAnim | null> {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    return await deserializeAnim(JSON.parse(raw));
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
export function downloadProject(anim: PixelAnim, name = "pixelpaint") {
  const json = JSON.stringify(serializeAnim(anim));
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const w = anim.frames[0]?.width ?? 32;
  const h = anim.frames[0]?.height ?? 32;
  a.download = `${name}-${w}x${h}${PROJECT_EXT}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function readProjectFile(file: File): Promise<PixelAnim | null> {
  try {
    return await deserializeAnim(JSON.parse(await file.text()));
  } catch {
    return null;
  }
}
