# PixelPaint · 在线像素画工作站

在线像素画工作站：**画像素画 · 图片转像素化 · 背景处理**。图片全程在浏览器本地处理，不会上传到服务器。

在线使用：https://FIERsity.github.io/PixelPaint/

## 功能

### 🎨 画板
- 铅笔 / 橡皮 / 取色 / 填充 / 直线 / 矩形
- 可调笔刷大小、画布缩放（1×~32×）、网格开关
- 多图层（新建 / 删除 / 排序 / 显隐 / 不透明度）
- 撤销 / 重做
- 预设调色板（Sweetie 16 / PICO-8 / Game Boy / 灰度）+ 任意取色
- 导出 PNG（1×~16× 最近邻放大）

### 🖼 转像素
- 上传任意图片 → 降采样 + 图片颜色聚类量化 → 像素画
- 常用输出尺寸预设（16 / 32 / 64 / 128 / 256 px，按原图比例）+ 自定义
- 自动调色板从当前图片提取主要颜色，也可选择固定调色板
- 可调颜色数、调色板、抖动算法（Floyd-Steinberg / Atkinson / Bayer）
- 大图处理在 Web Worker 中进行，不卡界面
- 一键发送到画板继续精修，或进入下一步背景处理

### 🧩 背景处理（转像素下一步）
- AI 自动去除背景（ONNX Runtime 本地推理）
- 快速（量化 ~40MB）/ 精细（ISNet）两档模型
- 默认按像素画规则整理为硬边透明，可调 alpha 阈值，也可保留柔和边缘
- 首次使用下载模型，之后浏览器缓存秒开
- 从转像素结果进入，不再单独占用顶部模块
- 结果可下载 PNG，或发送到画板 / 返回转像素继续处理

## 技术栈

Vite + React + TypeScript + Tailwind CSS v4 + @imgly/background-removal

## 图标

工具栏 / 操作按钮的像素风图标来自 [Pxlkit](https://pxlkit.xyz)
（[License: MIT code + Pxlkit Assets License](https://github.com/Joangeldelarosa/pxlkit)）——
免费使用需署名，已在页面 footer 标注。直线 / 矩形图标为本项目自绘（同格式）。

## 本地开发

```bash
npm install
npm run dev       # 本地开发
npm run build     # 构建到 dist/
npm run preview   # 预览构建产物
```

## 部署

推送到 `main` 分支自动部署到 GitHub Pages（见 `.github/workflows/pages.yml`），
或手动：Settings → Pages → Source 选 GitHub Actions。

## 目录结构

```
PixelPaint/
├── src/
│   ├── components/
│   │   ├── Editor.tsx     # 画板编辑器
│   │   ├── Convert.tsx    # 图片转像素化 + 背景处理流程
│   │   └── Cutout.tsx     # 背景处理面板
│   ├── lib/
│   │   ├── pixelDoc.ts    # 像素文档模型 + 画笔工具 + 撤销
│   │   ├── pixel.ts       # 降采样 / 量化 / 抖动算法
│   │   ├── palette.ts     # 调色板
│   │   └── toPixel.worker.ts  # 转像素 Web Worker
│   ├── App.tsx            # 布局 + 工作区导航
│   └── index.css          # TinyPress 风格设计系统
├── .github/workflows/pages.yml
└── README.md
```

## 许可证

MIT
