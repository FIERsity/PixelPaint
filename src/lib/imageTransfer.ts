// 浏览器内生成图片文件的辅助函数。

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
