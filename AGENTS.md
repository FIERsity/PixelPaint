# AGENTS.md

## 作用域与上级规则

本文件适用于 PixelPaint 仓库。跨项目策略、Git/main 规则和默认设备范围由 `../070315-site/AGENTS.md` 统一管理。开始跨项目工作或修改本文件前，先读取主文件。

本文件中的 `OWNER-MAINTAINED` 内容只有在用户明确改变产品策略时才能修改。`AGENT-MAINTAINED` 内容是项目事实；代码、配置或工作流改变后，执行变更的代理应同步更新。

## OWNER-MAINTAINED: 产品边界

- PixelPaint 是本地优先的浏览器像素画工作站，包含画板、图片像素化和背景处理。
- 用户图片、项目内容、图层和导出结果不得上传到服务器。
- 用户主动提交的反馈文字是允许的网络例外；本地 AI 模型下载不等于上传用户图片。
- 不新增账户、云存储、遥测、分析或远程图片处理，除非用户明确批准为大改动。
- 默认面向桌面横屏开发。不主动进行竖屏专项设计，但保持已有基础响应式、触摸和移动编辑能力不被明显破坏。
- 小改动通过最低验证后可直接提交并推送 `main`；大改动先按主 AGENTS 的标准询问用户。

## 工作方式

1. 检查 `git status --short --branch`，保留已有修改和未跟踪内容。
2. 当前 `output/` 是本地测试材料和截图目录，不得顺手删除、重生成或提交。
3. 使用 Node 22、npm 和已提交的 `package-lock.json`。
4. 使用明确路径暂存，提交前检查 `git diff --cached`。
5. 推送 `main` 会自动发布 GitHub Pages，推送前完成最低验证。

## AGENT-MAINTAINED: 项目事实

<!-- AGENT-MAINTAINED:START project-facts -->

### 架构

- `src/App.tsx`：应用协调、帧状态、自动保存、导入、确认、反馈和工作区切换。
- `src/components/Editor.tsx`：画布工具、选择、图层、历史、指针交互和导出。
- `src/components/Convert.tsx`：图片像素化流程和 Web Worker 调度。
- `src/components/Cutout.tsx`：像素背景处理与浏览器本地 AI 备用路径。
- `src/lib/`：数据模型、纯算法、持久化、i18n、Worker 和 colocated 测试。
- `public/`：受版本控制的静态资源。
- `dist/`：Vite 生成产物，不编辑、不提交。
- `node_modules/`：依赖目录，不编辑、不提交。
- `output/`：未跟踪的本地截图、项目样本、帧动画测试材料和带来源说明的第三方素材。

技术栈为 React、TypeScript、Vite、Vitest、Oxlint 和 Tailwind。Vite `base: "./"` 用于 GitHub Pages 子路径，除非部署方式改变不得移除。

### 命令

- 安装：`npm ci`
- 开发：`npm run dev`
- 测试：`npm test`
- 监听测试：`npm run test:watch`
- lint：`npm run lint`
- 构建：`npm run build`
- 本地构建预览：`npm run preview`

最低验证为 `npm test`、`npm run lint`、`npm run build`。算法和数据模型变化应增加聚焦 Vitest；Canvas、拖放、指针、导入导出或视觉变化还需要桌面浏览器检查。

### 发布

`main` 推送通过 GitHub Actions 运行测试和构建，并发布 `dist/` 到 GitHub Pages。公开地址为 `https://FIERsity.github.io/PixelPaint/`。CI 当前不运行 lint，因此本地推送前仍必须执行 lint。

<!-- AGENT-MAINTAINED:END project-facts -->

## 关键实现约束

### 数据和兼容性

- `PixelDoc` 必须有正尺寸和至少一个图层；每个 RGBA 缓冲区长度必须为 `width * height * 4`。
- 动画必须保留至少一帧；复制帧必须深拷贝并生成新的图层 ID。
- 编辑与转换尺寸保持 `1..512`；项目读取器为兼容旧文件可接受至 `1024`，不得无迁移地收紧。
- FPS 保持在 `1..60`。
- 完全透明像素的 RGB 不具有语义；填充、量化、抖动、抠图和导出必须保持透明语义。
- 撤销历史是逐帧的；结构变化、导入和外部 resize 必须正确重置历史边界。
- 自动保存的 storage key、项目版本和旧版本读取兼容性不得无迁移修改。
- 对项目格式、localStorage 数据或尺寸兼容性的改变属于大改动。

### 异步与资源

- 像素化和抠图结果必须与当前输入及设置匹配；保留 request ID、签名或等价的过期结果保护。
- 设置变化后旧结果不得继续成为可应用结果。
- Worker、ImageBitmap、object URL 和模型资源必须在替换或卸载时正确终止、关闭或回收。
- `@imgly/background-removal` 保持浏览器端懒加载，不得把用户图片发送到远端处理。

### 交互与文案

- 保持最近邻、像素化渲染，不引入导致像素模糊的插值。
- 保留破坏性操作确认、键盘可用性、焦点管理和现有触摸行为。
- 中文和 English 文案必须同步维护。
- 默认只做桌面横屏重点验收；修改指针、触摸或响应式代码时再增加相应窄屏检查。

## 文档维护

代理可以更新 `project-facts` 中经过验证的架构、命令、依赖和发布事实。以下变化还必须同步更新 `../070315-site/AGENTS.md`：

- 项目目录、GitHub 仓库或公开 URL 改变。
- 最低验证命令、Node 版本或发布方式改变。
- 隐私边界、产品定位或主站工具入口需要改变。

用户功能、格式支持、安装方式或使用流程变化时同步更新 README。不要在本文件记录临时进度、提交号、部署版本或秘密信息。
