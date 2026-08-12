export interface GifFrame {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

const MAX_GIF_DIMENSION = 65535;
const TRANSPARENT_ALPHA_THRESHOLD = 128;

class ByteWriter {
  private readonly bytes: number[] = [];

  push(...values: number[]) {
    this.bytes.push(...values.map((value) => value & 0xff));
  }

  word(value: number) {
    this.push(value, value >> 8);
  }

  toBytes() {
    return new Uint8Array(this.bytes);
  }
}

function colorKey(r: number, g: number, b: number) {
  return (r << 16) | (g << 8) | b;
}

function colorDistance(a: number, b: number) {
  const ar = a >> 16;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = b >> 16;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const dr = ar - br;
  const dg = ag - bg;
  const db = ab - bb;
  return dr * dr + dg * dg + db * db;
}

function buildPalette(frames: GifFrame[]) {
  const counts = new Map<number, number>();
  let hasTransparency = false;

  for (const frame of frames) {
    for (let i = 0; i < frame.pixels.length; i += 4) {
      const alpha = frame.pixels[i + 3];
      if (alpha < TRANSPARENT_ALPHA_THRESHOLD) {
        hasTransparency = true;
        continue;
      }
      const key = colorKey(frame.pixels[i], frame.pixels[i + 1], frame.pixels[i + 2]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const colors = [...counts.entries()]
    .sort(([aKey, aCount], [bKey, bCount]) => bCount - aCount || aKey - bKey)
    .map(([key]) => key)
    .slice(0, hasTransparency ? 255 : 256);
  const palette = new Uint8Array(256 * 3);
  const start = hasTransparency ? 1 : 0;
  const colorToIndex = new Map<number, number>();

  colors.forEach((key, index) => {
    const paletteIndex = start + index;
    colorToIndex.set(key, paletteIndex);
    palette[paletteIndex * 3] = key >> 16;
    palette[paletteIndex * 3 + 1] = (key >> 8) & 0xff;
    palette[paletteIndex * 3 + 2] = key & 0xff;
  });

  return { colors, colorToIndex, palette, hasTransparency };
}

function nearestPaletteIndex(
  key: number,
  paletteColors: number[],
  colorToIndex: Map<number, number>,
  cache: Map<number, number>,
) {
  const exact = colorToIndex.get(key);
  if (exact !== undefined) return exact;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  let bestIndex = paletteColors.length > 0 ? 0 : 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < paletteColors.length; i++) {
    const distance = colorDistance(key, paletteColors[i]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  const paletteIndex = colorToIndex.get(paletteColors[bestIndex]) ?? 0;
  cache.set(key, paletteIndex);
  return paletteIndex;
}

function frameIndices(
  frame: GifFrame,
  width: number,
  height: number,
  palette: ReturnType<typeof buildPalette>,
) {
  const out = new Uint8Array(width * height);
  const cache = new Map<number, number>();
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const source = (y * frame.width + x) * 4;
      const target = y * width + x;
      if (frame.pixels[source + 3] < TRANSPARENT_ALPHA_THRESHOLD && palette.hasTransparency) {
        out[target] = 0;
      } else {
        out[target] = nearestPaletteIndex(
          colorKey(frame.pixels[source], frame.pixels[source + 1], frame.pixels[source + 2]),
          palette.colors,
          palette.colorToIndex,
          cache,
        );
      }
    }
  }
  return out;
}

/** GIF LZW image data, using a fixed 256-color palette (minimum code size 8). */
function encodeLzw(indices: Uint8Array) {
  const minCodeSize = 8;
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  let bitBuffer = 0;
  let bitCount = 0;
  const bytes: number[] = [];
  const dictionary = new Map<number, number>();

  const writeCode = (code: number) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      bytes.push(bitBuffer & 0xff);
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };

  writeCode(clearCode);
  if (indices.length > 0) {
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const symbol = indices[i];
      const key = (prefix << 8) | symbol;
      const existing = dictionary.get(key);
      if (existing !== undefined) {
        prefix = existing;
        continue;
      }

      writeCode(prefix);
      if (nextCode < 4096) {
        dictionary.set(key, nextCode++);
        if (nextCode === (1 << codeSize) && codeSize < 12) codeSize += 1;
      } else {
        writeCode(clearCode);
        dictionary.clear();
        codeSize = minCodeSize + 1;
        nextCode = endCode + 1;
      }
      prefix = symbol;
    }
    writeCode(prefix);
  }
  writeCode(endCode);
  if (bitCount > 0) bytes.push(bitBuffer & 0xff);
  return new Uint8Array(bytes);
}

function writeSubBlocks(writer: ByteWriter, data: Uint8Array) {
  for (let offset = 0; offset < data.length; offset += 255) {
    const length = Math.min(255, data.length - offset);
    writer.push(length);
    for (let i = 0; i < length; i++) writer.push(data[offset + i]);
  }
  writer.push(0);
}

/** Encode composited RGBA animation frames as a browser-downloadable GIF89a file. */
export function encodeGif(frames: GifFrame[], fps: number): Uint8Array {
  if (frames.length === 0) throw new Error("GIF needs at least one frame");
  const width = Math.max(...frames.map((frame) => frame.width));
  const height = Math.max(...frames.map((frame) => frame.height));
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("GIF frame dimensions must be positive integers");
  }
  if (width > MAX_GIF_DIMENSION || height > MAX_GIF_DIMENSION) {
    throw new Error("GIF frame dimensions are too large");
  }
  for (const frame of frames) {
    if (frame.width < 1 || frame.height < 1 || frame.pixels.length !== frame.width * frame.height * 4) {
      throw new Error("GIF frame pixels do not match frame dimensions");
    }
    if (frame.width > width || frame.height > height) throw new Error("GIF frame dimensions are invalid");
  }

  const palette = buildPalette(frames);
  const writer = new ByteWriter();
  for (const char of "GIF89a") writer.push(char.charCodeAt(0));
  writer.word(width);
  writer.word(height);
  writer.push(0xf7, 0, 0); // global table, 256 colors, 8-bit color resolution
  for (const value of palette.palette) writer.push(value);

  // Netscape application extension: 0 means repeat forever.
  writer.push(0x21, 0xff, 0x0b);
  for (const char of "NETSCAPE2.0") writer.push(char.charCodeAt(0));
  writer.push(0x03, 0x01, 0x00, 0x00, 0x00);

  const delay = Math.min(65535, Math.max(1, Math.round(100 / Math.max(1, fps))));
  for (const frame of frames) {
    const indices = frameIndices(frame, width, height, palette);
    writer.push(0x21, 0xf9, 0x04, palette.hasTransparency ? 0x09 : 0x08);
    writer.word(delay);
    writer.push(0, 0);
    writer.push(0x2c);
    writer.word(0);
    writer.word(0);
    writer.word(width);
    writer.word(height);
    writer.push(0);
    writer.push(8);
    writeSubBlocks(writer, encodeLzw(indices));
  }
  writer.push(0x3b);
  return writer.toBytes();
}
