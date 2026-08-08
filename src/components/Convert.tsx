import { useCallback, useEffect, useRef, useState } from "react";
import type { PixelDoc } from "../lib/pixelDoc";
import { docFromPixels } from "../lib/pixelDoc";
import { NO_PALETTE, PRESET_PALETTES, rgbToHex, type Palette } from "../lib/palette";
import type { DitherMode, ToPixelOptions } from "../lib/pixel";
import type { ToPixelRequest, ToPixelResponse } from "../lib/toPixel.worker";
import { checkerStyle } from "../lib/checker";
import { pixelsToPngFile, type ImageTransfer } from "../lib/imageTransfer";

const SIZE_PRESETS = [
  { value: "16", label: "16 px（按比例）" },
  { value: "32", label: "32 px（按比例）" },
  { value: "64", label: "64 px（按比例）" },
  { value: "128", label: "128 px（按比例）" },
  { value: "256", label: "256 px（按比例）" },
] as const;

type SizePreset = (typeof SIZE_PRESETS)[number]["value"] | "custom";

interface ConvertProps {
  onImport: (doc: PixelDoc) => void;
  onNotice?: (msg: string) => void;
  onSendToCutout: (file: File) => void;
  incomingImage?: ImageTransfer | null;
  onIncomingConsumed?: (id: number) => void;
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

export default function Convert({ onImport, onNotice, onSendToCutout, incomingImage, onIncomingConsumed }: ConvertProps) {
  const [source, setSource] = useState<Source | null>(null);
  const [outW, setOutW] = useState(32);
  const [outH, setOutH] = useState(32);
  const [sizePreset, setSizePreset] = useState<SizePreset>("32");
  const [lockRatio, setLockRatio] = useState(true);
  const [maxColors, setMaxColors] = useState(16);
  const [paletteName, setPaletteName] = useState<string>(NO_PALETTE.name);
  const [autoPalette, setAutoPalette] = useState<string[]>([]);
  const [dither, setDither] = useState<DitherMode>("none");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragover, setDragover] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const previewRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);
  // 每个请求自带尺寸，避免用“最新参数”错配旧结果导致崩溃/花屏
  const pending = useRef(new Map<number, { w: number; h: number; auto: boolean }>());
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
      const req = pending.current.get(msg.id);
      pending.current.delete(msg.id);
      // 只采纳最新一次请求的结果
      if (msg.id !== reqId.current) return;
      if (msg.error) {
        setError(msg.error);
        setBusy(false);
        return;
      }
      if (!req) return;
      if (req.auto && Array.isArray(msg.palette)) {
        setAutoPalette(msg.palette.map(([r, g, b]) => rgbToHex(r, g, b)));
      }
      setResult({ pixels: msg.pixels, w: req.w, h: req.h });
      setBusy(false);
    };
    workerRef.current = w;
    return w;
  }, []);

  // 卸载时终止 worker，避免僵尸线程持有整张源图
  useEffect(() => () => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const runConvert = useCallback(() => {
    const s = sourceRef.current;
    const w = ensureWorker();
    if (!s || !w) return;
    const opts = optsRef.current;
    if (!opts) return;
    reqId.current += 1;
    const id = reqId.current;
    pending.current.set(id, {
      w: opts.outWidth,
      h: opts.outHeight,
      auto: paletteName === NO_PALETTE.name,
    });
    setBusy(true);
    setError(null);
    // 传拷贝而非 transfer，避免 detach 源图
    const req: ToPixelRequest = { id, data: s.data, srcW: s.w, srcH: s.h, opts };
    w.postMessage(req);
  }, [ensureWorker, paletteName]);

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
    if (result.w < 1 || result.h < 1) return; // 防止尺寸为 0 时 createImageData 抛异常
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
      setSizePreset("32");
      setAutoPalette([]);
      onNotice?.(`已读取 ${file.name}（${img.width}×${img.height}）`);
    } catch {
      setError("无法读取该图片，请换一张试试。");
    }
  }, [onNotice]);

  const onWidth = (v: number) => {
    const w = Math.max(1, Math.min(512, Math.round(v) || 1));
    setSizePreset("custom");
    setOutW(w);
    if (lockRatio && source) {
      setOutH(Math.max(1, Math.min(512, Math.round((w * source.h) / source.w))));
    }
  };

  const onHeight = (v: number) => {
    setSizePreset("custom");
    setOutH(Math.max(1, Math.min(512, Math.round(v) || 1)));
  };

  const onSizePreset = (value: SizePreset) => {
    setSizePreset(value);
    if (value === "custom") return;
    const width = Number(value);
    const height = source
      ? Math.max(1, Math.min(512, Math.round((width * source.h) / source.w)))
      : width;
    setOutW(width);
    setOutH(height);
    setLockRatio(true);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragover(false);
    const f = e.dataTransfer.files?.[0];
    if (f) loadFile(f);
  };

  // 从抠图模块流转过来的图片，作为新的输入载入。
  useEffect(() => {
    if (!incomingImage) return;
    void loadFile(incomingImage.file);
    onIncomingConsumed?.(incomingImage.id);
  }, [incomingImage, loadFile, onIncomingConsumed]);

  const chosenPalette: Palette = PRESET_PALETTES.find((p) => p.name === paletteName) ?? NO_PALETTE;
  const paletteLocked = chosenPalette.colors.length > 0;
  // 预览放大：小画布放大到可读尺寸（最长边约 420px），不超过 20×
  const previewScale = result
    ? Math.max(1, Math.min(20, Math.floor(420 / Math.max(result.w, result.h))))
    : 1;
  const previewChecker = checkerStyle(previewScale);

  const sendToCutout = async () => {
    if (!result || sending) return;
    setSending(true);
    setError(null);
    try {
      const file = await pixelsToPngFile(result.pixels, result.w, result.h, "pixelpaint-converted.png");
      if (!file) throw new Error("无法生成 PNG");
      onSendToCutout(file);
    } catch {
      setError("无法把结果送入抠图，请重试。");
    } finally {
      setSending(false);
    }
  };

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
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label="选择或拖放要转像素的图片"
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
            <div className="preview-box">
              <div
                className="pixel-preview checker"
                style={{ width: result.w * previewScale, height: result.h * previewScale, ...previewChecker }}
              >
                <canvas
                  ref={previewRef}
                  className="pixelated"
                  style={{
                    imageRendering: "pixelated",
                    width: result.w * previewScale,
                    height: result.h * previewScale,
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="preview-box checker" style={{ color: "var(--muted)", fontSize: 13 }}>上传图片后在此预览像素化结果</div>
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
            <label htmlFor="size-preset">输出尺寸 <span className="range-val">{outW}×{outH}</span></label>
            <select
              id="size-preset"
              className="num-input"
              value={sizePreset}
              onChange={(e) => onSizePreset(e.target.value as SizePreset)}
            >
              {SIZE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              <option value="custom">自定义</option>
            </select>
            {sizePreset === "custom" && (
              <div className="size-row">
                <input id="out-w" className="num-input" type="number" min={1} max={512} value={outW} onChange={(e) => onWidth(Number(e.target.value))} aria-label="输出宽度" />
                <span style={{ color: "var(--muted)" }} aria-hidden="true">×</span>
                <input className="num-input" type="number" min={1} max={512} value={outH} onChange={(e) => onHeight(Number(e.target.value))} aria-label="输出高度" />
              </div>
            )}
            <label className="ghost-check" style={{ marginTop: 6 }}>
              <input type="checkbox" checked={lockRatio} onChange={(e) => setLockRatio(e.target.checked)} />
              自定义时保持原图比例
            </label>
          </div>

          <div className="param-row">
            <label htmlFor="max-colors">
              颜色数 <span className="range-val">{paletteLocked ? "由调色板决定" : maxColors}</span>
            </label>
            <input
              id="max-colors"
              type="range" min={2} max={64} value={maxColors}
              onChange={(e) => setMaxColors(Number(e.target.value))}
              disabled={paletteLocked}
            />
            {paletteLocked && (
              <p style={{ fontSize: 12, color: "var(--muted)" }}>
                已选固定调色板（{chosenPalette.colors.length} 色），此项无效
              </p>
            )}
          </div>

          <div className="param-row">
            <label htmlFor="palette-pick">调色板</label>
            <select
              id="palette-pick"
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
            {paletteName === NO_PALETTE.name && (
              <>
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                  {autoPalette.length > 0 ? `已从当前图片提取 ${autoPalette.length} 色` : "上传图片后自动提取颜色"}
                </p>
                {autoPalette.length > 0 && (
                  <div className="palette-grid auto-palette-grid">
                    {autoPalette.map((c) => (
                      <span key={c} className="swatch" style={{ background: c }} title={c} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="param-row">
            <label htmlFor="dither-pick">抖动</label>
            <select
              id="dither-pick"
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
          <button
            type="button"
            className="btn-ghost"
            style={{ width: "100%", marginTop: 8 }}
            disabled={!result || busy || sending}
            onClick={sendToCutout}
          >
            {sending ? "准备中…" : "发送到抠图"}
          </button>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, textAlign: "center" }}>
            结果会作为新画布进入「画板」继续编辑
          </p>
        </div>
      </aside>
    </div>
  );
}
