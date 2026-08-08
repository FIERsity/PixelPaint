import { describe, expect, it } from "vitest";
import { analyzePixelArt } from "./pixelArt";

function rgba(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      pixels.set(fill(x, y), (y * width + x) * 4);
    }
  }
  return pixels;
}

describe("analyzePixelArt", () => {
  it("接受颜色重复、边缘硬朗的像素画", () => {
    const pixels = rgba(8, 8, (x, y) => {
      const even = (x < 4) === (y < 4);
      return even ? [255, 80, 80, 255] : [40, 80, 220, 255];
    });
    const result = analyzePixelArt(pixels, 8, 8);
    expect(result.isPixelArt).toBe(true);
    expect(result.reason).toBe("ok");
  });

  it("拒绝颜色过于丰富的照片或渐变类图片", () => {
    const pixels = rgba(32, 32, (x, y) => [x * 8, y * 8, (x * 7 + y * 3) % 256, 255]);
    const result = analyzePixelArt(pixels, 32, 32);
    expect(result.isPixelArt).toBe(false);
    expect(["too-many-colors", "low-repetition"]).toContain(result.reason);
  });

  it("拒绝大量半透明抗锯齿边缘", () => {
    const pixels = rgba(16, 16, (x, y) => (x < 8 && y < 8 ? [255, 255, 255, 128] : [0, 0, 0, 255]));
    const result = analyzePixelArt(pixels, 16, 16);
    expect(result.isPixelArt).toBe(false);
    expect(result.reason).toBe("soft-edges");
  });

  it("拒绝超过画板支持尺寸的图片", () => {
    const result = analyzePixelArt(new Uint8ClampedArray(513 * 4), 513, 1);
    expect(result.isPixelArt).toBe(false);
    expect(result.reason).toBe("too-large");
  });
});
