import { useEffect, useRef, useState } from "react";
import type { PixelDoc } from "../lib/pixelDoc";
import { docFromPixels } from "../lib/pixelDoc";
import {
  normalizeCutoutBlob,
  removePixelBackgroundBlob,
  type CutoutEdgeMode,
  type PixelCutoutScope,
} from "../lib/cutout";
import { useI18n } from "../lib/i18n";

interface CutoutProps {
  inputFile: File | null;
  resultFile: File | null;
  onResult: (file: File) => void;
  onImport: (doc: PixelDoc) => void;
  onNotice?: (msg: string) => void;
}

type Phase = "idle" | "ready" | "running" | "done" | "error";
type CutoutMethod = "pixel" | "ai";

export default function Cutout({ inputFile, resultFile, onResult, onImport, onNotice }: CutoutProps) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>(inputFile ? "ready" : "idle");
  const [progress, setProgress] = useState<{ label: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<CutoutMethod>("pixel");
  const [scope, setScope] = useState<PixelCutoutScope>("connected");
  const [tolerance, setTolerance] = useState(18);
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
    setProgress({ label: t("prepare"), pct: 0 });
    try {
      let normalized: Blob;
      if (method === "pixel") {
        setProgress({ label: t("samplingBackground"), pct: 12 });
        const pixelResult = await removePixelBackgroundBlob(inputFile, { scope, tolerance });
        if (runId !== runIdRef.current) return;
        setProgress({ label: t("cleanEdges"), pct: 99 });
        normalized = pixelResult.blob;
      } else {
        // 懒加载背景处理模型（首次会下载约 40MB，之后由浏览器缓存）。
        const { removeBackground } = await import("@imgly/background-removal");
        const blob = await removeBackground(inputFile, {
          model,
          output: { format: "image/png" },
          progress: (key, current, total) => {
            if (runId !== runIdRef.current) return;
            let label = t("processing");
            if (key.includes("fetch")) label = t("downloadingModel");
            else if (key.includes("compute")) label = t("processingBackground");
            const pct = total > 0 ? Math.round((current / total) * 100) : 0;
            setProgress({ label, pct: Math.max(1, Math.min(99, pct)) });
          },
        });
        if (runId !== runIdRef.current) return;
        setProgress({ label: t("cleanEdges"), pct: 99 });
        normalized = await normalizeCutoutBlob(inputFile, blob, { mode: edgeMode, threshold });
      }
      if (runId !== runIdRef.current) return;
      const base = inputFile.name.replace(/\.[^.]+$/, "") || "pixelpaint";
      const file = new File([normalized], base + "-background.png", { type: "image/png" });
      onResult(file);
      setProgress(null);
      setPhase("done");
      onNotice?.(method === "pixel"
        ? t("pixelBackgroundDone", { scope: scope === "connected" ? t("connectedBackgroundShort") : t("globalBackgroundShort") })
        : t("backgroundDone", { mode: edgeMode === "hard" ? t("hardEdgeShort") : t("softEdgeShort") }));
    } catch (err) {
      if (runId !== runIdRef.current) return;
      console.error(err);
      setError(t("backgroundError"));
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
      if (!ctx) throw new Error(t("resultCanvasError"));
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      onImport(docFromPixels(image.data, image.width, image.height, t("background")));
    } catch {
      setError(t("sendBackgroundError"));
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
      <h2 className="card-title">{t("backgroundSettings")}</h2>
      <p className="card-desc">{t("backgroundDescription")}</p>
      <div className="tool-divider" />

      {!inputFile && (
        <div className="operation-empty" role="status">
          {t("backgroundEmpty")}
        </div>
      )}

      <div className="param-row">
        <label htmlFor="cutout-method">{t("backgroundMethod")}</label>
        <select
          id="cutout-method"
          className="num-input"
          style={{ width: "100%" }}
          value={method}
          onChange={(e) => setMethod(e.target.value as CutoutMethod)}
        >
          <option value="pixel">{t("pixelMethod")}</option>
          <option value="ai">{t("aiMethod")}</option>
        </select>
        <p className="field-hint">{method === "pixel" ? t("pixelMethodHint") : t("aiMethodHint")}</p>
      </div>

      {method === "pixel" ? (
        <>
          <div className="param-row">
            <label htmlFor="cutout-scope">{t("backgroundScope")}</label>
            <select
              id="cutout-scope"
              className="num-input"
              style={{ width: "100%" }}
              value={scope}
              onChange={(e) => setScope(e.target.value as PixelCutoutScope)}
            >
              <option value="connected">{t("connectedBackground")}</option>
              <option value="global">{t("globalBackground")}</option>
            </select>
            <p className="field-hint">{t("scopeHint")}</p>
          </div>

          <div className="param-row">
            <label htmlFor="cutout-tolerance">
              {t("colorTolerance")} <span className="range-val">{tolerance}</span>
            </label>
            <input
              id="cutout-tolerance"
              type="range"
              min="0"
              max="100"
              step="1"
              value={tolerance}
              onChange={(e) => setTolerance(Number(e.target.value))}
            />
            <p className="field-hint">{t("toleranceHint")}</p>
          </div>
        </>
      ) : (
        <>
          <div className="param-row">
            <label htmlFor="cutout-model">{t("modelPrecision")}</label>
            <select
              id="cutout-model"
              className="num-input"
              style={{ width: "100%" }}
              value={model}
              onChange={(e) => setModel(e.target.value as "isnet" | "isnet_quint8")}
            >
              <option value="isnet_quint8">{t("fastModel")}</option>
              <option value="isnet">{t("preciseModel")}</option>
            </select>
            <p className="field-hint">{t("modelHint")}</p>
          </div>

          <div className="param-row">
            <label htmlFor="cutout-edge">{t("edgeProcessing")}</label>
            <select
              id="cutout-edge"
              className="num-input"
              style={{ width: "100%" }}
              value={edgeMode}
              onChange={(e) => setEdgeMode(e.target.value as CutoutEdgeMode)}
            >
              <option value="hard">{t("hardEdge")}</option>
              <option value="soft">{t("softEdge")}</option>
            </select>
            <p className="field-hint">{t("edgeHint")}</p>
          </div>

          {edgeMode === "hard" && (
            <div className="param-row">
              <label htmlFor="cutout-threshold">
                {t("hardThreshold")} <span className="range-val">{threshold}</span>
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
              <p className="field-hint">{t("thresholdHint")}</p>
            </div>
          )}
        </>
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
        {phase === "running" ? t("processing") : method === "pixel" ? t("startPixelBackground") : t("startBackground")}
      </button>

      <div className="operation-actions background-result-actions">
        <button
          type="button"
          className="btn-ghost operation-secondary-action background-result-button"
          disabled={!resultFile || phase === "running"}
          onClick={sendToCanvas}
        >
          {t("sendToCanvas")}
        </button>

        <button
          type="button"
          className="btn-ghost operation-secondary-action background-result-button"
          disabled={!resultFile || phase === "running"}
          onClick={download}
        >
          {t("downloadPng")}
        </button>
      </div>
    </div>
  );
}
