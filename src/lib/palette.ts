// PixelPaint · 调色板

export interface Palette {
  id: string;
  name: string;
  colors: string[]; // hex
  source: "auto" | "builtin" | "custom";
}

// 经典游戏复古调色板（PICO-8 / Sweetie 16 常用 16 色）
export const SWEETIE16: Palette = {
  id: "sweetie16",
  name: "Sweetie 16",
  source: "builtin",
  colors: [
    "#1a1c2c", "#5d275d", "#b13e53", "#ef7d57",
    "#ffcd75", "#a7f070", "#38b764", "#257179",
    "#29366f", "#3b5dc9", "#41a6f6", "#73eff7",
    "#f4f4f4", "#94b0c2", "#566c86", "#333c57",
  ],
};

export const PICO8: Palette = {
  id: "pico8",
  name: "PICO-8",
  source: "builtin",
  colors: [
    "#000000", "#1D2B53", "#7E2553", "#008751",
    "#AB5236", "#5F574F", "#C2C3C7", "#FFF1E8",
    "#FF004D", "#FFA300", "#FFEC27", "#00E436",
    "#29ADFF", "#83769C", "#FF77A8", "#FFCCAA",
  ],
};

export const GAMEBOY: Palette = {
  id: "gameboy",
  name: "Game Boy",
  source: "builtin",
  colors: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"],
};

export const GRAYSCALE: Palette = {
  id: "grayscale",
  name: "灰度",
  source: "builtin",
  colors: ["#000000", "#3b3b3b", "#767676", "#b2b2b2", "#eeeeee", "#ffffff"],
};

// 经典游戏调色板（色值来自 LOSPEC / 原作者）
export const ENDESGA32: Palette = {
  id: "endesga32",
  name: "ENDESGA-32",
  source: "builtin",
  colors: [
    "#be4a2f", "#d77643", "#ead4aa", "#e4a672", "#b86f50", "#733e39", "#3e2731", "#a22633",
    "#e43b44", "#f77622", "#feae34", "#fee761", "#63c74d", "#3e8948", "#265c42", "#193c3e",
    "#124e89", "#0099db", "#2ce8f5", "#ffffff", "#c0cbdc", "#8b9bb4", "#5a6988", "#3a4466",
    "#262b44", "#181425", "#ff0044", "#68386c", "#b55088", "#f6757a", "#e8b796", "#c28569",
  ],
};

export const DB16: Palette = {
  id: "db16",
  name: "DawnBringer 16",
  source: "builtin",
  colors: [
    "#140c1c", "#442434", "#30346d", "#4e4a4e", "#854c30", "#346524", "#d04648", "#757161",
    "#597dce", "#d27d2c", "#8595a1", "#6daa2c", "#d2aa99", "#6dc2ca", "#dad45e", "#deeed6",
  ],
};

export const DB32: Palette = {
  id: "db32",
  name: "DawnBringer 32",
  source: "builtin",
  colors: [
    "#000000", "#222034", "#45283c", "#663931", "#8f563b", "#df7126", "#d9a066", "#eec39a",
    "#fbf236", "#99e550", "#6abe30", "#37946e", "#4b692f", "#524b24", "#323c39", "#3f3f74",
    "#306082", "#5b6ee1", "#639bff", "#5fcde4", "#cbdbfc", "#ffffff", "#9badb7", "#847e87",
    "#696a6a", "#595652", "#76428a", "#ac3232", "#d95763", "#d77bba", "#8f974a", "#8a6f30",
  ],
};

export const ARNE16: Palette = {
  id: "arne16",
  name: "ARNE16",
  source: "builtin",
  colors: [
    "#000000", "#9d9d9d", "#ffffff", "#be2633", "#e06f8b", "#493c2b", "#a46422", "#eb8931",
    "#f7e26b", "#2f484e", "#44891a", "#a3ce27", "#1b2632", "#005784", "#31a2f2", "#b2dcef",
  ],
};

export const APOLLO: Palette = {
  id: "apollo",
  name: "Apollo",
  source: "builtin",
  colors: [
    "#3f3f74", "#7a4369", "#a84f53", "#d67841", "#e5b361", "#c9d684", "#84b188", "#406b70",
    "#2f6d80", "#306082", "#475d91", "#584b82", "#6d4482", "#8a4682", "#a14d80", "#b75a79",
  ],
};

export const CGA: Palette = {
  id: "cga",
  name: "CGA",
  source: "builtin",
  colors: [
    "#000000", "#0000aa", "#00aa00", "#00aaaa", "#aa0000", "#aa00aa", "#aa5500", "#aaaaaa",
    "#555555", "#5555ff", "#55ff55", "#55ffff", "#ff5555", "#ff55ff", "#ffff55", "#ffffff",
  ],
};

// 转像素专用的自动取色模式。编辑器的“自定义”调色板与它保持独立。
export const NO_PALETTE: Palette = { id: "auto", name: "自动", colors: [], source: "auto" };

export const BUILTIN_PALETTES: Palette[] = [
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

export const PRESET_PALETTES: Palette[] = [
  NO_PALETTE,
  ...BUILTIN_PALETTES,
];

export const DEFAULT_PALETTE = SWEETIE16;

export const CUSTOM_PALETTE: Palette = {
  id: "custom-default",
  name: "自定义",
  colors: [...DEFAULT_PALETTE.colors],
  source: "custom",
};

let paletteSequence = 0;

export function createPaletteId(prefix = "custom"): string {
  paletteSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${paletteSequence}`;
}

export function normalizePaletteColors(colors: unknown[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of colors) {
    if (typeof value !== "string") continue;
    const rgb = parseHex(value);
    if (!rgb) continue;
    const hex = rgbToHex(rgb[0], rgb[1], rgb[2]);
    if (seen.has(hex)) continue;
    seen.add(hex);
    normalized.push(hex);
  }
  return normalized;
}

export function createCustomPalette(name = "自定义", colors: unknown[] = []): Palette {
  return {
    id: createPaletteId(),
    name: name.trim() || "自定义",
    colors: normalizePaletteColors(colors),
    source: "custom",
  };
}

export function paletteToJson(palette: Palette): string {
  return JSON.stringify({
    format: "pixelpaint-palette",
    version: 1,
    name: palette.name,
    colors: palette.colors,
  }, null, 2);
}

export function paletteToGpl(palette: Palette): string {
  const lines = ["GIMP Palette", `Name: ${palette.name}`, "Columns: 8", "#"];
  for (const color of palette.colors) {
    const [r, g, b] = hexToRgb(color);
    lines.push(`${r.toString().padStart(3, " ")} ${g.toString().padStart(3, " ")} ${b.toString().padStart(3, " ")} ${color}`);
  }
  return `${lines.join("\n")}\n`;
}

function colorsFromJson(value: unknown): { name?: string; colors: string[] } | null {
  if (Array.isArray(value)) return { colors: normalizePaletteColors(value) };
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.colors)) return null;
  const colors = record.colors.map((color) => {
    if (typeof color === "string") return color;
    if (color && typeof color === "object" && typeof (color as Record<string, unknown>).hex === "string") {
      return (color as Record<string, string>).hex;
    }
    return "";
  });
  return {
    name: typeof record.name === "string" ? record.name : undefined,
    colors: normalizePaletteColors(colors),
  };
}

function parseGpl(text: string): string[] {
  const colors: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || /^gimp palette$/i.test(trimmed) || /^(name|columns):/i.test(trimmed)) continue;
    const parts = trimmed.split(/\s+/);
    const rgb = parts.slice(0, 3).map(Number);
    if (rgb.length === 3 && rgb.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
      colors.push(rgbToHex(rgb[0], rgb[1], rgb[2]));
    }
  }
  return normalizePaletteColors(colors);
}

function parseHexText(text: string): string[] {
  const matches = text.match(/#[0-9a-fA-F]{3,6}\b/g) ?? [];
  return normalizePaletteColors(matches);
}

function fileStem(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").trim() || "导入调色板";
}

/** 读取 JSON、GPL 或包含 HEX 色值的普通文本调色板。 */
export function parsePaletteText(text: string, filename = "导入调色板"): Palette | null {
  const trimmed = text.trim();
  let name = fileStem(filename);
  let colors: string[] = [];
  const isJson = /\.json$/i.test(filename) || trimmed.startsWith("{") || trimmed.startsWith("[");
  const isGpl = /\.gpl$/i.test(filename) || /^gimp palette$/im.test(trimmed);

  if (isJson) {
    try {
      const parsed = colorsFromJson(JSON.parse(trimmed));
      if (parsed) {
        colors = parsed.colors;
        name = parsed.name?.trim() || name;
      }
    } catch {
      return null;
    }
  } else if (isGpl) {
    colors = parseGpl(trimmed);
    const gplName = trimmed.match(/^Name:\s*(.+)$/im)?.[1]?.trim();
    if (gplName) name = gplName;
  } else {
    colors = parseHexText(trimmed);
  }

  if (colors.length === 0) return null;
  return createCustomPalette(name, colors);
}

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
