import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "./components/Editor";
import Convert from "./components/Convert";
import Cutout from "./components/Cutout";
import {
  addFrame, clampIndex, createAnim, deleteFrame, moveFrame, type PixelAnim,
} from "./lib/anim";
import { composite, type PixelDoc } from "./lib/pixelDoc";
import { clearAutosave, downloadProject, loadAutosave, readProjectFile, saveAutosave } from "./lib/persist";
import type { ImageTransfer } from "./lib/imageTransfer";

type Tab = "editor" | "convert" | "cutout";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "editor", label: "画板" },
  { id: "convert", label: "转像素" },
  { id: "cutout", label: "抠图" },
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
  const [tab, setTab] = useState<Tab>("editor");
  const [anim, setAnim] = useState<PixelAnim>(() => createAnim(32, 32));
  const [frameIndex, setFrameIndex] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [onion, setOnion] = useState(false);
  const [onionNext, setOnionNext] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingConvertImage, setPendingConvertImage] = useState<ImageTransfer | null>(null);
  const [pendingCutoutImage, setPendingCutoutImage] = useState<ImageTransfer | null>(null);
  const restoringRef = useRef(true);
  const noticeTimer = useRef<number | undefined>(undefined);
  const transferIdRef = useRef(0);

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3600);
  }, []);

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
      const next = addFrame(a, mode, frameIndex);
      setFrameIndex(frameIndex + 1);
      return next;
    });
    setEpoch((e) => e + 1);
    setPlaying(false);
  }, [frameIndex]);

  const removeFrame = useCallback(() => {
    if (frames.length <= 1) {
      showNotice("至少保留一帧");
      return;
    }
    if (!confirm(`删除第 ${frameIndex + 1} 帧？`)) return;
    setAnim((a) => deleteFrame(a, frameIndex) ?? a);
    setFrameIndex((i) => clampIndex(i, frames.length - 1));
    setEpoch((e) => e + 1);
    setPlaying(false);
  }, [frames.length, frameIndex, showNotice]);

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
        showNotice(`已恢复上次的草稿（${draft.frames.length} 帧 · ${draft.frames[0]?.width}×${draft.frames[0]?.height}）`);
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
      if (!res.ok && res.reason) showNotice(res.reason);
    }, 800);
    return () => window.clearTimeout(t);
  }, [anim, showNotice]);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  // 转像素 / 抠图结果 -> 画板（覆盖前确认）
  const handleImport = useCallback((next: PixelDoc) => {
    if (hasContent(doc) && !confirm("画板已有内容，导入会替换当前帧（可在画板里撤销）。继续？")) return;
    setAnim((a) => {
      const frames2 = a.frames.map((f, i) => (i === frameIndex ? next : f));
      return { ...a, frames: frames2 };
    });
    setTab("editor");
    setEpoch((e) => e + 1);
    showNotice(`已送入画板 ${next.width}×${next.height}`);
  }, [doc, frameIndex, showNotice]);

  const sendToConvert = useCallback((file: File) => {
    setPendingConvertImage({ id: ++transferIdRef.current, file });
    setTab("convert");
    showNotice("已送入转像素");
  }, [showNotice]);

  const sendToCutout = useCallback((file: File) => {
    setPendingCutoutImage({ id: ++transferIdRef.current, file });
    setTab("cutout");
    showNotice("已送入抠图");
  }, [showNotice]);

  const consumeConvertImage = useCallback((id: number) => {
    setPendingConvertImage((pending) => pending?.id === id ? null : pending);
  }, []);

  const consumeCutoutImage = useCallback((id: number) => {
    setPendingCutoutImage((pending) => pending?.id === id ? null : pending);
  }, []);

  const startOver = () => {
    if (!confirm("清空画布并删除本地草稿？")) return;
    clearAutosave();
    setAnim(createAnim(32, 32));
    setFrameIndex(0);
    setEpoch((e) => e + 1);
    setPlaying(false);
    showNotice("已清空，重新开始");
  };

  // 工程保存 / 打开（多帧）
  const saveProject = useCallback(() => {
    downloadProject(anim);
    showNotice(`工程已保存（${anim.frames.length} 帧 · ${anim.fps}fps）`);
  }, [anim, showNotice]);

  const openProject = useCallback(async (file: File) => {
    const next = await readProjectFile(file);
    if (!next) {
      showNotice("无法读取该工程文件");
      return;
    }
    if (!confirm(`打开工程会替换当前画布与全部帧（共 ${next.frames.length} 帧），继续？`)) return;
    setAnim(next);
    setFrameIndex(0);
    setEpoch((e) => e + 1);
    setPlaying(false);
    showNotice(`已打开工程（${next.frames.length} 帧 · ${next.fps}fps）`);
  }, [showNotice]);

  // Tab 方向键导航（ARIA tabs 规范）
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : (i - 1 + TABS.length) % TABS.length;
      setTab(TABS[next].id);
    }
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="container header-inner">
          <div className="brand">
            <div className="brand-icon"><BrandIcon /></div>
            <div>
              <h1>Pixel<span className="brand-sub">Paint</span></h1>
              <p className="tagline">在线像素画工作站 · 画 / 转 / 抠 · 帧动画</p>
            </div>
          </div>
          <div className="header-actions">
            <p className="privacy-note">纯本地处理 · 不上传</p>
            <nav className="tabs" role="tablist" aria-label="工作区" onKeyDown={onTabKeyDown}>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls={`panel-${t.id}`}
                  tabIndex={tab === t.id ? 0 : -1}
                  className={`tab ${tab === t.id ? "active" : ""}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </nav>
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
              onSendToCutout={sendToCutout}
              incomingImage={pendingConvertImage}
              onIncomingConsumed={consumeConvertImage}
            />
          </div>
        )}
        {tab === "cutout" && (
          <div role="tabpanel" id="panel-cutout" aria-labelledby="tab-cutout">
            <Cutout
              onImport={handleImport}
              onNotice={showNotice}
              onSendToConvert={sendToConvert}
              incomingImage={pendingCutoutImage}
              onIncomingConsumed={consumeCutoutImage}
            />
          </div>
        )}
      </main>

      {notice && (
        <div className="toast show" role="status" aria-live="polite">{notice}</div>
      )}

      <footer className="site-footer">
        <div className="container">
          <p>
            PixelPaint · 在线像素画工作站 · 图片仅在本地浏览器中处理，绝不上传
            {" · "}
            <button type="button" className="link-btn" onClick={startOver}>清空重来</button>
          </p>
          <p style={{ marginTop: 6 }}>
            Icons by{" "}
            <a href="https://pxlkit.xyz" target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>
              Pxlkit
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
