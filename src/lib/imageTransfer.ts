// 浏览器内模块之间传递图片结果时使用的轻量辅助函数。

export interface ImageTransfer {
  id: number;
  file: File;
}

export function pixelsToPngFile(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  name = "pixelpaint.png",
): Promise<File | null> {
  if (width < 1 || height < 1) return Promise.resolve(null);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.putImageData(new ImageData(pixels.slice(), width, height), 0, 0);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob ? new File([blob], name, { type: "image/png" }) : null);
    }, "image/png");
  });
}

export async function urlToImageFile(url: string, name = "pixelpaint.png"): Promise<File> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`图片读取失败（${response.status}）`);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || "image/png" });
}
