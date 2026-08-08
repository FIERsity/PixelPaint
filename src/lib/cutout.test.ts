import { describe, expect, it } from "vitest";
import { normalizeCutoutAlpha } from "./cutout";

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
