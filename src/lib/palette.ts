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

// 经典游戏调色板（色值来自 LOSPEC / 原作者）
export const ENDESGA32: Palette = {
  name: "ENDESGA-32",
  colors: [
    "#be4a2f", "#d77643", "#ead4aa", "#e4a672", "#b86f50", "#733e39", "#3e2731", "#a22633",
    "#e43b44", "#f77622", "#feae34", "#fee761", "#63c74d", "#3e8948", "#265c42", "#193c3e",
    "#124e89", "#0099db", "#2ce8f5", "#ffffff", "#c0cbdc", "#8b9bb4", "#5a6988", "#3a4466",
    "#262b44", "#181425", "#ff0044", "#68386c", "#b55088", "#f6757a", "#e8b796", "#c28569",
  ],
};

export const DB16: Palette = {
  name: "DawnBringer 16",
  colors: [
    "#140c1c", "#442434", "#30346d", "#4e4a4e", "#854c30", "#346524", "#d04648", "#757161",
    "#597dce", "#d27d2c", "#8595a1", "#6daa2c", "#d2aa99", "#6dc2ca", "#dad45e", "#deeed6",
  ],
};

export const DB32: Palette = {
  name: "DawnBringer 32",
  colors: [
    "#000000", "#222034", "#45283c", "#663931", "#8f563b", "#df7126", "#d9a066", "#eec39a",
    "#fbf236", "#99e550", "#6abe30", "#37946e", "#4b692f", "#524b24", "#323c39", "#3f3f74",
    "#306082", "#5b6ee1", "#639bff", "#5fcde4", "#cbdbfc", "#ffffff", "#9badb7", "#847e87",
    "#696a6a", "#595652", "#76428a", "#ac3232", "#d95763", "#d77bba", "#8f974a", "#8a6f30",
  ],
};

export const ARNE16: Palette = {
  name: "ARNE16",
  colors: [
    "#000000", "#9d9d9d", "#ffffff", "#be2633", "#e06f8b", "#493c2b", "#a46422", "#eb8931",
    "#f7e26b", "#2f484e", "#44891a", "#a3ce27", "#1b2632", "#005784", "#31a2f2", "#b2dcef",
  ],
};

export const APOLLO: Palette = {
  name: "Apollo",
  colors: [
    "#3f3f74", "#7a4369", "#a84f53", "#d67841", "#e5b361", "#c9d684", "#84b188", "#406b70",
    "#2f6d80", "#306082", "#475d91", "#584b82", "#6d4482", "#8a4682", "#a14d80", "#b75a79",
  ],
};

export const CGA: Palette = {
  name: "CGA",
  colors: [
    "#000000", "#0000aa", "#00aa00", "#00aaaa", "#aa0000", "#aa00aa", "#aa5500", "#aaaaaa",
    "#555555", "#5555ff", "#55ff55", "#55ffff", "#ff5555", "#ff55ff", "#ffff55", "#ffffff",
  ],
};

export const NO_PALETTE: Palette = { name: "自动（不限色）", colors: [] };

export const PRESET_PALETTES: Palette[] = [
  NO_PALETTE,
  SWEETIE16,
  PICO8,
  ENDESGA32,
  DB16,
  DB32,
  ARNE16,
  APOLLO,
  CGA,
  GAMEBOY,
  GRAYSCALE,
];

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
