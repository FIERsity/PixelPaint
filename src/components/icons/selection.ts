import type { PxlKitData } from "../../lib/pixelTypes";

export const Selection: PxlKitData = {
  name: "selection",
  size: 16,
  category: "tool",
  grid: [
    "................",
    "..GG.GG.GG.GG...",
    "..G.........G...",
    "................",
    "..G.........G...",
    "..G.........G...",
    "................",
    "..G.........G...",
    "..G.........G...",
    "................",
    "..G.........G...",
    "..G.........G...",
    "..GG.GG.GG.GG...",
    "................",
    "................",
    "................",
  ],
  palette: { G: "#4b5fc7" },
  tags: ["selection", "marquee", "mask"],
};
