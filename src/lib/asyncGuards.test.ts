import { describe, expect, it } from "vitest";
import { isCurrentAsyncRun, isCurrentConversionResponse } from "./asyncGuards";

describe("conversion response freshness", () => {
  it("only accepts the latest request for the current input generation", () => {
    expect(isCurrentConversionResponse({ id: 4, generation: 2 }, 4, 2, true)).toBe(true);
    expect(isCurrentConversionResponse({ id: 3, generation: 2 }, 4, 2, true)).toBe(false);
    expect(isCurrentConversionResponse({ id: 4, generation: 1 }, 4, 2, true)).toBe(false);
  });

  it("rejects an otherwise current response after the source is cleared", () => {
    expect(isCurrentConversionResponse({ id: 4, generation: 2 }, 4, 2, false)).toBe(false);
  });
});

describe("background run freshness", () => {
  it("requires both the current run id and a mounted consumer", () => {
    expect(isCurrentAsyncRun(3, 3, true)).toBe(true);
    expect(isCurrentAsyncRun(2, 3, true)).toBe(false);
    expect(isCurrentAsyncRun(3, 3, false)).toBe(false);
  });
});
