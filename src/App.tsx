import { useCallback, useState } from "react";
import Editor from "./components/Editor";
import Convert from "./components/Convert";
import Cutout from "./components/Cutout";
import { createDoc, type PixelDoc } from "./lib/pixelDoc";

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

export default function App() {
  const [tab, setTab] = useState<Tab>("editor");
  const [doc, setDoc] = useState<PixelDoc>(() => createDoc(32, 32));

  // 转像素 / 抠图结果 -> 送进画板（替换当前文档）
  const handleImport = useCallback((next: PixelDoc) => {
    setDoc(next);
    setTab("editor");
  }, []);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
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
            <nav className="tabs" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
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
        {tab === "editor" && <Editor doc={doc} setDoc={setDoc} />}
        {tab === "convert" && <Convert onImport={handleImport} />}
        {tab === "cutout" && <Cutout onImport={handleImport} />}
      </main>

      <footer className="site-footer">
        <div className="container">
          <p>PixelPaint · 在线像素画工作站 · 图片仅在本地浏览器中处理，绝不上传</p>
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
