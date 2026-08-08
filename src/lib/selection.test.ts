import { describe, expect, it } from "vitest";
import {
  combineSelectionMasks,
  countClippedOpaquePixels,
  countSelected,
  maskFromPoints,
  movePixelsBySelection,
  rectangleSelectionMask,
  shiftSelectionMask,
} from "./selection";

describe("pixel selection masks", () => {
  it("creates inclusive pixel-aligned rectangles", () => {
    const mask = rectangleSelectionMask(5, 4, 3, 2, 1, 1);
    expect(countSelected(mask)).toBe(6);
    expect(mask[1 * 5 + 1]).toBe(1);
    expect(mask[2 * 5 + 3]).toBe(1);
  });

  it("combines disconnected areas with add and subtract", () => {
    const first = maskFromPoints(4, 2, [[0, 0], [1, 0]]);
    const second = maskFromPoints(4, 2, [[3, 1]]);
    const added = combineSelectionMasks(first, second, "add");
    expect(countSelected(added)).toBe(3);
    const removed = combineSelectionMasks(added, maskFromPoints(4, 2, [[1, 0]]), "subtract");
    expect(countSelected(removed)).toBe(2);
    expect(removed[0]).toBe(1);
    expect(removed[7]).toBe(1);
  });

  it("supports replace and intersect", () => {
    const base = maskFromPoints(3, 1, [[0, 0], [1, 0]]);
    const gesture = maskFromPoints(3, 1, [[1, 0], [2, 0]]);
    expect(Array.from(combineSelectionMasks(base, gesture, "replace"))).toEqual([0, 1, 1]);
    expect(Array.from(combineSelectionMasks(base, gesture, "intersect"))).toEqual([0, 1, 0]);
  });

  it("shifts distributed selection islands and clips the mask", () => {
    const mask = maskFromPoints(4, 2, [[0, 0], [3, 1]]);
    expect(Array.from(shiftSelectionMask(mask, 4, 2, 1, 0))).toEqual([0, 1, 0, 0, 0, 0, 0, 0]);
  });
});

describe("moving selected pixels", () => {
  it("cuts the source, moves as a group and preserves relative spacing", () => {
    const pixels = new Uint8ClampedArray(4 * 4);
    pixels.set([255, 0, 0, 255], 0);
    pixels.set([0, 0, 255, 255], 2 * 4);
    const mask = maskFromPoints(4, 1, [[0, 0], [2, 0]]);
    const moved = movePixelsBySelection(pixels, mask, 4, 1, 1, 0);
    expect(Array.from(moved.pixels.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(moved.pixels.slice(4, 8))).toEqual([255, 0, 0, 255]);
    expect(Array.from(moved.pixels.slice(12, 16))).toEqual([0, 0, 255, 255]);
    expect(Array.from(moved.mask)).toEqual([0, 1, 0, 1]);
  });

  it("reports opaque pixels clipped outside the canvas", () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]);
    const mask = maskFromPoints(2, 1, [[0, 0], [1, 0]]);
    const moved = movePixelsBySelection(pixels, mask, 2, 1, -1, 0);
    expect(moved.clippedOpaque).toBe(1);
    expect(countClippedOpaquePixels(pixels, mask, 2, 1, -1, 0)).toBe(1);
    expect(countSelected(moved.mask)).toBe(1);
  });

  it("moves transparent selected cells as transparent pixels", () => {
    const pixels = new Uint8ClampedArray(3 * 4);
    pixels.set([255, 0, 0, 255], 0);
    pixels.set([0, 0, 255, 255], 2 * 4);
    const mask = maskFromPoints(3, 1, [[0, 0], [1, 0]]);
    const moved = movePixelsBySelection(pixels, mask, 3, 1, 1, 0);
    expect(Array.from(moved.pixels.slice(4, 8))).toEqual([255, 0, 0, 255]);
    expect(Array.from(moved.pixels.slice(8, 12))).toEqual([0, 0, 0, 0]);
  });
});
