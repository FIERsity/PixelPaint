import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyPixelChanges, brushOffsets, cloneDoc, composite, createDoc,
  drawLinePoints, floodFill, getPixel, History, putPixel,
  rectPoints, resizeDoc, StrokeRecorder, uid,
  type Layer, type PixelDoc, type Rgba, type Tool,
} from "../lib/pixelDoc";
import { DEFAULT_PALETTE, parseHex, PRESET_PALETTES, rgbToHex, type Palette } from "../lib/palette";
import { Pencil } from "./icons/pencil";
import { Eraser } from "./icons/eraser";
import { Eyedropper } from "./icons/eyedropper";
import { PaintBucket } from "./icons/paint-bucket";
import { Undo } from "./icons/undo";
import { Redo } from "./icons/redo";
import { Trash } from "./icons/trash";
import { Download } from "./icons/download";
import { Upload } from "./icons/upload";
import { Line } from "./icons/line";
import { Rect } from "./icons/rect";
import PixelIcon from "../lib/PixelIcon";
import type { PxlKitData } from "../lib/pixelTypes";

export interface AnimationProps {
  frames: PixelDoc[];
  frameIndex: number;
  fps: number;
  playing: boolean;
  onion: boolean;
  onionNext: boolean;
  onFrameSelect: (i: number) => void;
  onFrameAddBlank: () => void;
  onFrameDuplicate: () => void;
  onFrameDelete: () => void;
  onFrameShift: (dir: -1 | 1) => void;
  onFpsChange: (fps: number) => void;
  onTogglePlay: () => void;
  onToggleOnion: () => void;
  onToggleOnionNext: () => void;
}

interface EditorProps {
  doc: PixelDoc;
  setDoc: (d: PixelDoc) => void;
  onNotice?: (msg: string) => void;
  /** 洋葱皮：相邻帧的合成位图（非当前帧） */
  onionPixels?: Uint8ClampedArray | null;
  animation?: AnimationProps;
  /** 外部替换文档（导入/换帧）时自增，Editor 据此清空撤销历史 */
  epoch?: number;
  onSaveProject?: () => void;
  onOpenProject?: (file: File) => Promise<void> | void;
}

const ZOOMS = [1, 2, 4, 8, 16, 32];

const TOOLS: Array<{ id: Tool; label: string; icon: PxlKitData; key: string }> = [
  { id: "pencil", label: "铅笔", icon: Pencil, key: "B" },
  { id: "eraser", label: "橡皮", icon: Eraser, key: "E" },
  { id: "picker", label: "取色", icon: Eyedropper, key: "I" },
  { id: "fill", label: "填充", icon: PaintBucket, key: "G" },
  { id: "line", label: "直线", icon: Line, key: "L" },
  { id: "rect", label: "矩形", icon: Rect, key: "R" },
];

const TRANSPARENT: Rgba = [0, 0, 0, 0];

// 单帧缩略图：把帧的合成结果画到小画布
function FrameThumb({ frame, active, index, onClick }: {
  frame: PixelDoc;
  active: boolean;
  index: number;
  onClick: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const maxSide = 44;
    const scale = maxSide / Math.max(frame.width, frame.height);
    c.width = Math.max(1, Math.round(frame.width * scale));
    c.height = Math.max(1, Math.round(frame.height * scale));
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const temp = document.createElement("canvas");
    temp.width = frame.width;
    temp.height = frame.height;
    const tctx = temp.getContext("2d")!;
    tctx.putImageData(new ImageData(composite(frame).slice(), frame.width, frame.height), 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(temp, 0, 0, c.width, c.height);
  }, [frame]);
  return (
    <button
      type="button"
      className={`frame-thumb ${active ? "active" : ""}`}
      onClick={onClick}
      title={`第 ${index + 1} 帧`}
      aria-label={`选择第 ${index + 1} 帧`}
      aria-pressed={active}
    >
      <canvas ref={ref} className="pixelated" />
      <span>{index + 1}</span>
    </button>
  );
}

export default function Editor({ doc, setDoc, onNotice, onionPixels, animation, epoch = 0, onSaveProject, onOpenProject }: EditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef(new History(80));
  const recorderRef = useRef<StrokeRecorder | null>(null);
  const layerCanvasesRef = useRef<Array<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }>>([]);
  const layerSigRef = useRef("");
  const projectInputRef = useRef<HTMLInputElement>(null);
  const [, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState<string>(DEFAULT_PALETTE.colors[3]);
  const [colorText, setColorText] = useState<string>(DEFAULT_PALETTE.colors[3]);
  const [palette, setPalette] = useState<Palette>(DEFAULT_PALETTE);
  const [zoom, setZoom] = useState(8);
  const [showGrid, setShowGrid] = useState(true);
  const [activeLayer, setActiveLayer] = useState(0);
  const [brushSize, setBrushSize] = useState(1);
  const [rectFilled, setRectFilled] = useState(false);
  const [sizeW, setSizeW] = useState(doc.width);
  const [sizeH, setSizeH] = useState(doc.height);
  const [exportScale, setExportScale] = useState(4);

  const drag = useRef({ drawing: false, tool: "pencil" as Tool, x: 0, y: 0, lastX: 0, lastY: 0 });

  // 外部替换文档（换帧/导入）时清空撤销历史
  const prevEpoch = useRef(epoch);
  useEffect(() => {
    if (prevEpoch.current !== epoch) {
      prevEpoch.current = epoch;
      historyRef.current.reset();
      recorderRef.current = null;
    }
  }, [epoch]);

  // activeLayer 始终有效
  const layerIndex = Math.min(activeLayer, doc.layers.length - 1);
  useEffect(() => {
    if (activeLayer > doc.layers.length - 1) setActiveLayer(doc.layers.length - 1);
  }, [doc.layers.length, activeLayer]);

  // 画布尺寸变化时同步表单
  useEffect(() => {
    setSizeW(doc.width);
    setSizeH(doc.height);
  }, [doc.width, doc.height]);

  // ---------- 渲染：逐图层离屏画布 + GPU 合成（不再每帧全量 CPU 混合） ----------
  // 把某图层像素同步到它的离屏画布（笔画过程中高频调用，只拷贝一层）
  const syncLayerCanvas = useCallback((index: number) => {
    const lcs = layerCanvasesRef.current;
    const layer = doc.layers[index];
    const lc = lcs[index];
    if (!layer || !lc) return;
    const img = lc.ctx.createImageData(doc.width, doc.height);
    img.data.set(layer.pixels);
    lc.ctx.putImageData(img, 0, 0);
  }, [doc.width, doc.height, doc.layers]);

  // 重建所有离屏画布（结构性变化 / 撤销重做文档级条目时）
  const rebuildLayerCanvases = useCallback((target?: PixelDoc) => {
    const d = target ?? doc;
    const lcs = d.layers.map(() => {
      const c = document.createElement("canvas");
      c.width = d.width;
      c.height = d.height;
      return { canvas: c, ctx: c.getContext("2d")! };
    });
    d.layers.forEach((l, i) => {
      const img = lcs[i].ctx.createImageData(d.width, d.height);
      img.data.set(l.pixels);
      lcs[i].ctx.putImageData(img, 0, 0);
    });
    layerCanvasesRef.current = lcs;
    layerSigRef.current = d.layers.map((l) => l.id).join(",") + `@${d.width}x${d.height}`;
  }, [doc]);

  // 合成显示：按顺序把可见图层画到主画布（drawImage 由浏览器 GPU 加速）
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== doc.width || canvas.height !== doc.height) {
      canvas.width = doc.width;
      canvas.height = doc.height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 自愈：离屏画布与文档不一致时重建（结构性变化 / 文档级撤销）
    const sig = doc.layers.map((l) => l.id).join(",") + `@${doc.width}x${doc.height}`;
    if (layerCanvasesRef.current.length !== doc.layers.length || layerSigRef.current !== sig) {
      rebuildLayerCanvases();
    }
    const lcs = layerCanvasesRef.current;

    ctx.clearRect(0, 0, doc.width, doc.height);

    // 洋葱皮：把相邻帧的合成图（着色为蓝）铺在当前帧之下
    if (onionPixels && onionPixels.length === doc.width * doc.height * 4) {
      const img = ctx.createImageData(doc.width, doc.height);
      img.data.set(onionPixels);
      for (let i = 0; i < img.data.length; i += 4) {
        const a = img.data[i + 3];
        if (a > 0) {
          img.data[i] = 60;
          img.data[i + 1] = 130;
          img.data[i + 2] = 255;
          img.data[i + 3] = Math.round(a * 0.38); // 半透明蓝幽灵
        }
      }
      ctx.putImageData(img, 0, 0);
    }

    for (let i = 0; i < doc.layers.length; i++) {
      const l = doc.layers[i];
      if (!l.visible || l.opacity <= 0) continue;
      ctx.globalAlpha = l.opacity;
      ctx.drawImage(lcs[i].canvas, 0, 0);
    }
    ctx.globalAlpha = 1;
  }, [doc, rebuildLayerCanvases, onionPixels]);

  useEffect(() => { draw(); }, [draw]);

  const clearOverlay = useCallback(() => {
    const o = overlayRef.current;
    if (!o) return;
    if (o.width !== doc.width || o.height !== doc.height) {
      o.width = doc.width;
      o.height = doc.height;
    }
    o.getContext("2d")?.clearRect(0, 0, o.width, o.height);
  }, [doc.width, doc.height]);

  useEffect(() => { clearOverlay(); }, [clearOverlay]);

  // ---------- 工具落点计算（预览与落笔共用，保证完全一致） ----------
  const expand = useCallback((base: Array<[number, number]>): Array<[number, number]> => {
    const offsets = brushOffsets(brushSize);
    const seen = new Set<number>();
    const out: Array<[number, number]> = [];
    for (const [bx, by] of base) {
      for (const [ox, oy] of offsets) {
        const x = bx + ox;
        const y = by + oy;
        if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) continue;
        const key = y * doc.width + x;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([x, y]);
      }
    }
    return out;
  }, [brushSize, doc.width, doc.height]);

  const shapePoints = useCallback((t: Tool, x0: number, y0: number, x1: number, y1: number) => {
    if (t === "line") return expand(drawLinePoints(x0, y0, x1, y1));
    if (t === "rect") return expand(rectPoints(x0, y0, x1, y1, rectFilled));
    return expand([[x1, y1]]);
  }, [expand, rectFilled]);

  // 预览：把「将要落下的确切像素」画到叠加层
  const showPreview = useCallback((pts: Array<[number, number]>, erasing: boolean) => {
    const o = overlayRef.current;
    if (!o) return;
    if (o.width !== doc.width || o.height !== doc.height) {
      o.width = doc.width;
      o.height = doc.height;
    }
    const ctx = o.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, o.width, o.height);
    const rgb = parseHex(color) ?? [0, 0, 0];
    const img = ctx.createImageData(o.width, o.height);
    for (const [x, y] of pts) {
      const i = (y * o.width + x) * 4;
      if (erasing) {
        img.data[i] = 220; img.data[i + 1] = 60; img.data[i + 2] = 60; img.data[i + 3] = 150;
      } else {
        img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = 235;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [color, doc.width, doc.height]);

  // ---------- 写入 ----------
  const currentRgba = useCallback((): Rgba => {
    const rgb = parseHex(color);
    if (!rgb) return [0, 0, 0, 255];
    return [rgb[0], rgb[1], rgb[2], 255];
  }, [color]);

  const applyPoints = useCallback((pts: Array<[number, number]>, rgba: Rgba) => {
    const layer = doc.layers[layerIndex];
    if (!layer) return;
    const rec = recorderRef.current;
    for (const [x, y] of pts) {
      const idx = y * doc.width + x;
      const i = idx * 4;
      const before: Rgba = [layer.pixels[i], layer.pixels[i + 1], layer.pixels[i + 2], layer.pixels[i + 3]];
      putPixel(layer.pixels, doc.width, x, y, rgba[0], rgba[1], rgba[2], rgba[3]);
      rec?.touch(idx, before, rgba);
    }
  }, [doc, layerIndex]);

  // 提交结构变化（触发重渲染 + 上层自动保存）
  const commit = useCallback(() => {
    setDoc({ ...doc, layers: [...doc.layers] });
  }, [doc, setDoc]);

  // ---------- 指针事件 ----------
  const toPixel = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * doc.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * doc.height);
    return [
      Math.max(0, Math.min(doc.width - 1, x)),
      Math.max(0, Math.min(doc.height - 1, y)),
    ];
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* 指针捕获失败不阻断绘制（如合成事件/部分浏览器） */
    }
    const [x, y] = toPixel(e);

    // 取色：透明处不改色
    if (tool === "picker") {
      const img = composite(doc);
      const [r, g, b, a] = getPixel(img, doc.width, x, y);
      if (a === 0) {
        onNotice?.("这里是透明像素，未取色");
      } else {
        const hex = rgbToHex(r, g, b);
        setColor(hex);
        setColorText(hex);
      }
      return;
    }

    drag.current = { drawing: true, tool, x, y, lastX: x, lastY: y };

    // 填充：一次性操作，立即完成并入历史
    if (tool === "fill") {
      const layer = doc.layers[layerIndex];
      if (layer) {
        const rec = new StrokeRecorder(layer.id);
        recorderRef.current = rec;
        const pts = floodFill(layer.pixels, doc.width, doc.height, x, y);
        applyPoints(pts, currentRgba());
        recorderRef.current = null;
        const entry = rec.entry();
        if (entry) historyRef.current.push(entry);
        syncLayerCanvas(layerIndex);
        draw();
        commit();
      }
      drag.current.drawing = false;
      refresh();
      return;
    }

    // 铅笔/橡皮/直线/矩形：开始记录本次笔画（增量撤销，不整幅快照）
    recorderRef.current = new StrokeRecorder(doc.layers[layerIndex].id);
    if (tool === "pencil" || tool === "eraser") {
      applyPoints(expand([[x, y]]), tool === "eraser" ? TRANSPARENT : currentRgba());
      syncLayerCanvas(layerIndex);
      draw();
      refresh();
    } else {
      showPreview(shapePoints(tool, x, y, x, y), false);
      refresh();
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current.drawing) return;
    const [x, y] = toPixel(e);
    const t = drag.current.tool;

    if (t === "pencil" || t === "eraser") {
      if (x === drag.current.lastX && y === drag.current.lastY) return;
      const path = drawLinePoints(drag.current.lastX, drag.current.lastY, x, y);
      applyPoints(expand(path), t === "eraser" ? TRANSPARENT : currentRgba());
      drag.current.lastX = x;
      drag.current.lastY = y;
      syncLayerCanvas(layerIndex);
      draw();
    } else if (t === "line" || t === "rect") {
      showPreview(shapePoints(t, drag.current.x, drag.current.y, x, y), false);
    }
  };

  // 收尾一笔：把记录器转成历史条目（只存变更像素）
  const finalizeStroke = () => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    const entry = rec?.entry() ?? null;
    if (entry) historyRef.current.push(entry);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current.drawing) return;
    drag.current.drawing = false;
    const [x, y] = toPixel(e);
    const t = drag.current.tool;

    if (t === "line" || t === "rect") {
      applyPoints(shapePoints(t, drag.current.x, drag.current.y, x, y), currentRgba());
      clearOverlay();
      syncLayerCanvas(layerIndex);
      draw();
    }
    finalizeStroke();
    commit();
    refresh();
  };

  // 指针取消：直线/矩形还没落笔则丢弃；铅笔/橡皮保留已画部分
  const onPointerCancel = () => {
    if (!drag.current.drawing) return;
    const t = drag.current.tool;
    drag.current.drawing = false;
    clearOverlay();
    if (t === "line" || t === "rect") {
      recorderRef.current = null; // 未落笔，不留历史
      refresh();
      return;
    }
    finalizeStroke();
    commit();
    refresh();
  };

  // ---------- 历史（增量像素条目 + 结构性文档条目） ----------
  const undo = useCallback(() => {
    const entry = historyRef.current.popUndo();
    if (!entry) return;
    if (entry.kind === "pixels") {
      applyPixelChanges(doc, entry.layerId, entry.changes, "before");
      historyRef.current.pushRedo(entry);
      const idx = doc.layers.findIndex((l) => l.id === entry.layerId);
      if (idx >= 0) syncLayerCanvas(idx);
      draw();
      setDoc({ ...doc, layers: [...doc.layers] });
    } else {
      historyRef.current.pushRedo({ kind: "doc", doc: cloneDoc(doc) });
      rebuildLayerCanvases(entry.doc);
      setDoc(entry.doc); // draw effect 会随渲染刷新
    }
    setActiveLayer((i) => Math.min(i, doc.layers.length - 1));
    refresh();
  }, [doc, setDoc, syncLayerCanvas, draw, rebuildLayerCanvases]);

  const redo = useCallback(() => {
    const entry = historyRef.current.popRedo();
    if (!entry) return;
    if (entry.kind === "pixels") {
      applyPixelChanges(doc, entry.layerId, entry.changes, "after");
      historyRef.current.push(entry);
      const idx = doc.layers.findIndex((l) => l.id === entry.layerId);
      if (idx >= 0) syncLayerCanvas(idx);
      draw();
      setDoc({ ...doc, layers: [...doc.layers] });
    } else {
      historyRef.current.push({ kind: "doc", doc: cloneDoc(doc) });
      rebuildLayerCanvases(entry.doc);
      setDoc(entry.doc);
    }
    setActiveLayer((i) => Math.min(i, doc.layers.length - 1));
    refresh();
  }, [doc, setDoc, syncLayerCanvas, draw, rebuildLayerCanvases]);

  // ---------- 图层（全部入历史） ----------
  const withHistory = (fn: () => void) => {
    historyRef.current.pushDoc(doc);
    fn();
    refresh();
  };

  const addLayer = () => withHistory(() => {
    const layer: Layer = {
      id: uid(),
      name: `图层 ${doc.layers.length + 1}`,
      visible: true,
      opacity: 1,
      pixels: new Uint8ClampedArray(doc.width * doc.height * 4),
    };
    setDoc({ ...doc, layers: [...doc.layers, layer] });
    setActiveLayer(doc.layers.length);
  });

  const removeLayer = (i: number) => {
    if (doc.layers.length <= 1) {
      onNotice?.("至少要保留一个图层");
      return;
    }
    const name = doc.layers[i]?.name ?? "该图层";
    if (!confirm(`删除「${name}」？可以用撤销恢复。`)) return;
    withHistory(() => {
      const layers = doc.layers.filter((_, idx) => idx !== i);
      setDoc({ ...doc, layers });
      setActiveLayer(Math.min(i, layers.length - 1));
    });
  };

  const moveLayer = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= doc.layers.length) return;
    withHistory(() => {
      const layers = [...doc.layers];
      [layers[i], layers[j]] = [layers[j], layers[i]];
      setDoc({ ...doc, layers });
      setActiveLayer(j);
    });
  };

  const toggleLayer = (i: number) => withHistory(() => {
    setDoc({ ...doc, layers: doc.layers.map((l, idx) => (idx === i ? { ...l, visible: !l.visible } : l)) });
  });

  const setLayerOpacity = (i: number, opacity: number) => {
    setDoc({ ...doc, layers: doc.layers.map((l, idx) => (idx === i ? { ...l, opacity } : l)) });
  };

  const clearLayer = () => {
    if (!confirm("清空当前图层？可以用撤销恢复。")) return;
    withHistory(() => {
      const layer = doc.layers[layerIndex];
      if (layer) layer.pixels.fill(0);
      syncLayerCanvas(layerIndex);
      draw();
      setDoc({ ...doc, layers: [...doc.layers] });
    });
  };

  // ---------- 画布尺寸 ----------
  const clampSize = (v: number) => Math.max(1, Math.min(512, Math.round(v) || 1));

  const applyResize = () => {
    const w = clampSize(sizeW);
    const h = clampSize(sizeH);
    if (w === doc.width && h === doc.height) return;
    const shrinking = w < doc.width || h < doc.height;
    if (shrinking && !confirm(`缩小画布会裁掉超出部分（${doc.width}×${doc.height} → ${w}×${h}），继续？`)) return;
    withHistory(() => setDoc(resizeDoc(doc, w, h)));
    onNotice?.(`画布已调整为 ${w}×${h}（内容保留）`);
  };

  const newCanvas = () => {
    const w = clampSize(sizeW);
    const h = clampSize(sizeH);
    if (!confirm(`新建 ${w}×${h} 空白画布？当前内容会被清空（可撤销）。`)) return;
    withHistory(() => {
      setDoc(createDoc(w, h));
      setActiveLayer(0);
    });
  };

  // ---------- 导出 / 工程 ----------
  const exportPng = useCallback(() => {
    const scale = exportScale;
    const img = composite(doc);
    const temp = document.createElement("canvas");
    temp.width = doc.width;
    temp.height = doc.height;
    temp.getContext("2d")!.putImageData(new ImageData(img.slice(), doc.width, doc.height), 0, 0);
    const c = document.createElement("canvas");
    c.width = doc.width * scale;
    c.height = doc.height * scale;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(temp, 0, 0, c.width, c.height);
    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pixelpaint-${doc.width}x${doc.height}@${scale}x.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, "image/png");
  }, [doc, exportScale]);

  const saveProject = useCallback(() => {
    onSaveProject?.();
  }, [onSaveProject]);

  const openProject = async (file: File) => {
    await onOpenProject?.(file);
  };

  // ---------- 键盘快捷键 ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); saveProject(); return; }
      if (mod && e.key.toLowerCase() === "e") { e.preventDefault(); exportPng(); return; }
      if (mod) return;

      const k = e.key.toLowerCase();
      const hit = TOOLS.find((t) => t.key.toLowerCase() === k);
      if (hit) { setTool(hit.id); return; }
      if (k === "[") { setBrushSize((s) => Math.max(1, s - 1)); return; }
      if (k === "]") { setBrushSize((s) => Math.min(5, s + 1)); return; }
      if (k === "+" || k === "=") {
        setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)] ?? z);
        return;
      }
      if (k === "-") {
        setZoom((z) => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)] ?? z);
        return;
      }
      if (k === " " && animation) {
        e.preventDefault();
        animation.onTogglePlay();
        return;
      }
      if (k === "g") return; // 已被填充占用
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, saveProject, exportPng, animation]);

  const gridVisible = showGrid && zoom >= 4;
  const cell = zoom;
  const canUndo = historyRef.current.canUndo;
  const canRedo = historyRef.current.canRedo;

  return (
    <div className="editor-layout">
      {/* 工具条 */}
      <aside className="card tool-panel" aria-label="绘图工具">
        <div className="tool-list">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tool-btn ${tool === t.id ? "active" : ""}`}
              onClick={() => setTool(t.id)}
              title={`${t.label}（${t.key}）`}
              aria-label={t.label}
              aria-pressed={tool === t.id}
            >
              <PixelIcon data={t.icon} size={22} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <div className="tool-divider" />
        <div className="tool-panel-field">
          <label className="field-label" htmlFor="brush-size">笔刷 [ ]</label>
          <select id="brush-size" className="num-input" style={{ width: "100%" }} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((s) => <option key={s} value={s}>{s} px</option>)}
          </select>
        </div>
        <div className="tool-panel-field">
          <label className="field-label" htmlFor="zoom-level">缩放 - +</label>
          <select id="zoom-level" className="num-input" style={{ width: "100%" }} value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
            {ZOOMS.map((z) => <option key={z} value={z}>{z}×</option>)}
          </select>
        </div>
        {tool === "rect" && (
          <label className="ghost-check" style={{ marginTop: 6 }}>
            <input type="checkbox" checked={rectFilled} onChange={(e) => setRectFilled(e.target.checked)} />
            填充矩形
          </label>
        )}
      </aside>

      {/* 画布 */}
      <section className="card canvas-card">
        <div className="canvas-head">
          <span className="canvas-info">
            {doc.width} × {doc.height} · 第 {layerIndex + 1}/{doc.layers.length} 层
          </span>
          <div className="canvas-actions">
            <label className="ghost-check">
              <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
              网格
            </label>
            <button type="button" className="btn-ghost icon-btn" onClick={undo} disabled={!canUndo} title="撤销（Ctrl+Z）" aria-label="撤销">
              <PixelIcon data={Undo} size={16} />
            </button>
            <button type="button" className="btn-ghost icon-btn" onClick={redo} disabled={!canRedo} title="重做（Ctrl+Shift+Z）" aria-label="重做">
              <PixelIcon data={Redo} size={16} />
            </button>
          </div>
        </div>
        <div className="canvas-stage">
          <div
            className="canvas-wrap checker"
            style={{ width: doc.width * cell, height: doc.height * cell, backgroundSize: `${cell}px ${cell}px` }}
          >
            <canvas
              ref={canvasRef}
              className="pixelated"
              style={{ width: doc.width * cell, height: doc.height * cell, touchAction: "none" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              aria-label={`像素画布 ${doc.width}×${doc.height}`}
            />
            <canvas
              ref={overlayRef}
              className="pixelated canvas-overlay"
              style={{ width: doc.width * cell, height: doc.height * cell }}
              aria-hidden="true"
            />
            {gridVisible && (
              <div
                className="canvas-grid"
                style={{ width: doc.width * cell, height: doc.height * cell, backgroundSize: `${cell}px ${cell}px` }}
              />
            )}
          </div>
        </div>
        <p className="shortcut-hint">
          快捷键：B 铅笔 · E 橡皮 · I 取色 · G 填充 · L 直线 · R 矩形 · M 对称 · [ ] 笔刷 · - + 缩放 · Ctrl+Z 撤销 · Ctrl+S 存工程
        </p>

        {animation && (
          <div className="frame-strip" role="toolbar" aria-label="帧动画">
            <div className="frame-controls">
              <button
                type="button"
                className="btn-ghost icon-btn"
                onClick={animation.onTogglePlay}
                aria-label={animation.playing ? "暂停预览" : "播放预览"}
                title={animation.playing ? "暂停预览" : "播放预览（空格）"}
              >
                {animation.playing ? "⏸" : "▶"}
              </button>
              <label className="ghost-check">
                <input type="checkbox" checked={animation.onion} onChange={animation.onToggleOnion} />
                洋葱皮
              </label>
              <label className="ghost-check" title="同时显示下一帧（淡青色）">
                <input type="checkbox" checked={animation.onionNext} onChange={animation.onToggleOnionNext} />
                显示下一帧
              </label>
              <label className="fps-label">
                <span>帧率</span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={animation.fps}
                  onChange={(e) => animation.onFpsChange(Number(e.target.value))}
                  className="num-input"
                  style={{ width: 54 }}
                  aria-label="帧率"
                />
              </label>
            </div>
            <div className="frame-list">
              {animation.frames.map((f, i) => (
                <FrameThumb
                  key={f.layers[0]?.id ?? i}
                  frame={f}
                  index={i}
                  active={i === animation.frameIndex}
                  onClick={() => animation.onFrameSelect(i)}
                />
              ))}
              <div className="frame-ops">
                <button type="button" className="frame-op" onClick={animation.onFrameAddBlank} title="新建空白帧" aria-label="新建空白帧">＋</button>
                <button type="button" className="frame-op" onClick={animation.onFrameDuplicate} title="复制当前帧" aria-label="复制当前帧">⧉</button>
                <button type="button" className="frame-op" onClick={() => animation.onFrameShift(-1)} title="左移" aria-label="左移当前帧">‹</button>
                <button type="button" className="frame-op" onClick={() => animation.onFrameShift(1)} title="右移" aria-label="右移当前帧">›</button>
                <button type="button" className="frame-op danger" onClick={animation.onFrameDelete} title="删除当前帧" aria-label="删除当前帧">✕</button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 右侧面板 */}
      <aside className="side-panels">
        <div className="card palette-card">
          <div className="panel-head">
            <h2 className="card-title">调色板</h2>
          </div>
          <label className="field-label" htmlFor="palette-select">预设</label>
          <select
            id="palette-select"
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
                onClick={() => { setColor(c); setColorText(c); }}
                title={c}
                aria-label={`颜色 ${c}`}
              />
            ))}
          </div>
          <div className="color-row">
            <input
              type="color"
              value={color}
              onChange={(e) => { setColor(e.target.value); setColorText(e.target.value); }}
              aria-label="选择颜色"
              style={{ width: 36, height: 32, border: "none", background: "none", padding: 0 }}
            />
            <input
              className="text-input"
              style={{ flex: 1 }}
              value={colorText}
              onChange={(e) => {
                setColorText(e.target.value);
                const rgb = parseHex(e.target.value);
                if (rgb) setColor(rgbToHex(rgb[0], rgb[1], rgb[2]));
              }}
              onBlur={() => setColorText(color)}
              aria-label="颜色 hex 值"
              aria-invalid={parseHex(colorText) === null}
              spellCheck={false}
            />
          </div>
          {parseHex(colorText) === null && (
            <p style={{ fontSize: 12, color: "var(--amber)", marginTop: 6 }}>
              hex 无效，仍在使用 {color}
            </p>
          )}
        </div>

        <div className="card layers-card">
          <div className="panel-head">
            <h2 className="card-title">图层</h2>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="btn-ghost" onClick={clearLayer}>清空</button>
              <button type="button" className="btn-ghost" onClick={addLayer}>＋ 新建</button>
            </div>
          </div>
          <div className="layer-list">
            {doc.layers.map((l, i) => (
              <div
                key={l.id}
                className={`layer-item ${i === layerIndex ? "active" : ""}`}
                onClick={() => setActiveLayer(i)}
              >
                <button
                  type="button"
                  className="layer-eye"
                  onClick={(e) => { e.stopPropagation(); toggleLayer(i); }}
                  title={l.visible ? "隐藏图层" : "显示图层"}
                  aria-label={l.visible ? `隐藏 ${l.name}` : `显示 ${l.name}`}
                >
                  {l.visible ? "◉" : "○"}
                </button>
                <span className="layer-name">{l.name}</span>
                <input
                  type="range" min={0} max={100} value={Math.round(l.opacity * 100)}
                  onChange={(e) => setLayerOpacity(i, Number(e.target.value) / 100)}
                  onClick={(e) => e.stopPropagation()}
                  title={`不透明度 ${Math.round(l.opacity * 100)}%`}
                  aria-label={`${l.name} 不透明度`}
                />
                <div className="layer-actions">
                  <button type="button" className="mini-btn" onClick={(e) => { e.stopPropagation(); moveLayer(i, 1); }} title="上移" aria-label="上移图层">↑</button>
                  <button type="button" className="mini-btn" onClick={(e) => { e.stopPropagation(); moveLayer(i, -1); }} title="下移" aria-label="下移图层">↓</button>
                  <button type="button" className="mini-btn danger icon-btn" onClick={(e) => { e.stopPropagation(); removeLayer(i); }} title="删除图层" aria-label={`删除 ${l.name}`}>
                    <PixelIcon data={Trash} size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card canvas-tools-card">
          <h2 className="card-title">画布尺寸</h2>
          <div className="size-row">
            <label className="sr-only" htmlFor="canvas-w">宽度</label>
            <input id="canvas-w" className="num-input" type="number" min={1} max={512} value={sizeW}
              onChange={(e) => setSizeW(clampSize(Number(e.target.value)))} />
            <span aria-hidden="true">×</span>
            <label className="sr-only" htmlFor="canvas-h">高度</label>
            <input id="canvas-h" className="num-input" type="number" min={1} max={512} value={sizeH}
              onChange={(e) => setSizeH(clampSize(Number(e.target.value)))} />
          </div>
          <div className="size-row">
            <button type="button" className="btn-ghost" style={{ flex: 1 }} onClick={applyResize}>调整（保留内容）</button>
            <button type="button" className="btn-ghost" style={{ flex: 1 }} onClick={newCanvas}>新建空白</button>
          </div>

          <div className="tool-divider" />
          <h2 className="card-title">导出与工程</h2>
          <div className="size-row">
            <label className="field-label" style={{ margin: 0 }} htmlFor="export-scale">放大</label>
            <select id="export-scale" className="num-input" style={{ flex: 1 }} value={exportScale} onChange={(e) => setExportScale(Number(e.target.value))}>
              {[1, 2, 4, 8, 16].map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
            <button type="button" className="btn-primary" onClick={exportPng}>导出 PNG</button>
          </div>
          <div className="size-row">
            <button type="button" className="btn-ghost icon-text-btn" style={{ flex: 1 }} onClick={saveProject}>
              <PixelIcon data={Download} size={14} /> 保存工程
            </button>
            <button type="button" className="btn-ghost icon-text-btn" style={{ flex: 1 }} onClick={() => projectInputRef.current?.click()}>
              <PixelIcon data={Upload} size={14} /> 打开工程
            </button>
            <input
              ref={projectInputRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) openProject(f);
                e.target.value = "";
              }}
            />
          </div>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
            工程含图层信息，可再次打开继续编辑；画布内容也会自动存本地草稿。
          </p>
        </div>
      </aside>
    </div>
  );
}
