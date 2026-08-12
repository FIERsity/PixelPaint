export type SpriteSheetLayout = "horizontal" | "vertical" | "grid";

export interface SpriteSheetFrame {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

export interface SpriteSheetOptions {
  layout: SpriteSheetLayout;
  columns?: number;
  scale?: number;
}

export interface SpriteSheetPlan {
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  width: number;
  height: number;
  scale: number;
}

export interface SpriteSheetResult extends SpriteSheetPlan {
  pixels: Uint8ClampedArray;
}

export const MAX_SPRITE_SHEET_EDGE = 8192;
export const MAX_SPRITE_SHEET_PIXELS = 8 * 1024 * 1024;

export class SpriteSheetError extends Error {
  readonly code: "invalid" | "too-large";
  readonly width?: number;
  readonly height?: number;

  constructor(
    code: "invalid" | "too-large",
    message: string,
    width?: number,
    height?: number,
  ) {
    super(message);
    this.name = "SpriteSheetError";
    this.code = code;
    this.width = width;
    this.height = height;
  }
}

export function planSpriteSheet(
  frames: ArrayLike<{ width: number; height: number }>,
  options: SpriteSheetOptions,
): SpriteSheetPlan {
  if (frames.length < 1) throw new SpriteSheetError("invalid", "Sprite sheet needs at least one frame");

  let cellWidth = 0;
  let cellHeight = 0;
  for (let i = 0; i < frames.length; i++) {
    const { width, height } = frames[i];
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new SpriteSheetError("invalid", "Sprite sheet frame dimensions must be positive integers");
    }
    cellWidth = Math.max(cellWidth, width);
    cellHeight = Math.max(cellHeight, height);
  }

  const scale = options.scale ?? 1;
  if (!Number.isInteger(scale) || scale < 1) {
    throw new SpriteSheetError("invalid", "Sprite sheet scale must be a positive integer");
  }

  let columns: number;
  if (options.layout === "horizontal") columns = frames.length;
  else if (options.layout === "vertical") columns = 1;
  else if (options.layout === "grid") {
    columns = options.columns ?? 1;
    if (!Number.isInteger(columns) || columns < 1) {
      throw new SpriteSheetError("invalid", "Sprite sheet columns must be a positive integer");
    }
    columns = Math.min(columns, frames.length);
  } else {
    throw new SpriteSheetError("invalid", "Unknown sprite sheet layout");
  }

  const rows = Math.ceil(frames.length / columns);
  const width = cellWidth * columns * scale;
  const height = cellHeight * rows * scale;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw new SpriteSheetError("too-large", "Sprite sheet dimensions are too large", width, height);
  }
  if (width > MAX_SPRITE_SHEET_EDGE || height > MAX_SPRITE_SHEET_EDGE || width * height > MAX_SPRITE_SHEET_PIXELS) {
    throw new SpriteSheetError("too-large", "Sprite sheet dimensions are too large", width, height);
  }

  return { columns, rows, cellWidth, cellHeight, width, height, scale };
}

export function buildSpriteSheet(frames: SpriteSheetFrame[], options: SpriteSheetOptions): SpriteSheetResult {
  const plan = planSpriteSheet(frames, options);
  const out = new Uint8ClampedArray(plan.width * plan.height * 4);

  frames.forEach((frame, frameIndex) => {
    if (frame.pixels.length !== frame.width * frame.height * 4) {
      throw new SpriteSheetError("invalid", "Sprite sheet frame pixels do not match frame dimensions");
    }

    const cellX = frameIndex % plan.columns;
    const cellY = Math.floor(frameIndex / plan.columns);
    const offsetX = cellX * plan.cellWidth * plan.scale;
    const offsetY = cellY * plan.cellHeight * plan.scale;

    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) {
        const source = (y * frame.width + x) * 4;
        const pixelX = offsetX + x * plan.scale;
        const pixelY = offsetY + y * plan.scale;
        for (let sy = 0; sy < plan.scale; sy++) {
          let target = ((pixelY + sy) * plan.width + pixelX) * 4;
          for (let sx = 0; sx < plan.scale; sx++) {
            out[target] = frame.pixels[source];
            out[target + 1] = frame.pixels[source + 1];
            out[target + 2] = frame.pixels[source + 2];
            out[target + 3] = frame.pixels[source + 3];
            target += 4;
          }
        }
      }
    }
  });

  return { ...plan, pixels: out };
}
