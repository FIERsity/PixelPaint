import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Editor from "./components/Editor";
import Convert from "./components/Convert";
import {
  addFrame, adjacentOnionFrames, clampIndex, createAnim, deleteFrame, moveFrame, resizeFrames, type PixelAnim,
} from "./lib/anim";
import { composite, type PixelDoc } from "./lib/pixelDoc";
import { CUSTOM_PALETTE, type Palette } from "./lib/palette";
import { loadCustomPalettes, saveCustomPalettes } from "./lib/paletteStore";
import { clearAutosave, downloadProject, loadAutosave, readProjectFile, saveAutosave } from "./lib/persist";
import { useI18n } from "./lib/i18n";
import { resolveImportedPalette, type CanvasImportRequest } from "./lib/importFlow";

type Tab = "editor" | "convert";

type PromptRequest = { id: number; message: string; resolve: (accepted: boolean) => void };

export interface ToastRequest {
  kind?: "info" | "success" | "warning" | "error";
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  dedupKey?: string;
  duration?: number;
}

interface ToastEntry extends ToastRequest { id: number }

function useDialogFocus(open: boolean, ref: RefObject<HTMLElement | null>, onEscape: () => void) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => {
      const focusable = ref.current?.querySelector<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== "Tab" || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [onEscape, open, ref]);
}

const TABS: Array<{ id: Tab; labelKey: string }> = [
  { id: "editor", labelKey: "editor" },
  { id: "convert", labelKey: "convert" },
];

function BrandIcon() {
  return (
    <svg viewBox="0 0 220 220" width="28" height="28" aria-hidden="true">
      <g fill="#7C3AED">
        <rect x="28" y="28" width="30" height="30" /><rect x="66" y="28" width="30" height="30" /><rect x="104" y="28" width="30" height="30" /><rect x="142" y="28" width="30" height="30" />
        <rect x="28" y="66" width="30" height="30" /><rect x="66" y="66" width="30" height="30" /><rect x="104" y="66" width="30" height="30" /><rect x="142" y="66" width="30" height="30" />
        <rect x="28" y="104" width="30" height="30" /><rect x="66" y="104" width="30" height="30" /><rect x="142" y="104" width="30" height="30" />
        <rect x="28" y="142" width="30" height="30" /><rect x="66" y="142" width="30" height="30" /><rect x="104" y="142" width="30" height="30" /><rect x="142" y="142" width="30" height="30" />
      </g>
      <rect x="111" y="111" width="30" height="30" fill="#DB2777" stroke="#F7F8FA" strokeWidth="6" />
      <path d="M141 111l18-18v18z" fill="#DB2777" />
    </svg>
  );
}

// 帧是否有内容（用于覆盖前确认）
function hasContent(doc: PixelDoc): boolean {
  const px = composite(doc);
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) return true;
  return false;
}

export default function App() {
  const { language, setLanguage, t } = useI18n();
  const [tab, setTab] = useState<Tab>("editor");
  const [customPalettes, setCustomPalettes] = useState<Palette[]>(() => loadCustomPalettes());
  const [anim, setAnim] = useState<PixelAnim>(() => {
    const initialPalette = loadCustomPalettes()[0] ?? CUSTOM_PALETTE;
    return createAnim(32, 32, 8, t("layerName", { index: 1 }), initialPalette);
  });
  const [frameIndex, setFrameIndex] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [onion, setOnion] = useState(false);
  const [onionNext, setOnionNext] = useState(false);
  const [promptQueue, setPromptQueue] = useState<PromptRequest[]>([]);
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const [importRequest, setImportRequest] = useState<CanvasImportRequest | null>(null);
  const [pixelizeTransfer, setPixelizeTransfer] = useState<{ id: number; file: File } | null>(null);
  const [autosaveStatus, setAutosaveStatus] = useState<"saving" | "saved" | "failed">("saved");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);
  const restoringRef = useRef(true);
  const promptQueueRef = useRef<PromptRequest[]>([]);
  const promptIdRef = useRef(0);
  const toastIdRef = useRef(0);
  const toastTimersRef = useRef(new Map<number, number>());
  const scrollPositionsRef = useRef<Record<Tab, number>>({ editor: 0, convert: 0 });
  const feedbackDialogRef = useRef<HTMLDivElement>(null);
  const promptDialogRef = useRef<HTMLDivElement>(null);
  const importDialogRef = useRef<HTMLDivElement>(null);
  const tRef = useRef(t);
  const customPalettesRef = useRef(customPalettes);
  tRef.current = t;

  const enqueuePrompt = useCallback((request: PromptRequest) => {
    const next = [...promptQueueRef.current, request];
    promptQueueRef.current = next;
    setPromptQueue(next);
  }, []);

  const dismissToast = useCallback((id: number) => {
    const timer = toastTimersRef.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    toastTimersRef.current.delete(id);
    setToasts((items) => items.filter((item) => item.id !== id));
  }, []);

  const showToast = useCallback((request: ToastRequest) => {
    const key = request.dedupKey ?? request.message;
    setToasts((items) => {
      if (items.some((item) => (item.dedupKey ?? item.message) === key)) return items;
      const id = ++toastIdRef.current;
      const entry: ToastEntry = { kind: "info", ...request, id };
      const duration = request.duration ?? (entry.kind === "warning" ? 5000 : entry.kind === "error" ? 0 : 3000);
      if (duration > 0) {
        const timer = window.setTimeout(() => dismissToast(id), duration);
        toastTimersRef.current.set(id, timer);
      }
      return [...items, entry];
    });
  }, [dismissToast]);

  const showNotice = useCallback((msg: string) => {
    const kind = /失败|无法|failed|could not|error/i.test(msg)
      ? "error"
      : /至少|请先|不像|invalid|keep at least|try .*first/i.test(msg) ? "warning" : "info";
    showToast({ kind, message: msg });
  }, [showToast]);

  const askConfirm = useCallback((message: string) => new Promise<boolean>((resolve) => {
    enqueuePrompt({ id: ++promptIdRef.current, message, resolve });
  }), [enqueuePrompt]);

  const finishPrompt = useCallback((accepted: boolean) => {
    const active = promptQueueRef.current[0];
    if (!active) return;
    const next = promptQueueRef.current.slice(1);
    promptQueueRef.current = next;
    setPromptQueue(next);
    active.resolve(accepted);
  }, []);

  const closeFeedback = useCallback(() => {
    if (feedbackSending) return;
    setFeedbackOpen(false);
  }, [feedbackSending]);
  const closeImportDialog = useCallback(() => setImportRequest(null), []);
  const cancelPrompt = useCallback(() => finishPrompt(false), [finishPrompt]);

  const submitFeedback = useCallback(async () => {
    const text = feedbackText.trim();
    if (!text) return;
    setFeedbackSending(true);
    try {
      const response = await fetch("https://feedback.070315.site/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setFeedbackText("");
      setFeedbackOpen(false);
      showToast({ kind: "success", message: t("feedbackSuccess") });
    } catch (error) {
      console.error("[PixelPaint] feedback submission failed:", error);
      showToast({ kind: "error", message: t("feedbackFailure"), dedupKey: "feedback-error" });
    } finally {
      setFeedbackSending(false);
    }
  }, [feedbackText, showToast, t]);

  useDialogFocus(feedbackOpen, feedbackDialogRef, closeFeedback);
  useDialogFocus(promptQueue.length > 0, promptDialogRef, cancelPrompt);
  useDialogFocus(Boolean(importRequest), importDialogRef, closeImportDialog);

  useEffect(() => () => {
    for (const timer of toastTimersRef.current.values()) window.clearTimeout(timer);
  }, []);

  const doc = anim.frames[frameIndex] ?? anim.frames[0];
  const frames = anim.frames;
  const activePalette = anim.palette ?? customPalettes[0] ?? CUSTOM_PALETTE;

  const adoptLoadedAnim = useCallback((next: PixelAnim): PixelAnim => {
    const importedPalette = next.palette;
    if (!importedPalette) {
      return { ...next, palette: customPalettesRef.current[0] ?? CUSTOM_PALETTE };
    }
    if (importedPalette.source === "custom") {
      const exists = customPalettesRef.current.some((palette) => palette.id === importedPalette.id);
      const nextPalettes = exists
        ? customPalettesRef.current.map((palette) => palette.id === importedPalette.id ? importedPalette : palette)
        : [...customPalettesRef.current, importedPalette];
      customPalettesRef.current = nextPalettes;
      setCustomPalettes(nextPalettes);
      return { ...next, palette: importedPalette };
    }
    return next;
  }, []);

  const updatePalette = useCallback((palette: Palette) => {
    setAnim((current) => ({ ...current, palette }));
  }, []);

  const updateCustomPalettes = useCallback((palettes: Palette[]) => {
    customPalettesRef.current = palettes;
    setCustomPalettes(palettes);
    setAnim((current) => {
      const active = current.palette;
      if (!active) return { ...current, palette: palettes[0] ?? CUSTOM_PALETTE };
      const updated = palettes.find((palette) => palette.id === active.id);
      return updated ? { ...current, palette: updated } : current;
    });
  }, []);

  // 更新当前帧（Editor 编辑时调用）
  const setDoc = useCallback((d: PixelDoc) => {
    setAnim((a) => ({ ...a, frames: a.frames.map((f, i) => (i === frameIndex ? d : f)) }));
  }, [frameIndex]);

  const resizeAllFrames = useCallback((width: number, height: number) => {
    setAnim((current) => resizeFrames(current, width, height));
    setEpoch((current) => current + 1);
    setPlaying(false);
  }, []);

  // 帧操作
  const selectFrame = useCallback((i: number) => {
    setFrameIndex(clampIndex(i, frames.length));
    setEpoch((e) => e + 1);
  }, [frames.length]);

  const insertFrame = useCallback((mode: "blank" | "duplicate") => {
    setAnim((a) => {
      const next = addFrame(a, mode, frameIndex, t("layerName", { index: 1 }));
      setFrameIndex(frameIndex + 1);
      return next;
    });
    setEpoch((e) => e + 1);
    setPlaying(false);
  }, [frameIndex, t]);

  const removeFrame = useCallback(async () => {
    if (frames.length <= 1) {
      showNotice(t("atLeastOneFrame"));
      return;
    }
    if (!(await askConfirm(t("deleteFrameConfirm", { index: frameIndex + 1 })))) return;
    setAnim((a) => deleteFrame(a, frameIndex) ?? a);
    setFrameIndex((i) => clampIndex(i, frames.length - 1));
    setEpoch((e) => e + 1);
    setPlaying(false);
  }, [askConfirm, frames.length, frameIndex, showNotice, t]);

  const shiftFrame = useCallback((dir: -1 | 1) => {
    setAnim((a) => {
      const next = moveFrame(a, frameIndex, frameIndex + dir);
      setFrameIndex((i) => clampIndex(i + dir, next.frames.length));
      return next;
    });
    setEpoch((e) => e + 1);
  }, [frameIndex]);

  const setFps = useCallback((fps: number) => {
    setAnim((a) => ({ ...a, fps: Math.max(1, Math.min(60, Math.round(fps))) }));
  }, []);

  // 播放循环
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setFrameIndex((i) => (i + 1) % frames.length);
    }, Math.max(40, 1000 / anim.fps));
    return () => window.clearInterval(id);
  }, [playing, frames.length, anim.fps]);

  // 洋葱皮：上一帧默认显示；启用下一帧时可同时显示前后相邻帧。
  const onionFrames = useMemo(() => {
    const adjacent = adjacentOnionFrames(frames, frameIndex, onion, onionNext);
    return {
      previous: adjacent.previous ? composite(adjacent.previous) : null,
      next: adjacent.next ? composite(adjacent.next) : null,
    };
  }, [onion, onionNext, frames, frameIndex]);

  // 启动时恢复本地草稿
  useEffect(() => {
    let alive = true;
    (async () => {
      const draft = await loadAutosave();
      if (alive && draft) {
        setAnim(adoptLoadedAnim(draft));
        setFrameIndex(clampIndex(0, draft.frames.length));
        setEpoch((e) => e + 1);
        showNotice(tRef.current("draftRestored", {
          count: draft.frames.length,
          width: draft.frames[0]?.width ?? 0,
          height: draft.frames[0]?.height ?? 0,
        }));
      }
      restoringRef.current = false;
    })();
    return () => { alive = false; };
  }, [adoptLoadedAnim, showNotice]);

  useEffect(() => {
    customPalettesRef.current = customPalettes;
    saveCustomPalettes(customPalettes);
  }, [customPalettes]);

  // 自动保存草稿（防抖）
  useEffect(() => {
    if (restoringRef.current) return;
    setAutosaveStatus("saving");
    const t = window.setTimeout(() => {
      const res = saveAutosave(anim);
      if (res.ok) setAutosaveStatus("saved");
      else {
        setAutosaveStatus("failed");
        showToast({ kind: "error", message: tRef.current("autosaveError"), dedupKey: "autosave-error" });
      }
    }, 800);
    return () => window.clearTimeout(t);
  }, [anim, showToast]);

  const switchTab = useCallback((next: Tab, scroll: "restore" | "top" = "restore") => {
    if (next === tab) {
      if (scroll === "top") window.scrollTo({ top: 0 });
      return;
    }
    scrollPositionsRef.current[tab] = window.scrollY;
    if (tab === "editor") setPlaying(false);
    setTab(next);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: scroll === "top" ? 0 : scrollPositionsRef.current[next] });
    });
  }, [tab]);

  const requestCanvasImport = useCallback((request: CanvasImportRequest) => {
    setImportRequest(request);
  }, []);

  const finishCanvasImport = useCallback((withPalette: boolean) => {
    if (!importRequest) return;
    let selectedPalette: Palette | null = null;
    let nextPalettes = customPalettesRef.current;
    let reused = false;
    if (withPalette && importRequest.extractedColors?.length) {
      const resolution = resolveImportedPalette(
        customPalettesRef.current,
        importRequest.sourceName,
        importRequest.extractedColors,
        t("extractedPaletteName"),
      );
      if (resolution) {
        selectedPalette = resolution.palette;
        nextPalettes = resolution.palettes;
        reused = resolution.reused;
      }
    }
    if (nextPalettes !== customPalettesRef.current) {
      customPalettesRef.current = nextPalettes;
      setCustomPalettes(nextPalettes);
    }
    const next = importRequest.doc;
    setAnim((a) => {
      const frames2 = a.frames.map((f, i) => (i === frameIndex ? next : f));
      return { ...a, frames: frames2, palette: selectedPalette ?? a.palette };
    });
    setImportRequest(null);
    switchTab("editor", "top");
    setEpoch((e) => e + 1);
    showToast({
      kind: "success",
      message: selectedPalette
        ? t(reused ? "sentToCanvasPaletteReused" : "sentToCanvasWithPalette", { width: next.width, height: next.height, name: selectedPalette.name })
        : t("sentToCanvas", { width: next.width, height: next.height }),
    });
  }, [frameIndex, importRequest, showToast, switchTab, t]);

  const sendImageToPixelize = useCallback((file: File) => {
    setPixelizeTransfer({ id: Date.now(), file });
    switchTab("convert", "top");
    showToast({ kind: "info", message: t("movedToPixelize") });
  }, [showToast, switchTab, t]);

  const offerImageToPixelize = useCallback((file: File) => {
    showToast({
      kind: "warning",
      message: t("notPixelArtNotice"),
      actionLabel: t("goToPixelize"),
      onAction: () => sendImageToPixelize(file),
      duration: 7000,
    });
  }, [sendImageToPixelize, showToast, t]);

  const startOver = async () => {
    if (!(await askConfirm(t("clearCanvasConfirm")))) return;
    clearAutosave();
    setAnim(createAnim(32, 32, 8, t("layerName", { index: 1 }), activePalette));
    setFrameIndex(0);
    setEpoch((e) => e + 1);
    setPlaying(false);
    showNotice(t("cleared"));
  };

  // 工程保存 / 打开（多帧）
  const saveProject = useCallback(() => {
    downloadProject(anim);
    showNotice(t("projectSaved", { count: anim.frames.length, fps: anim.fps }));
  }, [anim, showNotice, t]);

  const openProject = useCallback(async (file: File) => {
    const next = await readProjectFile(file);
    if (!next) {
      showNotice(t("invalidProject"));
      return;
    }
    if (!(await askConfirm(t("replaceProjectConfirm", { count: next.frames.length })))) return;
    setAnim(adoptLoadedAnim(next));
    setFrameIndex(0);
    setEpoch((e) => e + 1);
    setPlaying(false);
    showNotice(t("projectOpened", { count: next.frames.length, fps: next.fps }));
  }, [adoptLoadedAnim, askConfirm, showNotice, t]);

  // Tab 方向键导航（ARIA tabs 规范）
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : (i - 1 + TABS.length) % TABS.length;
      switchTab(TABS[next].id);
    }
  };

  const activePrompt = promptQueue[0];

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="container header-inner">
          <div className="brand">
            <div className="brand-icon"><BrandIcon /></div>
            <div>
              <h1>Pixel<span className="brand-sub">Paint</span></h1>
              <p className="tagline">{t("tagline")}</p>
            </div>
          </div>
          <nav className="tabs" role="tablist" aria-label={t("workspace")} onKeyDown={onTabKeyDown}>
            {TABS.map((tabItem) => (
              <button
                key={tabItem.id}
                type="button"
                role="tab"
                id={`tab-${tabItem.id}`}
                aria-selected={tab === tabItem.id}
                aria-controls={`panel-${tabItem.id}`}
                tabIndex={tab === tabItem.id ? 0 : -1}
                className={`tab ${tab === tabItem.id ? "active" : ""}`}
                onClick={() => switchTab(tabItem.id)}
              >
                {t(tabItem.labelKey)}
              </button>
            ))}
          </nav>
          <div className="header-actions">
            <div className="lang-switch" role="group" aria-label={t("language")}>
              <button
                type="button"
                className={`lang-btn ${language === "zh" ? "active" : ""}`}
                aria-pressed={language === "zh"}
                onClick={() => setLanguage("zh")}
              >
                {t("langZh")}
              </button>
              <button
                type="button"
                className={`lang-btn ${language === "en" ? "active" : ""}`}
                aria-pressed={language === "en"}
                onClick={() => setLanguage("en")}
              >
                {t("langEn")}
              </button>
            </div>
            <button type="button" className="btn-ghost header-feedback" onClick={() => setFeedbackOpen(true)}>
              {t("feedback")}
            </button>
          </div>
        </div>
      </header>

      <main className="container">
          <div role="tabpanel" id="panel-editor" aria-labelledby="tab-editor" hidden={tab !== "editor"}>
            <Editor
              doc={doc}
              setDoc={setDoc}
              palette={activePalette}
              customPalettes={customPalettes}
              onPaletteChange={updatePalette}
              onCustomPalettesChange={updateCustomPalettes}
              onNotice={showNotice}
              onConfirm={askConfirm}
              epoch={epoch}
              onionPreviousPixels={onionFrames.previous}
              onionNextPixels={onionFrames.next}
              onSaveProject={saveProject}
              onOpenProject={openProject}
              onSendImageToPixelize={offerImageToPixelize}
              onCanvasImport={requestCanvasImport}
              animation={{
                frames,
                frameIndex,
                fps: anim.fps,
                playing,
                onion,
                onionNext,
                onFrameSelect: selectFrame,
                onFrameAddBlank: () => insertFrame("blank"),
                onFrameDuplicate: () => insertFrame("duplicate"),
                onFrameDelete: removeFrame,
                onFrameShift: shiftFrame,
                onResizeFrames: resizeAllFrames,
                onFpsChange: setFps,
                onTogglePlay: () => setPlaying((p) => !p),
                onToggleOnion: () => setOnion((o) => !o),
                onToggleOnionNext: () => setOnionNext((o) => !o),
              }}
            />
          </div>
          <div role="tabpanel" id="panel-convert" aria-labelledby="tab-convert" hidden={tab !== "convert"}>
            <Convert
              onImport={requestCanvasImport}
              onNotice={showNotice}
              externalFile={pixelizeTransfer}
            />
          </div>
      </main>

      {feedbackOpen && (
        <div
          className="modal-overlay open"
          role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeFeedback(); }}
        >
          <div ref={feedbackDialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
            <h2 id="feedback-title">{t("feedbackTitle")}</h2>
            <p className="modal-hint">{t("feedbackHint")}</p>
            <textarea
              rows={4}
              maxLength={2000}
              value={feedbackText}
              placeholder={t("feedbackPlaceholder")}
              onChange={(e) => setFeedbackText(e.target.value)}
            />
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={closeFeedback} disabled={feedbackSending}>
                {t("cancel")}
              </button>
              <button type="button" className="btn-primary" onClick={() => void submitFeedback()} disabled={feedbackSending || feedbackText.trim().length === 0}>
                {feedbackSending ? t("sending") : t("submit")}
              </button>
            </div>
          </div>
        </div>
      )}

      {activePrompt && (
        <div
          className="modal-overlay prompt-overlay"
          role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) finishPrompt(false); }}
        >
          <div ref={promptDialogRef} className="modal prompt-modal" role="dialog" aria-modal="true" aria-labelledby="prompt-title">
            <div className="prompt-kicker">
              <span className="prompt-kind confirm">
                <span aria-hidden="true">?</span>
                {t("confirmTitle")}
              </span>
              {promptQueue.length > 1 && (
                <span className="prompt-position">{t("promptQueuePosition", { total: promptQueue.length })}</span>
              )}
            </div>
            <h2 id="prompt-title">{t("confirmTitle")}</h2>
            <p className="prompt-message">{activePrompt.message}</p>
            {promptQueue.length > 1 && (
              <div className="prompt-queue" aria-label={t("promptQueueLabel")}>
                <div className="prompt-queue-head">
                  <span>{t("promptQueueLabel")}</span>
                  <span>{t("promptQueueCount", { count: promptQueue.length - 1 })}</span>
                </div>
                <ol>
                  {promptQueue.slice(1, 4).map((item) => (
                    <li key={item.id}>{item.message}</li>
                  ))}
                  {promptQueue.length > 4 && <li>{t("promptQueueMore", { count: promptQueue.length - 4 })}</li>}
                </ol>
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => finishPrompt(false)}>{t("cancel")}</button>
              <button type="button" className="btn-primary" onClick={() => finishPrompt(true)}>
                {t("confirmAction")}
              </button>
            </div>
          </div>
        </div>
      )}

      {importRequest && (
        <div className="modal-overlay import-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setImportRequest(null); }}>
          <div ref={importDialogRef} className="modal import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
            <h2 id="import-title">{t("sendToCanvasConfirmTitle")}</h2>
            <p className="import-summary"><strong>{importRequest.doc.width} × {importRequest.doc.height}</strong><span>{importRequest.sourceName}</span></p>
            {hasContent(doc) && <p className="import-warning">{t("replaceCurrentFrameWarning")}</p>}
            {importRequest.extractedColors && importRequest.extractedColors.length > 0 && (
              <div className="import-palette-preview">
                <p>{t("extractedPaletteOffer", { count: importRequest.extractedColors.length })}</p>
                <div className="preset-swatches">
                  {importRequest.extractedColors.map((color) => <span key={color} style={{ background: color }} title={color} />)}
                </div>
              </div>
            )}
            <div className="modal-actions import-actions-dialog">
              <button type="button" className="btn-ghost" onClick={() => setImportRequest(null)}>{t("cancel")}</button>
              <button type="button" className="btn-ghost" onClick={() => finishCanvasImport(false)}>{t("sendOnly")}</button>
              {importRequest.extractedColors && importRequest.extractedColors.length > 0 && (
                <button type="button" className="btn-primary" onClick={() => finishCanvasImport(true)}>{t("sendAndCreatePalette")}</button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="toast-region" aria-live="polite" aria-label={t("notifications")}>
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind ?? "info"}`} role={toast.kind === "error" ? "alert" : "status"}>
            <span className="toast-message">{toast.message}</span>
            {toast.actionLabel && toast.onAction && (
              <button type="button" onClick={() => { toast.onAction?.(); dismissToast(toast.id); }}>{toast.actionLabel}</button>
            )}
            <button type="button" className="toast-close" onClick={() => dismissToast(toast.id)} aria-label={t("dismiss")}>×</button>
          </div>
        ))}
      </div>

      <footer className="site-footer">
        <div className="container">
          <p>
            {t("footer")}
            {" · "}
            <button type="button" className="link-btn" onClick={() => void startOver()}>{t("clearRestart")}</button>
          </p>
          <p style={{ marginTop: 6 }}>
            {t("iconsBy")} {" "}
            <a href="https://pxlkit.xyz" target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>
              Pxlkit
            </a>
          </p>
          <p className={`autosave-status ${autosaveStatus}`}>{t(autosaveStatus === "saving" ? "autosaveSaving" : autosaveStatus === "saved" ? "autosaveSaved" : "autosaveFailed")}</p>
        </div>
      </footer>
    </div>
  );
}
