import { useCallback, useEffect, useRef, useState } from "react";
import type { PixelDoc } from "../lib/pixelDoc";
import { docFromPixels } from "../lib/pixelDoc";
import { checkerStyle } from "../lib/checker";
import { normalizeCutoutBlob, type CutoutEdgeMode } from "../lib/cutout";
import { urlToImageFile, type ImageTransfer } from "../lib/imageTransfer";

interface CutoutProps {
  embedded?: boolean;
  onImport: (doc: PixelDoc) => void;
  onNotice?: (msg: string) => void;
  onSendToConvert: (file: File) => void;
  incomingImage?: ImageTransfer | null;
  onIncomingConsumed?: (id: number) => void;
}

type Phase = "idle" | "ready" | "running" | "done" | "error";

export default function Cutout({ embedded = false, onImport, onNotice, onSendToConvert, incomingImage, onIncomingConsumed }: CutoutProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [srcFile, setSrcFile] = useState<File | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ label: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragover, setDragover] = useState(false);
  const [model, setModel] = useState<"isnet" | "isnet_quint8">("isnet_quint8");
  const [edgeMode, setEdgeMode] = useState<CutoutEdgeMode>("hard");
  const [threshold, setThreshold] = useState(128);
  const [sending, setSending] = useState(false);
  const [previewCell, setPreviewCell] = useState(1);
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const previewImageRef = useRef<HTMLImageElement>(null);
  const consumedIncomingRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const runIdRef = useRef(0);
  // 跟踪当前 object URL，保证卸载时能释放（否则 Blob 泄漏到页面关闭）
  const urlsRef = useRef<{ src: string | null; result: string | null }>({ src: null, result: null });
  urlsRef.current = { src: srcUrl, result: resultUrl };

  useEffect(() => () => {
    if (urlsRef.current.src) URL.revokeObjectURL(urlsRef.current.src);
    if (urlsRef.current.result) URL.revokeObjectURL(urlsRef.current.result);
  }, []);

  const loadFile = useCallback((file: File) => {
    // 新文件会使旧任务失效；模型推理本身无法随时取消，但旧结果不能再覆盖新图。
    runIdRef.current += 1;
    runningRef.current = false;
    // 清理旧资源
    if (srcUrl) URL.revokeObjectURL(srcUrl);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    const url = URL.createObjectURL(file);
    setSrcUrl(url);
    setSrcFile(file);
    setResultUrl(null);
    setError(null);
    setProgress(null);
    setPreviewCell(1);
    setPreviewSize(null);
    setPhase("ready");
  }, [srcUrl, resultUrl]);

  const updatePreviewCell = useCallback(() => {
    const image = previewImageRef.current;
    if (!image || !image.naturalWidth) return;
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
    setPreviewSize((prev) => prev?.width === image.naturalWidth && prev.height === image.naturalHeight
      ? prev
      : { width: image.naturalWidth, height: image.naturalHeight });
    setPreviewCell((prev) => Math.abs(prev - scale) < 0.01 ? prev : scale);
  }, []);

  // 图片响应式缩放时同步棋盘格的单元尺寸，保持透明格与图像像素边界一致。
  useEffect(() => {
    const image = previewImageRef.current;
    if (!image) return;
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updatePreviewCell);
    observer?.observe(image);
    updatePreviewCell();
    return () => observer?.disconnect();
  }, [srcUrl, resultUrl, updatePreviewCell]);

  // 从转像素模块流转过来的图片，作为新的输入载入。
  useEffect(() => {
    if (!incomingImage || consumedIncomingRef.current === incomingImage.id) return;
    consumedIncomingRef.current = incomingImage.id;
    loadFile(incomingImage.file);
    onIncomingConsumed?.(incomingImage.id);
  }, [incomingImage, loadFile, onIncomingConsumed]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragover(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("image/")) loadFile(f);
  };

  const run = async () => {
    if (!srcFile || runningRef.current) return;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    runningRef.current = true;
    setPhase("running");
    setError(null);
    setProgress({ label: "准备中…", pct: 0 });
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    try {
      // 懒加载抠图库（首次会下载 ~40MB 模型，之后走浏览器缓存）
      const { removeBackground } = await import("@imgly/background-removal");
      const blob = await removeBackground(srcFile, {
        model,
        output: { format: "image/png" },
        progress: (key, current, total) => {
          if (runId !== runIdRef.current) return;
          let label = "处理中…";
          if (key.includes("fetch")) label = "下载模型…";
          else if (key.includes("compute")) label = "AI 抠图中…";
          const pct = total > 0 ? Math.round((current / total) * 100) : 0;
          setProgress({ label, pct: Math.max(1, Math.min(99, pct)) });
        },
      });
      if (runId !== runIdRef.current) return;
      setProgress({ label: "整理像素边缘…", pct: 99 });
      const normalized = await normalizeCutoutBlob(srcFile, blob, { mode: edgeMode, threshold });
      if (runId !== runIdRef.current) return;
      setResultUrl(URL.createObjectURL(normalized));
      setProgress(null);
      setPhase("done");
      onNotice?.(`${embedded ? "背景处理" : "抠图"}完成 · ${edgeMode === "hard" ? "像素硬边" : "柔和边缘"}`);
    } catch (err) {
      if (runId !== runIdRef.current) return;
      console.error(err);
      setError("抠图失败，可能是模型下载被拦截或图片无法处理。请重试。");
      setPhase("error");
    } finally {
      if (runId === runIdRef.current) runningRef.current = false;
    }
  };

  // 抠图结果 -> 画板
  const sendToCanvas = async () => {
    if (!resultUrl) return;
    try {
      const bitmap = await createImageBitmap(await (await fetch(resultUrl)).blob());
      const c = document.createElement("canvas");
      c.width = bitmap.width;
      c.height = bitmap.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const img = ctx.getImageData(0, 0, c.width, c.height);
      onImport(docFromPixels(img.data, img.width, img.height, "抠图"));
    } catch {
      setError("无法把结果送入画板，请重试。");
    }
  };

  const sendToConvert = async () => {
    if (!resultUrl || sending) return;
    setSending(true);
    setError(null);
    try {
      const base = srcFile ? srcFile.name.replace(/\.[^.]+$/, "") : "cutout";
      const file = await urlToImageFile(resultUrl, base + "-cutout.png");
      onSendToConvert(file);
    } catch {
      setError("无法把结果送入转像素，请重试。");
    } finally {
      setSending(false);
    }
  };

  const download = () => {
    if (!resultUrl) return;
    const a = document.createElement("a");
    a.href = resultUrl;
    const base = srcFile ? srcFile.name.replace(/\.[^.]+$/, "") : "cutout";
    a.download = base + "-cutout.png";
    a.click();
  };

  const showChecker = previewCell >= 1;
  const checkerProps = showChecker ? checkerStyle(previewCell) : {};
  const previewWidth = previewSize ? previewSize.width * previewCell : undefined;
  const previewHeight = previewSize ? previewSize.height * previewCell : undefined;

  return (
    <div className="convert-layout">
      <section>
        {!embedded && (
          <div
            className={`card drop-card ${dragover ? "dragover" : ""}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragover(true); }}
            onDragLeave={() => setDragover(false)}
            onDrop={handleDrop}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="选择或拖放要抠图的图片"
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ""; }}
            />
            <div className="drop-inner">
              <div className="drop-icon">
                <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <p className="drop-title">点击选择或拖拽图片</p>
              <p className="drop-hint">AI 自动去除背景，保留主体（本地处理，隐私安全）</p>
            </div>
          </div>
        )}

        <div className="card">
          <div className="panel-head">
            <h2 className="card-title">{embedded ? "背景处理结果" : "结果"}</h2>
            {phase === "done" && <span className="badge">已完成</span>}
          </div>
          {resultUrl ? (
            <div className="preview-box">
              <img
                ref={previewImageRef}
                src={resultUrl}
                alt={embedded ? "背景处理结果" : "抠图结果"}
                className={`pixelated${showChecker ? " checker" : ""}`}
                onLoad={updatePreviewCell}
                style={{ width: previewWidth, height: previewHeight, maxWidth: "100%", maxHeight: "60vh", display: "block", imageRendering: "pixelated", ...checkerProps }}
              />
            </div>
          ) : srcUrl ? (
            <div className="preview-box">
              <img
                ref={previewImageRef}
                src={srcUrl}
                alt="原图"
                className={showChecker ? "checker" : undefined}
                onLoad={updatePreviewCell}
                style={{ width: previewWidth, height: previewHeight, maxWidth: "100%", maxHeight: "60vh", display: "block", ...checkerProps }}
              />
            </div>
          ) : (
            <div className="preview-box checker" style={{ color: "var(--muted)", fontSize: 13 }}>上传图片后点击「开始抠图」</div>
          )}
          {phase === "running" && progress && (
            <>
              <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }}>{progress.label} {progress.pct}%</p>
              <div className="progress"><div style={{ width: `${progress.pct}%` }} /></div>
            </>
          )}
          {error && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>{error}</p>}
        </div>
      </section>

      <aside>
        <div className="card">
          <h2 className="card-title">{embedded ? "背景处理设置" : "抠图设置"}</h2>
          <div className="tool-divider" />
          <div className="param-row">
            <label htmlFor="cutout-model">模型精度</label>
            <select
              id="cutout-model"
              className="num-input" style={{ width: "100%" }}
              value={model}
              onChange={(e) => setModel(e.target.value as "isnet" | "isnet_quint8")}
            >
              <option value="isnet_quint8">快速（量化，约 40MB）</option>
              <option value="isnet">精细（ISNet，较慢）</option>
            </select>
            <p style={{ fontSize: 12, color: "var(--muted)" }}>
              首次使用需下载模型，之后浏览器会缓存。快速模型适合日常抠图，精细模型边缘更稳但更慢。
            </p>
          </div>

          <div className="param-row">
            <label htmlFor="cutout-edge">边缘处理</label>
            <select
              id="cutout-edge"
              className="num-input"
              style={{ width: "100%" }}
              value={edgeMode}
              onChange={(e) => setEdgeMode(e.target.value as CutoutEdgeMode)}
            >
              <option value="hard">像素硬边（推荐）</option>
              <option value="soft">柔和边缘</option>
            </select>
            <p style={{ fontSize: 12, color: "var(--muted)" }}>
              硬边会把半透明蒙版吸附为透明 / 不透明像素，减少像素画边缘的灰边。
            </p>
          </div>

          {edgeMode === "hard" && (
            <div className="param-row">
              <label htmlFor="cutout-threshold">
                硬边阈值 <span className="range-val">{threshold}</span>
              </label>
              <input
                id="cutout-threshold"
                type="range"
                min="32"
                max="224"
                step="1"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
              <p style={{ fontSize: 12, color: "var(--muted)" }}>数值越高，保留的主体边缘越少。</p>
            </div>
          )}

          <button
            type="button"
            className="btn-primary"
            style={{ width: "100%" }}
            disabled={!srcFile || phase === "running"}
            onClick={run}
          >
            {phase === "running" ? "处理中…" : embedded ? "开始处理背景" : "开始抠图"}
          </button>

          {phase === "done" && (
            <>
              <div className="tool-divider" />
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button type="button" className="btn-primary" onClick={sendToCanvas}>发送到画板编辑</button>
                <button type="button" className="btn-ghost" onClick={sendToConvert} disabled={sending}>
                  {sending ? "准备中…" : embedded ? "继续转像素" : "发送到转像素"}
                </button>
                <button type="button" className="btn-ghost" onClick={download}>下载 PNG</button>
              </div>
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, textAlign: "center" }}>
                发送到画板后可继续转像素 / 精修
              </p>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
