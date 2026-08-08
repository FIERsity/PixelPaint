import { useCallback, useEffect, useRef, useState } from "react";
import {
  composite, createDoc, drawLinePoints, floodFill, getPixel,
  History, mirrorPoints, putPixel, uid,
  type Layer, type MirrorMode, type PixelDoc, type Tool,
} from "../lib/pixelDoc";
import { DEFAULT_PALETTE, hexToRgb, PRESET_PALETTES, rgbToHex, type Palette } from "../lib/palette";
import { Pencil } from "./icons/pencil";
import { Eraser } from "./icons/eraser";
import { Eyedropper } from "./icons/eyedropper";
import { PaintBucket } from "./icons/paint-bucket";
import { Undo } from "./icons/undo";
import { Redo } from "./icons/redo";
import { Trash } from "./icons/trash";
import { Line } from "./icons/line";
import { Rect } from "./icons/rect";
import PixelIcon from "../lib/PixelIcon";
import type { PxlKitData } from "../lib/pixelTypes";

interface EditorProps {
  doc: PixelDoc;
  setDoc: (d: PixelDoc) => void;
}

const ZOOMS = [1, 2, 4, 8, 16, 32];

const TOOLS: Array<{ id: Tool; label: string; icon: PxlKitData }> = [
  { id: "pencil", label: "铅笔", icon: Pencil },
  { id: "eraser", label: "橡皮", icon: Eraser },
  { id: "picker", label: "取色", icon: Eyedropper },
  { id: "fill", label: "填充", icon: PaintBucket },
  { id: "line", label: "直线", icon: Line },
  { id: "rect", label: "矩形", icon: Rect },
];

export default function Editor({ doc, setDoc }: EditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef(new History(80));
  const [, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState<string>(DEFAULT_PALETTE.colors[3]);
  const [palette, setPalette] = useState<Palette>(DEFAULT_PALETTE);
  const [mirror, setMirror] = useState<MirrorMode>("none");
  const [zoom, setZoom] = useState(8);
  const [showGrid, setShowGrid] = useState(true);
  const [activeLayer, setActiveLayer] = useState(0);
  const [brushSize, setBrushSize] = useState(1);

  // 新建画布表单
  const [newW, setNewW] = useState(32);
  const [newH, setNewH] = useState(32);
  // 导出倍数
  const [exportScale, setExportScale] = useState(4);

  const dragRef = useRef<{ x: number; y: number; drawing: boolean }>({ x: 0, y: 0, drawing: false });
  const previewRef = useRef<{ x: number; y: number } | null>(null);

  // ---------- 渲染到画布 ----------
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = doc.width;
    canvas.height = doc.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(doc.width, doc.height);
    img.data.set(composite(doc));
    ctx.putImageData(img, 0, 0);
  }, [doc]);

  useEffect(() => { draw(); }, [draw]);

  // 预览（直线/矩形拖动时覆盖画）
  const drawPreview = useCallback((ex: number, ey: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    draw();
    const s = dragRef.current;
    if (tool === "line") {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(brushSize, 1);
      ctx.lineCap = "square";
      ctx.beginPath();
      ctx.moveTo(s.x + 0.5, s.y + 0.5);
      ctx.lineTo(ex + 0.5, ey + 0.5);
      ctx.stroke();
    } else if (tool === "rect") {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.4;
      const x = Math.min(s.x, ex), y = Math.min(s.y, ey);
      const w = Math.abs(ex - s.x) + 1, h = Math.abs(ey - s.y) + 1;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
    }
  }, [draw, tool, color, brushSize]);

  // ---------- 应用颜色到一组坐标 ----------
  const applyToLayer = useCallback((layer: Layer, pts: Array<[number, number]>, rgba: [number, number, number, number]) => {
    for (const [x, y] of pts) putPixel(layer.pixels, doc.width, x, y, rgba[0], rgba[1], rgba[2], rgba[3]);
  }, [doc.width]);

  const currentColorRgba = (): [number, number, number, number] => {
    const [r, g, b] = hexToRgb(color);
    return [r, g, b, 255];
  };

  // ---------- 鼠标/触摸事件 ----------
  const canvasToPixel = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * doc.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * doc.height);
    return [Math.max(0, Math.min(doc.width - 1, x)), Math.max(0, Math.min(doc.height - 1, y))];
  };

  const getLayer = (): Layer => doc.layers[Math.min(activeLayer, doc.layers.length - 1)];

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const [x, y] = canvasToPixel(e);
    dragRef.current = { x, y, drawing: true };
    const layer = getLayer();

    if (tool === "picker") {
      const img = composite(doc);
      const [r, g, b] = getPixel(img, doc.width, x, y);
      setColor(rgbToHex(r, g, b));
      return;
    }

    historyRef.current.push(doc);
    refresh();

    if (tool === "fill") {
      const pts = floodFill(layer.pixels, doc.width, doc.height, x, y);
      applyToLayer(layer, pts, currentColorRgba());
      draw();
      return;
    }

    if (tool === "pencil" || tool === "eraser") {
      const rgba: [number, number, number, number] = tool === "eraser" ? [0, 0, 0, 0] : currentColorRgba();
      stamp(layer, x, y, rgba);
      draw();
    } else {
      // line / rect：等待拖动
      previewRef.current = { x, y };
      drawPreview(x, y);
    }
  };

  const stamp = (layer: Layer, x: number, y: number, rgba: [number, number, number, number]) => {
    const pts = mirrorPoints(doc.width, doc.height, x, y, mirror);
    applyToLayer(layer, pts, rgba);
    if (brushSize > 1) {
      const half = Math.floor(brushSize / 2);
      for (let dx = -half; dx <= half; dx++) {
        for (let dy = -half; dy <= half; dy++) {
          if (dx === 0 && dy === 0) continue;
          const pts2 = mirrorPoints(doc.width, doc.height, x + dx, y + dy, mirror);
          applyToLayer(layer, pts2, rgba);
        }
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.drawing) return;
    const [x, y] = canvasToPixel(e);
    const layer = getLayer();
    if (tool === "pencil" || tool === "eraser") {
      const rgba: [number, number, number, number] = tool === "eraser" ? [0, 0, 0, 0] : currentColorRgba();
      const line = drawLinePoints(dragRef.current.x, dragRef.current.y, x, y);
      for (const [lx, ly] of line) stamp(layer, lx, ly, rgba);
      dragRef.current.x = x;
      dragRef.current.y = y;
      draw();
    } else if (tool === "line" || tool === "rect") {
      drawPreview(x, y);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current.drawing) return;
    dragRef.current.drawing = false;
    const [x, y] = canvasToPixel(e);
    const layer = getLayer();
    const s = dragRef.current;
    previewRef.current = null;

    if (tool === "line") {
      // 对对称点逐组连线
      const starts = mirrorPoints(doc.width, doc.height, s.x, s.y, mirror);
      const ends = mirrorPoints(doc.width, doc.height, x, y, mirror);
      const rgba = currentColorRgba();
      for (let i = 0; i < starts.length; i++) {
        const line = drawLinePoints(starts[i][0], starts[i][1], ends[i][0], ends[i][1]);
        applyToLayer(layer, line, rgba);
      }
      draw();
    } else if (tool === "rect") {
      const starts = mirrorPoints(doc.width, doc.height, s.x, s.y, mirror);
      const ends = mirrorPoints(doc.width, doc.height, x, y, mirror);
      const rgba = currentColorRgba();
      for (let i = 0; i < starts.length; i++) {
        const x0 = Math.min(starts[i][0], ends[i][0]);
        const y0 = Math.min(starts[i][1], ends[i][1]);
        const x1 = Math.max(starts[i][0], ends[i][0]);
        const y1 = Math.max(starts[i][1], ends[i][1]);
        const pts: Array<[number, number]> = [];
        for (let px = x0; px <= x1; px++) { pts.push([px, y0], [px, y1]); }
        for (let py = y0; py <= y1; py++) { pts.push([x0, py], [x1, py]); }
        applyToLayer(layer, pts, rgba);
      }
      draw();
    }
  };

  // ---------- 撤销 / 重做 ----------
  const undo = () => {
    const prev = historyRef.current.undo(doc);
    if (prev) { setDoc(prev); refresh(); }
  };
  const redo = () => {
    const next = historyRef.current.redo(doc);
    if (next) { setDoc(next); refresh(); }
  };

  // ---------- 图层操作 ----------
  const addLayer = () => {
    const layer: Layer = { id: uid(), name: `图层 ${doc.layers.length + 1}`, visible: true, opacity: 1, pixels: new Uint8ClampedArray(doc.width * doc.height * 4) };
    setDoc({ ...doc, layers: [...doc.layers, layer] });
    setActiveLayer(doc.layers.length);
  };
  const removeLayer = (i: number) => {
    if (doc.layers.length <= 1) return;
    const layers = doc.layers.filter((_, idx) => idx !== i);
    setDoc({ ...doc, layers });
    setActiveLayer(Math.min(activeLayer, layers.length - 1));
  };
  const moveLayer = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= doc.layers.length) return;
    const layers = [...doc.layers];
    [layers[i], layers[j]] = [layers[j], layers[i]];
    setDoc({ ...doc, layers });
    setActiveLayer(j);
  };
  const toggleLayer = (i: number) => {
    const layers = doc.layers.map((l, idx) => (idx === i ? { ...l, visible: !l.visible } : l));
    setDoc({ ...doc, layers });
  };
  const setLayerOpacity = (i: number, opacity: number) => {
    const layers = doc.layers.map((l, idx) => (idx === i ? { ...l, opacity } : l));
    setDoc({ ...doc, layers });
  };

  // ---------- 新建画布 ----------
  const newCanvas = () => {
    const w = Math.max(1, Math.min(512, Math.round(newW)));
    const h = Math.max(1, Math.min(512, Math.round(newH)));
    historyRef.current = new History(80);
    setDoc(createDoc(w, h));
    setActiveLayer(0);
    refresh();
  };

  // ---------- 导出 PNG ----------
  const exportPng = () => {
    const scale = exportScale;
    const img = composite(doc);
    const c = document.createElement("canvas");
    c.width = doc.width * scale;
    c.height = doc.height * scale;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const temp = document.createElement("canvas");
    temp.width = doc.width;
    temp.height = doc.height;
    const tctx = temp.getContext("2d")!;
    tctx.putImageData(new ImageData(img.slice(), doc.width, doc.height), 0, 0);
    ctx.drawImage(temp, 0, 0, c.width, c.height);
    c.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `pixelpaint-${doc.width}x${doc.height}x${scale}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  };

  const gridVisible = showGrid && zoom >= 4;
  const cellPx = zoom;

  return (
    <div className="editor-layout">
      {/* 左侧工具条 */}
      <aside className="card tool-panel">
        <div className="tool-list">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tool-btn ${tool === t.id ? "active" : ""}`}
              onClick={() => setTool(t.id)}
              title={t.label}
            >
              <PixelIcon data={t.icon} size={22} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <div className="tool-divider" />
        <div className="tool-list">
          {(["none", "x", "y", "both"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`tool-btn ${mirror === m ? "active" : ""}`}
              onClick={() => setMirror(m)}
              title={m === "none" ? "对称：关" : m === "x" ? "水平对称" : m === "y" ? "垂直对称" : "双向对称"}
            >
              <span aria-hidden="true" style={{ fontSize: 16 }}>{m === "none" ? "◯" : m === "x" ? "⇔" : m === "y" ? "⇕" : "✛"}</span>
              <span>对称{m === "none" ? "" : m === "both" ? "双向" : m}</span>
            </button>
          ))}
        </div>
        <div className="tool-divider" />
        <div className="tool-panel-field">
          <label className="field-label">笔刷</label>
          <select className="num-input" style={{ width: "100%" }} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((s) => <option key={s} value={s}>{s} px</option>)}
          </select>
        </div>
        <div className="tool-panel-field">
          <label className="field-label">缩放</label>
          <select className="num-input" style={{ width: "100%" }} value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
            {ZOOMS.map((z) => <option key={z} value={z}>{z}×</option>)}
          </select>
        </div>
      </aside>

      {/* 中间画布 */}
      <section className="card canvas-card">
        <div className="canvas-head">
          <span className="canvas-info">{doc.width} × {doc.height} · 第 {activeLayer + 1}/{doc.layers.length} 层</span>
          <div className="canvas-actions">
            <label className="ghost-check">
              <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
              网格
            </label>
            <button type="button" className="btn-ghost" onClick={undo} disabled={!historyRef.current.canUndo} title="撤销" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "6px 8px" }}>
              <PixelIcon data={Undo} size={16} />
            </button>
            <button type="button" className="btn-ghost" onClick={redo} disabled={!historyRef.current.canRedo} title="重做" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "6px 8px" }}>
              <PixelIcon data={Redo} size={16} />
            </button>
          </div>
        </div>
        <div className="canvas-stage">
          <div className="canvas-wrap checker" style={{ width: doc.width * cellPx, height: doc.height * cellPx, backgroundSize: `${cellPx}px ${cellPx}px` }}>
            <canvas
              ref={canvasRef}
              className="pixelated"
              style={{ width: doc.width * cellPx, height: doc.height * cellPx, touchAction: "none" }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
            {gridVisible && (
              <div
                className="canvas-grid"
                style={{
                  width: doc.width * cellPx,
                  height: doc.height * cellPx,
                  backgroundSize: `${cellPx}px ${cellPx}px`,
                }}
              />
            )}
          </div>
        </div>
      </section>

      {/* 右侧面板 */}
      <aside className="side-panels">
        {/* 调色板 */}
        <div className="card palette-card">
          <div className="panel-head">
            <h2 className="card-title">调色板</h2>
          </div>
          <select
            className="num-input"
            style={{ width: "100%", marginBottom: 10 }}
            value={palette.name}
            onChange={(e) => {
              const p = PRESET_PALETTES.find((x) => x.name === e.target.value);
              if (p) setPalette(p);
            }}
          >
            {PRESET_PALETTES.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
          <div className="palette-grid">
            {palette.colors.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch ${color.toLowerCase() === c.toLowerCase() ? "active" : ""}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                title={c}
              />
            ))}
          </div>
          <div className="color-row">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              style={{ width: 36, height: 32, border: "none", background: "none", padding: 0 }}
            />
            <input
              className="text-input"
              style={{ flex: 1 }}
              value={color}
              onChange={(e) => setColor(e.target.value)}
              spellCheck={false}
            />
          </div>
        </div>

        {/* 图层 */}
        <div className="card layers-card">
          <div className="panel-head">
            <h2 className="card-title">图层</h2>
            <button type="button" className="btn-ghost" onClick={addLayer}>＋ 新建</button>
          </div>
          <div className="layer-list">
            {doc.layers.map((l, i) => (
              <div key={l.id} className={`layer-item ${i === activeLayer ? "active" : ""}`} onClick={() => setActiveLayer(i)}>
                <button
                  type="button"
                  className="layer-eye"
                  onClick={(e) => { e.stopPropagation(); toggleLayer(i); }}
                  title={l.visible ? "隐藏" : "显示"}
                >
                  {l.visible ? "👁" : "—"}
                </button>
                <span className="layer-name">{l.name}</span>
                <input
                  type="range" min={0} max={100} value={Math.round(l.opacity * 100)}
                  onChange={(e) => setLayerOpacity(i, Number(e.target.value) / 100)}
                  onClick={(e) => e.stopPropagation()}
                  title="不透明度"
                />
                <div className="layer-actions">
                  <button type="button" className="mini-btn" onClick={(e) => { e.stopPropagation(); moveLayer(i, 1); }} title="上移">↑</button>
                  <button type="button" className="mini-btn" onClick={(e) => { e.stopPropagation(); moveLayer(i, -1); }} title="下移">↓</button>
                  <button type="button" className="mini-btn danger" onClick={(e) => { e.stopPropagation(); removeLayer(i); }} title="删除" style={{ display: "inline-flex", alignItems: "center" }}>
                    <PixelIcon data={Trash} size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 画布 & 导出 */}
        <div className="card canvas-tools-card">
          <h2 className="card-title">画布</h2>
          <div className="size-row">
            <input className="num-input" type="number" min={1} max={512} value={newW} onChange={(e) => setNewW(Number(e.target.value))} />
            <span>×</span>
            <input className="num-input" type="number" min={1} max={512} value={newH} onChange={(e) => setNewH(Number(e.target.value))} />
            <button type="button" className="btn-ghost" onClick={newCanvas}>新建</button>
          </div>
          <div className="tool-divider" />
          <h2 className="card-title">导出</h2>
          <div className="size-row">
            <span className="field-label" style={{ margin: 0 }}>放大</span>
            <select className="num-input" style={{ flex: 1 }} value={exportScale} onChange={(e) => setExportScale(Number(e.target.value))}>
              {[1, 2, 4, 8, 16].map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
            <button type="button" className="btn-primary" onClick={exportPng}>导出 PNG</button>
          </div>
        </div>
      </aside>
    </div>
  );
}
