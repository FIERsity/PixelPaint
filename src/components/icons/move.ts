import type { PxlKitData } from "../../lib/pixelTypes";

export const Move: PxlKitData = {
  name: "move",
  size: 16,
  category: "tool",
  grid: [
    ".......G........",
    "......GGG.......",
    ".....GGGGG......",
    ".......G........",
    ".......G........",
    "..G....G....G...",
    ".GGGGGGGGGGGGG..",
    "GGGGGGGGGGGGGGG.",
    ".GGGGGGGGGGGGG..",
    "..G....G....G...",
    ".......G........",
    ".......G........",
    ".....GGGGG......",
    "......GGG.......",
    ".......G........",
    "................",
  ],
  palette: { G: "#4b5fc7" },
  tags: ["move", "translate", "arrows"],
};
