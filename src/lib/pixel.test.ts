import { describe, expect, it } from "vitest";
import { downsample, imageToPixels, quantize } from "./pixel";

function solid(w: number, h: number, rgb: [number, number, number]) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = 255;
  }
  return px;
}

describe("downsample", () => {
  it("纯色图降采样后仍是同一颜色", () => {
    const out = downsample(solid(8, 8, [200, 100, 50]), 8, 8, 4, 4);
    expect(out).toHaveLength(4 * 4 * 4);
    expect([out[0], out[1], out[2], out[3]]).toEqual([200, 100, 50, 255]);
  });

  it("非法尺寸返回空数组而不是崩溃（回归：删空输入框导致白屏）", () => {
    expect(downsample(solid(4, 4, [0, 0, 0]), 4, 4, 0, 4)).toHaveLength(0);
    expect(downsample(solid(4, 4, [0, 0, 0]), 4, 4, 4, 0)).toHaveLength(0);
    expect(downsample(solid(4, 4, [0, 0, 0]), 4, 4, -1, -1)).toHaveLength(0);
  });

  it("放大也能工作（输出大于输入）", () => {
    const out = downsample(solid(2, 2, [10, 20, 30]), 2, 2, 4, 4);
    expect(out).toHaveLength(64);
    expect(out[3]).toBe(255);
  });

  it("使用预乘 alpha 插值，不让透明像素的隐藏 RGB 污染边缘", () => {
    const src = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 0, 255, 0,
    ]);
    const out = downsample(src, 2, 1, 4, 1);
    expect([out[4], out[5], out[6], out[7]]).toEqual([255, 0, 0, 128]);
    expect([out[12], out[13], out[14], out[15]]).toEqual([0, 0, 0, 0]);
  });
});

describe("quantize", () => {
  it("颜色数已少于上限时原样返回", () => {
    const px = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
    ]);
    const { pixels } = quantize(px, 16);
    expect(Array.from(pixels)).toEqual(Array.from(px));
  });

  it("把渐变压到指定色数以内", () => {
    // 64 个不同灰阶
    const px = new Uint8ClampedArray(64 * 4);
    for (let i = 0; i < 64; i++) {
      px[i * 4] = i * 4; px[i * 4 + 1] = i * 4; px[i * 4 + 2] = i * 4; px[i * 4 + 3] = 255;
    }
    const { pixels } = quantize(px, 4);
    const distinct = new Set<string>();
    for (let i = 0; i < pixels.length; i += 4) distinct.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    expect(distinct.size).toBeLessThanOrEqual(4);
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("保留透明像素的 alpha", () => {
    const px = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]);
    const { pixels } = quantize(px, 2);
    expect(pixels[7]).toBe(0);
  });

  it("主色调占多数时仍保留其它色相（回归：之前按像素数优先导致同色调）", () => {
    // 大量红色系渐变 + 少量蓝/绿/黄纯色
    const px = new Uint8ClampedArray(512 * 4);
    let i = 0;
    // 400 个红色系（渐变，制造“主色调大量相近色”）
    for (let n = 0; n < 400; n++) {
      const v = 40 + (n % 200);
      px[i++] = v; px[i++] = 10; px[i++] = 10; px[i++] = 255;
    }
    // 各 40 个纯蓝/绿/黄
    for (let n = 0; n < 40; n++) { px[i++] = 0; px[i++] = 0; px[i++] = 255; px[i++] = 255; }
    for (let n = 0; n < 40; n++) { px[i++] = 0; px[i++] = 255; px[i++] = 0; px[i++] = 255; }
    for (let n = 0; n < 40; n++) { px[i++] = 255; px[i++] = 255; px[i++] = 0; px[i++] = 255; }

    const { pixels } = quantize(px, 8);
    // 收集输出颜色，检查蓝/绿/黄是否仍存在（接近各自纯色）
    const seen = new Set<string>();
    for (let k = 0; k < pixels.length; k += 4) {
      if (pixels[k + 3] === 0) continue;
      const key = `${pixels[k]},${pixels[k + 1]},${pixels[k + 2]}`;
      seen.add(key);
    }
    const near = (c: [number, number, number], tol = 40) =>
      [...seen].some((s) => {
        const [r, g, b] = s.split(",").map(Number);
        return Math.abs(r - c[0]) <= tol && Math.abs(g - c[1]) <= tol && Math.abs(b - c[2]) <= tol;
      });
    expect(near([0, 0, 255]), "蓝色应保留").toBe(true);
    expect(near([0, 255, 0]), "绿色应保留").toBe(true);
    expect(near([255, 255, 0]), "黄色应保留").toBe(true);
    // 颜色种类不超过上限
    expect(seen.size).toBeLessThanOrEqual(8);
  });

  it("maxColors<=0 视为不限色", () => {
    const px = solid(4, 1, [123, 45, 67]);
    const { pixels } = quantize(px, 0);
    expect(Array.from(pixels)).toEqual(Array.from(px));
  });
});

describe("imageToPixels", () => {
  it("输出尺寸与请求一致", () => {
    const { pixels } = imageToPixels(solid(16, 16, [100, 150, 200]), 16, 16, {
      outWidth: 8, outHeight: 4, maxColors: 16, palette: null, dither: "none",
    });
    expect(pixels).toHaveLength(8 * 4 * 4);
  });

  it("固定调色板下所有输出颜色都来自该调色板", () => {
    const palette = ["#000000", "#ffffff"];
    const src = new Uint8ClampedArray(4 * 4);
    // 四个不同灰阶
    [30, 90, 160, 240].forEach((v, i) => {
      src[i * 4] = v; src[i * 4 + 1] = v; src[i * 4 + 2] = v; src[i * 4 + 3] = 255;
    });
    const { pixels } = imageToPixels(src, 4, 1, {
      outWidth: 4, outHeight: 1, maxColors: 16, palette, dither: "none",
    });
    for (let i = 0; i < pixels.length; i += 4) {
      const hex = `${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`;
      expect(["0,0,0", "255,255,255"]).toContain(hex);
    }
  });

  it("各抖动算法都不会崩溃且尺寸正确", () => {
    for (const dither of ["none", "floyd", "atkinson", "bayer2", "bayer4"] as const) {
      const { pixels } = imageToPixels(solid(8, 8, [120, 130, 140]), 8, 8, {
        outWidth: 4, outHeight: 4, maxColors: 4, palette: null, dither,
      });
      expect(pixels, `dither=${dither}`).toHaveLength(4 * 4 * 4);
    }
  });

  it.each(["bayer2", "bayer4"] as const)("%s 固定调色板输出仍全部属于该调色板", (dither) => {
    const values = [32, 96, 160, 224];
    const src = new Uint8ClampedArray(values.length * 4);
    values.forEach((value, index) => src.set([value, value, value, 255], index * 4));
    const { pixels } = imageToPixels(src, 4, 1, {
      outWidth: 4, outHeight: 1, maxColors: 16, palette: ["#000000", "#ffffff"], dither,
    });
    const colors = new Set<string>();
    for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    expect([...colors].every((color) => color === "0,0,0" || color === "255,255,255")).toBe(true);
    expect(colors.size).toBe(2);
  });

  it("Bayer 自动调色板输出仍全部属于返回调色板", () => {
    const src = new Uint8ClampedArray(16 * 4);
    for (let i = 0; i < 16; i++) src.set([i * 16, 80, 255 - i * 16, 255], i * 4);
    const { pixels, palette } = imageToPixels(src, 16, 1, {
      outWidth: 16, outHeight: 1, maxColors: 4, palette: null, dither: "bayer4",
    });
    const allowed = new Set(palette.map((color) => color.join(",")));
    for (let i = 0; i < pixels.length; i += 4) {
      expect(allowed.has(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`)).toBe(true);
    }
  });

  it("透明输入保持透明（不会被填成黑色）", () => {
    const src = new Uint8ClampedArray(4 * 4); // 全透明
    const { pixels } = imageToPixels(src, 2, 2, {
      outWidth: 2, outHeight: 2, maxColors: 8, palette: ["#ff0000"], dither: "none",
    });
    for (let i = 3; i < pixels.length; i += 4) expect(pixels[i]).toBe(0);
  });

  it("非法输出尺寸会被安全归一化", () => {
    const { pixels } = imageToPixels(solid(2, 2, [100, 150, 200]), 2, 2, {
      outWidth: 0, outHeight: 0, maxColors: 4, palette: null, dither: "none",
    });
    expect(pixels).toHaveLength(1 * 1 * 4);
  });
});
