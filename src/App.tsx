import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "./components/Editor";
import Convert from "./components/Convert";
import {
  addFrame, clampIndex, createAnim, deleteFrame, moveFrame, type PixelAnim,
} from "./lib/anim";
import { composite, type PixelDoc } from "./lib/pixelDoc";
import { clearAutosave, downloadProject, loadAutosave, readProjectFile, saveAutosave } from "./lib/persist";
import { useI18n } from "./lib/i18n";

type Tab = "editor" | "convert";

type PromptRequest =
  | { id: number; kind: "notice"; message: string }
  | { id: number; kind: "confirm"; message: string; resolve: (accepted: boolean) => void };

const TABS: Array<{ id: Tab; labelKey: string }> = [
  { id: "editor", labelKey: "editor" },
  { id: "convert", labelKey: "convert" },
];

function BrandIcon() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
      <rect x="2" y="2" width="28" height="28" rx="6" fill="currentColor" />
      <rect x="6" y="6" width="5" height="5" fill="#fff" />
      <rect x="13" y="6" width="5" height="5" fill="#fff" opacity="0.85" />
      <rect x="6" y="13" width="5" height="5" fill="#fff" opacity="0.7" />
      <rect x="20" y="11" width="5" height="12" rx="1.5" fill="#fff" opacity="0.9" />
      <rect x="19" y="23" width="7" height="3" rx="1" fill="#fff" opacity="0.75" />
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
  const [anim, setAnim] = useState<PixelAnim>(() => createAnim(32, 32, 8, t("layerName", { index: 1 })));
  const [frameIndex, setFrameIndex] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [onion, setOnion] = useState(false);
  const [onionNext, setOnionNext] = useState(false);
  const [promptQueue, setPromptQueue] = useState<PromptRequest[]>([]);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);
  const restoringRef = useRef(true);
  const promptQueueRef = useRef<PromptRequest[]>([]);
  const promptIdRef = useRef(0);
  const tRef = useRef(t);
  tRef.current = t;

  const enqueuePrompt = useCallback((request: PromptRequest) => {
    const next = [...promptQueueRef.current, request];
    promptQueueRef.current = next;
    setPromptQueue(next);
  }, []);

  const showNotice = useCallback((msg: string) => {
    if (promptQueueRef.current.some((item) => item.kind === "notice" && item.message === msg)) return;
    enqueuePrompt({ id: ++promptIdRef.current, kind: "notice", message: msg });
  }, [enqueuePrompt]);

  const askConfirm = useCallback((message: string) => new Promise<boolean>((resolve) => {
    enqueuePrompt({ id: ++promptIdRef.current, kind: "confirm", message, resolve });
  }), [enqueuePrompt]);

  const finishPrompt = useCallback((accepted: boolean) => {
    const active = promptQueueRef.current[0];
    if (!active) return;
    const next = promptQueueRef.current.slice(1);
    promptQueueRef.current = next;
    setPromptQueue(next);
    if (active.kind === "confirm") active.resolve(accepted);
  }, []);

  const closeFeedback = useCallback(() => {
    if (feedbackSending) return;
    setFeedbackOpen(false);
  }, [feedbackSending]);

  const submitFeedback = useCallback(async () => {
    const text = feedbackText.trim();
    if (!text) {
      showNotice(t("feedbackEmpty"));
      return;
    }
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
      showNotice(t("feedbackSuccess"));
    } catch (error) {
      console.error("[PixelPaint] feedback submission failed:", error);
      showNotice(t("feedbackFailure"));
    } finally {
      setFeedbackSending(false);
    }
  }, [feedbackText, showNotice, t]);

  useEffect(() => {
    if (!feedbackOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeFeedback();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeFeedback, feedbackOpen]);

  const doc = anim.frames[frameIndex] ?? anim.frames[0];
  const frames = anim.frames;

  // 更新当前帧（Editor 编辑时调用）
  const setDoc = useCallback((d: PixelDoc) => {
    setAnim((a) => ({ ...a, frames: a.frames.map((f, i) => (i === frameIndex ? d : f)) }));
  }, [frameIndex]);

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

  // 洋葱皮：上一帧（或下一帧）的合成图
  const onionPixels = useMemo(() => {
    if (!onion) return null;
    const prev = frames[frameIndex - 1];
    const next = frames[frameIndex + 1];
    const target = prev ?? (onionNext ? next : null);
    return target ? composite(target) : null;
  }, [onion, onionNext, frames, frameIndex]);

  // 启动时恢复本地草稿
  useEffect(() => {
    let alive = true;
    (async () => {
      const draft = await loadAutosave();
      if (alive && draft) {
        setAnim(draft);
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
  }, [showNotice]);

  // 自动保存草稿（防抖）
  useEffect(() => {
    if (restoringRef.current) return;
    const t = window.setTimeout(() => {
      const res = saveAutosave(anim);
      if (!res.ok) showNotice(tRef.current("autosaveError"));
    }, 800);
    return () => window.clearTimeout(t);
  }, [anim, showNotice]);

  useEffect(() => {
    if (promptQueue.length === 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finishPrompt(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [finishPrompt, promptQueue.length]);

  // 转像素 / 背景处理结果 -> 画板（覆盖前确认）
  const handleImport = useCallback(async (next: PixelDoc) => {
    if (hasContent(doc) && !(await askConfirm(t("replaceCurrentFrameConfirm")))) return;
    setAnim((a) => {
      const frames2 = a.frames.map((f, i) => (i === frameIndex ? next : f));
      return { ...a, frames: frames2 };
    });
    setTab("editor");
    setEpoch((e) => e + 1);
    showNotice(t("sentToCanvas", { width: next.width, height: next.height }));
  }, [askConfirm, doc, frameIndex, showNotice, t]);

  const startOver = async () => {
    if (!(await askConfirm(t("clearCanvasConfirm")))) return;
    clearAutosave();
    setAnim(createAnim(32, 32, 8, t("layerName", { index: 1 })));
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
    setAnim(next);
    setFrameIndex(0);
    setEpoch((e) => e + 1);
    setPlaying(false);
    showNotice(t("projectOpened", { count: next.frames.length, fps: next.fps }));
  }, [askConfirm, showNotice, t]);

  // Tab 方向键导航（ARIA tabs 规范）
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : (i - 1 + TABS.length) % TABS.length;
      setTab(TABS[next].id);
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
                onClick={() => setTab(tabItem.id)}
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
        {tab === "editor" && (
          <div role="tabpanel" id="panel-editor" aria-labelledby="tab-editor">
            <Editor
              doc={doc}
              setDoc={setDoc}
              onNotice={showNotice}
              onConfirm={askConfirm}
              epoch={epoch}
              onionPixels={onionPixels}
              onSaveProject={saveProject}
              onOpenProject={openProject}
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
                onFpsChange: setFps,
                onTogglePlay: () => setPlaying((p) => !p),
                onToggleOnion: () => setOnion((o) => !o),
                onToggleOnionNext: () => setOnionNext((o) => !o),
              }}
            />
          </div>
        )}
        {tab === "convert" && (
          <div role="tabpanel" id="panel-convert" aria-labelledby="tab-convert">
            <Convert
              onImport={handleImport}
              onNotice={showNotice}
            />
          </div>
        )}
      </main>

      {feedbackOpen && (
        <div
          className="modal-overlay open"
          role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeFeedback(); }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
            <h2 id="feedback-title">{t("feedbackTitle")}</h2>
            <p className="modal-hint">{t("feedbackHint")}</p>
            <textarea
              autoFocus
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
              <button type="button" className="btn-primary" onClick={() => void submitFeedback()} disabled={feedbackSending}>
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
          <div className="modal prompt-modal" role="dialog" aria-modal="true" aria-labelledby="prompt-title">
            <div className="prompt-kicker">
              <span className={`prompt-kind ${activePrompt.kind}`}>
                <span aria-hidden="true">{activePrompt.kind === "confirm" ? "?" : "i"}</span>
                {activePrompt.kind === "confirm" ? t("confirmTitle") : t("noticeTitle")}
              </span>
              {promptQueue.length > 1 && (
                <span className="prompt-position">{t("promptQueuePosition", { total: promptQueue.length })}</span>
              )}
            </div>
            <h2 id="prompt-title">{activePrompt.kind === "confirm" ? t("confirmTitle") : t("noticeTitle")}</h2>
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
              {activePrompt.kind === "confirm" && (
                <button type="button" className="btn-ghost" onClick={() => finishPrompt(false)}>
                  {t("cancel")}
                </button>
              )}
              <button type="button" className="btn-primary" autoFocus onClick={() => finishPrompt(true)}>
                {activePrompt.kind === "confirm" ? t("confirmAction") : t("promptDismiss")}
              </button>
            </div>
          </div>
        </div>
      )}

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
        </div>
      </footer>
    </div>
  );
}
