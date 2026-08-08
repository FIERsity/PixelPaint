import { useCallback, useEffect, useRef, useState } from "react";
import type { PixelDoc } from "../lib/pixelDoc";
import { docFromPixels } from "../lib/pixelDoc";
import { NO_PALETTE, PRESET_PALETTES, type Palette } from "../lib/palette";
import type { DitherMode, ToPixelOptions } from "../lib/pixel";
import type { ToPixelRequest, ToPixelResponse } from "../lib/toPixel.worker";

interface ConvertProps {
  onImport: (doc: PixelDoc) => void;
}

interface Source {
  data: Uint8ClampedArray;
  w: number;
  h: number;
  name: string;
}

interface Result {
  pixels: Uint8ClampedArray;
  w: number;
  h: number;
}

export default function Convert({ onImport }: ConvertProps) {
  const [source, setSource] = useState<Source | null>(null);
  const [outW, setOutW] = useState(32);
  const [outH, setOutH] = useState(32);
  const [lockRatio, setLockRatio] = useState(true);
  const [maxColors, setMaxColors] = useState(16);
  const [paletteName, setPaletteName] = useState<string>(NO_PALETTE.name);
  const [dither, setDither] = useState<DitherMode>("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragover, setDragover] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const previewRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const sourceRef = useRef<Source | null>(null);
  sourceRef.current = source;
  const optsRef = useRef<ToPixelOptions | null>(null);

  // 当前参数（每次渲染刷新到 ref，避免 worker 闭包捕获陈旧值）
  const buildOpts = useCallback((): ToPixelOptions => {
    const pal = PRESET_PALETTES.find((p) => p.name === paletteName) ?? NO_PALETTE;
    return {
      outWidth: outW,
      outHeight: outH,
      maxColors,
      palette: pal.colors.length > 0 ? pal.colors : null,
      dither,
    };
  }, [outW, outH, maxColors, paletteName, dither]);
  optsRef.current = buildOpts();

  // 创建 Worker（懒初始化）
  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    if (typeof Worker === "undefined") return null;
    const w = new Worker(new URL("../lib/toPixel.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<ToPixelResponse>) => {
      const msg = e.data as ToPixelResponse & { error?: string };
      if (msg.error) {
        setError(msg.error);
        setBusy(false);
        return;
      }
      const opts = optsRef.current;
      if (!opts) return;
      setResult({ pixels: msg.pixels, w: opts.outWidth, h: opts.outHeight });
      setBusy(false);
    };
    workerRef.current = w;
    return w;
  }, []);

  const runConvert = useCallback(() => {
    const s = sourceRef.current;
    const w = ensureWorker();
    if (!s || !w) return;
    const opts = optsRef.current;
    if (!opts) return;
    reqId.current += 1;
    const id = reqId.current;
    setBusy(true);
    setError(null);
    // 传拷贝而非 transfer，避免 detach 源图
    const req: ToPixelRequest = { id, data: s.data, srcW: s.w, srcH: s.h, opts };
    w.postMessage(req);
  }, [ensureWorker]);

  // 参数或图片变化时自动转换（限流）
  useEffect(() => {
    if (!source) return;
    const t = setTimeout(runConvert, 220);
    return () => clearTimeout(t);
  }, [source, outW, outH, maxColors, paletteName, dither, runConvert]);

  // 预览绘制
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !result) return;
    canvas.width = result.w;
    canvas.height = result.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(result.w, result.h);
    img.data.set(result.pixels);
    ctx.putImageData(img, 0, 0);
  }, [result]);

  const loadFile = useCallback(async (file: File) => {
    try {
      setError(null);
      const bitmap = await createImageBitmap(file);
      const c = document.createElement("canvas");
      c.width = bitmap.width;
      c.height = bitmap.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const img = ctx.getImageData(0, 0, c.width, c.height);
      setSource({ data: img.data, w: img.width, h: img.height, name: file.name });
      const w = 32;
      const h = Math.max(1, Math.round((32 * img.height) / img.width));
      setOutW(w);
      setOutH(h);
    } catch {
      setError("无法读取该图片，请换一张试试。");
    }
  }, []);

  const onWidth = (v: number) => {
    setOutW(v);
    if (lockRatio && source) {
      setOutH(Math.max(1, Math.round((v * source.h) / source.w)));
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragover(false);
    const f = e.dataTransfer.files?.[0];
    if (f) loadFile(f);
  };

  const chosenPalette: Palette = PRESET_PALETTES.find((p) => p.name === paletteName) ?? NO_PALETTE;

  return (
    <div className="convert-layout">
      <section>
        {/* 上传 */}
        <div
          className={`card drop-card ${dragover ? "dragover" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragover(true); }}
          onDragLeave={() => setDragover(false)}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
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
            <p className="drop-hint">支持 JPG / PNG / WebP，将转换为像素画</p>
          </div>
        </div>

        {/* 预览 */}
        <div className="card">
          <div className="panel-head">
            <h2 className="card-title">预览</h2>
            {result && <span className="badge">{result.w} × {result.h} px</span>}
          </div>
          {result ? (
            <div className="preview-box checker">
              <canvas ref={previewRef} className="pixelated" style={{ imageRendering: "pixelated" }} />
            </div>
          ) : (
            <div className="preview-box" style={{ color: "var(--muted)", fontSize: 13 }}>上传图片后在此预览像素化结果</div>
          )}
          {busy && <div className="progress"><div style={{ width: "100%" }} /></div>}
          {error && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>{error}</p>}
        </div>
      </section>

      {/* 参数 */}
      <aside>
        <div className="card">
          <h2 className="card-title">像素化参数</h2>
          <div className="tool-divider" />

          <div className="param-row">
            <label>输出尺寸 <span className="range-val">{outW}×{outH}</span></label>
            <div className="size-row">
              <input className="num-input" type="number" min={1} max={512} value={outW} onChange={(e) => onWidth(Number(e.target.value))} />
              <span style={{ color: "var(--muted)" }}>×</span>
              <input className="num-input" type="number" min={1} max={512} value={outH} onChange={(e) => setOutH(Number(e.target.value))} />
            </div>
            <label className="ghost-check" style={{ marginTop: 6 }}>
              <input type="checkbox" checked={lockRatio} onChange={(e) => setLockRatio(e.target.checked)} />
              保持原图比例
            </label>
          </div>

          <div className="param-row">
            <label>颜色数 <span className="range-val">{maxColors}</span></label>
            <input type="range" min={2} max={64} value={maxColors} onChange={(e) => setMaxColors(Number(e.target.value))} />
          </div>

          <div className="param-row">
            <label>调色板</label>
            <select
              className="num-input" style={{ width: "100%" }}
              value={paletteName}
              onChange={(e) => setPaletteName(e.target.value)}
            >
              {PRESET_PALETTES.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
            {chosenPalette.colors.length > 0 && (
              <div style={{ display: "flex", gap: 3, marginTop: 6, flexWrap: "wrap" }}>
                {chosenPalette.colors.map((c) => (
                  <span key={c} style={{ width: 16, height: 16, borderRadius: 4, background: c, border: "1px solid var(--border)" }} />
                ))}
              </div>
            )}
          </div>

          <div className="param-row">
            <label>抖动</label>
            <select
              className="num-input" style={{ width: "100%" }}
              value={dither}
              onChange={(e) => setDither(e.target.value as DitherMode)}
            >
              <option value="none">无</option>
              <option value="floyd">Floyd-Steinberg</option>
              <option value="atkinson">Atkinson</option>
              <option value="bayer2">Bayer 2×2</option>
              <option value="bayer4">Bayer 4×4</option>
            </select>
          </div>

          <div className="tool-divider" />
          <button
            type="button"
            className="btn-primary"
            style={{ width: "100%" }}
            disabled={!result || busy}
            onClick={() => {
              if (result) onImport(docFromPixels(result.pixels, result.w, result.h, "像素化"));
            }}
          >
            {busy ? "转换中…" : "发送到画板精修"}
          </button>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, textAlign: "center" }}>
            结果会作为新画布进入「画板」继续编辑
          </p>
        </div>
      </aside>
    </div>
  );
}
