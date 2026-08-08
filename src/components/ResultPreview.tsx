import { useEffect, useRef, useState } from "react";
import { checkerStyle } from "../lib/checker";

export type PreviewOperation = "pixelate" | "background";

interface PixelResult {
  pixels: Uint8ClampedArray;
  w: number;
  h: number;
}

interface ResultPreviewProps {
  operation: PreviewOperation;
  result: PixelResult | null;
  backgroundUrl: string | null;
  busy: boolean;
  error: string | null;
}

export default function ResultPreview({ operation, result, backgroundUrl, busy, error }: ResultPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageScale, setImageScale] = useState(1);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !result || result.w < 1 || result.h < 1) return;
    canvas.width = result.w;
    canvas.height = result.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const image = ctx.createImageData(result.w, result.h);
    image.data.set(result.pixels);
    ctx.putImageData(image, 0, 0);
  }, [result]);

  const updateImageScale = () => {
    const image = imageRef.current;
    if (!image || !image.naturalWidth || !image.naturalHeight) return;
    const box = image.parentElement;
    const maxWidth = Math.max(1, (box?.clientWidth ?? 700) - 34);
    const maxHeight = Math.max(1, Math.min(
      typeof window === "undefined" ? 600 : window.innerHeight * 0.6,
      600,
    ));
    const fitScale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
    const scale = fitScale >= 1
      ? Math.max(1, Math.min(20, Math.floor(fitScale)))
      : fitScale;
    if (!Number.isFinite(scale) || scale <= 0) return;
    setImageScale((current) => Math.abs(current - scale) < 0.01 ? current : scale);
    setImageSize((current) => current?.width === image.naturalWidth && current.height === image.naturalHeight
      ? current
      : { width: image.naturalWidth, height: image.naturalHeight });
  };

  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateImageScale);
    observer?.observe(image);
    updateImageScale();
    return () => observer?.disconnect();
  }, [backgroundUrl]);

  const showBackground = operation === "background" && Boolean(backgroundUrl);
  const previewScale = result
    ? Math.max(1, Math.min(20, Math.floor(420 / Math.max(result.w, result.h))))
    : 1;
  const imageChecker = imageScale >= 1 ? checkerStyle(imageScale) : {};

  return (
    <div className="card result-card">
      <div className="panel-head">
        <h2 className="card-title">结果预览</h2>
        {showBackground && <span className="badge">透明结果</span>}
        {!showBackground && result && <span className="badge">{result.w} × {result.h} px</span>}
      </div>

      {showBackground ? (
        <div className="preview-box">
          <img
            ref={imageRef}
            src={backgroundUrl ?? undefined}
            alt="背景处理结果"
            className={`pixelated${imageScale >= 1 ? " checker" : ""}`}
            onLoad={updateImageScale}
            style={{
              width: imageSize ? imageSize.width * imageScale : undefined,
              height: imageSize ? imageSize.height * imageScale : undefined,
              maxWidth: "100%",
              maxHeight: "60vh",
              display: "block",
              imageRendering: "pixelated",
              ...imageChecker,
            }}
          />
        </div>
      ) : result ? (
        <div className="preview-box">
          <div
            className="pixel-preview checker"
            style={{ width: result.w * previewScale, height: result.h * previewScale, ...checkerStyle(previewScale) }}
          >
            <canvas
              ref={canvasRef}
              className="pixelated"
              style={{ width: result.w * previewScale, height: result.h * previewScale, imageRendering: "pixelated" }}
            />
          </div>
        </div>
      ) : (
        <div className="preview-box checker result-empty">
          {operation === "background" ? "完成转像素后可处理背景" : "选择图片后在此查看像素化结果"}
        </div>
      )}

      {busy && <div className="progress"><div style={{ width: "100%" }} /></div>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
