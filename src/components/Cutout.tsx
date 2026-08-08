import { useEffect, useRef, useState } from "react";
import type { PixelDoc } from "../lib/pixelDoc";
import { docFromPixels } from "../lib/pixelDoc";
import { normalizeCutoutBlob, type CutoutEdgeMode } from "../lib/cutout";

interface CutoutProps {
  inputFile: File | null;
  resultFile: File | null;
  onResult: (file: File) => void;
  onImport: (doc: PixelDoc) => void;
  onReturnToPixel: (file: File) => void;
  onNotice?: (msg: string) => void;
}

type Phase = "idle" | "ready" | "running" | "done" | "error";

export default function Cutout({ inputFile, resultFile, onResult, onImport, onReturnToPixel, onNotice }: CutoutProps) {
  const [phase, setPhase] = useState<Phase>(inputFile ? "ready" : "idle");
  const [progress, setProgress] = useState<{ label: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<"isnet" | "isnet_quint8">("isnet_quint8");
  const [edgeMode, setEdgeMode] = useState<CutoutEdgeMode>("hard");
  const [threshold, setThreshold] = useState(128);

  const previousInputRef = useRef<File | null>(inputFile);
  const runningRef = useRef(false);
  const runIdRef = useRef(0);

  useEffect(() => {
    if (previousInputRef.current === inputFile) return;
    previousInputRef.current = inputFile;
    runIdRef.current += 1;
    runningRef.current = false;
    setPhase(inputFile ? "ready" : "idle");
    setProgress(null);
    setError(null);
  }, [inputFile]);

  const run = async () => {
    if (!inputFile || runningRef.current) return;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    runningRef.current = true;
    setPhase("running");
    setError(null);
    setProgress({ label: "准备中…", pct: 0 });
    try {
      // 懒加载背景处理模型（首次会下载约 40MB，之后由浏览器缓存）。
      const { removeBackground } = await import("@imgly/background-removal");
      const blob = await removeBackground(inputFile, {
        model,
        output: { format: "image/png" },
        progress: (key, current, total) => {
          if (runId !== runIdRef.current) return;
          let label = "处理中…";
          if (key.includes("fetch")) label = "下载模型…";
          else if (key.includes("compute")) label = "处理背景…";
          const pct = total > 0 ? Math.round((current / total) * 100) : 0;
          setProgress({ label, pct: Math.max(1, Math.min(99, pct)) });
        },
      });
      if (runId !== runIdRef.current) return;
      setProgress({ label: "整理像素边缘…", pct: 99 });
      const normalized = await normalizeCutoutBlob(inputFile, blob, { mode: edgeMode, threshold });
      if (runId !== runIdRef.current) return;
      const base = inputFile.name.replace(/\.[^.]+$/, "") || "pixelpaint";
      const file = new File([normalized], base + "-background.png", { type: "image/png" });
      onResult(file);
      setProgress(null);
      setPhase("done");
      onNotice?.(`背景处理完成 · ${edgeMode === "hard" ? "像素硬边" : "柔和边缘"}`);
    } catch (err) {
      if (runId !== runIdRef.current) return;
      console.error(err);
      setError("背景处理失败，可能是模型下载被拦截或图片无法处理。请重试。");
      setPhase("error");
    } finally {
      if (runId === runIdRef.current) runningRef.current = false;
    }
  };

  const sendToCanvas = async () => {
    if (!resultFile) return;
    try {
      const bitmap = await createImageBitmap(resultFile);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("无法创建结果画布");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      onImport(docFromPixels(image.data, image.width, image.height, "背景处理"));
    } catch {
      setError("无法把结果发送到画板，请重试。");
    }
  };

  const download = () => {
    if (!resultFile) return;
    const url = URL.createObjectURL(resultFile);
    const a = document.createElement("a");
    a.href = url;
    a.download = resultFile.name;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div className="operation-panel">
      <h2 className="card-title">背景处理设置</h2>
      <p className="card-desc">处理当前像素化结果，保留透明区域并整理像素边缘。</p>
      <div className="tool-divider" />

      {!inputFile && (
        <div className="operation-empty" role="status">
          完成转像素后，这里会处理当前结果。
        </div>
      )}

      <div className="param-row">
        <label htmlFor="cutout-model">模型精度</label>
        <select
          id="cutout-model"
          className="num-input"
          style={{ width: "100%" }}
          value={model}
          onChange={(e) => setModel(e.target.value as "isnet" | "isnet_quint8")}
        >
          <option value="isnet_quint8">快速（量化，约 40MB）</option>
          <option value="isnet">精细（ISNet，较慢）</option>
        </select>
        <p className="field-hint">首次使用需下载模型，之后浏览器会缓存。</p>
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
        <p className="field-hint">硬边会把半透明边缘整理为透明或不透明像素。</p>
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
          <p className="field-hint">数值越高，保留的主体边缘越少。</p>
        </div>
      )}

      {phase === "running" && progress && (
        <div className="operation-progress" role="status" aria-live="polite">
          <div className="progress-label"><span>{progress.label}</span><span>{progress.pct}%</span></div>
          <div className="progress"><div style={{ width: `${progress.pct}%` }} /></div>
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      <button
        type="button"
        className="btn-primary operation-main-action"
        disabled={!inputFile || phase === "running"}
        onClick={run}
      >
        {phase === "running" ? "处理中…" : "开始处理背景"}
      </button>

      {phase === "done" && resultFile && (
        <div className="operation-result-actions">
          <div className="tool-divider" />
          <button type="button" className="btn-primary" onClick={sendToCanvas}>发送到画板</button>
          <button type="button" className="btn-ghost" onClick={() => onReturnToPixel(resultFile)}>返回转像素</button>
          <button type="button" className="btn-ghost" onClick={download}>下载 PNG</button>
        </div>
      )}
    </div>
  );
}
