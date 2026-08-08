# PixelPaint

本地优先的像素画工作站：画板、图片转像素和背景处理。图片在浏览器中处理，不上传服务器。

在线使用：https://FIERsity.github.io/PixelPaint/

## 功能

### 画板

- 铅笔、橡皮、取色、填充、直线、矩形
- 多图层、撤销/重做、帧动画和洋葱皮
- 调色板、网格、最近邻 PNG 导出

### 转像素

- 按常用尺寸预设或自定义尺寸转为像素画
- 从当前图片提取自动调色板
- 支持固定调色板、颜色数和抖动算法
- 结果可发送到画板，或继续处理背景

### 背景处理

- 浏览器本地 AI 背景处理
- 像素硬边或柔和边缘
- 透明 PNG 结果可预览、下载或发送到画板

界面支持中文和 English，反馈入口位于右上角。

## 本地开发

```bash
npm install
npm run dev
```

检查项目：

```bash
npm test
npm run lint
npm run build
```

## English

PixelPaint is a local-first pixel art workstation for drawing, image pixelization, and background processing. Images stay in the browser.

- Canvas editor with layers, undo/redo, grids, palettes, and frame animation
- Pixelization with presets, custom dimensions, extracted palettes, and dithering
- Local background processing with hard or soft pixel edges
- Chinese and English UI; feedback is available in the top-right corner

Online: https://FIERsity.github.io/PixelPaint/

## License

MIT
