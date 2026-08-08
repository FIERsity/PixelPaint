import { describe, expect, it } from "vitest";
import { clampDimension, normalizeDimensionDraft, parseDimensionDraft } from "./dimensions";

describe("dimension input", () => {
  it("allows an empty draft while the last valid value remains safe", () => {
    expect(parseDimensionDraft("")).toBeNull();
    expect(parseDimensionDraft("0")).toBeNull();
    expect(parseDimensionDraft("64")).toBe(64);
    expect(normalizeDimensionDraft("", 32)).toBe("32");
  });

  it("keeps dimensions within the supported range", () => {
    expect(clampDimension(0)).toBe(1);
    expect(clampDimension(513)).toBe(512);
    expect(parseDimensionDraft("513")).toBeNull();
    expect(normalizeDimensionDraft("513", 32)).toBe("32");
  });
});
