import { describe, expect, it } from "vitest";
import { normalizeCutoutAlpha, removePixelBackground } from "./cutout";

function image(width: number, height: number, color: [number, number, number, number]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set(color, i);
  return pixels;
}

function setPixel(pixels: Uint8ClampedArray, width: number, x: number, y: number, color: [number, number, number, number]): void {
  pixels.set(color, (y * width + x) * 4);
}

function alphaAt(pixels: Uint8ClampedArray, width: number, x: number, y: number): number {
  return pixels[(y * width + x) * 4 + 3];
}

describe("normalizeCutoutAlpha", () => {
  it("像素硬边把连续 alpha 变成全透明或全不透明", () => {
    const result = new Uint8ClampedArray([
      255, 80, 40, 80,
      255, 80, 40, 128,
      255, 80, 40, 254,
    ]);
    const normalized = normalizeCutoutAlpha(result, null, { mode: "hard", threshold: 128 });
    expect(Array.from(normalized)).toEqual([
      255, 80, 40, 0,
      255, 80, 40, 255,
      255, 80, 40, 255,
    ]);
  });

  it("保留柔和边缘，同时不重新打开输入 PNG 的透明区域", () => {
    const result = new Uint8ClampedArray([
      255, 80, 40, 200,
      255, 80, 40, 160,
    ]);
    const source = new Uint8ClampedArray([
      255, 80, 40, 255,
      255, 80, 40, 0,
    ]);
    const normalized = normalizeCutoutAlpha(result, source, { mode: "soft", threshold: 128 });
    expect(Array.from(normalized)).toEqual([
      255, 80, 40, 200,
      255, 80, 40, 0,
    ]);
  });
});

describe("removePixelBackground", () => {
  it("从边缘学习背景色，并保护主体内部同色像素", () => {
    const width = 7;
    const height = 7;
    const pixels = image(width, height, [232, 28, 184, 255]);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) setPixel(pixels, width, x, y, [30, 48, 90, 255]);
    }
    setPixel(pixels, width, 3, 3, [232, 28, 184, 255]);
    const original = pixels.slice();

    const result = removePixelBackground(pixels, width, height, { scope: "connected", tolerance: 12 });

    expect(result.removedPixels).toBe(24);
    expect(alphaAt(result.pixels, width, 0, 0)).toBe(0);
    expect(alphaAt(result.pixels, width, 3, 3)).toBe(255);
    expect(alphaAt(result.pixels, width, 2, 3)).toBe(255);
    expect(Array.from(pixels)).toEqual(Array.from(original));
    expect(result.backgroundColors.length).toBeGreaterThan(0);
  });

  it("全局模式会移除主体内部的相近颜色", () => {
    const width = 5;
    const pixels = image(width, width, [246, 246, 246, 255]);
    for (let y = 1; y < width - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) setPixel(pixels, width, x, y, [36, 52, 86, 255]);
    }
    setPixel(pixels, width, 2, 2, [246, 246, 246, 255]);

    const result = removePixelBackground(pixels, width, width, { scope: "global", tolerance: 10 });

    expect(alphaAt(result.pixels, width, 2, 2)).toBe(0);
    expect(result.removedPixels).toBe(17);
  });

  it("容差可以覆盖边缘背景的轻微颜色变化，并保留原有 alpha", () => {
    const width = 4;
    const height = 4;
    const pixels = image(width, height, [248, 248, 248, 255]);
    setPixel(pixels, width, 1, 0, [240, 242, 246, 255]);
    setPixel(pixels, width, 2, 0, [242, 244, 248, 255]);
    setPixel(pixels, width, 1, 1, [28, 60, 120, 120]);
    setPixel(pixels, width, 2, 1, [28, 60, 120, 0]);

    const result = removePixelBackground(pixels, width, height, { scope: "connected", tolerance: 22 });

    expect(alphaAt(result.pixels, width, 0, 0)).toBe(0);
    expect(alphaAt(result.pixels, width, 1, 0)).toBe(0);
    expect(alphaAt(result.pixels, width, 1, 1)).toBe(120);
    expect(alphaAt(result.pixels, width, 2, 1)).toBe(0);
  });
});
