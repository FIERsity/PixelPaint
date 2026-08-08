import { useCallback, useEffect, useRef, useState } from "react";
import type { PixelDoc } from "../lib/pixelDoc";
import { docFromPixels } from "../lib/pixelDoc";
import Cutout from "./Cutout";
import ResultPreview, { type PreviewOperation } from "./ResultPreview";
import { NO_PALETTE, PRESET_PALETTES, rgbToHex, type Palette } from "../lib/palette";
import type { DitherMode, ToPixelOptions } from "../lib/pixel";
import type { ToPixelRequest, ToPixelResponse } from "../lib/toPixel.worker";
import { clampDimension, normalizeDimensionDraft, parseDimensionDraft } from "../lib/dimensions";
import { pixelsToPngFile } from "../lib/imageTransfer";

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

export default function Convert({ onImport, onNotice }: ConvertProps) {
  const [source, setSource] = useState<Source | null>(null);
  const [outW, setOutW] = useState(32);
  const [outH, setOutH] = useState(32);
  const [widthDraft, setWidthDraft] = useState("32");
  const [heightDraft, setHeightDraft] = useState("32");
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
  const [operation, setOperation] = useState<PreviewOperation>("pixelate");
  const [backgroundInput, setBackgroundInput] = useState<File | null>(null);
  const [backgroundResult, setBackgroundResult] = useState<File | null>(null);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);

  const previewInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);
  // 每个请求自带尺寸，避免用“最新参数”错配旧结果导致崩溃/花屏。
  const pending = useRef(new Map<number, { w: number; h: number; auto: boolean }>());
  const sourceRef = useRef<Source | null>(null);
  const backgroundUrlRef = useRef<string | null>(null);
  const optsRef = useRef<ToPixelOptions | null>(null);
  sourceRef.current = source;

  const replaceBackgroundResult = useCallback((file: File | null) => {
    if (backgroundUrlRef.current) URL.revokeObjectURL(backgroundUrlRef.current);
    const url = file ? URL.createObjectURL(file) : null;
    backgroundUrlRef.current = url;
    setBackgroundResult(file);
    setBackgroundUrl(url);
  }, []);

  const clearBackgroundState = useCallback(() => {
    setBackgroundInput(null);
    replaceBackgroundResult(null);
  }, [replaceBackgroundResult]);

  const buildOpts = useCallback((): ToPixelOptions => {
    const pal = PRESET_PALETTES.find((p) => p.name === paletteName) ?? NO_PALETTE;
    return {
      outWidth: clampDimension(outW),
      outHeight: clampDimension(outH),
      maxColors,
      palette: pal.colors.length > 0 ? pal.colors : null,
      dither,
    };
  }, [outW, outH, maxColors, paletteName, dither]);
  optsRef.current = buildOpts();

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    if (typeof Worker === "undefined") return null;
    const worker = new Worker(new URL("../lib/toPixel.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<ToPixelResponse>) => {
      const msg = e.data as ToPixelResponse & { error?: string };
      const request = pending.current.get(msg.id);
      pending.current.delete(msg.id);
      if (msg.id !== reqId.current) return;
      if (msg.error) {
        setError(msg.error);
        setBusy(false);
        return;
      }
      if (!request) return;
      if (request.auto && Array.isArray(msg.palette)) {
        setAutoPalette(msg.palette.map(([r, g, b]) => rgbToHex(r, g, b)));
      }
      setResult({ pixels: msg.pixels, w: request.w, h: request.h });
      setBusy(false);
    };
    workerRef.current = worker;
    return worker;
  }, []);

  useEffect(() => () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    if (backgroundUrlRef.current) URL.revokeObjectURL(backgroundUrlRef.current);
  }, []);

  const runConvert = useCallback(() => {
    const currentSource = sourceRef.current;
    const worker = ensureWorker();
    if (!currentSource || !worker) return;
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
    const request: ToPixelRequest = { id, data: currentSource.data, srcW: currentSource.w, srcH: currentSource.h, opts };
    worker.postMessage(request);
  }, [ensureWorker, paletteName]);

  useEffect(() => {
    if (!source) return;
    const timer = setTimeout(runConvert, 220);
    return () => clearTimeout(timer);
  }, [source, outW, outH, maxColors, paletteName, dither, runConvert]);

  const setOutputDimensions = useCallback((width: number, height: number) => {
    const nextWidth = clampDimension(width);
    const nextHeight = clampDimension(height);
    setOutW(nextWidth);
    setOutH(nextHeight);
    setWidthDraft(String(nextWidth));
    setHeightDraft(String(nextHeight));
  }, []);

  const loadFile = useCallback(async (file: File) => {
    try {
      setError(null);
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("无法创建图片画布");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const width = 32;
      const height = clampDimension(Math.round((width * image.height) / image.width));
      setSource({ data: image.data, w: image.width, h: image.height, name: file.name });
      setResult(null);
      setOutputDimensions(width, height);
      setSizePreset("32");
      setAutoPalette([]);
      setOperation("pixelate");
      clearBackgroundState();
      onNotice?.(`已读取 ${file.name}（${image.width}×${image.height}）`);
    } catch {
      setError("无法读取该图片，请换一张试试。");
    }
  }, [clearBackgroundState, onNotice, setOutputDimensions]);

  const onWidthDraft = (raw: string) => {
    setWidthDraft(raw);
    const width = parseDimensionDraft(raw);
    if (width === null) return;
    const height = lockRatio && source
      ? clampDimension(Math.round((width * source.h) / source.w))
      : outH;
    setOutW(width);
    setOutH(height);
    if (lockRatio && source) setHeightDraft(String(height));
    setSizePreset("custom");
  };

  const onHeightDraft = (raw: string) => {
    setHeightDraft(raw);
    const height = parseDimensionDraft(raw);
    if (height === null) return;
    const width = lockRatio && source
      ? clampDimension(Math.round((height * source.w) / source.h))
      : outW;
    setOutH(height);
    setOutW(width);
    if (lockRatio && source) setWidthDraft(String(width));
    setSizePreset("custom");
  };

  const onSizeBlur = (axis: "width" | "height") => {
    if (axis === "width") setWidthDraft(normalizeDimensionDraft(widthDraft, outW));
    else setHeightDraft(normalizeDimensionDraft(heightDraft, outH));
  };

  const onSizePreset = (value: SizePreset) => {
    setSizePreset(value);
    if (value === "custom") return;
    const width = Number(value);
    const height = source
      ? clampDimension(Math.round((width * source.h) / source.w))
      : width;
    setLockRatio(true);
    setOutputDimensions(width, height);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragover(false);
    const file = e.dataTransfer.files?.[0];
    if (file?.type.startsWith("image/")) void loadFile(file);
  };

  const chosenPalette: Palette = PRESET_PALETTES.find((p) => p.name === paletteName) ?? NO_PALETTE;
  const paletteLocked = chosenPalette.colors.length > 0;
  const sourceCardTitle = operation === "background"
    ? result ? "当前像素化结果" : "先选择图片开始转像素"
    : "选择图片或拖拽到这里";
  const sourceCardHint = operation === "background"
    ? result ? `点击可更换图片 · 当前结果 ${result.w}×${result.h} px` : "选择图片后会先完成转像素"
    : "支持 JPG / PNG / WebP · 全程在浏览器本地处理";
  const sourceCardLabel = operation === "background" && result
    ? "更换用于处理背景的图片"
    : "选择或拖放要处理的图片";

  const enterBackground = async () => {
    setOperation("background");
    if (!result || sending) return;
    setSending(true);
    setError(null);
    try {
      const file = await pixelsToPngFile(result.pixels, result.w, result.h, "pixelpaint-converted.png");
      if (!file) throw new Error("无法生成 PNG");
      setBackgroundInput(file);
      replaceBackgroundResult(null);
      onNotice?.("已切换到处理背景");
    } catch {
      setError("无法准备背景处理，请重试。");
    } finally {
      setSending(false);
    }
  };

  const returnToPixel = (file: File) => {
    setOperation("pixelate");
    void loadFile(file);
    onNotice?.("已返回转像素");
  };

  return (
    <div className="convert-workbench">
      <div className="workbench-head">
        <div>
          <p className="eyebrow">图片处理</p>
          <h1 className="workbench-title">转像素</h1>
          <p className="workbench-desc">把图片变成可编辑的像素画，也可以处理当前结果的透明背景。</p>
        </div>
        <div className="operation-switcher" role="tablist" aria-label="图片处理操作">
          <button
            type="button"
            role="tab"
            aria-selected={operation === "pixelate"}
            className={`operation-tab ${operation === "pixelate" ? "active" : ""}`}
            onClick={() => setOperation("pixelate")}
          >
            转像素
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={operation === "background"}
            className={`operation-tab ${operation === "background" ? "active" : ""}`}
            onClick={() => void enterBackground()}
          >
            处理背景
          </button>
        </div>
      </div>

      <div className="convert-layout">
        <section className="convert-main">
          <div
            className={`card drop-card source-card ${dragover ? "dragover" : ""}`}
            onClick={() => previewInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragover(true); }}
            onDragLeave={() => setDragover(false)}
            onDrop={handleDrop}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                previewInputRef.current?.click();
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={sourceCardLabel}
          >
            <input
              ref={previewInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void loadFile(file);
                e.target.value = "";
              }}
            />
            <div className="source-card-copy">
              <div className="drop-icon" aria-hidden="true">↑</div>
              <div>
                <p className="drop-title">{sourceCardTitle}</p>
                <p className="drop-hint">{sourceCardHint}</p>
              </div>
            </div>
          </div>

          <ResultPreview
            operation={operation}
            result={result}
            backgroundUrl={backgroundUrl}
            busy={busy}
            error={error}
          />
        </section>

        <aside className="card operation-card">
          {operation === "pixelate" ? (
            <div className="operation-panel">
              <h2 className="card-title">转像素设置</h2>
              <div className="tool-divider" />

              <div className="param-row">
                <label htmlFor="size-preset">输出尺寸 <span className="range-val">{outW}×{outH}</span></label>
                <select
                  id="size-preset"
                  className="num-input"
                  value={sizePreset}
                  onChange={(e) => onSizePreset(e.target.value as SizePreset)}
                >
                  {SIZE_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
                  <option value="custom">自定义</option>
                </select>
                {sizePreset === "custom" && (
                  <div className="size-row output-size-row">
                    <input
                      id="out-w"
                      className="num-input"
                      type="number"
                      min={1}
                      max={512}
                      value={widthDraft}
                      onChange={(e) => onWidthDraft(e.target.value)}
                      onBlur={() => onSizeBlur("width")}
                      aria-label="输出宽度"
                      aria-describedby="output-size-hint"
                    />
                    <span aria-hidden="true">×</span>
                    <input
                      id="out-h"
                      className="num-input"
                      type="number"
                      min={1}
                      max={512}
                      value={heightDraft}
                      onChange={(e) => onHeightDraft(e.target.value)}
                      onBlur={() => onSizeBlur("height")}
                      aria-label="输出高度"
                      aria-describedby="output-size-hint"
                    />
                  </div>
                )}
                <label className="ghost-check inline-check" style={{ marginTop: 6 }}>
                  <input type="checkbox" checked={lockRatio} onChange={(e) => setLockRatio(e.target.checked)} />
                  保持原图比例
                </label>
                {sizePreset === "custom" && <p id="output-size-hint" className="field-hint">范围 1–512；清空时不会立即改动当前结果。</p>}
              </div>

              <div className="param-row">
                <label htmlFor="max-colors">颜色数 <span className="range-val">{paletteLocked ? "由调色板决定" : maxColors}</span></label>
                <input
                  id="max-colors"
                  type="range"
                  min={2}
                  max={64}
                  value={maxColors}
                  onChange={(e) => setMaxColors(Number(e.target.value))}
                  disabled={paletteLocked}
                />
                {paletteLocked && <p className="field-hint">已选固定调色板（{chosenPalette.colors.length} 色）。</p>}
              </div>

              <div className="param-row">
                <label htmlFor="palette-pick">调色板</label>
                <select
                  id="palette-pick"
                  className="num-input"
                  style={{ width: "100%" }}
                  value={paletteName}
                  onChange={(e) => setPaletteName(e.target.value)}
                >
                  {PRESET_PALETTES.map((palette) => <option key={palette.name} value={palette.name}>{palette.name}</option>)}
                </select>
                {chosenPalette.colors.length > 0 && (
                  <div className="preset-swatches">
                    {chosenPalette.colors.map((color) => <span key={color} style={{ background: color }} title={color} />)}
                  </div>
                )}
                {paletteName === NO_PALETTE.name && (
                  <>
                    <p className="field-hint">{autoPalette.length > 0 ? `已从当前图片提取 ${autoPalette.length} 色` : "上传图片后自动提取颜色"}</p>
                    {autoPalette.length > 0 && (
                      <div className="palette-grid auto-palette-grid">
                        {autoPalette.map((color) => <span key={color} className="swatch" style={{ background: color }} title={color} />)}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="param-row">
                <label htmlFor="dither-pick">抖动</label>
                <select
                  id="dither-pick"
                  className="num-input"
                  style={{ width: "100%" }}
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

              <div className="operation-actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!result || busy}
                  onClick={() => {
                    if (result) onImport(docFromPixels(result.pixels, result.w, result.h, "像素化"));
                  }}
                >
                  {busy ? "转换中…" : "发送到画板"}
                </button>
                <button type="button" className="btn-ghost" disabled={!result || busy || sending} onClick={() => void enterBackground()}>
                  {sending ? "准备中…" : "处理背景"}
                </button>
              </div>
            </div>
          ) : (
            <Cutout
              inputFile={backgroundInput}
              resultFile={backgroundResult}
              onResult={replaceBackgroundResult}
              onImport={onImport}
              onReturnToPixel={returnToPixel}
              onNotice={onNotice}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
