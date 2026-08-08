// ============================================================
// PixelPaint · 用户调色板本地库
// ============================================================

import {
  createCustomPalette,
  CUSTOM_PALETTE,
  normalizePaletteColors,
  type Palette,
} from "./palette";

export const PALETTE_LIBRARY_KEY = "pixelpaint:palette-library:v1";

function sanitizePalette(value: unknown): Palette | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || !Array.isArray(record.colors)) return null;
  const colors = normalizePaletteColors(record.colors);
  return {
    id: typeof record.id === "string" && record.id ? record.id : createCustomPalette(record.name, colors).id,
    name: record.name.trim() || "自定义",
    colors,
    source: "custom",
  };
}

export function loadCustomPalettes(): Palette[] {
  try {
    const raw = localStorage.getItem(PALETTE_LIBRARY_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const palettes = parsed.map(sanitizePalette).filter((palette): palette is Palette => Boolean(palette));
        if (palettes.length > 0) return palettes;
      }
    }
  } catch {
    // 浏览器禁用存储时使用内存中的默认调色板。
  }
  return [{ ...CUSTOM_PALETTE, colors: [...CUSTOM_PALETTE.colors] }];
}

export function saveCustomPalettes(palettes: Palette[]): void {
  try {
    localStorage.setItem(PALETTE_LIBRARY_KEY, JSON.stringify(palettes.map((palette) => ({
      id: palette.id,
      name: palette.name,
      colors: normalizePaletteColors(palette.colors),
    }))));
  } catch {
    // 本地存储空间不足时不阻断绘图。
  }
}
