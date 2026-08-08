import { describe, expect, it } from "vitest";
import { resolveImportedPalette, samePaletteColors } from "./importFlow";
import type { Palette } from "./palette";

const palette = (id: string, name: string, colors: string[]): Palette => ({ id, name, colors, source: "custom" });

describe("canvas import palette", () => {
  it("reuses a custom palette only when normalized colors and order match", () => {
    const existing = palette("one", "Hero", ["#112233", "#abcdef"]);
    expect(resolveImportedPalette([existing], "other.png", ["#123", "#ABCDEF"], "Extracted")?.palette).toBe(existing);
    expect(samePaletteColors(existing.colors, ["#abcdef", "#112233"])).toBe(false);
  });

  it("adds a numeric suffix when the source name is already used by different colors", () => {
    const existing = palette("one", "hero", ["#000000"]);
    const result = resolveImportedPalette([existing], "hero.png", ["#ffffff"], "Extracted");
    expect(result?.palette.name).toBe("hero 2");
    expect(result?.palettes).toHaveLength(2);
  });
});
