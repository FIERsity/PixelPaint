import type { PixelDoc } from "./pixelDoc";
import { createCustomPalette, normalizePaletteColors, type Palette } from "./palette";

export type CanvasImportSource = "pixelize" | "background" | "image";

export interface CanvasImportRequest {
  doc: PixelDoc;
  source: CanvasImportSource;
  sourceName: string;
  extractedColors?: string[];
}

export function paletteNameFromSource(sourceName: string, fallback: string): string {
  const stem = sourceName.replace(/\.[^.]+$/, "").trim();
  return stem || fallback;
}

export function samePaletteColors(a: unknown[], b: unknown[]): boolean {
  const left = normalizePaletteColors(a);
  const right = normalizePaletteColors(b);
  return left.length === right.length && left.every((color, index) => color === right[index]);
}

export function resolveImportedPalette(
  palettes: Palette[],
  sourceName: string,
  colors: unknown[],
  fallbackName: string,
): { palette: Palette; palettes: Palette[]; reused: boolean } | null {
  const normalized = normalizePaletteColors(colors);
  if (normalized.length === 0) return null;

  const existing = palettes.find((palette) => palette.source === "custom" && samePaletteColors(palette.colors, normalized));
  if (existing) return { palette: existing, palettes, reused: true };

  const base = paletteNameFromSource(sourceName, fallbackName);
  let name = base;
  let suffix = 2;
  while (palettes.some((palette) => palette.name === name)) name = `${base} ${suffix++}`;
  const palette = createCustomPalette(name, normalized);
  return { palette, palettes: [...palettes, palette], reused: false };
}
