// PixelPaint · 像素化 Web Worker
import { imageToPixels, type ToPixelOptions } from "./pixel";

export interface ToPixelRequest {
  id: number;
  data: Uint8ClampedArray;
  srcW: number;
  srcH: number;
  opts: ToPixelOptions;
}

export interface ToPixelResponse {
  id: number;
  pixels: Uint8ClampedArray;
  palette: Array<[number, number, number]>;
}

self.onmessage = (e: MessageEvent<ToPixelRequest>) => {
  const { id, data, srcW, srcH, opts } = e.data;
  try {
    const { pixels, palette } = imageToPixels(data, srcW, srcH, opts);
    (self as unknown as Worker).postMessage({ id, pixels, palette } satisfies ToPixelResponse, {
      transfer: [pixels.buffer],
    });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
