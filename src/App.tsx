import { useCallback, useEffect, useRef, useState } from "react";
import Editor from "./components/Editor";
import Convert from "./components/Convert";
import Cutout from "./components/Cutout";
import { composite, createDoc, type PixelDoc } from "./lib/pixelDoc";
import { clearAutosave, loadAutosave, saveAutosave } from "./lib/persist";

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

// 画布是否有内容（用于覆盖前确认）
function hasContent(doc: PixelDoc): boolean {
  const px = composite(doc);
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) return true;
  return false;
}

export default function App() {
  const [tab, setTab] = useState<Tab>("editor");
  const [doc, setDoc] = useState<PixelDoc>(() => createDoc(32, 32));
  const [notice, setNotice] = useState<string | null>(null);
  const restoringRef = useRef(true);
  const noticeTimer = useRef<number | undefined>(undefined);

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3600);
  }, []);

  // 启动时恢复本地草稿
  useEffect(() => {
    let alive = true;
    (async () => {
      const draft = await loadAutosave();
      if (alive && draft) {
        setDoc(draft);
        showNotice(`已恢复上次的草稿（${draft.width}×${draft.height}）`);
      }
      restoringRef.current = false;
    })();
    return () => { alive = false; };
  }, [showNotice]);

  // 自动保存草稿（防抖）
  useEffect(() => {
    if (restoringRef.current) return;
    const t = window.setTimeout(() => {
      const res = saveAutosave(doc);
      if (!res.ok && res.reason) showNotice(res.reason);
    }, 800);
    return () => window.clearTimeout(t);
  }, [doc, showNotice]);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  // 转像素 / 抠图结果 -> 画板（覆盖前确认）
  const handleImport = useCallback((next: PixelDoc) => {
    if (hasContent(doc) && !confirm("画板已有内容，导入会替换它（可在画板里撤销）。继续？")) return;
    setDoc(next);
    setTab("editor");
    showNotice(`已送入画板 ${next.width}×${next.height}`);
  }, [doc, showNotice]);

  const startOver = () => {
    if (!confirm("清空画布并删除本地草稿？")) return;
    clearAutosave();
    setDoc(createDoc(32, 32));
    showNotice("已清空，重新开始");
  };

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
              <p className="tagline">在线像素画工作站 · 画 / 转 / 抠</p>
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
            <Editor doc={doc} setDoc={setDoc} onNotice={showNotice} />
          </div>
        )}
        {tab === "convert" && (
          <div role="tabpanel" id="panel-convert" aria-labelledby="tab-convert">
            <Convert onImport={handleImport} onNotice={showNotice} />
          </div>
        )}
        {tab === "cutout" && (
          <div role="tabpanel" id="panel-cutout" aria-labelledby="tab-cutout">
            <Cutout onImport={handleImport} onNotice={showNotice} />
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
