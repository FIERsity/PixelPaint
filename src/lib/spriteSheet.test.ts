import { describe, expect, it } from "vitest";
import {
  MAX_SPRITE_SHEET_EDGE,
  SpriteSheetError,
  buildSpriteSheet,
  planSpriteSheet,
  type SpriteSheetFrame,
} from "./spriteSheet";

function frame(width: number, height: number, rgba: [number, number, number, number]): SpriteSheetFrame {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set(rgba, i);
  return { width, height, pixels };
}

function pixelAt(pixels: Uint8ClampedArray, width: number, x: number, y: number) {
  return Array.from(pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
}

describe("sprite sheet", () => {
  it("按帧顺序横向排列并保留透明格子区域", () => {
    const result = buildSpriteSheet([
      frame(1, 1, [255, 0, 0, 255]),
      frame(2, 1, [0, 255, 0, 255]),
      frame(1, 2, [0, 0, 255, 255]),
    ], { layout: "horizontal" });

    expect(result).toMatchObject({ columns: 3, rows: 1, cellWidth: 2, cellHeight: 2, width: 6, height: 2 });
    expect(pixelAt(result.pixels, result.width, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(result.pixels, result.width, 1, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(result.pixels, result.width, 2, 0)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(result.pixels, result.width, 4, 1)).toEqual([0, 0, 255, 255]);
  });

  it("按行优先生成网格并留下最后的空槽", () => {
    const result = buildSpriteSheet([
      frame(1, 1, [1, 0, 0, 255]),
      frame(1, 1, [2, 0, 0, 255]),
      frame(1, 1, [3, 0, 0, 255]),
    ], { layout: "grid", columns: 2 });

    expect(result).toMatchObject({ columns: 2, rows: 2, width: 2, height: 2 });
    expect(pixelAt(result.pixels, result.width, 0, 0)[0]).toBe(1);
    expect(pixelAt(result.pixels, result.width, 1, 0)[0]).toBe(2);
    expect(pixelAt(result.pixels, result.width, 0, 1)[0]).toBe(3);
    expect(pixelAt(result.pixels, result.width, 1, 1)).toEqual([0, 0, 0, 0]);
  });

  it("支持纵向排列和最近邻整数放大", () => {
    const result = buildSpriteSheet([
      frame(1, 1, [10, 20, 30, 40]),
      frame(1, 1, [50, 60, 70, 80]),
    ], { layout: "vertical", scale: 2 });

    expect(result).toMatchObject({ columns: 1, rows: 2, width: 2, height: 4, scale: 2 });
    expect(pixelAt(result.pixels, result.width, 1, 1)).toEqual([10, 20, 30, 40]);
    expect(pixelAt(result.pixels, result.width, 0, 2)).toEqual([50, 60, 70, 80]);
  });

  it("在分配像素缓冲区前拒绝过大的输出", () => {
    expect(() => planSpriteSheet([
      { width: 512, height: 512 },
      { width: 512, height: 512 },
    ], { layout: "horizontal", scale: 16 })).toThrowError(SpriteSheetError);

    try {
      planSpriteSheet([{ width: MAX_SPRITE_SHEET_EDGE + 1, height: 1 }], { layout: "horizontal" });
    } catch (error) {
      expect(error).toMatchObject({ code: "too-large", width: MAX_SPRITE_SHEET_EDGE + 1, height: 1 });
    }
  });

  it("拒绝无效列数和像素长度", () => {
    expect(() => planSpriteSheet([{ width: 1, height: 1 }], { layout: "grid", columns: 0 })).toThrowError(SpriteSheetError);
    expect(() => buildSpriteSheet([
      { width: 1, height: 1, pixels: new Uint8ClampedArray(3) },
    ], { layout: "horizontal" })).toThrowError(SpriteSheetError);
  });
});
