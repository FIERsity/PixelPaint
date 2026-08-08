import { describe, expect, it } from "vitest";
import { matchSquareSizePreset } from "./sizePresets";

describe("size presets", () => {
  it("matches supported square sizes", () => {
    expect(matchSquareSizePreset(32, 32)).toBe("32");
    expect(matchSquareSizePreset(256, 256)).toBe("256");
  });

  it("uses custom for non-square and unsupported sizes", () => {
    expect(matchSquareSizePreset(48, 32)).toBe("custom");
    expect(matchSquareSizePreset(24, 24)).toBe("custom");
  });
});
