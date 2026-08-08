import { describe, expect, it } from "vitest";
import {
  addFrame, clampIndex, createAnim, deleteFrame, moveFrame, resizeFrames,
} from "./anim";
import { putPixel } from "./pixelDoc";

describe("anim 帧操作", () => {
  it("createAnim 只有一帧，尺寸与 fps 正确", () => {
    const a = createAnim(16, 24, 12);
    expect(a.frames).toHaveLength(1);
    expect(a.frames[0].width).toBe(16);
    expect(a.frames[0].height).toBe(24);
    expect(a.fps).toBe(12);
  });

  it("addFrame blank 生成空白同尺寸帧，插在当前帧后", () => {
    const a = createAnim(16, 16);
    const b = addFrame(a, "blank");
    expect(b.frames).toHaveLength(2);
    expect(b.frames[1].width).toBe(16);
    // 空白帧像素全透明
    expect(b.frames[1].layers[0].pixels.every((v) => v === 0)).toBe(true);
  });

  it("addFrame duplicate 深拷贝当前帧，互不影响", () => {
    const a = createAnim(16, 16);
    putPixel(a.frames[0].layers[0].pixels, 16, 1, 1, 255, 0, 0, 255);
    const b = addFrame(a, "duplicate");
    expect(b.frames[1].layers[0].id).not.toBe(a.frames[0].layers[0].id);
    // 复制帧在 (1,1) 有原内容：idx=(1*16+1)*4+3=71
    expect(b.frames[1].layers[0].pixels[71]).toBe(255);
    // 修改原帧不影响复制帧
    putPixel(a.frames[0].layers[0].pixels, 16, 1, 1, 0, 0, 0, 0);
    expect(b.frames[1].layers[0].pixels[71]).toBe(255);
  });

  it("deleteFrame 至少保留一帧", () => {
    const a = createAnim(8, 8);
    expect(deleteFrame(a, 0)).toBeNull();
    const two = addFrame(a, "blank");
    expect(deleteFrame(two, 0)!.frames).toHaveLength(1);
  });

  it("moveFrame 支持前后移动", () => {
    let a = createAnim(8, 8);
    a = addFrame(a, "blank");
    a = addFrame(a, "blank");
    // 3 帧，把第 3 帧移到第 1 位
    const m = moveFrame(a, 2, 0);
    const ids = m.frames.map((f) => f.layers[0].id);
    expect(ids[0]).toBe(a.frames[2].layers[0].id);
    expect(ids[2]).toBe(a.frames[1].layers[0].id);
  });

  it("resizeFrames 同步调整全部帧并保留各帧内容", () => {
    let a = createAnim(4, 4);
    a = addFrame(a, "blank");
    putPixel(a.frames[0].layers[0].pixels, 4, 1, 1, 255, 0, 0, 255);
    putPixel(a.frames[1].layers[0].pixels, 4, 2, 2, 0, 255, 0, 255);

    const resized = resizeFrames(a, 3, 3);

    expect(resized.frames.every((frame) => frame.width === 3 && frame.height === 3)).toBe(true);
    expect(resized.frames[0].layers[0].pixels[(1 * 3 + 1) * 4]).toBe(255);
    expect(resized.frames[1].layers[0].pixels[(2 * 3 + 2) * 4 + 1]).toBe(255);
  });

  it("clampIndex 越界修正", () => {
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(1, 3)).toBe(1);
  });
});
