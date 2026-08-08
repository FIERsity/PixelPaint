// ============================================================
// PixelPaint · 帧动画数据模型（纯函数，可单测）
// 一个动画 = 若干帧，每帧是一个独立 PixelDoc（宽高/图层独立）
// ============================================================

import { createDoc, cloneDoc, type PixelDoc } from "./pixelDoc";

export interface PixelAnim {
  frames: PixelDoc[];
  fps: number;
}

export function createAnim(width = 32, height = 32, fps = 8): PixelAnim {
  return { frames: [createDoc(width, height)], fps };
}

export function cloneFrame(doc: PixelDoc): PixelDoc {
  return cloneDoc(doc);
}

/** 在当前帧之后插入新帧；blank = 空白同尺寸，duplicate = 复制当前帧 */
export function addFrame(anim: PixelAnim, mode: "blank" | "duplicate", index?: number): PixelAnim {
  const i = Math.max(0, Math.min(index ?? anim.frames.length - 1, anim.frames.length - 1));
  const source = anim.frames[i];
  const next = mode === "duplicate"
    ? cloneFrame(source)
    : createDoc(source.width, source.height);
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

/** 删除帧后校正当前选中索引 */
export function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length - 1));
}
