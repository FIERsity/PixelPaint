export type SelectionMode = "replace" | "add" | "subtract" | "intersect";

export interface SelectionMoveResult {
  pixels: Uint8ClampedArray;
  mask: Uint8Array;
  clippedOpaque: number;
}

export function createSelectionMask(width: number, height: number): Uint8Array {
  return new Uint8Array(Math.max(0, width * height));
}

export function countSelected(mask: Uint8Array): number {
  let count = 0;
  for (const value of mask) count += value === 0 ? 0 : 1;
  return count;
}

export function selectionMasksEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function maskFromPoints(
  width: number,
  height: number,
  points: Array<[number, number]>,
): Uint8Array {
  const mask = createSelectionMask(width, height);
  for (const [x, y] of points) {
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    mask[y * width + x] = 1;
  }
  return mask;
}

export function rectangleSelectionMask(
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Uint8Array {
  const mask = createSelectionMask(width, height);
  const left = Math.max(0, Math.min(x0, x1));
  const right = Math.min(width - 1, Math.max(x0, x1));
  const top = Math.max(0, Math.min(y0, y1));
  const bottom = Math.min(height - 1, Math.max(y0, y1));
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) mask[y * width + x] = 1;
  }
  return mask;
}

export function combineSelectionMasks(
  base: Uint8Array,
  gesture: Uint8Array,
  mode: SelectionMode,
): Uint8Array {
  if (base.length !== gesture.length) throw new Error("selection mask size mismatch");
  const next = new Uint8Array(base.length);
  for (let i = 0; i < base.length; i++) {
    const a = base[i] !== 0;
    const b = gesture[i] !== 0;
    next[i] = (
      mode === "replace" ? b
        : mode === "add" ? a || b
          : mode === "subtract" ? a && !b
            : a && b
    ) ? 1 : 0;
  }
  return next;
}

export function shiftSelectionMask(
  mask: Uint8Array,
  width: number,
  height: number,
  dx: number,
  dy: number,
): Uint8Array {
  const shifted = createSelectionMask(width, height);
  for (let index = 0; index < mask.length; index++) {
    if (mask[index] === 0) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    shifted[ny * width + nx] = 1;
  }
  return shifted;
}

export function countClippedOpaquePixels(
  source: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number,
  dx: number,
  dy: number,
): number {
  let count = 0;
  for (let index = 0; index < mask.length; index++) {
    if (mask[index] === 0 || source[index * 4 + 3] === 0) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) count += 1;
  }
  return count;
}

export function movePixelsBySelection(
  source: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number,
  dx: number,
  dy: number,
): SelectionMoveResult {
  if (source.length !== width * height * 4 || mask.length !== width * height) {
    throw new Error("selection move size mismatch");
  }
  const pixels = source.slice();
  const shiftedMask = shiftSelectionMask(mask, width, height, dx, dy);
  const clippedOpaque = countClippedOpaquePixels(source, mask, width, height, dx, dy);

  for (let index = 0; index < mask.length; index++) {
    if (mask[index] === 0) continue;
    const offset = index * 4;
    pixels[offset] = 0;
    pixels[offset + 1] = 0;
    pixels[offset + 2] = 0;
    pixels[offset + 3] = 0;
  }

  for (let index = 0; index < mask.length; index++) {
    if (mask[index] === 0) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    const nx = x + dx;
    const ny = y + dy;
    const sourceOffset = index * 4;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const targetOffset = (ny * width + nx) * 4;
    pixels[targetOffset] = source[sourceOffset];
    pixels[targetOffset + 1] = source[sourceOffset + 1];
    pixels[targetOffset + 2] = source[sourceOffset + 2];
    pixels[targetOffset + 3] = source[sourceOffset + 3];
  }

  return { pixels, mask: shiftedMask, clippedOpaque };
}
