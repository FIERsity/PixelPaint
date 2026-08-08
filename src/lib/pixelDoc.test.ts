import { describe, expect, it } from "vitest";
import {
  applyPixelChanges, brushOffsets, composite, createDoc, drawLinePoints,
  floodFill, getPixel, History, putPixel,
  resizeDoc, StrokeRecorder,
} from "./pixelDoc";

function set(doc: ReturnType<typeof createDoc>, x: number, y: number, rgb: [number, number, number]) {
  putPixel(doc.layers[0].pixels, doc.width, x, y, rgb[0], rgb[1], rgb[2], 255);
}

describe("floodFill", () => {
  it("只填充同色连通区域，不越过其它颜色", () => {
    // 8×1 横条：左半红、右半蓝
    const doc = createDoc(8, 1);
    for (let x = 0; x < 4; x++) set(doc, x, 0, [255, 0, 0]);
    for (let x = 4; x < 8; x++) set(doc, x, 0, [0, 0, 255]);

    const red = floodFill(doc.layers[0].pixels, 8, 1, 0, 0);
    expect(red).toHaveLength(4);
    expect(red.every(([x]) => x < 4)).toBe(true);

    const blue = floodFill(doc.layers[0].pixels, 8, 1, 5, 0);
    expect(blue).toHaveLength(4);
    expect(blue.every(([x]) => x >= 4)).toBe(true);
  });

  it("透明区域按 alpha 匹配，不会吃掉有色像素", () => {
    const doc = createDoc(4, 1);
    set(doc, 2, 0, [10, 20, 30]);
    const pts = floodFill(doc.layers[0].pixels, 4, 1, 0, 0);
    // 只有 x=0,1 是透明连通区，x=2 是有色边界，x=3 被隔断
    expect(pts.map(([x]) => x).sort()).toEqual([0, 1]);
  });

  it("不会因相邻不同色而连成一片（回归：旧实现按 a>0 匹配）", () => {
    const doc = createDoc(2, 1);
    set(doc, 0, 0, [255, 0, 0]);
    set(doc, 1, 0, [0, 255, 0]);
    expect(floodFill(doc.layers[0].pixels, 2, 1, 0, 0)).toHaveLength(1);
  });
});

describe("brushOffsets", () => {
  it("size=1 是单像素", () => {
    expect(brushOffsets(1)).toEqual([[0, 0]]);
  });
  it("size=n 覆盖 n×n 个像素", () => {
    expect(brushOffsets(2)).toHaveLength(4);
    expect(brushOffsets(3)).toHaveLength(9);
    expect(brushOffsets(5)).toHaveLength(25);
  });
  it("非法输入被夹到 1", () => {
    expect(brushOffsets(0)).toEqual([[0, 0]]);
    expect(brushOffsets(-3)).toEqual([[0, 0]]);
  });
});

describe("drawLinePoints", () => {
  it("水平线连续无空洞", () => {
    const pts = drawLinePoints(0, 0, 5, 0);
    expect(pts).toHaveLength(6);
  });
  it("对角线每步前进一格", () => {
    expect(drawLinePoints(0, 0, 3, 3)).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
  });
  it("单点线返回单点", () => {
    expect(drawLinePoints(2, 2, 2, 2)).toEqual([[2, 2]]);
  });
});

describe("resizeDoc", () => {
  it("放大时保留原内容且左上对齐", () => {
    const doc = createDoc(2, 2);
    set(doc, 0, 0, [255, 0, 0]);
    set(doc, 1, 1, [0, 0, 255]);
    const bigger = resizeDoc(doc, 4, 4);
    expect(bigger.width).toBe(4);
    expect(getPixel(bigger.layers[0].pixels, 4, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(getPixel(bigger.layers[0].pixels, 4, 1, 1)).toEqual([0, 0, 255, 255]);
    expect(getPixel(bigger.layers[0].pixels, 4, 3, 3)).toEqual([0, 0, 0, 0]);
  });

  it("缩小时裁掉超出部分，保留区域不串行", () => {
    const doc = createDoc(4, 4);
    set(doc, 0, 0, [1, 2, 3]);
    set(doc, 3, 3, [9, 9, 9]);
    const smaller = resizeDoc(doc, 2, 2);
    expect(getPixel(smaller.layers[0].pixels, 2, 0, 0)).toEqual([1, 2, 3, 255]);
    expect(smaller.layers[0].pixels).toHaveLength(2 * 2 * 4);
  });

  it("保留所有图层的元信息", () => {
    const doc = createDoc(2, 2);
    doc.layers.push({ ...doc.layers[0], id: "l2", name: "第二层", visible: false, opacity: 0.5, pixels: new Uint8ClampedArray(16) });
    const out = resizeDoc(doc, 3, 3);
    expect(out.layers).toHaveLength(2);
    expect(out.layers[1].name).toBe("第二层");
    expect(out.layers[1].visible).toBe(false);
    expect(out.layers[1].opacity).toBe(0.5);
  });
});

describe("composite", () => {
  it("隐藏图层不参与合成", () => {
    const doc = createDoc(1, 1);
    set(doc, 0, 0, [255, 0, 0]);
    doc.layers[0].visible = false;
    expect(composite(doc)[3]).toBe(0);
  });

  it("上层不透明像素覆盖下层", () => {
    const doc = createDoc(1, 1);
    set(doc, 0, 0, [255, 0, 0]);
    doc.layers.push({
      id: "top", name: "top", visible: true, opacity: 1,
      pixels: new Uint8ClampedArray([0, 0, 255, 255]),
    });
    const out = composite(doc);
    expect([out[0], out[1], out[2], out[3]]).toEqual([0, 0, 255, 255]);
  });

  it("图层不透明度参与混合", () => {
    const doc = createDoc(1, 1);
    set(doc, 0, 0, [0, 0, 0]);
    doc.layers.push({
      id: "top", name: "top", visible: true, opacity: 0.5,
      pixels: new Uint8ClampedArray([255, 255, 255, 255]),
    });
    const out = composite(doc);
    expect(out[3]).toBe(255);
    // 50% 白盖黑 ≈ 中灰
    expect(out[0]).toBeGreaterThan(100);
    expect(out[0]).toBeLessThan(155);
  });
});

describe("History（增量像素条目 + 文档条目）", () => {
  it("像素条目：撤销恢复 before，重做恢复 after", () => {
    const h = new History(10);
    const doc = createDoc(2, 1);
    const layerId = doc.layers[0].id;

    const rec = new StrokeRecorder(layerId);
    putPixel(doc.layers[0].pixels, 2, 0, 0, 255, 0, 0, 255);
    rec.touch(0, [0, 0, 0, 0], [255, 0, 0, 255]);
    putPixel(doc.layers[0].pixels, 2, 1, 0, 0, 0, 255, 255);
    rec.touch(1, [0, 0, 0, 0], [0, 0, 255, 255]);
    h.push(rec.entry()!);

    // 撤销
    const e = h.popUndo()!;
    if (e.kind !== "pixels") throw new Error("expected pixels entry");
    expect(applyPixelChanges(doc, e.layerId, e.changes, "before")).toBe(true);
    expect(getPixel(doc.layers[0].pixels, 2, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(doc.layers[0].pixels, 2, 1, 0)).toEqual([0, 0, 0, 0]);

    // 重做
    expect(applyPixelChanges(doc, e.layerId, e.changes, "after")).toBe(true);
    expect(getPixel(doc.layers[0].pixels, 2, 0, 0)).toEqual([255, 0, 0, 255]);
  });

  it("文档条目：撤销/重做替换整份文档", () => {
    const h = new History(10);
    const a = createDoc(1, 1);
    h.pushDoc(a);
    const b = createDoc(1, 1);
    set(b, 0, 0, [255, 0, 0]);
    h.pushDoc(b);

    // 最近一条是 b 的克隆（带像素）
    const e1 = h.popUndo()!;
    if (e1.kind !== "doc") throw new Error("expected doc entry");
    expect(e1.doc.layers[0].pixels[3]).toBe(255);

    // 再撤销回到 a（无像素）
    const e2 = h.popUndo()!;
    if (e2.kind !== "doc") throw new Error("expected doc entry");
    expect(e2.doc.layers[0].pixels[3]).toBe(0);
  });

  it("撤销条目自动进入重做栈，新操作清空重做栈", () => {
    const h = new History(10);
    const doc = createDoc(1, 1);
    const rec = new StrokeRecorder(doc.layers[0].id);
    rec.touch(0, [0, 0, 0, 0], [1, 2, 3, 4]);
    h.push(rec.entry()!);
    h.popUndo();
    h.pushRedo({ kind: "pixels", layerId: doc.layers[0].id, changes: [] });
    expect(h.canRedo).toBe(true);
    h.push({ kind: "pixels", layerId: doc.layers[0].id, changes: [] });
    expect(h.canRedo).toBe(false);
  });

  it("连续重做时保留尚未恢复的条目", () => {
    const h = new History(10);
    const first = { kind: "selection" as const, before: new Uint8Array([0]), after: new Uint8Array([1]) };
    const second = { kind: "selection" as const, before: new Uint8Array([1]), after: new Uint8Array([0]) };
    h.push(first);
    h.push(second);
    h.pushRedo(h.popUndo()!);
    h.pushRedo(h.popUndo()!);

    const redoFirst = h.popRedo()!;
    h.restore(redoFirst);
    expect(h.canRedo).toBe(true);
    const redoSecond = h.popRedo()!;
    h.restore(redoSecond);
    expect(h.canRedo).toBe(false);
    expect(h.canUndo).toBe(true);
  });

  it("超出上限后丢弃最旧条目", () => {
    const h = new History(2);
    for (let i = 0; i < 5; i++) {
      const d = createDoc(1, 1);
      h.pushDoc(d);
    }
    let count = 0;
    while (h.popUndo()) count++;
    expect(count).toBe(2);
  });
});

describe("StrokeRecorder", () => {
  it("同一像素多次改动只保留一条，before 为首次、after 为末次", () => {
    const rec = new StrokeRecorder("l1");
    rec.touch(3, [0, 0, 0, 0], [10, 0, 0, 255]);
    rec.touch(3, [0, 0, 0, 0], [20, 0, 0, 255]);
    rec.touch(3, [0, 0, 0, 0], [30, 0, 0, 255]);
    const entry = rec.entry();
    expect(entry).not.toBeNull();
    if (entry && entry.kind === "pixels") {
      expect(entry.changes).toHaveLength(1);
      expect(entry.changes[0].before).toEqual([0, 0, 0, 0]);
      expect(entry.changes[0].after).toEqual([30, 0, 0, 255]);
    } else {
      throw new Error("expected pixels entry");
    }
  });

  it("没画任何像素时返回 null（不产生空历史）", () => {
    const rec = new StrokeRecorder("l1");
    expect(rec.entry()).toBeNull();
    expect(rec.size).toBe(0);
  });
});

describe("applyPixelChanges", () => {
  it("图层 id 不存在时返回 false 不抛错", () => {
    const doc = createDoc(2, 1);
    expect(applyPixelChanges(doc, "ghost", [], "before")).toBe(false);
  });
});
