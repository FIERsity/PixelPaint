# PixelPaint 重点风险修复 Spec

> 状态：已批准并实施，待提交
> 范围：算法正确性、异步结果一致性、预览渲染、洋葱皮、GIF 动画兼容性
> 用户确认：D1 采用预乘 alpha；D2 不透明度加入撤销历史；R6/GIF 默认无限循环。

## 1. 背景与目标

PixelPaint 当前测试、lint 和构建均通过，但现有测试偏重纯算法的基本行为，对以下边界覆盖不足：

- 抖动结果是否仍满足固定调色板约束；
- 图片源切换、清空及并发解码时，异步结果是否仍属于当前输入；
- AI 背景处理中修改参数或离开面板时，状态机能否正常恢复；
- 条件挂载的 Canvas 是否在重新出现时重绘；
- 洋葱皮 UI 文案与实际显示帧是否一致；
- 导出的动画 GIF 是否明确声明循环播放。

本轮目标是以最小、可测试的改动修复已经确认的问题，不修改项目格式、自动保存 key、尺寸兼容范围、隐私边界或部署方式。

## 2. 结论分级

### 2.1 首轮必须修复

| ID | 严重度 | 结论 | 主要文件 |
| --- | --- | --- | --- |
| R1 | P0 | Bayer 2×2/4×4 会输出调色板以外的颜色，违反固定调色板约束 | `src/lib/pixel.ts`、`pixel.test.ts` |
| R2 | P1 | 图片加载和 Worker 请求没有统一输入代次，旧图片结果可在切图或清空后被接纳 | `src/components/Convert.tsx` |
| R3 | P1 | AI 背景处理中修改 AI 参数会留下无法自行恢复的 `running` UI；卸载时旧任务仍可能回调父组件 | `src/components/Cutout.tsx` |
| R4 | P1 | 背景预览切回像素化预览时，新挂载 Canvas 可能保持空白 | `src/components/ResultPreview.tsx` |
| R5 | P1 | “同时显示下一帧”在有上一帧时不起作用，且下一帧没有按文案使用淡青色 | `src/App.tsx`、`src/components/Editor.tsx` |

### 2.2 建议同轮处理的兼容性问题

| ID | 严重度 | 结论 | 主要文件 |
| --- | --- | --- | --- |
| R6 | P2 | 动画 GIF 未写循环扩展；文件结构仍可解码，但循环行为交给查看器决定 | `src/lib/gif.ts`、`gif.test.ts` |

### 2.3 需要产品决策，不应未经确认顺手修改

| ID | 类型 | 现状 |
| --- | --- | --- |
| D1 | 重采样质量 | 当前所谓“降采样”是左上对齐的 2×2 双线性点采样；大倍率缩小时容易混叠，且 RGBA 非预乘插值会让透明像素的无意义 RGB 污染半透明边缘 |
| D2 | 撤销语义 | 图层增删、移动、显隐、清空可撤销，但图层不透明度不可撤销；源码注释“图层（全部入历史）”与行为不一致 |
| D3 | GIF 帧率 | GIF 延迟单位为 10ms，统一帧延迟无法精确表示 60 FPS；当前 60 FPS 导出实际约为 50 FPS |

## 3. 已确认问题与证据

## R1 — Bayer 抖动破坏调色板约束

### 当前行为

`dither()` 先调用 `quantizeColor()` 得到 `nr/ng/nb`，随后立即把 `work` 当前像素覆盖成该量化色。Bayer 分支再使用已经覆盖后的 `work[i]` 与 `nr` 比较，并直接对量化色做 `±128`：

```ts
work[i] = nr;
// ...
qc(work[i], nr)
```

这使阈值判断退化，并且最终输出没有再次映射回调色板。

### 可复现证据

对灰阶 `[32, 96, 160, 224]` 使用固定黑白调色板：

```text
palette = [#000000, #ffffff]
```

实测：

```text
bayer2 => 128,128,128 | 0,0,0 | 255,255,255 | 127,127,127
bayer4 => 128,128,128 | 0,0,0 | 255,255,255 | 127,127,127
```

其中 `#808080` 和 `#7f7f7f` 不属于固定调色板。

现有测试只检查所有抖动模式“不崩溃且尺寸正确”，因此没有发现该错误。

### 修复设计

有序抖动应在量化之前对原始颜色施加位置相关偏移，再把偏移后的颜色交给 `quantizeColor()`：

1. 在循环外分别预建 2×2 和 4×4 Bayer 矩阵，或按当前 mode 只建一次；
2. 对当前未量化的 `work` RGB 读取原值；
3. 根据矩阵阈值计算有限幅度的 RGB 偏移；
4. 调用 `quantizeColor(adjustedR, adjustedG, adjustedB)`；
5. 输出必须使用该次量化结果，不直接构造 `±128` 色；
6. Bayer 不扩散误差，不修改邻居；Floyd 和 Atkinson 保持现有误差扩散路径。

建议把 Bayer 与误差扩散分支在代码结构上提前分开，避免再次混用“原色、工作色、量化色”。

### 必须增加的测试

1. `bayer2` + 固定黑白调色板：所有非透明输出均属于黑白两色；
2. `bayer4` + 固定黑白调色板：同上；
3. 自动调色板 + Bayer：所有非透明输出均属于返回的 `palette`；
4. Bayer 在均匀中灰图片上产生至少两种调色板色，证明不是退化为普通量化；
5. 全透明像素保持 alpha=0；
6. 矩阵具有空间周期：2×2 与 4×4 的输出图案不完全相同。

### 验收标准

- 任意固定调色板下，所有非透明输出 RGB 必须是调色板成员；
- 自动调色板下，所有非透明输出 RGB 必须是返回 palette 的成员；
- Floyd、Atkinson 和 `none` 的现有测试结果不回归；
- 不在每个像素内重新创建 Bayer 矩阵。

---

## R2 — 图片源与 Worker 结果存在竞态

### 当前行为

Convert 使用递增 `reqId` 防止旧 Worker 请求覆盖新请求，但该 ID 只在 `runConvert()` 真正发请求时递增。输入源变化与请求递增之间有 220ms 防抖窗口。

确定性问题序列：

1. 图片 A 的 Worker 请求 `id=1` 正在运行；
2. 用户加载图片 B，`setSource(B)` 并清空 result；
3. B 的新 Worker 请求要等待 220ms；
4. 在此窗口内 A 返回，因为 `reqId` 仍为 1，A 被当成当前结果接纳；
5. 页面短暂显示 A 的结果，并可能允许导出或进入背景处理。

清空输入时问题更明显：清空只执行 `setSource(null); setResult(null)`，没有使当前请求失效。旧请求返回后仍会重新写入 `result`。虽然主预览因 `source` 为空而隐藏，但操作区的按钮只看 `result`，旧结果可能重新启用下载或背景处理。

此外，`loadFile()` 本身也没有解码代次：快速选择 A、B 时，如果 A 的 `createImageBitmap()` 后完成，A 可以覆盖 B。

### 修复设计

引入统一的“输入代次 / generation”，并让解码与 Worker 请求都依附于它。

建议状态：

```ts
const inputGenerationRef = useRef(0);
const loadIdRef = useRef(0);
```

#### 输入失效函数

集中提供 `invalidateConversion()`：

- `inputGenerationRef.current += 1`；
- `reqId.current += 1`，立即使所有在途 Worker 响应失效；
- `pending.current.clear()`；
- `setBusy(false)`；
- 必要时清空 result、autoPalette、error 和背景状态。

#### 文件解码

`loadFile(file)` 开始时生成 `loadId`，在每一个 `await` 之后检查是否仍为最新：

- 旧解码不得调用 `setSource`；
- 无论成功、失败或过期，都必须关闭已经创建的 ImageBitmap；
- 旧解码失败不得覆盖当前图片的 error。

#### Worker 请求

pending 元数据增加：

```ts
{ generation, w, h, auto }
```

响应只有同时满足以下条件才可接纳：

- `msg.id === reqId.current`；
- request 存在；
- `request.generation === inputGenerationRef.current`；
- 当前仍有 source。

增加 `worker.onerror` / `worker.onmessageerror`：仅当错误属于当前 generation 时结束 busy 并显示错误，避免 Worker 装载级错误令 UI 永久 busy。

### 必须增加的测试

组件逻辑目前缺少 DOM 测试基础。首选把“是否接纳响应”的判断提取为纯函数或小型 reducer，并为以下状态转换写 Vitest：

1. A 请求后切到 B，A 响应被拒绝；
2. A 请求后清空，A 响应被拒绝；
3. A、B 解码乱序完成，只接纳 B；
4. 同 generation 的最新请求正常接纳；
5. 旧 generation 的 error 不覆盖当前状态；
6. Worker fatal error 会退出 busy。

另做桌面浏览器人工回归：使用两张颜色和尺寸明显不同的大图快速连续切换，并在转换中清空。

### 验收标准

- 当前结果、自动调色板、busy 和 error 始终属于当前 source；
- 清空图片后，在途请求完成也不能重新启用任何结果操作；
- 快速连续选择文件时，以最后一次用户选择为准；
- 不要求真正取消 Worker 内 CPU 计算，但旧结果必须不可见、不可导入、不可下载。

---

## R3 — 背景处理取消状态不完整

### 当前行为 A：AI 参数变化后 UI 卡在 running

Cutout 的 signature effect 会在设置变化时：

```ts
runIdRef.current += 1;
runningRef.current = false;
if (resultFile && resultSignature !== signature) setPhase("ready");
```

如果第一次 AI 运行尚未产生 `resultFile`，用户在运行中修改模型、边缘模式或阈值：

- 旧任务会因 run ID 失效，不再提交结果；
- `runningRef` 已变成 false；
- 但 `phase` 因没有 resultFile 仍保持 `running`；
- AI 路径不会自动重跑；
- 主按钮按 `phase === "running"` 禁用；
- 用户无法重新开始，只能切换方法或重新进入面板。

### 当前行为 B：卸载后旧任务仍可能回调父组件

Cutout 在从背景页切回像素化页时会卸载，但没有 cleanup 使 run ID 失效。底层 AI Promise 不能真正取消，完成后仍可能调用父组件的 `onResult()` 和 `onNotice()`，把已离开的旧任务结果写回 Convert。

### 修复设计

1. 将“使当前运行失效”和“UI 进入可重试状态”统一为一个函数；
2. signature 变化时总是：
   - 递增 run ID；
   - `runningRef=false`；
   - `setProgress(null)`；
   - `setError(null)`；
   - 有输入时 `setPhase("ready")`，无输入时 `idle`；
3. 像素方法继续在 320ms 后自动开始新运行；AI 方法保持手动重新开始；
4. 组件卸载 cleanup 中递增 run ID，并设置 mounted 标志；
5. 所有 `onResult`、`onNotice` 和 state 更新前均确认 run ID 最新且组件仍 mounted；
6. 不宣称能够中止 `@imgly/background-removal` 的下载/推理，只保证旧任务不再产生可观察副作用。

应避免使用 `phase` 与 `runningRef` 两套可能分叉的事实来源。推荐将按钮禁用、进度显示和并发保护统一由一个运行 token/reducer 管理；如果保持当前结构，也必须用测试覆盖二者同步。

### 必须增加的测试

将 Cutout 运行状态提取为 reducer 或可注入 async runner 后测试：

1. AI running → 修改 model → ready，进度清空，可重新点击；
2. AI running → 修改 threshold → 旧结果被拒绝；
3. pixel running → 修改 tolerance → 旧结果被拒绝并自动启动新任务；
4. running → input changed → 旧结果不能触发 onResult；
5. running → unmount → 旧任务完成不能触发 onResult/onNotice；
6. 最新任务成功后 resultSignature 与启动时 signature 完全一致。

### 验收标准

- AI 运行中改变任一 AI 设置后，按钮在旧任务失效时恢复为可点击；
- 像素路径设置变化后仍自动刷新；
- 离开背景页后，旧任务完成不得改变背景结果或弹出成功通知；
- 旧结果可以留作带“参数已变化”标记的预览，但发送和下载必须继续禁用。

---

## R4 — 条件重挂载 Canvas 不会重绘

### 当前行为

ResultPreview 的绘制 effect 只依赖 `[result]`。背景结果存在时，组件渲染 `<img>`，像素 `<canvas>` 被卸载。切回像素化时会创建新的 Canvas DOM 节点，但 `result` 对象没有变化，effect 不会重新运行，新 Canvas 为空白。

### 修复设计

最小修改：让绘制 effect 同时依赖当前 operation，或依赖派生的 `showBackground`：

```ts
useEffect(drawPixelResult, [result, operation]);
```

更稳健的方案是使用 callback ref，在 Canvas 节点挂载时立即绘制当前 result；这样渲染正确性不依赖“哪个状态变化触发了挂载”。首轮建议采用最小依赖修复，除非测试表明 callback ref 更简单。

### 测试与验收

浏览器回归步骤：

1. 导入图片并等待像素化结果；
2. 记录 Canvas 中一个已知非透明像素；
3. 进入背景处理，确保 `<canvas>` 卸载；
4. 不修改像素化设置，切回像素化；
5. 新 Canvas 的尺寸和 ImageData 必须与原 result 一致，不得空白。

如引入 React DOM 测试环境，则用 mock canvas 验证第二次挂载再次调用 `putImageData`。不要只做截图测试。

---

## R5 — 洋葱皮“下一帧”实现与 UI 不一致

### 当前行为

中英文文案明确为：

- “同时显示下一帧（淡青色）”
- “Show the next frame in a pale cyan”

但 App 当前选择：

```ts
const target = prev ?? (onionNext ? next : null);
```

结果：

- 只要上一帧存在，就永远不会使用下一帧；
- `onionNext=true` 在第 2 帧及之后通常没有效果；
- Editor 只有一个 `onionPixels`，统一着色为蓝色；
- 无法做到“同时显示”和“下一帧淡青色”。

这是确定的实现/文案不一致，不是单纯偏好问题。

### 修复设计

将前后帧分开传递：

```ts
onionPreviousPixels?: Uint8ClampedArray | null;
onionNextPixels?: Uint8ClampedArray | null;
```

App 规则：

- `onion=false`：两者都为 null；
- `onion=true`：存在上一帧则提供上一帧；
- `onion=true && onionNext=true`：存在下一帧则同时提供下一帧；
- 不做首尾循环洋葱皮，保持当前相邻帧语义。

Editor 绘制顺序：

1. 上一帧洋葱皮；
2. 下一帧洋葱皮；
3. 当前帧各图层。

颜色建议保持文案含义：

- 上一帧：当前蓝色；
- 下一帧：淡青色，与上一帧有明确区分；
- 两者 alpha 保持约 0.38，重叠时不得盖住当前帧。

“显示下一帧”复选框在主洋葱皮关闭时建议禁用，但保留 checked 状态；重新开启主洋葱皮后恢复用户之前的选择。

### 必须增加的测试

优先把相邻帧选择提取为纯函数：

1. 中间帧、onion on、next off：只有 prev；
2. 中间帧、onion on、next on：prev 和 next 同时存在；
3. 第一帧、next off：无洋葱帧；
4. 第一帧、next on：只有 next；
5. 最后一帧、next on：只有 prev；
6. onion off：无论 next 是否 checked，都不输出洋葱帧。

Canvas 人工验收需要三帧使用三种明显图案，确认中间帧能同时看到前后两帧且颜色不同。

### 验收标准

- UI 文案无需改变；
- 中间帧开启“显示下一帧”后可以同时看到上一帧和下一帧；
- 上一帧与下一帧视觉可区分；
- 当前帧绘制和导出不包含洋葱皮；
- 画布尺寸不匹配时继续安全忽略不匹配的洋葱帧。

---

## R6 — GIF 未声明循环播放

### 当前行为

`encodeGif()` 写出合法的 GIF89a 头、全局调色板、每帧 GCE、图像描述符、LZW 数据和 trailer，但没有 `NETSCAPE2.0` 或 `ANIMEXTS1.0` Application Extension。

这不等于 GIF 文件损坏；它意味着播放次数未由文件明确指定。不同查看器可能只播放一次，也可能按自身默认循环。PixelPaint 编辑器预览本身是循环动画，因此导出行为不确定。

### 修复设计

在全局调色板之后、第一帧之前写入标准 Netscape 循环扩展：

```text
21 FF 0B "NETSCAPE2.0" 03 01 00 00 00
```

`00 00` 表示无限循环。

保持现有：

- 共享 256 色全局调色板；
- alpha < 128 使用透明索引；
- disposal method 2；
- 自定义 LZW；
- 当前 FPS 到 centisecond delay 的取整方式。

### 必须增加的测试

1. 多帧 GIF 恰好包含一个 `NETSCAPE2.0` 扩展；
2. 循环次数为 0；
3. 扩展位于第一帧图像描述符之前；
4. 现有透明、多帧和不同尺寸结构测试继续通过；
5. 用至少两种独立解码器/浏览器人工打开，确认持续循环。

### 验收标准

- Chrome、Firefox/Safari 中下载后循环播放；
- 常见系统预览或图片查看器中不因新增扩展而无法打开；
- 不改变项目内帧数据和 FPS 设置。

---

## 4. 需要用户确认的设计项

## D1 — 是否在本轮改变重采样算法

### 已确认现状

当前 `downsample()`：

- 坐标使用 `sx = x * srcW / outW`，是左上对齐而非像素中心对齐；
- 大倍率缩小时每个输出像素只看 2×2 邻域，并不是区域平均，容易漏掉细节和产生混叠；
- RGBA 四通道直接插值，未使用预乘 alpha；透明像素中的任意 RGB 会污染半透明边缘颜色。

例如“不透明红 + 透明蓝”的插值边缘会产生半透明紫色，而按照“透明像素 RGB 无语义”的项目约束，合理结果应是半透明红色。

### 两个选项

**选项 A（建议本轮采用）— 只修透明语义：**

- 使用预乘 alpha 插值，再在 alpha > 0 时反预乘；
- 保留现有采样坐标与整体视觉风格；
- 风险较小，但大倍率缩小混叠仍存在。

**选项 B（另立视觉质量任务）— 重做缩放器：**

- 缩小时采用 area/box resampling；
- 放大时采用中心对齐、预乘 alpha 的双线性插值；
- 会明显改变许多既有图片的像素化结果，需要黄金图或浏览器视觉对比；
- 应作为单独的小型功能改进，不与竞态修复混在同一提交。

建议：首轮选择 A，B 另开 spec 或后续任务。

## D2 — 图层不透明度是否进入撤销历史

若决定修复，不能简单在每个 range `onChange` 上 `pushDoc`，否则一次拖动会产生几十条历史并迅速挤掉 80 条上限。

建议语义：

- 指针按下/键盘首次改变时保存一次 before 快照；
- 拖动期间实时预览，不重复入历史；
- pointerup、blur 或键盘操作结束时提交为一个历史条目；
- Escape 是否取消本次拖动需要另行定义，首轮可不支持取消；
- Undo 一次恢复到本次滑动前的不透明度。

建议：作为 P2 独立提交；如果用户认为“不透明度是视图参数而非编辑动作”，则只修正源码注释，不加入历史。

## D3 — 是否处理高 FPS 的 GIF 平均帧率

当前统一 delay：

```ts
round(100 / fps) centiseconds
```

- 60 FPS → 2cs → 实际 50 FPS；
- 30 FPS → 3cs → 实际约 33.3 FPS；
- 24 FPS → 4cs → 实际 25 FPS。

可选增强是按帧使用误差累计，在 1cs/2cs 或 3cs/4cs 之间交替，使整段动画平均 FPS 更接近设置值。但部分查看器会把 1cs 延迟钳制为更大值，跨平台收益不稳定。

建议：本轮不改，只在后续有明确动画时序需求时处理。

## 5. 实施顺序与提交边界

为降低回归范围，建议分四个小提交，每个都可独立测试和回退：

### Commit 1 — 像素算法正确性

- 修复 Bayer；
- 增加固定/自动调色板成员测试；
- 如用户选择 D1-A，同时加入预乘 alpha 插值及测试；
- 修正源码中“median-cut”误导注释为实际的加权聚类描述。

### Commit 2 — 转换与背景异步一致性

- Convert 输入 generation、文件解码代次、Worker fatal error；
- Cutout 状态失效、unmount 保护；
- 尽量抽取纯状态逻辑并写 Vitest。

### Commit 3 — 预览与洋葱皮

- ResultPreview 重挂载重绘；
- 前后洋葱帧拆分与颜色区分；
- 相邻帧选择纯函数测试；
- 桌面浏览器交互检查。

### Commit 4 — GIF 循环与可选历史一致性

- Netscape 无限循环扩展；
- GIF 结构测试和跨解码器检查；
- D2 若批准，单独再提交，不与 GIF 混成同一逻辑变更。

实际提交时可保持 Commit 4 只含 GIF；这里的“第四阶段”不要求把不相关代码放进一个 commit。

## 6. 总体验收矩阵

### 自动检查

```bash
npm test
npm run lint
npm run build
```

新增测试必须覆盖：

- Bayer 固定调色板成员约束；
- Bayer 自动调色板成员约束；
- Convert 旧 generation 响应拒绝；
- 文件解码乱序；
- Cutout 参数变化、输入变化和卸载失效；
- 洋葱皮前后帧选择；
- GIF 无限循环扩展。

### 桌面浏览器（约 1440×900）

1. 黑白调色板分别使用 Bayer 2×2 和 4×4，导出 PNG 后抽样确认只有黑白；
2. 连续快速加载两张大图，只出现最后选择的图片结果；
3. 转换中清空，等待旧 Worker 完成，按钮不得重新启用；
4. AI 背景处理中改变模型或硬边阈值，主按钮恢复可重试；
5. AI 背景处理中切回像素化，旧任务完成不得覆盖背景结果或弹成功通知；
6. 背景页切回像素化页，像素 Canvas 立即正确显示；
7. 三帧动画在中间帧同时显示前后洋葱皮，颜色可区分；
8. 下载 GIF，在至少两个独立查看器中确认循环。

### 基础响应式保护

本任务不做竖屏专项设计，但需在现有窄屏布局快速确认：

- 操作按钮没有因新增状态文案溢出；
- 洋葱皮复选框仍可操作；
- 背景处理参数变化后不会留下无法操作的 disabled UI。

## 7. 明确非目标

本轮不做：

- 项目格式或 `localStorage` key 迁移；
- 512 编辑上限或 1024 工程读取兼容范围调整；
- Editor.tsx 大规模拆分；
- AI 模型替换；
- 服务端处理、上传、遥测或分析；
- 全面移动端重设计；
- 调色板距离空间从 RGB 改为 OKLab；
- GIF 局部帧优化或全新编码库迁移；
- area resampling（除非用户明确选择 D1-B）。

## 8. 审查时需要确认的三个决定

1. **D1：重采样**
   - [x] A：本轮只修预乘 alpha 透明语义
   - [ ] B：另立任务重做缩放器
   - [ ] 本轮完全不改重采样

2. **D2：图层不透明度撤销**
   - [x] 加入撤销历史，一次拖动算一步
   - [ ] 保持不可撤销，只修正文档/注释

3. **R6：GIF 无限循环**
   - [x] 本轮加入 Netscape 无限循环扩展
   - [ ] 保持由查看器决定播放次数

上述选择已由用户确认并完成实现。
