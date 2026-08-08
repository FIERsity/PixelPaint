// PixelPaint · 调色板

export interface Palette {
  name: string;
  colors: string[]; // hex
}

// 经典游戏复古调色板（PICO-8 / Sweetie 16 常用 16 色）
export const SWEETIE16: Palette = {
  name: "Sweetie 16",
  colors: [
    "#1a1c2c", "#5d275d", "#b13e53", "#ef7d57",
    "#ffcd75", "#a7f070", "#38b764", "#257179",
    "#29366f", "#3b5dc9", "#41a6f6", "#73eff7",
    "#f4f4f4", "#94b0c2", "#566c86", "#333c57",
  ],
};

export const PICO8: Palette = {
  name: "PICO-8",
  colors: [
    "#000000", "#1D2B53", "#7E2553", "#008751",
    "#AB5236", "#5F574F", "#C2C3C7", "#FFF1E8",
    "#FF004D", "#FFA300", "#FFEC27", "#00E436",
    "#29ADFF", "#83769C", "#FF77A8", "#FFCCAA",
  ],
};

export const GAMEBOY: Palette = {
  name: "Game Boy",
  colors: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"],
};

export const GRAYSCALE: Palette = {
  name: "灰度",
  colors: ["#000000", "#3b3b3b", "#767676", "#b2b2b2", "#eeeeee", "#ffffff"],
};

export const NO_PALETTE: Palette = { name: "自动（不限色）", colors: [] };

export const PRESET_PALETTES: Palette[] = [NO_PALETTE, SWEETIE16, PICO8, GAMEBOY, GRAYSCALE];

export const DEFAULT_PALETTE = SWEETIE16;

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

export function parseHex(input: string): [number, number, number] | null {
  const m = input.trim().match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return null;
  return hexToRgb(m[1]);
}
