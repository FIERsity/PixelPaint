import { useCallback, useEffect, useRef, useState } from "react";
import type { PixelDoc } from "../lib/pixelDoc";
import { docFromPixels } from "../lib/pixelDoc";

interface CutoutProps {
  onImport: (doc: PixelDoc) => void;
  onNotice?: (msg: string) => void;
}

type Phase = "idle" | "ready" | "running" | "done" | "error";

export default function Cutout({ onImport, onNotice }: CutoutProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [srcFile, setSrcFile] = useState<File | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ label: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragover, setDragover] = useState(false);
  const [model, setModel] = useState<"isnet" | "isnet_quint8">("isnet_quint8");

  const inputRef = useRef<HTMLInputElement>(null);
  const runningRef = useRef(false);
  // 跟踪当前 object URL，保证卸载时能释放（否则 Blob 泄漏到页面关闭）
  const urlsRef = useRef<{ src: string | null; result: string | null }>({ src: null, result: null });
  urlsRef.current = { src: srcUrl, result: resultUrl };

  useEffect(() => () => {
    if (urlsRef.current.src) URL.revokeObjectURL(urlsRef.current.src);
    if (urlsRef.current.result) URL.revokeObjectURL(urlsRef.current.result);
  }, []);

  const loadFile = useCallback((file: File) => {
    // 清理旧资源
    if (srcUrl) URL.revokeObjectURL(srcUrl);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    const url = URL.createObjectURL(file);
    setSrcUrl(url);
    setSrcFile(file);
    setResultUrl(null);
    setError(null);
    setProgress(null);
    setPhase("ready");
  }, [srcUrl, resultUrl]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragover(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("image/")) loadFile(f);
  };

  const run = async () => {
    if (!srcFile || runningRef.current) return;
    runningRef.current = true;
    setPhase("running");
    setError(null);
    setProgress({ label: "准备中…", pct: 0 });
    try {
      // 懒加载抠图库（首次会下载 ~40MB 模型，之后走浏览器缓存）
      const { removeBackground } = await import("@imgly/background-removal");
      const blob = await removeBackground(srcFile, {
        model,
        output: { format: "image/png" },
        progress: (key, current, total) => {
          let label = "处理中…";
          if (key.includes("fetch")) label = "下载模型…";
          else if (key.includes("compute")) label = "AI 抠图中…";
          const pct = total > 0 ? Math.round((current / total) * 100) : 0;
          setProgress({ label, pct: Math.max(1, Math.min(99, pct)) });
        },
      });
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(URL.createObjectURL(blob));
      setProgress(null);
      setPhase("done");
      onNotice?.("抠图完成");
    } catch (err) {
      console.error(err);
      setError("抠图失败，可能是模型下载被拦截或图片无法处理。请重试。");
      setPhase("error");
    } finally {
      runningRef.current = false;
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

  const download = () => {
    if (!resultUrl) return;
    const a = document.createElement("a");
    a.href = resultUrl;
    const base = srcFile ? srcFile.name.replace(/\.[^.]+$/, "") : "cutout";
    a.download = base + "-cutout.png";
    a.click();
  };

  return (
    <div className="convert-layout">
      <section>
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

        <div className="card">
          <div className="panel-head">
            <h2 className="card-title">结果</h2>
            {phase === "done" && <span className="badge">已完成</span>}
          </div>
          {resultUrl ? (
            <div className="preview-box checker">
              <img src={resultUrl} alt="抠图结果" style={{ maxWidth: "100%" }} />
            </div>
          ) : srcUrl ? (
            <div className="preview-box checker">
              <img src={srcUrl} alt="原图" style={{ maxWidth: "100%" }} />
            </div>
          ) : (
            <div className="preview-box" style={{ color: "var(--muted)", fontSize: 13 }}>上传图片后点击「开始抠图」</div>
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
          <h2 className="card-title">抠图设置</h2>
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
              首次使用需下载模型，之后浏览器会缓存。Small 适合日常抠图。
            </p>
          </div>

          <button
            type="button"
            className="btn-primary"
            style={{ width: "100%" }}
            disabled={!srcFile || phase === "running"}
            onClick={run}
          >
            {phase === "running" ? "抠图中…" : "开始抠图"}
          </button>

          {phase === "done" && (
            <>
              <div className="tool-divider" />
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button type="button" className="btn-primary" onClick={sendToCanvas}>发送到画板编辑</button>
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
