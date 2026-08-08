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
import { useI18n } from "../lib/i18n";

const SIZE_PRESETS = [
  { value: "16", labelKey: "size16" },
  { value: "32", labelKey: "size32" },
  { value: "64", labelKey: "size64" },
  { value: "128", labelKey: "size128" },
  { value: "256", labelKey: "size256" },
] as const;

type SizePreset = (typeof SIZE_PRESETS)[number]["value"] | "custom";

interface ConvertProps {
  onImport: (doc: PixelDoc) => void | Promise<void>;
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
  const { t } = useI18n();
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
      if (!ctx) throw new Error(t("createCanvasError"));
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
      onNotice?.(t("readImageNotice", { name: file.name, width: image.width, height: image.height }));
    } catch {
      setError(t("readImageError"));
    }
  }, [clearBackgroundState, onNotice, setOutputDimensions, t]);

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
    ? result ? t("currentPixelResult") : t("startPixelize")
    : t("chooseImage");
  const sourceCardHint = operation === "background"
    ? result ? t("changeImageHint", { width: result.w, height: result.h }) : t("startPixelizeHint")
    : t("imageHint");
  const sourceCardLabel = operation === "background" && result
    ? t("changeBackgroundImage")
    : t("chooseImageAria");

  const enterBackground = async () => {
    setOperation("background");
    if (!result || sending) return;
    setSending(true);
    setError(null);
    try {
      const file = await pixelsToPngFile(result.pixels, result.w, result.h, "pixelpaint-converted.png");
      if (!file) throw new Error(t("createPngError"));
      setBackgroundInput(file);
      replaceBackgroundResult(null);
      onNotice?.(t("switchToBackground"));
    } catch {
      setError(t("prepareBackgroundError"));
    } finally {
      setSending(false);
    }
  };

  const downloadPixelResult = useCallback(async () => {
    if (!result) return;
    const file = await pixelsToPngFile(result.pixels, result.w, result.h, `pixelpaint-${result.w}x${result.h}.png`);
    if (!file) {
      setError(t("createPngError"));
      return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, [result, t]);

  return (
    <div className="convert-workbench">
      <div className="workbench-head">
        <div>
          <p className="eyebrow">{t("imageProcessing")}</p>
          <h1 className="workbench-title">{t("pixelize")}</h1>
          <p className="workbench-desc">{t("pixelizeDescription")}</p>
        </div>
        <div className="operation-switcher" role="tablist" aria-label={t("imageProcessingOperations")}>
          <button
            type="button"
            role="tab"
            aria-selected={operation === "pixelate"}
            className={`operation-tab ${operation === "pixelate" ? "active" : ""}`}
            onClick={() => setOperation("pixelate")}
          >
            {t("pixelize")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={operation === "background"}
            className={`operation-tab ${operation === "background" ? "active" : ""}`}
            onClick={() => void enterBackground()}
          >
            {t("background")}
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
              <h2 className="card-title">{t("pixelizeSettings")}</h2>
              <div className="tool-divider" />

              <div className="param-row">
                <label htmlFor="size-preset">{t("outputSize")} <span className="range-val">{outW}×{outH}</span></label>
                <select
                  id="size-preset"
                  className="num-input"
                  value={sizePreset}
                  onChange={(e) => onSizePreset(e.target.value as SizePreset)}
                >
                  {SIZE_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{t(preset.labelKey)}</option>)}
                  <option value="custom">{t("custom")}</option>
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
                      aria-label={t("width")}
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
                      aria-label={t("height")}
                      aria-describedby="output-size-hint"
                    />
                  </div>
                )}
                <label className="ghost-check inline-check" style={{ marginTop: 6 }}>
                  <input type="checkbox" checked={lockRatio} onChange={(e) => setLockRatio(e.target.checked)} />
                  {t("keepRatio")}
                </label>
                {sizePreset === "custom" && <p id="output-size-hint" className="field-hint">{t("outputSizeHint")}</p>}
              </div>

              <div className="param-row">
                <label htmlFor="max-colors">{t("colorCount")} <span className="range-val">{paletteLocked ? t("paletteDecided") : maxColors}</span></label>
                <input
                  id="max-colors"
                  type="range"
                  min={2}
                  max={64}
                  value={maxColors}
                  onChange={(e) => setMaxColors(Number(e.target.value))}
                  disabled={paletteLocked}
                />
                {paletteLocked && <p className="field-hint">{t("fixedPaletteHint", { count: chosenPalette.colors.length })}</p>}
              </div>

              <div className="param-row">
                <label htmlFor="palette-pick">{t("palette")}</label>
                <select
                  id="palette-pick"
                  className="num-input"
                  style={{ width: "100%" }}
                  value={paletteName}
                  onChange={(e) => setPaletteName(e.target.value)}
                >
                  {PRESET_PALETTES.map((palette) => (
                    <option key={palette.name} value={palette.name}>
                      {palette.name === NO_PALETTE.name ? t("paletteAuto") : palette.name === "灰度" ? t("paletteGrayscale") : palette.name}
                    </option>
                  ))}
                </select>
                {chosenPalette.colors.length > 0 && (
                  <div className="preset-swatches">
                    {chosenPalette.colors.map((color) => <span key={color} style={{ background: color }} title={color} />)}
                  </div>
                )}
                {paletteName === NO_PALETTE.name && (
                  <>
                    <p className="field-hint">{autoPalette.length > 0 ? t("paletteExtracted", { count: autoPalette.length }) : t("paletteAutoHint")}</p>
                    {autoPalette.length > 0 && (
                      <div className="palette-grid auto-palette-grid">
                        {autoPalette.map((color) => <span key={color} className="swatch" style={{ background: color }} title={color} />)}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="param-row">
                <label htmlFor="dither-pick">{t("dither")}</label>
                <select
                  id="dither-pick"
                  className="num-input"
                  style={{ width: "100%" }}
                  value={dither}
                  onChange={(e) => setDither(e.target.value as DitherMode)}
                >
                  <option value="none">{t("noDither")}</option>
                  <option value="floyd">{t("floyd")}</option>
                  <option value="atkinson">{t("atkinson")}</option>
                  <option value="bayer2">{t("bayer2")}</option>
                  <option value="bayer4">{t("bayer4")}</option>
                </select>
              </div>

              <div className="operation-actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!result || busy}
                  onClick={() => {
                    if (result) void onImport(docFromPixels(result.pixels, result.w, result.h, t("pixelize")));
                  }}
                >
                  {busy ? t("converting") : t("sendToCanvas")}
                </button>
                <button type="button" className="btn-ghost" disabled={!result || busy || sending} onClick={() => void enterBackground()}>
                  {sending ? t("prepare") : t("background")}
                </button>
                <button
                  type="button"
                  className="btn-ghost operation-secondary-action background-result-button"
                  disabled={!result || busy || sending}
                  onClick={() => void downloadPixelResult()}
                >
                  {t("downloadPng")}
                </button>
              </div>
            </div>
          ) : (
            <Cutout
              inputFile={backgroundInput}
              resultFile={backgroundResult}
              onResult={replaceBackgroundResult}
              onImport={onImport}
              onNotice={onNotice}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
