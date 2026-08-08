import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  applyPixelChanges, brushOffsets, cloneDoc, composite, createDoc, docFromPixels,
  drawLinePoints, floodFill, getPixel, History, putPixel,
  resizeDoc, StrokeRecorder, uid,
  type Layer, type PixelDoc, type Rgba, type Tool,
} from "../lib/pixelDoc";
import {
  BUILTIN_PALETTES,
  createCustomPalette,
  mergePaletteColors,
  paletteToGpl,
  paletteToJson,
  parseHex,
  parsePaletteText,
  rgbToHex,
  type Palette,
} from "../lib/palette";
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
import { Selection } from "./icons/selection";
import { Move } from "./icons/move";
import PixelIcon from "../lib/PixelIcon";
import type { PxlKitData } from "../lib/pixelTypes";
import { checkerStyle } from "../lib/checker";
import { useI18n } from "../lib/i18n";
import { encodeGif } from "../lib/gif";
import { analyzePixelArt } from "../lib/pixelArt";
import { matchSquareSizePreset, SIZE_PRESET_VALUES, type SizePreset } from "../lib/sizePresets";
import {
  combineSelectionMasks,
  countSelected,
  createSelectionMask,
  maskFromPoints,
  movePixelsBySelection,
  rectangleSelectionMask,
  selectionMasksEqual,
  shiftSelectionMask,
  type SelectionMode,
} from "../lib/selection";
import type { CanvasImportRequest } from "../lib/importFlow";

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
  onResizeFrames: (width: number, height: number) => void;
  onFpsChange: (fps: number) => void;
  onTogglePlay: () => void;
  onToggleOnion: () => void;
  onToggleOnionNext: () => void;
}

interface EditorProps {
  doc: PixelDoc;
  setDoc: (d: PixelDoc) => void;
  palette: Palette;
  customPalettes: Palette[];
  onPaletteChange: (palette: Palette) => void;
  onCustomPalettesChange: (palettes: Palette[]) => void;
  onNotice?: (msg: string) => void;
  onConfirm: (message: string) => Promise<boolean>;
  /** 洋葱皮：相邻帧的合成位图（非当前帧） */
  onionPixels?: Uint8ClampedArray | null;
  animation?: AnimationProps;
  /** 外部替换文档（导入/换帧）时自增，Editor 据此清空撤销历史 */
  epoch?: number;
  onSaveProject?: () => void;
  onOpenProject?: (file: File) => Promise<void> | void;
  onSendImageToPixelize?: (file: File) => void;
  onCanvasImport?: (request: CanvasImportRequest) => void;
}

const ZOOMS = [1, 2, 4, 8, 16, 32];

const TOOLS: Array<{ id: Tool; labelKey: string; icon: PxlKitData; key: string }> = [
  { id: "pencil", labelKey: "pencil", icon: Pencil, key: "B" },
  { id: "eraser", labelKey: "eraser", icon: Eraser, key: "E" },
  { id: "picker", labelKey: "picker", icon: Eyedropper, key: "I" },
  { id: "fill", labelKey: "fill", icon: PaintBucket, key: "G" },
  { id: "line", labelKey: "line", icon: Line, key: "L" },
  { id: "select", labelKey: "selectionTool", icon: Selection, key: "M" },
  { id: "move", labelKey: "moveTool", icon: Move, key: "V" },
];

interface HsvColor { h: number; s: number; v: number }

function rgbToHsv(r: number, g: number, b: number): HsvColor {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === red) h = 60 * (((green - blue) / delta) % 6);
    else if (max === green) h = 60 * ((blue - red) / delta + 2);
    else h = 60 * ((red - green) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function hsvToHex({ h, s, v }: HsvColor): string {
  const chroma = v * s;
  const section = h / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  let rgb: [number, number, number];
  if (section < 1) rgb = [chroma, x, 0];
  else if (section < 2) rgb = [x, chroma, 0];
  else if (section < 3) rgb = [0, chroma, x];
  else if (section < 4) rgb = [0, x, chroma];
  else if (section < 5) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  const offset = v - chroma;
  return rgbToHex(...rgb.map((channel) => Math.round((channel + offset) * 255)) as [number, number, number]);
}

function hsvFromHex(value: string): HsvColor {
  const rgb = parseHex(value) ?? [239, 125, 87];
  return rgbToHsv(rgb[0], rgb[1], rgb[2]);
}

const TRANSPARENT: Rgba = [0, 0, 0, 0];

type SelectionShape = "rectangle" | "paint";

interface SelectionGesture {
  before: Uint8Array;
  gesture: Uint8Array;
  mode: SelectionMode;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
}

interface MoveSession {
  layerId: string;
  beforePixels: Uint8ClampedArray;
  mask: Uint8Array;
  previewCanvas: HTMLCanvasElement;
  dx: number;
  dy: number;
  clippedOpaque: number;
}

interface CanvasDrag {
  drawing: boolean;
  tool: Tool;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  moveStartDx: number;
  moveStartDy: number;
}

function useFocusTrap(open: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const selector = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const frame = window.requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(selector)?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(selector)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [onClose, open, ref]);
}

function pixelsToCanvas(pixels: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.putImageData(new ImageData(pixels.slice(), width, height), 0, 0);
  return canvas;
}

// 单帧缩略图：把帧的合成结果画到小画布
function FrameThumb({ frame, active, index, onClick }: {
  frame: PixelDoc;
  active: boolean;
  index: number;
  onClick: () => void;
}) {
  const { t } = useI18n();
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
      title={t("frameTitle", { index: index + 1 })}
      aria-label={t("selectFrame", { index: index + 1 })}
      aria-pressed={active}
    >
      <canvas ref={ref} className="pixelated" />
      <span>{index + 1}</span>
    </button>
  );
}

export default function Editor({ doc, setDoc, palette, customPalettes, onPaletteChange, onCustomPalettesChange, onNotice, onConfirm, onionPixels, animation, epoch = 0, onSaveProject, onOpenProject, onSendImageToPixelize, onCanvasImport }: EditorProps) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const canvasStageRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef(new History(80));
  const recorderRef = useRef<StrokeRecorder | null>(null);
  const layerCanvasesRef = useRef<Array<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }>>([]);
  const layerSigRef = useRef("");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const paletteFileInputRef = useRef<HTMLInputElement>(null);
  const paletteNameInputRef = useRef<HTMLInputElement>(null);
  const paletteManageRef = useRef<HTMLDivElement>(null);
  const paletteImportButtonRef = useRef<HTMLButtonElement>(null);
  const paletteImportDialogRef = useRef<HTMLDivElement>(null);
  const mobileDrawerRef = useRef<HTMLElement>(null);
  const frameMenuRef = useRef<HTMLDivElement>(null);
  const addedColorTimerRef = useRef<number | null>(null);
  const colorPickerCloseTimerRef = useRef<number | null>(null);
  const [renderVersion, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  const [tool, setTool] = useState<Tool>("pencil");
  const [canvasColorPickArmed, setCanvasColorPickArmed] = useState(false);
  const [color, setColor] = useState<string>(palette.colors[3] ?? "#ef7d57");
  const [colorText, setColorText] = useState<string>(palette.colors[3] ?? "#ef7d57");
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [colorPickerHue, setColorPickerHue] = useState(() => hsvFromHex(palette.colors[3] ?? "#ef7d57").h);
  const [paletteName, setPaletteName] = useState(palette.name);
  const [renamingPaletteId, setRenamingPaletteId] = useState<string | null>(null);
  const [paletteManageOpen, setPaletteManageOpen] = useState(false);
  const [paletteImportOpen, setPaletteImportOpen] = useState(false);
  const [paletteImportTab, setPaletteImportTab] = useState<"palette" | "file">("palette");
  const [paletteImportSource, setPaletteImportSource] = useState(BUILTIN_PALETTES[0]?.id ?? "");
  const [paletteImportColors, setPaletteImportColors] = useState<string[]>([]);
  const [paletteFilePreview, setPaletteFilePreview] = useState<Palette | null>(null);
  const [paletteFileError, setPaletteFileError] = useState<string | null>(null);
  const [paletteFileDragging, setPaletteFileDragging] = useState(false);
  const [paletteImportPosition, setPaletteImportPosition] = useState({ top: 0, left: 0 });
  const [recentlyAddedColor, setRecentlyAddedColor] = useState<string | null>(null);
  const [draggedColorIndex, setDraggedColorIndex] = useState<number | null>(null);
  const [dragOverColorIndex, setDragOverColorIndex] = useState<number | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<"before" | "after" | null>(null);
  const paletteGridRef = useRef<HTMLDivElement>(null);
  const palettePointerRef = useRef<{
    pointerId: number; pointerType: string; index: number; startX: number; startY: number; active: boolean; timer: number | null;
  } | null>(null);
  const suppressPaletteClickRef = useRef(false);
  const dragOverRef = useRef<{ index: number; position: "before" | "after" } | null>(null);
  const previousPaletteId = useRef(palette.id);
  const [zoom, setZoom] = useState(8);
  const zoomRef = useRef(zoom);
  const [showGrid, setShowGrid] = useState(true);
  const [activeLayer, setActiveLayer] = useState(0);
  const [brushSize, setBrushSize] = useState(1);
  const [selectionShape, setSelectionShape] = useState<SelectionShape>("rectangle");
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("replace");
  const [sizeW, setSizeW] = useState(doc.width);
  const [sizeH, setSizeH] = useState(doc.height);
  const [canvasSizePreset, setCanvasSizePreset] = useState<SizePreset>(() => matchSquareSizePreset(doc.width, doc.height));
  const [exportScale, setExportScale] = useState(4);
  const [imageImportBusy, setImageImportBusy] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState<"tools" | "palette" | null>(null);
  const [recentColors, setRecentColors] = useState<string[]>(() => palette.colors.slice(0, 6));
  const [framesExpanded, setFramesExpanded] = useState(() => (animation?.frames.length ?? 1) > 1);
  const [frameMenuOpen, setFrameMenuOpen] = useState(false);
  const previousFrameCountRef = useRef(animation?.frames.length ?? 1);
  const selectionRef = useRef<Uint8Array>(createSelectionMask(doc.width, doc.height));
  const selectionGestureRef = useRef<SelectionGesture | null>(null);
  const moveSessionRef = useRef<MoveSession | null>(null);
  const activePointersRef = useRef(new Map<number, { x: number; y: number }>());
  const navigationRef = useRef(false);
  const pinchRef = useRef<{
    distance: number; centerX: number; centerY: number; scrollLeft: number; scrollTop: number; zoomIndex: number;
  } | null>(null);

  const askConfirm = useCallback((message: string) => onConfirm(message), [onConfirm]);

  const cancelColorPickerClose = useCallback(() => {
    if (colorPickerCloseTimerRef.current === null) return;
    window.clearTimeout(colorPickerCloseTimerRef.current);
    colorPickerCloseTimerRef.current = null;
  }, []);

  const scheduleColorPickerClose = useCallback(() => {
    cancelColorPickerClose();
    colorPickerCloseTimerRef.current = window.setTimeout(() => {
      colorPickerCloseTimerRef.current = null;
      setColorPickerOpen(false);
    }, 220);
  }, [cancelColorPickerClose]);

  const armCanvasColorPick = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(min-width: 561px) and (pointer: fine)").matches) return;
    setColorPickerHue(hsvFromHex(color).h);
    setColorPickerOpen(true);
    setCanvasColorPickArmed(true);
  }, [color]);

  const updateChosenColor = useCallback((value: string) => {
    setColor(value);
    setColorText(value);
    setColorPickerOpen(false);
    setCanvasColorPickArmed(false);
  }, []);

  const previewChosenColor = useCallback((value: string) => {
    setColor(value);
    setColorText(value);
  }, []);

  const updatePickerSaturationValue = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.type === "pointermove" && (event.buttons & 1) === 0) return;
    if (event.type === "pointerdown") event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const v = Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height));
    previewChosenColor(hsvToHex({ h: colorPickerHue, s, v }));
  }, [colorPickerHue, previewChosenColor]);

  const updatePickerHue = useCallback((h: number) => {
    setColorPickerHue(h);
    const current = hsvFromHex(color);
    previewChosenColor(hsvToHex({ h, s: current.s, v: current.v }));
  }, [color, previewChosenColor]);

  const paletteEditable = palette.source === "custom";
  const paletteDisplayName = palette.id === "custom-default" && palette.name === "自定义" ? t("paletteCustom") : palette.name;
  const paletteRenaming = paletteEditable && renamingPaletteId === palette.id;
  const paletteImportCustomSources = customPalettes.filter((item) => item.id !== palette.id);
  const paletteImportBuiltinSources = BUILTIN_PALETTES.filter((item) => item.id !== palette.id);
  const paletteImportSources = [...paletteImportCustomSources, ...paletteImportBuiltinSources];
  const paletteImportSourcePalette = paletteImportSources.find((item) => item.id === paletteImportSource) ?? null;
  const parsedCurrentColor = parseHex(colorText);
  const normalizedCurrentColor = parsedCurrentColor ? rgbToHex(parsedCurrentColor[0], parsedCurrentColor[1], parsedCurrentColor[2]) : null;
  const currentPaletteColorSet = new Set(palette.colors.map((value) => value.toLowerCase()));
  const currentColorExists = normalizedCurrentColor ? currentPaletteColorSet.has(normalizedCurrentColor) : false;
  const canAddCurrentColor = paletteEditable && normalizedCurrentColor !== null && !currentColorExists;
  const paletteFileMerge = paletteFilePreview ? mergePaletteColors(palette.colors, paletteFilePreview.colors) : null;
  const closePaletteImport = useCallback(() => setPaletteImportOpen(false), []);
  const closeMobileDrawer = useCallback(() => setMobileDrawer(null), []);

  useFocusTrap(paletteImportOpen, paletteImportDialogRef, closePaletteImport);
  useFocusTrap(Boolean(mobileDrawer), mobileDrawerRef, closeMobileDrawer);

  zoomRef.current = zoom;

  useEffect(() => {
    setRecentColors((items) => [color, ...items.filter((item) => item.toLowerCase() !== color.toLowerCase())].slice(0, 6));
  }, [color]);

  useEffect(() => {
    const count = animation?.frames.length ?? 1;
    const previous = previousFrameCountRef.current;
    if (count <= 1) {
      setFramesExpanded(false);
      setFrameMenuOpen(false);
    } else if (previous <= 1 && count > 1) {
      setFramesExpanded(true);
    }
    previousFrameCountRef.current = count;
  }, [animation?.frames.length]);

  const displayPaletteName = (item: Palette) => (
    item.id === "custom-default" && item.name === "自定义" ? t("paletteCustom") : item.name
  );

  useEffect(() => {
    setPaletteName(paletteDisplayName);
    if (previousPaletteId.current !== palette.id && palette.colors.length > 0) {
      previousPaletteId.current = palette.id;
      setColor(palette.colors[0]);
      setColorText(palette.colors[0]);
    }
  }, [palette.id, paletteDisplayName, palette.colors]);

  useEffect(() => {
    if (!paletteRenaming) return;
    paletteNameInputRef.current?.focus();
    paletteNameInputRef.current?.select();
  }, [paletteRenaming]);

  useEffect(() => {
    if (!paletteManageOpen) return;
    const close = (event: PointerEvent) => {
      if (!paletteManageRef.current?.contains(event.target as Node)) setPaletteManageOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [paletteManageOpen]);

  useEffect(() => {
    if (!frameMenuOpen) return;
    const closePointer = (event: PointerEvent) => { if (!frameMenuRef.current?.contains(event.target as Node)) setFrameMenuOpen(false); };
    const closeKey = (event: KeyboardEvent) => { if (event.key === "Escape") setFrameMenuOpen(false); };
    document.addEventListener("pointerdown", closePointer);
    document.addEventListener("keydown", closeKey);
    return () => { document.removeEventListener("pointerdown", closePointer); document.removeEventListener("keydown", closeKey); };
  }, [frameMenuOpen]);

  useEffect(() => () => {
    const timer = palettePointerRef.current?.timer;
    if (timer !== null && timer !== undefined) window.clearTimeout(timer);
    if (addedColorTimerRef.current !== null) window.clearTimeout(addedColorTimerRef.current);
    if (colorPickerCloseTimerRef.current !== null) window.clearTimeout(colorPickerCloseTimerRef.current);
  }, []);

  const commitCustomPalette = (next: Palette, palettes = customPalettes.map((item) => item.id === next.id ? next : item)) => {
    onCustomPalettesChange(palettes);
    onPaletteChange(next);
  };

  const selectPalette = (id: string) => {
    const next = [...customPalettes, ...BUILTIN_PALETTES].find((item) => item.id === id);
    if (!next) return;
    setRenamingPaletteId(null);
    setPaletteManageOpen(false);
    setPaletteImportOpen(false);
    onPaletteChange(next);
  };

  const addCustomPalette = () => {
    const base = t("paletteCustom");
    let name = base;
    let index = 2;
    while (customPalettes.some((item) => item.name === name)) name = `${base} ${index++}`;
    const next = createCustomPalette(name, []);
    onCustomPalettesChange([...customPalettes, next]);
    onPaletteChange(next);
    setPaletteName(next.name);
    setRenamingPaletteId(next.id);
  };

  const renameCustomPalette = () => {
    if (!paletteEditable) return;
    const nextName = paletteName.trim() || t("paletteCustom");
    if (!(palette.id === "custom-default" && palette.name === "自定义" && nextName === t("paletteCustom")) && nextName !== palette.name) {
      commitCustomPalette({ ...palette, name: nextName });
    }
    setRenamingPaletteId(null);
  };

  const deleteCustomPalette = async () => {
    setPaletteManageOpen(false);
    if (!paletteEditable || customPalettes.length <= 1) {
      if (paletteEditable) onNotice?.(t("paletteKeepOne"));
      return;
    }
    if (!(await askConfirm(t("paletteDeleteConfirm", { name: paletteDisplayName })))) return;
    const nextPalettes = customPalettes.filter((item) => item.id !== palette.id);
    onCustomPalettesChange(nextPalettes);
    onPaletteChange(nextPalettes[0]);
  };

  const copyPaletteToCustom = () => {
    const base = palette.name;
    let name = base;
    let index = 2;
    while (customPalettes.some((item) => item.name === name)) name = `${base} ${index++}`;
    const next = createCustomPalette(name, palette.colors);
    onCustomPalettesChange([...customPalettes, next]);
    onPaletteChange(next);
    onNotice?.(t("paletteCopied", { name: next.name }));
  };

  const addCurrentColor = () => {
    if (!canAddCurrentColor || !normalizedCurrentColor) return;
    const merged = mergePaletteColors(palette.colors, [normalizedCurrentColor]);
    commitCustomPalette({ ...palette, colors: merged.colors });
    setColor(normalizedCurrentColor);
    setColorText(normalizedCurrentColor);
    setRecentlyAddedColor(normalizedCurrentColor);
    if (addedColorTimerRef.current !== null) window.clearTimeout(addedColorTimerRef.current);
    addedColorTimerRef.current = window.setTimeout(() => setRecentlyAddedColor(null), 360);
  };

  const removePaletteColor = (index: number) => {
    if (!paletteEditable) return;
    commitCustomPalette({ ...palette, colors: palette.colors.filter((_, i) => i !== index) });
  };

  const reorderPaletteColor = (from: number, target: number, position: "before" | "after") => {
    if (!paletteEditable || from < 0 || from >= palette.colors.length || target < 0 || target >= palette.colors.length || from === target) return;
    const colors = [...palette.colors];
    const [moved] = colors.splice(from, 1);
    let insertAt = position === "after" ? target + 1 : target;
    if (from < insertAt) insertAt -= 1;
    if (insertAt === from) return;
    colors.splice(Math.max(0, Math.min(insertAt, colors.length)), 0, moved);
    commitCustomPalette({ ...palette, colors });
  };

  const updatePaletteDropState = (index: number | null, position: "before" | "after" | null) => {
    const next = index === null || position === null ? null : { index, position };
    const current = dragOverRef.current;
    if (current?.index === next?.index && current?.position === next?.position) return;
    dragOverRef.current = next;
    setDragOverColorIndex(next?.index ?? null);
    setDragOverPosition(next?.position ?? null);
  };

  const clearPaletteDrag = () => {
    const timer = palettePointerRef.current?.timer;
    if (timer !== null && timer !== undefined) window.clearTimeout(timer);
    palettePointerRef.current = null;
    dragOverRef.current = null;
    setDraggedColorIndex(null);
    setDragOverColorIndex(null);
    setDragOverPosition(null);
  };

  const beginPalettePointer = (e: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (!paletteEditable || e.button !== 0) return;
    const targetButton = e.currentTarget;
    const activate = () => {
      const pointer = palettePointerRef.current;
      if (!pointer || pointer.pointerId !== e.pointerId) return;
      pointer.active = true;
      pointer.timer = null;
      suppressPaletteClickRef.current = true;
      setDraggedColorIndex(index);
      updatePaletteDropState(index, "before");
      try { targetButton.setPointerCapture(e.pointerId); } catch { /* optional */ }
    };
    palettePointerRef.current = {
      pointerId: e.pointerId, pointerType: e.pointerType, index, startX: e.clientX, startY: e.clientY, active: false,
      timer: e.pointerType === "touch" ? window.setTimeout(activate, 360) : null,
    };
  };

  const movePalettePointer = (e: React.PointerEvent<HTMLButtonElement>) => {
    const pointer = palettePointerRef.current;
    if (!pointer || pointer.pointerId !== e.pointerId) return;
    if (!pointer.active) {
      const distance = Math.hypot(e.clientX - pointer.startX, e.clientY - pointer.startY);
      if (pointer.pointerType === "mouse" && distance > 2) {
        pointer.active = true;
        suppressPaletteClickRef.current = true;
        setDraggedColorIndex(pointer.index);
        updatePaletteDropState(pointer.index, "before");
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* optional */ }
      } else {
        if (pointer.pointerType === "touch" && distance > 7) clearPaletteDrag();
        return;
      }
    }
    e.preventDefault();
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-palette-index]");
    const index = Number(target?.dataset.paletteIndex);
    if (!target || !Number.isInteger(index)) {
      updatePaletteDropState(null, null);
      return;
    }
    const rect = target.getBoundingClientRect();
    updatePaletteDropState(index, e.clientX < rect.left + rect.width / 2 ? "before" : "after");
  };

  const endPalettePointer = (e: React.PointerEvent<HTMLButtonElement>) => {
    const pointer = palettePointerRef.current;
    if (!pointer || pointer.pointerId !== e.pointerId) return;
    if (pointer.active && dragOverRef.current) {
      reorderPaletteColor(pointer.index, dragOverRef.current.index, dragOverRef.current.position);
    }
    clearPaletteDrag();
    if (pointer.active) window.setTimeout(() => { suppressPaletteClickRef.current = false; }, 0);
  };

  const movePaletteColorByKeyboard = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (!paletteEditable || target < 0 || target >= palette.colors.length) return;
    reorderPaletteColor(index, target, direction < 0 ? "before" : "after");
  };

  const openPaletteImport = () => {
    if (!paletteEditable) return;
    const rect = paletteImportButtonRef.current?.getBoundingClientRect();
    const width = Math.min(420, window.innerWidth - 24);
    if (rect) {
      setPaletteImportPosition({
        top: Math.min(rect.bottom + 8, window.innerHeight - 120),
        left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
      });
    }
    const source = paletteImportSources.find((item) => item.colors.some((value) => !currentPaletteColorSet.has(value.toLowerCase()))) ?? paletteImportSources[0];
    setPaletteImportTab("palette");
    setPaletteImportSource(source?.id ?? "");
    setPaletteImportColors([]);
    setPaletteFilePreview(null);
    setPaletteFileError(null);
    setPaletteFileDragging(false);
    setPaletteImportOpen(true);
  };

  const importOtherPaletteColors = () => {
    if (!paletteEditable || paletteImportColors.length === 0) return;
    const merged = mergePaletteColors(palette.colors, paletteImportColors);
    if (merged.added.length === 0) return;
    commitCustomPalette({ ...palette, colors: merged.colors });
    setPaletteImportOpen(false);
    onNotice?.(merged.skipped > 0
      ? t("paletteImportedWithSkipped", { added: merged.added.length, skipped: merged.skipped })
      : t("paletteImported", { count: merged.added.length, name: paletteDisplayName }));
  };

  const previewPaletteFile = async (file: File) => {
    const imported = parsePaletteText(await file.text(), file.name);
    if (!imported) {
      setPaletteFilePreview(null);
      setPaletteFileError(t("paletteFileInvalid"));
      return;
    }
    setPaletteFilePreview(imported);
    setPaletteFileError(null);
  };

  const mergePaletteFileIntoCurrent = () => {
    if (!paletteEditable || !paletteFilePreview || !paletteFileMerge || paletteFileMerge.added.length === 0) return;
    commitCustomPalette({ ...palette, colors: paletteFileMerge.colors });
    setPaletteImportOpen(false);
    onNotice?.(paletteFileMerge.skipped > 0
      ? t("paletteImportedWithSkipped", { added: paletteFileMerge.added.length, skipped: paletteFileMerge.skipped })
      : t("paletteImported", { count: paletteFileMerge.added.length, name: paletteDisplayName }));
  };

  const createPaletteFromFile = () => {
    if (!paletteFilePreview) return;
    let name = paletteFilePreview.name;
    let index = 2;
    while (customPalettes.some((item) => item.name === name)) name = `${paletteFilePreview.name} ${index++}`;
    const next = { ...paletteFilePreview, name };
    onCustomPalettesChange([...customPalettes, next]);
    onPaletteChange(next);
    setPaletteImportOpen(false);
    onNotice?.(t("paletteFileImported", { name: next.name, count: next.colors.length }));
  };

  const downloadPaletteText = (extension: "json" | "gpl") => {
    const text = extension === "json" ? paletteToJson(palette) : paletteToGpl(palette);
    const blob = new Blob([text], { type: extension === "json" ? "application/json" : "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${palette.name || "pixelpaint-palette"}.${extension}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    onNotice?.(t("paletteExported", { format: extension.toUpperCase() }));
  };

  const drag = useRef<CanvasDrag>({
    drawing: false,
    tool: "pencil",
    x: 0,
    y: 0,
    lastX: 0,
    lastY: 0,
    moveStartDx: 0,
    moveStartDy: 0,
  });

  // 外部替换文档（换帧/导入）时清空撤销历史
  const prevEpoch = useRef(epoch);
  useEffect(() => {
    if (prevEpoch.current !== epoch) {
      prevEpoch.current = epoch;
      historyRef.current.reset();
      recorderRef.current = null;
      layerSigRef.current = "";
      selectionGestureRef.current = null;
      moveSessionRef.current = null;
      if (selectionRef.current.length !== doc.width * doc.height) {
        selectionRef.current = createSelectionMask(doc.width, doc.height);
      }
      refresh();
    }
  }, [epoch, doc.width, doc.height]);

  // activeLayer 始终有效
  const layerIndex = Math.min(activeLayer, doc.layers.length - 1);
  useEffect(() => {
    if (activeLayer > doc.layers.length - 1) setActiveLayer(doc.layers.length - 1);
  }, [doc.layers.length, activeLayer]);

  // 画布尺寸变化时同步表单
  useEffect(() => {
    setSizeW(doc.width);
    setSizeH(doc.height);
    setCanvasSizePreset(matchSquareSizePreset(doc.width, doc.height));
    if (selectionRef.current.length !== doc.width * doc.height) {
      selectionRef.current = createSelectionMask(doc.width, doc.height);
      selectionGestureRef.current = null;
      moveSessionRef.current = null;
      refresh();
    }
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
      const moving = moveSessionRef.current;
      if (moving?.layerId === l.id) {
        ctx.drawImage(moving.previewCanvas, 0, 0);
      } else {
        ctx.drawImage(lcs[i].canvas, 0, 0);
      }
    }
    ctx.globalAlpha = 1;
  }, [doc, rebuildLayerCanvases, onionPixels]);

  useEffect(() => { draw(); }, [draw]);

  const renderOverlay = useCallback((preview: Array<[number, number]> = [], erasing = false) => {
    const o = overlayRef.current;
    if (!o) return;
    if (o.width !== doc.width || o.height !== doc.height) {
      o.width = doc.width;
      o.height = doc.height;
    }
    const ctx = o.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, o.width, o.height);
    const moving = moveSessionRef.current;
    const mask = moving
      ? shiftSelectionMask(moving.mask, doc.width, doc.height, moving.dx, moving.dy)
      : selectionRef.current;
    const img = ctx.createImageData(o.width, o.height);
    const paintOverlayPixel = (index: number, r: number, g: number, b: number, a: number) => {
      const i = index * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = a;
    };
    const selectionGesture = tool === "select" && !moving ? selectionGestureRef.current : null;
    if (selectionGesture) {
      for (let index = 0; index < selectionGesture.before.length; index++) {
        const wasSelected = selectionGesture.before[index] !== 0;
        const inGesture = selectionGesture.gesture[index] !== 0;
        if (selectionGesture.mode === "replace") {
          if (inGesture) paintOverlayPixel(index, 75, 95, 199, 66);
          continue;
        }
        if (wasSelected) paintOverlayPixel(index, 75, 95, 199, selectionGesture.mode === "subtract" ? 52 : 30);
        if (!inGesture) continue;
        if (selectionGesture.mode === "subtract") {
          paintOverlayPixel(index, 220, 60, 60, wasSelected ? 92 : 30);
        } else if (wasSelected) {
          paintOverlayPixel(index, 75, 95, 199, selectionGesture.mode === "intersect" ? 88 : 76);
        } else {
          paintOverlayPixel(index, 65, 166, 210, selectionGesture.mode === "intersect" ? 34 : 62);
        }
      }
    } else {
      const selectionAlpha = tool === "select" ? 52 : tool === "move" ? 42 : 26;
      for (let index = 0; index < mask.length; index++) {
        if (mask[index] === 0) continue;
        paintOverlayPixel(index, 75, 95, 199, selectionAlpha);
      }
    }
    const rgb = parseHex(color) ?? [0, 0, 0];
    for (const [x, y] of preview) {
      const i = (y * o.width + x) * 4;
      if (erasing) {
        img.data[i] = 220;
        img.data[i + 1] = 60;
        img.data[i + 2] = 60;
        img.data[i + 3] = 150;
      } else {
        img.data[i] = rgb[0];
        img.data[i + 1] = rgb[1];
        img.data[i + 2] = rgb[2];
        img.data[i + 3] = 235;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [color, doc.width, doc.height, tool]);

  useEffect(() => { renderOverlay(); }, [renderOverlay, renderVersion]);

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

  const shapePoints = useCallback((x0: number, y0: number, x1: number, y1: number) => (
    expand(drawLinePoints(x0, y0, x1, y1))
  ), [expand]);

  const selectionCount = countSelected(selectionRef.current);
  const selectionActive = selectionCount > 0;

  const constrainPoints = useCallback((pts: Array<[number, number]>) => {
    if (!selectionActive) return pts;
    const mask = selectionRef.current;
    return pts.filter(([x, y]) => mask[y * doc.width + x] !== 0);
  }, [doc.width, selectionActive]);

  // 预览：把「将要落下的确切像素」画到叠加层
  const showPreview = useCallback((pts: Array<[number, number]>, erasing: boolean) => {
    renderOverlay(constrainPoints(pts), erasing);
  }, [constrainPoints, renderOverlay]);

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
      if (selectionActive && selectionRef.current[idx] === 0) continue;
      const i = idx * 4;
      const before: Rgba = [layer.pixels[i], layer.pixels[i + 1], layer.pixels[i + 2], layer.pixels[i + 3]];
      putPixel(layer.pixels, doc.width, x, y, rgba[0], rgba[1], rgba[2], rgba[3]);
      rec?.touch(idx, before, rgba);
    }
  }, [doc, layerIndex, selectionActive]);

  // 提交结构变化（触发重渲染 + 上层自动保存）
  const commit = useCallback(() => {
    setDoc({ ...doc, layers: [...doc.layers] });
  }, [doc, setDoc]);

  // ---------- 像素选区 ----------
  const pushSelectionHistory = (before: Uint8Array, after: Uint8Array) => {
    if (selectionMasksEqual(before, after)) return;
    historyRef.current.push({ kind: "selection", before: before.slice(), after: after.slice() });
  };

  const applySelectionMask = (next: Uint8Array, record = true) => {
    const before = selectionRef.current;
    if (record) pushSelectionHistory(before, next);
    selectionRef.current = next;
    renderOverlay();
    refresh();
  };

  const selectAllPixels = () => {
    const next = createSelectionMask(doc.width, doc.height);
    next.fill(1);
    applySelectionMask(next);
  };

  const invertSelection = () => {
    const next = selectionRef.current.slice();
    for (let i = 0; i < next.length; i++) next[i] = next[i] === 0 ? 1 : 0;
    applySelectionMask(next);
  };

  const clearSelection = () => {
    if (!selectionActive) return;
    applySelectionMask(createSelectionMask(doc.width, doc.height));
  };

  const selectionModeForPointer = (e: React.PointerEvent<HTMLCanvasElement>): SelectionMode => {
    if (e.shiftKey && e.altKey) return "intersect";
    if (e.shiftKey) return "add";
    if (e.altKey) return "subtract";
    return selectionMode;
  };

  const updateSelectionGesture = (x: number, y: number) => {
    const gesture = selectionGestureRef.current;
    if (!gesture) return;
    if (selectionShape === "rectangle") {
      gesture.gesture = rectangleSelectionMask(doc.width, doc.height, gesture.x, gesture.y, x, y);
    } else {
      const path = drawLinePoints(gesture.lastX, gesture.lastY, x, y);
      const stroke = maskFromPoints(doc.width, doc.height, expand(path));
      for (let i = 0; i < stroke.length; i++) {
        if (stroke[i] !== 0) gesture.gesture[i] = 1;
      }
      gesture.lastX = x;
      gesture.lastY = y;
    }
    selectionRef.current = combineSelectionMasks(gesture.before, gesture.gesture, gesture.mode);
    renderOverlay();
    refresh();
  };

  const beginSelectionGesture = (x: number, y: number, e: React.PointerEvent<HTMLCanvasElement>) => {
    selectionGestureRef.current = {
      before: selectionRef.current.slice(),
      gesture: createSelectionMask(doc.width, doc.height),
      mode: selectionModeForPointer(e),
      x,
      y,
      lastX: x,
      lastY: y,
    };
    updateSelectionGesture(x, y);
  };

  const finishSelectionGesture = () => {
    const gesture = selectionGestureRef.current;
    if (!gesture) return;
    selectionGestureRef.current = null;
    pushSelectionHistory(gesture.before, selectionRef.current);
    renderOverlay();
    refresh();
  };

  const cancelSelectionGesture = () => {
    const gesture = selectionGestureRef.current;
    if (!gesture) return;
    selectionRef.current = gesture.before;
    selectionGestureRef.current = null;
    renderOverlay();
    refresh();
  };

  const deleteSelectedPixels = () => {
    if (!selectionActive || moveSessionRef.current) return;
    const layer = doc.layers[layerIndex];
    if (!layer) return;
    const rec = new StrokeRecorder(layer.id);
    for (let index = 0; index < selectionRef.current.length; index++) {
      if (selectionRef.current[index] === 0) continue;
      const i = index * 4;
      const before: Rgba = [layer.pixels[i], layer.pixels[i + 1], layer.pixels[i + 2], layer.pixels[i + 3]];
      if (before[3] === 0) continue;
      layer.pixels[i] = 0;
      layer.pixels[i + 1] = 0;
      layer.pixels[i + 2] = 0;
      layer.pixels[i + 3] = 0;
      rec.touch(index, before, TRANSPARENT);
    }
    const entry = rec.entry();
    if (!entry) return;
    historyRef.current.push(entry);
    syncLayerCanvas(layerIndex);
    draw();
    commit();
    refresh();
  };

  // ---------- 移动选中像素（预览阶段不修改文档） ----------
  const createMoveSession = (): MoveSession | null => {
    if (!selectionActive) return null;
    const layer = doc.layers[layerIndex];
    if (!layer) return null;
    const beforePixels = layer.pixels.slice();
    const session: MoveSession = {
      layerId: layer.id,
      beforePixels,
      mask: selectionRef.current.slice(),
      previewCanvas: pixelsToCanvas(beforePixels, doc.width, doc.height),
      dx: 0,
      dy: 0,
      clippedOpaque: 0,
    };
    moveSessionRef.current = session;
    draw();
    renderOverlay();
    refresh();
    return session;
  };

  const updateMoveOffset = (dx: number, dy: number) => {
    const session = moveSessionRef.current;
    if (!session) return;
    session.dx = Math.round(dx);
    session.dy = Math.round(dy);
    const result = movePixelsBySelection(
      session.beforePixels,
      session.mask,
      doc.width,
      doc.height,
      session.dx,
      session.dy,
    );
    session.clippedOpaque = result.clippedOpaque;
    const ctx = session.previewCanvas.getContext("2d");
    ctx?.putImageData(new ImageData(result.pixels.slice(), doc.width, doc.height), 0, 0);
    draw();
    renderOverlay();
    refresh();
  };

  const cancelMove = useCallback(() => {
    if (!moveSessionRef.current) return;
    moveSessionRef.current = null;
    draw();
    renderOverlay();
    refresh();
  }, [draw, renderOverlay]);

  const placeMove = useCallback(() => {
    const session = moveSessionRef.current;
    if (!session) return;
    const index = doc.layers.findIndex((layer) => layer.id === session.layerId);
    const layer = doc.layers[index];
    if (!layer) {
      moveSessionRef.current = null;
      renderOverlay();
      refresh();
      return;
    }
    const result = movePixelsBySelection(
      session.beforePixels,
      session.mask,
      doc.width,
      doc.height,
      session.dx,
      session.dy,
    );
    const rec = new StrokeRecorder(layer.id);
    for (let pixel = 0; pixel < result.pixels.length / 4; pixel++) {
      const i = pixel * 4;
      const before: Rgba = [session.beforePixels[i], session.beforePixels[i + 1], session.beforePixels[i + 2], session.beforePixels[i + 3]];
      const after: Rgba = [result.pixels[i], result.pixels[i + 1], result.pixels[i + 2], result.pixels[i + 3]];
      if (before[0] === after[0] && before[1] === after[1] && before[2] === after[2] && before[3] === after[3]) continue;
      rec.touch(pixel, before, after);
    }
    const entry = rec.entry();
    if (entry?.kind === "pixels") {
      historyRef.current.push({
        ...entry,
        selectionBefore: session.mask.slice(),
        selectionAfter: result.mask.slice(),
      });
    } else if (!selectionMasksEqual(session.mask, result.mask)) {
      historyRef.current.push({ kind: "selection", before: session.mask.slice(), after: result.mask.slice() });
    }
    layer.pixels.set(result.pixels);
    selectionRef.current = result.mask;
    moveSessionRef.current = null;
    syncLayerCanvas(index);
    draw();
    renderOverlay();
    if (entry) setDoc({ ...doc, layers: [...doc.layers] });
    if (result.clippedOpaque > 0) onNotice?.(t("moveClippedNotice", { count: result.clippedOpaque }));
    refresh();
  }, [doc, draw, onNotice, renderOverlay, setDoc, syncLayerCanvas, t]);

  const nudgeMove = (dx: number, dy: number) => {
    const session = moveSessionRef.current ?? createMoveSession();
    if (!session) {
      onNotice?.(t("moveNeedsSelection"));
      return;
    }
    updateMoveOffset(session.dx + dx, session.dy + dy);
  };

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

  const beginPinchNavigation = () => {
    const points = [...activePointersRef.current.values()];
    const stage = canvasStageRef.current;
    if (points.length < 2 || !stage) return;
    const [a, b] = points;
    pinchRef.current = {
      distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      centerX: (a.x + b.x) / 2,
      centerY: (a.y + b.y) / 2,
      scrollLeft: stage.scrollLeft,
      scrollTop: stage.scrollTop,
      zoomIndex: Math.max(0, ZOOMS.indexOf(zoomRef.current)),
    };
    navigationRef.current = true;

    if (drag.current.drawing) {
      const activeTool = drag.current.tool;
      drag.current.drawing = false;
      if (activeTool === "pencil" || activeTool === "eraser") {
        const entry = recorderRef.current?.entry() ?? null;
        recorderRef.current = null;
        if (entry) historyRef.current.push(entry);
        commit();
      } else if (activeTool === "select") {
        cancelSelectionGesture();
      } else if (activeTool === "line") {
        recorderRef.current = null;
        renderOverlay();
      } else if (activeTool === "move") {
        updateMoveOffset(drag.current.moveStartDx, drag.current.moveStartDy);
      }
      refresh();
    }
  };

  const updatePinchNavigation = () => {
    const points = [...activePointersRef.current.values()];
    const pinch = pinchRef.current;
    const stage = canvasStageRef.current;
    if (points.length < 2 || !pinch || !stage) return;
    const [a, b] = points;
    const centerX = (a.x + b.x) / 2;
    const centerY = (a.y + b.y) / 2;
    stage.scrollLeft = pinch.scrollLeft - (centerX - pinch.centerX);
    stage.scrollTop = pinch.scrollTop - (centerY - pinch.centerY);
    const ratio = Math.max(0.25, Math.min(4, Math.hypot(b.x - a.x, b.y - a.y) / pinch.distance));
    const nextIndex = Math.max(0, Math.min(ZOOMS.length - 1, pinch.zoomIndex + Math.round(Math.log2(ratio))));
    const nextZoom = ZOOMS[nextIndex];
    if (nextZoom !== zoomRef.current) setZoom(nextZoom);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* 指针捕获失败不阻断绘制（如合成事件/部分浏览器） */
    }
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointersRef.current.size >= 2) {
      beginPinchNavigation();
      return;
    }
    if (navigationRef.current) return;
    const [x, y] = toPixel(e);

    // 调色板选色面板可临时取色；工具栏吸管则保持为当前工具。
    if (tool === "picker" || (canvasColorPickArmed && e.pointerType !== "touch")) {
      const img = composite(doc);
      const [r, g, b, a] = getPixel(img, doc.width, x, y);
      if (a === 0) {
        onNotice?.(t("transparentPixel"));
      } else {
        updateChosenColor(rgbToHex(r, g, b));
      }
      return;
    }

    if (moveSessionRef.current && tool !== "move") {
      onNotice?.(t("moveFinishFirst"));
      return;
    }

    drag.current = {
      drawing: true,
      tool,
      x,
      y,
      lastX: x,
      lastY: y,
      moveStartDx: moveSessionRef.current?.dx ?? 0,
      moveStartDy: moveSessionRef.current?.dy ?? 0,
    };

    if (tool === "select") {
      beginSelectionGesture(x, y, e);
      return;
    }

    if (tool === "move") {
      const session = moveSessionRef.current ?? createMoveSession();
      if (!session) {
        drag.current.drawing = false;
        onNotice?.(t("moveNeedsSelection"));
        return;
      }
      drag.current.moveStartDx = session.dx;
      drag.current.moveStartDy = session.dy;
      return;
    }

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

    // 铅笔/橡皮/直线：开始记录本次笔画（增量撤销，不整幅快照）
    recorderRef.current = new StrokeRecorder(doc.layers[layerIndex].id);
    if (tool === "pencil" || tool === "eraser") {
      applyPoints(expand([[x, y]]), tool === "eraser" ? TRANSPARENT : currentRgba());
      syncLayerCanvas(layerIndex);
      draw();
      refresh();
    } else {
      showPreview(shapePoints(x, y, x, y), false);
      refresh();
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (navigationRef.current) {
      updatePinchNavigation();
      return;
    }
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
    } else if (t === "line") {
      showPreview(shapePoints(drag.current.x, drag.current.y, x, y), false);
    } else if (t === "select") {
      updateSelectionGesture(x, y);
    } else if (t === "move") {
      let dx = drag.current.moveStartDx + x - drag.current.x;
      let dy = drag.current.moveStartDy + y - drag.current.y;
      if (e.shiftKey) {
        if (Math.abs(dx - drag.current.moveStartDx) >= Math.abs(dy - drag.current.moveStartDy)) dy = drag.current.moveStartDy;
        else dx = drag.current.moveStartDx;
      }
      updateMoveOffset(dx, dy);
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
    activePointersRef.current.delete(e.pointerId);
    if (navigationRef.current) {
      if (activePointersRef.current.size === 0) {
        navigationRef.current = false;
        pinchRef.current = null;
      } else if (activePointersRef.current.size >= 2) {
        beginPinchNavigation();
      }
      return;
    }
    if (!drag.current.drawing) return;
    drag.current.drawing = false;
    const [x, y] = toPixel(e);
    const t = drag.current.tool;

    if (t === "select") {
      updateSelectionGesture(x, y);
      finishSelectionGesture();
      return;
    }
    if (t === "move") {
      refresh();
      return;
    }
    if (t === "line") {
      applyPoints(shapePoints(drag.current.x, drag.current.y, x, y), currentRgba());
      renderOverlay();
      syncLayerCanvas(layerIndex);
      draw();
    }
    finalizeStroke();
    commit();
    refresh();
  };

  // 指针取消：直线还没落笔则丢弃；铅笔/橡皮保留已画部分
  const onPointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.delete(e.pointerId);
    if (navigationRef.current) {
      if (activePointersRef.current.size === 0) { navigationRef.current = false; pinchRef.current = null; }
      return;
    }
    if (!drag.current.drawing) return;
    const t = drag.current.tool;
    drag.current.drawing = false;
    if (t === "select") {
      cancelSelectionGesture();
      return;
    }
    if (t === "move") {
      refresh();
      return;
    }
    renderOverlay();
    if (t === "line") {
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
    if (moveSessionRef.current) {
      cancelMove();
      return;
    }
    const entry = historyRef.current.popUndo();
    if (!entry) return;
    if (entry.kind === "pixels") {
      applyPixelChanges(doc, entry.layerId, entry.changes, "before");
      if (entry.selectionBefore) selectionRef.current = entry.selectionBefore.slice();
      historyRef.current.pushRedo(entry);
      const idx = doc.layers.findIndex((l) => l.id === entry.layerId);
      if (idx >= 0) syncLayerCanvas(idx);
      draw();
      setDoc({ ...doc, layers: [...doc.layers] });
    } else if (entry.kind === "selection") {
      selectionRef.current = entry.before.slice();
      historyRef.current.pushRedo(entry);
      renderOverlay();
    } else {
      historyRef.current.pushRedo({ kind: "doc", doc: cloneDoc(doc) });
      rebuildLayerCanvases(entry.doc);
      setDoc(entry.doc); // draw effect 会随渲染刷新
    }
    setActiveLayer((i) => Math.min(i, doc.layers.length - 1));
    refresh();
  }, [cancelMove, doc, setDoc, syncLayerCanvas, draw, rebuildLayerCanvases, renderOverlay]);

  const redo = useCallback(() => {
    if (moveSessionRef.current) return;
    const entry = historyRef.current.popRedo();
    if (!entry) return;
    if (entry.kind === "pixels") {
      applyPixelChanges(doc, entry.layerId, entry.changes, "after");
      if (entry.selectionAfter) selectionRef.current = entry.selectionAfter.slice();
      historyRef.current.restore(entry);
      const idx = doc.layers.findIndex((l) => l.id === entry.layerId);
      if (idx >= 0) syncLayerCanvas(idx);
      draw();
      setDoc({ ...doc, layers: [...doc.layers] });
    } else if (entry.kind === "selection") {
      selectionRef.current = entry.after.slice();
      historyRef.current.restore(entry);
      renderOverlay();
    } else {
      historyRef.current.restore({ kind: "doc", doc: cloneDoc(doc) });
      rebuildLayerCanvases(entry.doc);
      setDoc(entry.doc);
    }
    setActiveLayer((i) => Math.min(i, doc.layers.length - 1));
    refresh();
  }, [doc, setDoc, syncLayerCanvas, draw, rebuildLayerCanvases, renderOverlay]);

  // ---------- 图层（全部入历史） ----------
  const withHistory = (fn: () => void) => {
    historyRef.current.pushDoc(doc);
    fn();
    refresh();
  };

  const importImage = async (file: File) => {
    setImageImportBusy(true);
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file);
      if (bitmap.width > 512 || bitmap.height > 512) {
        onSendImageToPixelize?.(file);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("image canvas unavailable");
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bitmap, 0, 0);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const analysis = analyzePixelArt(image.data, image.width, image.height);
      if (!analysis.isPixelArt) {
        onSendImageToPixelize?.(file);
        return;
      }
      const next = docFromPixels(image.data, image.width, image.height, t("importedImageLayer"));
      if (onCanvasImport) onCanvasImport({ doc: next, source: "image", sourceName: file.name });
      else {
        withHistory(() => { setDoc(next); setActiveLayer(0); });
        onNotice?.(t("imageImported", { width: image.width, height: image.height }));
      }
    } catch (error) {
      console.error("[PixelPaint] image import failed:", error);
      onNotice?.(t("imageImportError"));
    } finally {
      bitmap?.close();
      setImageImportBusy(false);
    }
  };

  const addLayer = () => withHistory(() => {
    const layer: Layer = {
      id: uid(),
      name: t("layerName", { index: doc.layers.length + 1 }),
      visible: true,
      opacity: 1,
      pixels: new Uint8ClampedArray(doc.width * doc.height * 4),
    };
    setDoc({ ...doc, layers: [...doc.layers, layer] });
    setActiveLayer(doc.layers.length);
  });

  const removeLayer = async (i: number) => {
    if (doc.layers.length <= 1) {
      onNotice?.(t("atLeastOneLayer"));
      return;
    }
    const name = localizeLayerName(doc.layers[i]?.name ?? t("unnamedLayer"));
    if (!(await askConfirm(t("removeLayerConfirm", { name })))) return;
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

  const clearLayer = async () => {
    if (!(await askConfirm(t("clearLayerConfirm")))) return;
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

  const selectCanvasSizePreset = (value: SizePreset) => {
    setCanvasSizePreset(value);
    if (value === "custom") return;
    const size = Number(value);
    setSizeW(size);
    setSizeH(size);
  };

  const applyResize = async () => {
    const w = clampSize(sizeW);
    const h = clampSize(sizeH);
    const frames = animation?.frames ?? [doc];
    if (frames.every((frame) => frame.width === w && frame.height === h)) return;
    const shrinking = frames.some((frame) => w < frame.width || h < frame.height);
    if (shrinking) {
      const confirmKey = frames.length > 1 ? "resizeFramesConfirm" : "resizeConfirm";
      if (!(await askConfirm(t(confirmKey, {
        count: frames.length, fromW: doc.width, fromH: doc.height, toW: w, toH: h,
      })))) return;
    }
    if (animation) animation.onResizeFrames(w, h);
    else withHistory(() => setDoc(resizeDoc(doc, w, h)));
    onNotice?.(t(frames.length > 1 ? "resizedFrames" : "resized", { count: frames.length, width: w, height: h }));
  };

  const newCanvas = async () => {
    const w = clampSize(sizeW);
    const h = clampSize(sizeH);
    if (!(await askConfirm(t("newCanvasConfirm", { width: w, height: h })))) return;
    withHistory(() => {
      setDoc(createDoc(w, h, t("layerName", { index: 1 })));
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

  const exportGif = useCallback(() => {
    if (!animation || animation.frames.length < 2) {
      onNotice?.(t("gifNeedsFrames"));
      return;
    }
    try {
      const gif = encodeGif(
        animation.frames.map((frame) => ({
          width: frame.width,
          height: frame.height,
          pixels: composite(frame),
        })),
        animation.fps,
      );
      const blob = new Blob([
        gif.buffer.slice(gif.byteOffset, gif.byteOffset + gif.byteLength) as ArrayBuffer,
      ], { type: "image/gif" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pixelpaint-animation-${Math.max(...animation.frames.map((frame) => frame.width))}x${Math.max(...animation.frames.map((frame) => frame.height))}.gif`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      onNotice?.(t("gifExported", { count: animation.frames.length, fps: animation.fps }));
    } catch (error) {
      console.error("[PixelPaint] GIF export failed:", error);
      onNotice?.(t("gifExportError"));
    }
  }, [animation, onNotice, t]);

  const saveProject = useCallback(() => {
    onSaveProject?.();
  }, [onSaveProject]);

  const openProject = async (file: File) => {
    await onOpenProject?.(file);
  };

  const chooseTool = useCallback((next: Tool) => {
    if (moveSessionRef.current && next !== "move") {
      onNotice?.(t("moveFinishFirst"));
      return;
    }
    setColorPickerOpen(false);
    setCanvasColorPickArmed(false);
    setTool(next);
  }, [onNotice, t]);

  // ---------- 键盘快捷键 ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === "Escape" && canvasColorPickArmed) {
        e.preventDefault();
        setColorPickerOpen(false);
        setCanvasColorPickArmed(false);
        return;
      }
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); selectAllPixels(); return; }
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); clearSelection(); return; }
      if (mod && e.key.toLowerCase() === "i") { e.preventDefault(); invertSelection(); return; }

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
      if (hit) { chooseTool(hit.id); return; }
      if (e.key === "Enter" && moveSessionRef.current) { e.preventDefault(); placeMove(); return; }
      if (e.key === "Escape") {
        e.preventDefault();
        if (selectionGestureRef.current) cancelSelectionGesture();
        else if (moveSessionRef.current) cancelMove();
        else clearSelection();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectionActive) {
        e.preventDefault();
        deleteSelectedPixels();
        return;
      }
      if (tool === "move" && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 8 : 1;
        if (e.key === "ArrowLeft") nudgeMove(-step, 0);
        if (e.key === "ArrowRight") nudgeMove(step, 0);
        if (e.key === "ArrowUp") nudgeMove(0, -step);
        if (e.key === "ArrowDown") nudgeMove(0, step);
        return;
      }
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
  });

  const gridVisible = showGrid && zoom >= 4;
  const cell = zoom;
  const canvasChecker = checkerStyle(cell);
  const canUndo = historyRef.current.canUndo;
  const canRedo = historyRef.current.canRedo;
  const moveSession = moveSessionRef.current;
  const fitCanvas = useCallback(() => {
    const stage = canvasStageRef.current;
    if (!stage) return;
    const availableWidth = Math.max(1, stage.clientWidth - 28);
    const availableHeight = Math.max(1, stage.clientHeight - 28);
    const raw = Math.min(availableWidth / doc.width, availableHeight / doc.height);
    const next = [...ZOOMS].reverse().find((value) => value <= raw) ?? ZOOMS[0];
    setZoom(next);
    window.requestAnimationFrame(() => {
      stage.scrollLeft = Math.max(0, (doc.width * next - stage.clientWidth) / 2);
      stage.scrollTop = Math.max(0, (doc.height * next - stage.clientHeight) / 2);
    });
  }, [doc.height, doc.width]);
  const localizeLayerName = (name: string) => {
    const match = name.match(/^(?:图层|Layer)\s+(\d+)$/);
    return match ? t("layerName", { index: Number(match[1]) }) : name;
  };

  return (
    <>
    <div className="editor-layout">
      {/* 工具条 */}
      <aside className="card tool-panel" aria-label={t("drawingTools")}>
        <div className="tool-list">
          {TOOLS.map((toolItem) => (
            <button
              key={toolItem.id}
              type="button"
              className={`tool-btn ${tool === toolItem.id ? "active" : ""}`}
              onClick={() => chooseTool(toolItem.id)}
              title={`${t(toolItem.labelKey)} (${toolItem.key})`}
              aria-label={t(toolItem.labelKey)}
              aria-pressed={tool === toolItem.id}
            >
              <PixelIcon data={toolItem.icon} size={22} />
              <span>{t(toolItem.labelKey)}</span>
            </button>
          ))}
        </div>

        <div className="tool-divider" />
        {(["pencil", "eraser", "line"].includes(tool) || (tool === "select" && selectionShape === "paint")) && (
          <div className="tool-panel-field">
            <label className="field-label" htmlFor="brush-size">{tool === "select" ? t("selectionBrushSize") : t("brushSize")}</label>
            <select id="brush-size" className="num-input" style={{ width: "100%" }} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((s) => <option key={s} value={s}>{s} px</option>)}
            </select>
          </div>
        )}
        <div className="tool-panel-field">
          <label className="field-label" htmlFor="zoom-level">{t("canvasZoom")}</label>
          <select id="zoom-level" className="num-input" style={{ width: "100%" }} value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
            {ZOOMS.map((z) => <option key={z} value={z}>{z}×</option>)}
          </select>
        </div>
      </aside>

      {/* 画布 */}
      <section className="card canvas-card">
        <div className="canvas-head">
          <span className="canvas-info">
            {doc.width} × {doc.height} · {t("layerPosition", { index: layerIndex + 1, count: doc.layers.length })}
          </span>
          <div className="canvas-actions">
            <label className="ghost-check">
              <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
              {t("canvasGrid")}
            </label>
            <button type="button" className="btn-ghost icon-btn" onClick={undo} disabled={!canUndo} title={`${t("undo")} (Ctrl+Z)`} aria-label={t("undo")}>
              <PixelIcon data={Undo} size={16} />
            </button>
            <button type="button" className="btn-ghost icon-btn" onClick={redo} disabled={!canRedo} title={`${t("redo")} (Ctrl+Shift+Z)`} aria-label={t("redo")}>
              <PixelIcon data={Redo} size={16} />
            </button>
          </div>
        </div>
        {(tool === "select" || tool === "move" || selectionActive) && (
          <div className="selection-context" role="toolbar" aria-label={t("selectionActions")}>
            {tool === "select" && (
              <>
                <div className="selection-segment" role="group" aria-label={t("selectionMethod")}>
                  <button type="button" className={selectionShape === "rectangle" ? "active" : ""} onClick={() => setSelectionShape("rectangle")} aria-pressed={selectionShape === "rectangle"}>{t("selectionRectangle")}</button>
                  <button type="button" className={selectionShape === "paint" ? "active" : ""} onClick={() => setSelectionShape("paint")} aria-pressed={selectionShape === "paint"}>{t("selectionPaint")}</button>
                </div>
                <div className="selection-segment selection-mode-segment" role="group" aria-label={t("selectionCombineMode")}>
                  {(["replace", "add", "subtract", "intersect"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={selectionMode === mode ? "active" : ""}
                      onClick={() => setSelectionMode(mode)}
                      aria-pressed={selectionMode === mode}
                      title={t(`selectionMode${mode[0].toUpperCase()}${mode.slice(1)}`)}
                    >
                      <span className="selection-mode-icon" aria-hidden="true">{mode === "replace" ? "□" : mode === "add" ? "+" : mode === "subtract" ? "−" : "∩"}</span>
                      <span className="selection-mode-label">{t(`selectionMode${mode[0].toUpperCase()}${mode.slice(1)}Short`)}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <span className="selection-count">{t("selectionCount", { count: selectionCount })}</span>
            {tool === "move" && (
              moveSession ? (
                <div className="move-session-actions">
                  <span className="move-offset">{t("moveOffset", { x: moveSession.dx, y: moveSession.dy })}</span>
                  {moveSession.clippedOpaque > 0 && <span className="move-clipped">{t("moveClipped", { count: moveSession.clippedOpaque })}</span>}
                  <button type="button" className="btn-primary" onClick={placeMove}>{t("movePlace")}</button>
                  <button type="button" className="btn-ghost" onClick={cancelMove}>{t("moveCancel")}</button>
                </div>
              ) : (
                <div className="move-ready-actions">
                  <span className="selection-context-hint">{selectionActive ? t("moveReadyHint") : t("moveNeedsSelection")}</span>
                  <button type="button" className="mini-btn" onClick={clearSelection} disabled={!selectionActive}>{t("selectionClear")}</button>
                </div>
              )
            )}
            {tool !== "move" && (
              <div className="selection-quick-actions">
                <button type="button" className="mini-btn" onClick={selectAllPixels}>{t("selectionAll")}</button>
                <button type="button" className="mini-btn" onClick={invertSelection}>{t("selectionInvert")}</button>
                <button type="button" className="mini-btn" onClick={deleteSelectedPixels} disabled={!selectionActive}>{t("selectionDeletePixels")}</button>
                <button type="button" className="mini-btn" onClick={clearSelection} disabled={!selectionActive}>{t("selectionClear")}</button>
              </div>
            )}
          </div>
        )}
        <div ref={canvasStageRef} className="canvas-stage">
          <div
            className="canvas-wrap checker"
            style={{ width: doc.width * cell, height: doc.height * cell, ...canvasChecker }}
          >
            <canvas
              ref={canvasRef}
              className={`pixelated canvas-input canvas-tool-${tool} ${canvasColorPickArmed ? "canvas-color-pick-active" : ""}`}
              style={{ width: doc.width * cell, height: doc.height * cell, touchAction: "none" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              aria-label={t("pixelCanvas", { width: doc.width, height: doc.height })}
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
        <p className="shortcut-hint">{t("shortcutHint")}</p>

        {animation && (
          <div className={`frame-strip ${framesExpanded ? "expanded" : "collapsed"}`} aria-label={t("frameAnimation")}>
            <div className="frame-strip-head">
              <div>
                <strong>{t("frameAnimation")}</strong>
                <span>{animation.frames.length === 1 ? t("oneFrame") : t("frameCount", { count: animation.frames.length })}</span>
              </div>
              {framesExpanded ? (
                <button type="button" className="mini-btn frame-collapse" onClick={() => setFramesExpanded(false)}>{t("collapse")}</button>
              ) : (
                <button
                  type="button"
                  className="btn-ghost frame-expand-action"
                  onClick={() => animation.frames.length === 1 ? animation.onFrameDuplicate() : setFramesExpanded(true)}
                >{animation.frames.length === 1 ? t("makeAnimation") : t("expand")}</button>
              )}
            </div>
            {framesExpanded && <>
            <div className="frame-controls">
              <button
                type="button"
                className="btn-ghost icon-btn"
                onClick={animation.onTogglePlay}
                aria-label={animation.playing ? t("pausePreview") : t("playPreview")}
                title={animation.playing ? t("pausePreview") : t("playPreviewSpace")}
              >
                {animation.playing ? "⏸" : "▶"}
              </button>
              <label className="ghost-check">
                <input type="checkbox" checked={animation.onion} onChange={animation.onToggleOnion} />
                {t("onionSkin")}
              </label>
              <label className="ghost-check" title={t("showNextFrameHint")}>
                <input type="checkbox" checked={animation.onionNext} onChange={animation.onToggleOnionNext} />
                {t("showNextFrame")}
              </label>
              <label className="fps-label">
                <span>{t("frameRate")}</span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={animation.fps}
                  onChange={(e) => animation.onFpsChange(Number(e.target.value))}
                  className="num-input"
                  style={{ width: 54 }}
                  aria-label={t("frameRate")}
                />
              </label>
            </div>
            <div className="frame-create-actions">
              <button type="button" className="btn-ghost" onClick={animation.onFrameDuplicate}>{t("duplicateFrame")}</button>
              <button type="button" className="btn-ghost" onClick={animation.onFrameAddBlank}>{t("newBlankFrame")}</button>
            </div>
            <div className="frame-list">
              {animation.frames.map((f, i) => (
                <FrameThumb
                  key={`${f.layers[0]?.id ?? "frame"}-${i}`}
                  frame={f}
                  index={i}
                  active={i === animation.frameIndex}
                  onClick={() => animation.onFrameSelect(i)}
                />
              ))}
              <div ref={frameMenuRef} className="frame-ops frame-menu-wrap">
                <button type="button" className="frame-op" onClick={() => setFrameMenuOpen((open) => !open)} aria-expanded={frameMenuOpen} aria-label={t("frameActions")}>•••</button>
                {frameMenuOpen && (
                  <div className="frame-menu" role="menu">
                    <strong>{t("frameTitle", { index: animation.frameIndex + 1 })}</strong>
                    <button type="button" role="menuitem" disabled={animation.frameIndex === 0} onClick={() => { animation.onFrameShift(-1); setFrameMenuOpen(false); }}>{t("moveLeft")}</button>
                    <button type="button" role="menuitem" disabled={animation.frameIndex === animation.frames.length - 1} onClick={() => { animation.onFrameShift(1); setFrameMenuOpen(false); }}>{t("moveRight")}</button>
                    <button type="button" role="menuitem" className="danger" onClick={() => { void animation.onFrameDelete(); setFrameMenuOpen(false); }}>{t("deleteFrame")}</button>
                  </div>
                )}
              </div>
            </div>
            <p className="frame-gif-hint">{animation.frames.length < 2 ? t("gifNeedsFrames") : t("frameGifReady")}</p>
            </>}
          </div>
        )}
      </section>

      {/* 右侧面板 */}
      <aside className="side-panels">
        <div className="card palette-card">
          <div className="panel-head">
            <h2 className="card-title">{t("palette")}</h2>
            <div className="palette-head-actions">
              <button type="button" className="mini-btn" onClick={addCustomPalette} title={t("paletteNew")} aria-label={t("paletteNew")}>＋</button>
              <span className="palette-import-trigger" title={!paletteEditable ? t("paletteImportDisabled") : t("paletteImportColors")}>
                <button
                  ref={paletteImportButtonRef}
                  type="button"
                  className="mini-btn"
                  onClick={openPaletteImport}
                  disabled={!paletteEditable}
                  aria-label={t("paletteImportColors")}
                >⇩</button>
              </span>
            </div>
          </div>
          <label className="field-label" htmlFor="palette-select">{t("paletteCurrent")}</label>
          <select
            id="palette-select"
            className="num-input"
            style={{ width: "100%", marginBottom: 10 }}
            value={palette.id}
            onChange={(e) => selectPalette(e.target.value)}
          >
            <optgroup label={t("paletteMy") }>
              {customPalettes.map((item) => <option key={item.id} value={item.id}>{displayPaletteName(item)}</option>)}
            </optgroup>
            <optgroup label={t("paletteBuiltIn") }>
              {BUILTIN_PALETTES.map((item) => <option key={item.id} value={item.id}>{item.name === "灰度" ? t("paletteGrayscale") : item.name}</option>)}
            </optgroup>
          </select>
          {paletteRenaming ? (
            <div className="palette-rename-row">
              <label className="sr-only" htmlFor="palette-name">{t("paletteName")}</label>
              <input
                ref={paletteNameInputRef}
                id="palette-name"
                className="text-input"
                value={paletteName}
                onChange={(e) => setPaletteName(e.target.value)}
                onBlur={renameCustomPalette}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); renameCustomPalette(); }
                  if (e.key === "Escape") { e.preventDefault(); setPaletteName(paletteDisplayName); setRenamingPaletteId(null); }
                }}
                aria-label={t("paletteName")}
              />
            </div>
          ) : (
            <div className="palette-status-row">
              <span className="field-hint">{paletteEditable
                ? t("paletteCustomStatus", { count: palette.colors.length })
                : t("paletteBuiltinStatus", { count: palette.colors.length })}</span>
              {paletteEditable ? (
                <div ref={paletteManageRef} className="palette-manage">
                  <button type="button" className="mini-btn palette-manage-trigger" onClick={() => setPaletteManageOpen((open) => !open)} aria-label={t("paletteManage")} aria-expanded={paletteManageOpen}>•••</button>
                  {paletteManageOpen && (
                    <div className="palette-manage-menu" role="menu">
                      <button type="button" role="menuitem" onClick={() => { setPaletteManageOpen(false); setPaletteName(paletteDisplayName); setRenamingPaletteId(palette.id); }}>{t("paletteRename")}</button>
                      <button type="button" role="menuitem" className="danger" onClick={() => void deleteCustomPalette()}>{t("paletteDelete")}</button>
                    </div>
                  )}
                </div>
              ) : (
                <button type="button" className="btn-ghost palette-copy-btn" onClick={copyPaletteToCustom}>{t("paletteCopyToCustom")}</button>
              )}
            </div>
          )}
          <div
            ref={paletteGridRef}
            className={`palette-grid ${draggedColorIndex !== null ? "is-dragging" : ""}`}
          >
            {palette.colors.length === 0 && <p className="palette-empty">{t("paletteEmpty")}</p>}
            {palette.colors.map((c, index) => (
              <div
                key={`${c}-${index}`}
                data-palette-index={index}
                className={`palette-swatch-item ${draggedColorIndex === index ? "is-dragging" : ""} ${dragOverColorIndex === index && draggedColorIndex !== index ? `drop-${dragOverPosition}` : ""} ${recentlyAddedColor === c ? "is-new" : ""}`}
              >
                <button
                  type="button"
                  className={`swatch ${color.toLowerCase() === c.toLowerCase() ? "active" : ""}`}
                  style={{ background: c }}
                  onClick={(e) => {
                    if (suppressPaletteClickRef.current) { e.preventDefault(); return; }
                    setColor(c); setColorText(c);
                  }}
                  onPointerDown={(e) => beginPalettePointer(e, index)}
                  onPointerMove={movePalettePointer}
                  onPointerUp={endPalettePointer}
                  onPointerCancel={endPalettePointer}
                  onKeyDown={(e) => {
                    if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
                    e.preventDefault();
                    movePaletteColorByKeyboard(index, e.key === "ArrowLeft" ? -1 : 1);
                  }}
                  title={c}
                  aria-label={t("color", { value: c })}
                />
                {paletteEditable && (
                  <button type="button" className="palette-swatch-remove" onClick={() => removePaletteColor(index)} title={t("removeColor")} aria-label={`${t("removeColor")} ${c}`}>×</button>
                )}
              </div>
            ))}
          </div>
          <div className="color-row palette-color-add-row">
            <div
              className="palette-color-picker-wrap"
              onPointerEnter={cancelColorPickerClose}
              onPointerLeave={scheduleColorPickerClose}
            >
              <button
                type="button"
                className="palette-color-picker palette-color-picker-trigger"
                style={{ backgroundColor: color }}
                onClick={() => {
                  if (colorPickerOpen) {
                    setColorPickerOpen(false);
                    setCanvasColorPickArmed(false);
                  } else {
                    armCanvasColorPick();
                  }
                }}
                aria-label={t("chooseColor")}
                aria-haspopup="dialog"
                aria-expanded={colorPickerOpen}
              />
              {colorPickerOpen && (() => {
                const hsv = hsvFromHex(color);
                return (
                  <div className="palette-color-popover" role="dialog" aria-label={t("chooseColor")}>
                    <div
                      className="palette-color-sv"
                      style={{ backgroundColor: `hsl(${colorPickerHue} 100% 50%)` }}
                      onPointerDown={updatePickerSaturationValue}
                      onPointerMove={updatePickerSaturationValue}
                      aria-label={t("colorSaturationBrightness")}
                    >
                      <span className="palette-color-sv-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
                    </div>
                    <div className="palette-color-hue-row">
                      <span className="palette-color-preview" style={{ backgroundColor: color }} aria-hidden="true" />
                      <input
                        type="range"
                        className="palette-color-hue"
                        min={0}
                        max={359}
                        value={Math.round(colorPickerHue)}
                        style={{ color: `hsl(${colorPickerHue} 100% 50%)` }}
                        onChange={(event) => updatePickerHue(Number(event.target.value))}
                        aria-label={t("colorHue")}
                      />
                    </div>
                  </div>
                );
              })()}
            </div>
            <input
              className="text-input palette-hex-input"
              value={colorText}
              onChange={(e) => {
                setColorText(e.target.value);
                const rgb = parseHex(e.target.value);
                if (rgb) setColor(rgbToHex(rgb[0], rgb[1], rgb[2]));
              }}
              onBlur={() => setColorText(color)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCurrentColor(); } }}
              aria-label={t("colorHex")}
              aria-invalid={parseHex(colorText) === null}
              spellCheck={false}
            />
            <button
              type="button"
              className="btn-primary palette-add-color-btn"
              onClick={addCurrentColor}
              disabled={!canAddCurrentColor}
              title={!paletteEditable ? t("paletteReadonly") : currentColorExists ? t("paletteColorExists") : undefined}
            >{currentColorExists ? t("paletteColorExists") : t("paletteAddColor")}</button>
          </div>
          <div className="palette-export-actions">
            <span className="field-hint">{t("paletteExport")}</span>
            <button type="button" className="mini-btn" onClick={() => downloadPaletteText("json")} title={t("paletteExportJson")}>{t("paletteExportJson")}</button>
            <button type="button" className="mini-btn" onClick={() => downloadPaletteText("gpl")} title={t("paletteExportGpl")}>{t("paletteExportGpl")}</button>
          </div>
          {parseHex(colorText) === null && (
            <p style={{ fontSize: 12, color: "var(--amber)", marginTop: 6 }}>
              {t("invalidHex", { value: color })}
            </p>
          )}
        </div>

        <div className="card layers-card">
          <div className="panel-head">
            <h2 className="card-title">{t("layers")}</h2>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="btn-ghost" onClick={() => void clearLayer()}>{t("clear")}</button>
              <button type="button" className="btn-ghost" onClick={addLayer}>{t("newLayer")}</button>
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
                  title={l.visible ? t("hideLayer") : t("showLayer")}
                  aria-label={l.visible ? `${t("hideLayer")} ${localizeLayerName(l.name)}` : `${t("showLayer")} ${localizeLayerName(l.name)}`}
                >
                  {l.visible ? "◉" : "○"}
                </button>
                <span className="layer-name">{localizeLayerName(l.name)}</span>
                <input
                  type="range" min={0} max={100} value={Math.round(l.opacity * 100)}
                  onChange={(e) => setLayerOpacity(i, Number(e.target.value) / 100)}
                  onClick={(e) => e.stopPropagation()}
                  title={t("opacity", { value: Math.round(l.opacity * 100) })}
                  aria-label={`${localizeLayerName(l.name)} ${t("opacity", { value: Math.round(l.opacity * 100) })}`}
                />
                <div className="layer-actions">
                  <button type="button" className="mini-btn" onClick={(e) => { e.stopPropagation(); moveLayer(i, 1); }} title={t("moveUp")} aria-label={t("moveUp")}>↑</button>
                  <button type="button" className="mini-btn" onClick={(e) => { e.stopPropagation(); moveLayer(i, -1); }} title={t("moveDown")} aria-label={t("moveDown")}>↓</button>
                  <button type="button" className="mini-btn danger icon-btn" onClick={(e) => { e.stopPropagation(); void removeLayer(i); }} title={t("removeLayer")} aria-label={`${t("removeLayer")} ${localizeLayerName(l.name)}`}>
                    <PixelIcon data={Trash} size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card canvas-tools-card">
          <div className="canvas-size-head">
            <h2 className="card-title">{t("canvasSize")}</h2>
            <span className="field-hint">{t("canvasCurrentSize", { width: doc.width, height: doc.height })}</span>
          </div>
          <label className="sr-only" htmlFor="canvas-size-preset">{t("canvasSizePreset")}</label>
          <select
            id="canvas-size-preset"
            className="num-input canvas-size-preset"
            value={canvasSizePreset}
            onChange={(e) => selectCanvasSizePreset(e.target.value as SizePreset)}
          >
            {SIZE_PRESET_VALUES.map((value) => <option key={value} value={value}>{value} × {value}</option>)}
            <option value="custom">{t("custom")}</option>
          </select>
          {canvasSizePreset === "custom" && (
            <div className="size-row canvas-custom-size-row">
              <label className="sr-only" htmlFor="canvas-w">{t("width")}</label>
              <input id="canvas-w" className="num-input" type="number" min={1} max={512} value={sizeW}
                onChange={(e) => setSizeW(clampSize(Number(e.target.value)))} />
              <span aria-hidden="true">×</span>
              <label className="sr-only" htmlFor="canvas-h">{t("height")}</label>
              <input id="canvas-h" className="num-input" type="number" min={1} max={512} value={sizeH}
                onChange={(e) => setSizeH(clampSize(Number(e.target.value)))} />
            </div>
          )}
          <div className="size-row canvas-resize-actions">
            <button type="button" className="btn-ghost" style={{ flex: 1 }} onClick={() => void applyResize()} disabled={(animation?.frames ?? [doc]).every((frame) => frame.width === sizeW && frame.height === sizeH)}>{t("resizeKeepContent")}</button>
            <button type="button" className="btn-ghost" style={{ flex: 1 }} onClick={() => void newCanvas()}>{t("newBlankCanvas")}</button>
          </div>

          <div className="tool-divider" />
          <h2 className="card-title">{t("exportAndProject")}</h2>
          <div className="size-row export-actions">
            <label className="field-label" style={{ margin: 0 }} htmlFor="export-scale">{t("upscale")}</label>
            <select id="export-scale" className="num-input" style={{ flex: 1 }} value={exportScale} onChange={(e) => setExportScale(Number(e.target.value))}>
              {[1, 2, 4, 8, 16].map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </div>
          <div className="size-row export-actions">
            <button type="button" className="btn-primary" style={{ flex: 1 }} onClick={exportPng}>{t("exportPng")}</button>
            <button
              type="button"
              className="btn-ghost"
              style={{ flex: 1 }}
              onClick={exportGif}
              disabled={!animation || animation.frames.length < 2}
              title={animation && animation.frames.length >= 2 ? t("exportGif") : t("gifNeedsFrames")}
            >
              {t("exportGif")}
            </button>
          </div>
          <div className="size-row import-actions">
            <button type="button" className="btn-ghost icon-text-btn" style={{ flex: 1 }} onClick={() => imageInputRef.current?.click()} disabled={imageImportBusy}>
              <PixelIcon data={Upload} size={14} /> {imageImportBusy ? t("importingImage") : t("importImage")}
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importImage(f);
                e.target.value = "";
              }}
            />
          </div>
          <div className="size-row project-actions">
            <button type="button" className="btn-ghost icon-text-btn" style={{ flex: 1 }} onClick={saveProject}>
              <PixelIcon data={Download} size={14} /> {t("saveProject")}
            </button>
            <button type="button" className="btn-ghost icon-text-btn" style={{ flex: 1 }} onClick={() => projectInputRef.current?.click()}>
              <PixelIcon data={Upload} size={14} /> {t("openProject")}
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
          <p className="project-hint" style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
            {t("projectHint")}
          </p>
        </div>
      </aside>
    </div>
    <nav className="mobile-editor-dock" aria-label={t("drawingTools")}>
      <button type="button" className="dock-tool" onClick={() => setMobileDrawer("tools")}>
        <PixelIcon data={TOOLS.find((item) => item.id === tool)?.icon ?? Pencil} size={22} />
        <span>{t(TOOLS.find((item) => item.id === tool)?.labelKey ?? "pencil")}</span>
      </button>
      <button type="button" className="dock-color" style={{ background: color }} onClick={() => setMobileDrawer("palette")} aria-label={t("palette")} />
      <div className="dock-recent-colors" aria-label={t("recentColors")}>
        {recentColors.map((value) => (
          <button key={value} type="button" style={{ background: value }} onClick={() => { setColor(value); setColorText(value); }} aria-label={t("color", { value })} />
        ))}
      </div>
      <button type="button" className="dock-icon" onClick={undo} disabled={!canUndo} aria-label={t("undo")}><PixelIcon data={Undo} size={19} /></button>
      <button type="button" className="dock-icon" onClick={redo} disabled={!canRedo} aria-label={t("redo")}><PixelIcon data={Redo} size={19} /></button>
    </nav>

    {mobileDrawer && (
      <div className="mobile-drawer-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMobileDrawer(null); }}>
        <section ref={mobileDrawerRef} className="mobile-editor-drawer" role="dialog" aria-modal="true" aria-labelledby="mobile-drawer-title">
          <div className="mobile-drawer-head">
            <h2 id="mobile-drawer-title">{mobileDrawer === "tools" ? t("drawingTools") : t("palette")}</h2>
            <button type="button" className="mini-btn" onClick={() => setMobileDrawer(null)} aria-label={t("cancel")}>✕</button>
          </div>
          {mobileDrawer === "tools" ? (
            <>
              <div className="mobile-tool-grid">
                {TOOLS.map((item) => (
                  <button key={item.id} type="button" className={`tool-btn ${tool === item.id ? "active" : ""}`} onClick={() => { chooseTool(item.id); setMobileDrawer(null); }} aria-pressed={tool === item.id}>
                    <PixelIcon data={item.icon} size={24} /><span>{t(item.labelKey)}</span>
                  </button>
                ))}
              </div>
              <div className="mobile-drawer-settings">
                <label>{t("brushSize")}<select className="num-input" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))}>{[1, 2, 3, 4, 5].map((size) => <option key={size} value={size}>{size} px</option>)}</select></label>
                <label>{t("canvasZoom")}<select className="num-input" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>{ZOOMS.map((value) => <option key={value} value={value}>{value}×</option>)}</select></label>
                <button type="button" className="btn-ghost" onClick={() => { fitCanvas(); setMobileDrawer(null); }}>{t("fitToScreen")}</button>
              </div>
            </>
          ) : (
            <>
              <select className="num-input mobile-palette-select" value={palette.id} onChange={(e) => selectPalette(e.target.value)} aria-label={t("paletteCurrent")}>
                <optgroup label={t("paletteMy")}>{customPalettes.map((item) => <option key={item.id} value={item.id}>{displayPaletteName(item)}</option>)}</optgroup>
                <optgroup label={t("paletteBuiltIn")}>{BUILTIN_PALETTES.map((item) => <option key={item.id} value={item.id}>{item.name === "灰度" ? t("paletteGrayscale") : item.name}</option>)}</optgroup>
              </select>
              <div className={`palette-grid mobile-palette-grid ${draggedColorIndex !== null ? "is-dragging" : ""}`}>
                {palette.colors.map((value, index) => (
                  <div key={`${value}-${index}`} data-palette-index={index} className={`palette-swatch-item ${draggedColorIndex === index ? "is-dragging" : ""} ${dragOverColorIndex === index && draggedColorIndex !== index ? `drop-${dragOverPosition}` : ""}`}>
                    <button type="button" className={`swatch ${color.toLowerCase() === value.toLowerCase() ? "active" : ""}`} style={{ background: value }}
                      onClick={(event) => { if (suppressPaletteClickRef.current) { event.preventDefault(); return; } setColor(value); setColorText(value); }}
                      onPointerDown={(event) => beginPalettePointer(event, index)} onPointerMove={movePalettePointer} onPointerUp={endPalettePointer} onPointerCancel={endPalettePointer}
                      aria-label={t("color", { value })} />
                    {paletteEditable && <button type="button" className="palette-swatch-remove" onClick={() => removePaletteColor(index)} aria-label={`${t("removeColor")} ${value}`}>×</button>}
                  </div>
                ))}
              </div>
              <div className="color-row palette-color-add-row">
                <input type="color" className="palette-color-picker" value={color} onChange={(e) => updateChosenColor(e.target.value)} aria-label={t("chooseColor")} />
                <input className="text-input palette-hex-input" value={colorText} onChange={(e) => { setColorText(e.target.value); const rgb = parseHex(e.target.value); if (rgb) setColor(rgbToHex(rgb[0], rgb[1], rgb[2])); }} onBlur={() => setColorText(color)} aria-label={t("colorHex")} />
                <button type="button" className="btn-primary palette-add-color-btn" onClick={addCurrentColor} disabled={!canAddCurrentColor}>{currentColorExists ? t("paletteColorExists") : t("paletteAddColor")}</button>
              </div>
              <div className="mobile-palette-actions">
                <button type="button" className="btn-ghost" onClick={addCustomPalette}>{t("paletteNew")}</button>
                <button type="button" className="btn-ghost" onClick={openPaletteImport} disabled={!paletteEditable}>{t("paletteImportColors")}</button>
              </div>
            </>
          )}
        </section>
      </div>
    )}
    {paletteImportOpen && (
      <div className="modal-overlay palette-import-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setPaletteImportOpen(false); }}>
        <div
          ref={paletteImportDialogRef}
          className="modal palette-import-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="palette-import-title"
          style={{ top: paletteImportPosition.top, left: paletteImportPosition.left }}
        >
          <div className="palette-import-head">
            <h2 id="palette-import-title">{t("paletteImportTitle")}</h2>
            <button type="button" className="mini-btn" onClick={() => setPaletteImportOpen(false)} aria-label={t("cancel")}>✕</button>
          </div>
          <div className="palette-import-tabs" role="tablist" aria-label={t("paletteImportTitle")}>
            <button type="button" role="tab" aria-selected={paletteImportTab === "palette"} className={paletteImportTab === "palette" ? "active" : ""} onClick={() => setPaletteImportTab("palette")}>{t("paletteImportOther")}</button>
            <button type="button" role="tab" aria-selected={paletteImportTab === "file"} className={paletteImportTab === "file" ? "active" : ""} onClick={() => setPaletteImportTab("file")}>{t("paletteImportFile")}</button>
          </div>

          {paletteImportTab === "palette" ? (
            <div role="tabpanel" className="palette-import-panel">
              <p className="modal-hint">{t("paletteImportOtherHint", { name: paletteDisplayName })}</p>
              <label className="field-label" htmlFor="palette-import-source">{t("paletteImportSource")}</label>
              <select
                id="palette-import-source"
                className="num-input"
                style={{ width: "100%", marginBottom: 10 }}
                value={paletteImportSource}
                onChange={(e) => { setPaletteImportSource(e.target.value); setPaletteImportColors([]); }}
              >
                {paletteImportCustomSources.length > 0 && (
                  <optgroup label={t("paletteMy")}>
                    {paletteImportCustomSources.map((item) => <option key={item.id} value={item.id}>{displayPaletteName(item)}</option>)}
                  </optgroup>
                )}
                <optgroup label={t("paletteBuiltIn")}>
                  {paletteImportBuiltinSources.map((item) => <option key={item.id} value={item.id}>{item.name === "灰度" ? t("paletteGrayscale") : item.name}</option>)}
                </optgroup>
              </select>
              <div className="palette-import-toolbar">
                <span className="field-hint">{t("paletteSelectColors", { count: paletteImportColors.length })}</span>
                <button type="button" className="mini-btn" onClick={() => setPaletteImportColors((paletteImportSourcePalette?.colors ?? []).filter((value) => !currentPaletteColorSet.has(value.toLowerCase())))}>{t("paletteSelectAll")}</button>
                <button type="button" className="mini-btn" onClick={() => setPaletteImportColors([])}>{t("paletteClearSelection")}</button>
              </div>
              <div className="palette-import-grid">
                {(paletteImportSourcePalette?.colors ?? []).map((value) => {
                  const selected = paletteImportColors.includes(value);
                  const exists = currentPaletteColorSet.has(value.toLowerCase());
                  return (
                    <button
                      key={value}
                      type="button"
                      className={`swatch ${selected ? "active" : ""} ${exists ? "is-duplicate" : ""}`}
                      style={{ background: value }}
                      onClick={() => setPaletteImportColors((colors) => selected ? colors.filter((item) => item !== value) : [...colors, value])}
                      aria-label={exists ? `${t("color", { value })} · ${t("paletteColorExists")}` : t("color", { value })}
                      aria-pressed={selected}
                      disabled={exists}
                      title={exists ? t("paletteColorExists") : value}
                    />
                  );
                })}
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-primary" onClick={importOtherPaletteColors} disabled={paletteImportColors.length === 0}>{t("paletteImportSelectedCount", { count: paletteImportColors.length })}</button>
              </div>
            </div>
          ) : (
            <div role="tabpanel" className="palette-import-panel">
              <p className="modal-hint">{t("paletteFileHint")}</p>
              <button
                type="button"
                className={`palette-file-drop ${paletteFileDragging ? "is-dragging" : ""}`}
                onClick={() => paletteFileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setPaletteFileDragging(true); }}
                onDragLeave={() => setPaletteFileDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setPaletteFileDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) void previewPaletteFile(file);
                }}
              >
                <span>{paletteFilePreview ? paletteFilePreview.name : t("paletteChooseFile")}</span>
                <small>{t("paletteFileFormats")}</small>
              </button>
              <input
                ref={paletteFileInputRef}
                type="file"
                accept=".gpl,.json,.txt,.css,.palette,text/plain,text/css,application/json"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void previewPaletteFile(file);
                  e.target.value = "";
                }}
              />
              {paletteFileError && <p className="palette-file-error">{paletteFileError}</p>}
              {paletteFilePreview && (
                <>
                  <div className="palette-file-summary">
                    <strong>{paletteFilePreview.name}</strong>
                    <span>{t("paletteColorCount", { count: paletteFilePreview.colors.length })}</span>
                  </div>
                  <div className="palette-import-grid palette-file-preview-grid">
                    {paletteFilePreview.colors.map((value) => <span key={value} className={`swatch ${currentPaletteColorSet.has(value.toLowerCase()) ? "is-duplicate" : ""}`} style={{ background: value }} title={value} />)}
                  </div>
                  <div className="palette-file-actions">
                    <button type="button" className="btn-ghost" onClick={mergePaletteFileIntoCurrent} disabled={!paletteFileMerge || paletteFileMerge.added.length === 0}>{t("paletteFileMerge", { count: paletteFileMerge?.added.length ?? 0 })}</button>
                    <button type="button" className="btn-ghost" onClick={createPaletteFromFile}>{t("paletteFileCreate", { count: paletteFilePreview.colors.length })}</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    )}
    </>
  );
}
