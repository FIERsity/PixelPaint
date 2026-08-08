// ============================================================
// PixelPaint · 帧动画数据模型（纯函数，可单测）
// 一个动画 = 若干帧；画布尺寸默认统一，各帧图层与像素内容独立
// ============================================================

import { createDoc, cloneDoc, resizeDoc, uid, type PixelDoc } from "./pixelDoc";
import type { Palette } from "./palette";

export interface PixelAnim {
  frames: PixelDoc[];
  fps: number;
  palette?: Palette;
}

export function createAnim(width = 32, height = 32, fps = 8, layerName = "图层 1", palette?: Palette): PixelAnim {
  return { frames: [createDoc(width, height, layerName)], fps, palette };
}

export function cloneFrame(doc: PixelDoc): PixelDoc {
  const clone = cloneDoc(doc);
  return { ...clone, layers: clone.layers.map((layer) => ({ ...layer, id: uid() })) };
}

/** 在当前帧之后插入新帧；blank = 空白同尺寸，duplicate = 复制当前帧 */
export function addFrame(anim: PixelAnim, mode: "blank" | "duplicate", index?: number, layerName = "图层 1"): PixelAnim {
  const i = Math.max(0, Math.min(index ?? anim.frames.length - 1, anim.frames.length - 1));
  const source = anim.frames[i];
  const next = mode === "duplicate"
    ? cloneFrame(source)
    : createDoc(source.width, source.height, layerName);
  return {
    ...anim,
    frames: [...anim.frames.slice(0, i + 1), next, ...anim.frames.slice(i + 1)],
  };
}

/** 删除一帧；至少保留一帧，删无可删返回 null */
export function deleteFrame(anim: PixelAnim, index: number): PixelAnim | null {
  if (anim.frames.length <= 1) return null;
  return {
    ...anim,
    frames: anim.frames.filter((_, idx) => idx !== index),
  };
}

export function moveFrame(anim: PixelAnim, from: number, to: number): PixelAnim {
  const frames = [...anim.frames];
  const [f] = frames.splice(from, 1);
  frames.splice(Math.max(0, Math.min(to, frames.length)), 0, f);
  return { ...anim, frames };
}

/** 将全部帧同步为同一画布尺寸，逐帧保留左上角内容。 */
export function resizeFrames(anim: PixelAnim, width: number, height: number): PixelAnim {
  if (anim.frames.every((frame) => frame.width === width && frame.height === height)) return anim;
  return {
    ...anim,
    frames: anim.frames.map((frame) => resizeDoc(frame, width, height)),
  };
}

/** 删除帧后校正当前选中索引 */
export function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length - 1));
}
