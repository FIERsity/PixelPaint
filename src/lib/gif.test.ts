import { describe, expect, it } from "vitest";
import { encodeGif } from "./gif";

function markerCount(bytes: Uint8Array, marker: number[]) {
  let count = 0;
  for (let i = 0; i <= bytes.length - marker.length; i++) {
    if (marker.every((value, offset) => bytes[i + offset] === value)) count += 1;
  }
  return count;
}

describe("encodeGif", () => {
  it("生成带有每帧控制块和图像描述符的 GIF89a", () => {
    const frame1 = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 0, 0, 0,
      0, 0, 0, 0, 255, 255, 255, 255,
    ]);
    const frame2 = new Uint8ClampedArray([
      0, 0, 0, 0, 255, 0, 0, 255,
      255, 255, 255, 255, 0, 0, 0, 0,
    ]);
    const bytes = encodeGif([
      { width: 2, height: 2, pixels: frame1 },
      { width: 2, height: 2, pixels: frame2 },
    ], 8);

    expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe("GIF89a");
    expect(bytes[bytes.length - 1]).toBe(0x3b);
    expect(markerCount(bytes, [0x21, 0xf9, 0x04])).toBe(2);
    expect(markerCount(bytes, [0x2c])).toBe(2);
    expect(markerCount(bytes, [0x21, 0xff, 0x0b])).toBe(1);
    const ascii = new TextDecoder("latin1").decode(bytes);
    expect(ascii.indexOf("NETSCAPE2.0")).toBeGreaterThan(0);
    expect(ascii.indexOf("NETSCAPE2.0")).toBeLessThan(bytes.indexOf(0x2c));
    const loopExtension = bytes.indexOf(0x21, ascii.indexOf("NETSCAPE2.0") - 3);
    expect(Array.from(bytes.slice(loopExtension + 14, loopExtension + 19))).toEqual([0x03, 0x01, 0x00, 0x00, 0x00]);
  });

  it("支持不同帧尺寸并在共同画布中编码", () => {
    const bytes = encodeGif([
      { width: 1, height: 1, pixels: new Uint8ClampedArray([255, 0, 0, 255]) },
      { width: 2, height: 1, pixels: new Uint8ClampedArray([0, 0, 255, 255, 0, 0, 0, 0]) },
    ], 12);
    expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe("GIF89a");
    expect(bytes[6]).toBe(2); // logical screen width
    expect(bytes[8]).toBe(1); // logical screen height
  });
});
