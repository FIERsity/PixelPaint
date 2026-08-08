import { describe, expect, it } from "vitest";
import {
  normalizePaletteColors,
  paletteToGpl,
  paletteToJson,
  parsePaletteText,
  createCustomPalette,
} from "./palette";

describe("palette formats", () => {
  it("normalizes hex colors and removes duplicates", () => {
    expect(normalizePaletteColors(["#fff", "#FFFFFF", "oops", "#123456"])).toEqual(["#ffffff", "#123456"]);
  });

  it("reads a GIMP GPL palette", () => {
    const palette = parsePaletteText("GIMP Palette\nName: Test\nColumns: 2\n#\n255 0 0 red\n0 128 255 blue\n", "test.gpl");
    expect(palette?.name).toBe("Test");
    expect(palette?.colors).toEqual(["#ff0000", "#0080ff"]);
  });

  it("reads PixelPaint JSON and plain hex text", () => {
    const json = parsePaletteText(JSON.stringify({ format: "pixelpaint-palette", name: "JSON test", colors: ["#abc", "#112233"] }), "test.json");
    const text = parsePaletteText("#ff0000\n#00ff00\n#0000ff", "colors.txt");
    expect(json?.name).toBe("JSON test");
    expect(json?.colors).toEqual(["#aabbcc", "#112233"]);
    expect(text?.colors).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
  });

  it("exports both native JSON and GPL text", () => {
    const palette = createCustomPalette("Demo", ["#ff0000"]);
    expect(paletteToJson(palette)).toContain('"format": "pixelpaint-palette"');
    expect(paletteToGpl(palette)).toContain("GIMP Palette");
    expect(paletteToGpl(palette)).toContain("255   0   0 #ff0000");
  });
});
