# K 线库迁移方案：klinecharts 10.1.0 → Vela 0.9.3

> **状态：P1 已完成（2026-11-05），P2/P3 起开工** —— P1 的两条实测修正：①provider 注册表 store 永锚实时尾，任意锚点窗口必须走自定义 `MarketDataFeed`（`deps.dataFeed` 裸注入，`load` 返回值即 store）；②seek 靠周期往返触发身份重载（~43ms）。详见 [VELA-REMAINING.md §9](VELA-REMAINING.md)。 —— 剩余工作量、人日与执行顺序见 [VELA-REMAINING.md](VELA-REMAINING.md)；Pine / LuxAlgo 指标覆盖度实测见 [VELA-PINETS-COVERAGE.md](VELA-PINETS-COVERAGE.md)；P0 各项实测见 [VELA-P0-NOTES.md](VELA-P0-NOTES.md)。
>
> **步骤 0 记录**：① `origin/main` 已 merge 进 `vela`（含 `54e520e` 四类优化，两次 merge 均零冲突）；② 原 main 工作区挂着的 12 文件 WIP 已由 `54e520e` 落盘，无需另行处置；③ main 图表层已正式冻结（main 仓库 `docs/BACKLOG.md` 顶部冻结公告，`31bf844`）。
>
> 分支：`vela`（从 `main@7356dc2` 拉出）。本文只写**可执行方案**，不含营销。目标库 API 全部取自本机实测的 `@luxalgo/vela@0.9.3` 类型声明（`node_modules/@luxalgo/vela/dist/*.d.ts`），标 **[待实测]** 的是声明存在但行为未验证的部分。

## 1. 结论

**可以迁，且净收益明确**，但不是"换图表库"，是**换掉一整层图表基础设施**。

- Vela 自带回放（`chart.replay`）、绘图（`chart.drawings` + `toJSON/fromJSON` 序列化）、多图工作区（`VelaWorkspace` 含 `sync` 跨图同步、`getState/applyState` 持久化）、截图（`screenshotCanvas()`），这些在我们项目里是自研的：`replay.js` 123 行 + `crosshairSync.js` 114 行 + `workspace.js` 249 行 + `chart.js` 295 行 ≈ **780 行可以直接删**；`draw.js` 385 行改写后也会瘦一半。另外白捡撤销/重做、复制粘贴、对象树、数据窗口（见 §3 末）。
- 代价是**绘图与指标全部要重写**：klinecharts 的 overlay 模板和 `createIndicator({ figures })` 在 Vela 里对应的是 **drawing types 注册表**和 **native indicator 插件**，不是参数级替换。
- 最大不确定项：Vela **没有公开的 projector**（`time→x` 只存在于内部 `Projector` 类型，`chart` 上没有访问器）。这会影响我们"用时间戳自己算坐标画 Pine line/box/label"的做法，需要用 `@luxalgo/vela-pinets` 引擎替代（见 §7 风险 R1）。

### 1.1 已定决策（2026-11-04）

| # | 决策 | 影响 |
|---|---|---|
| D1 | **Pine 走 `@luxalgo/vela-pinets`** | 自研 `pineDraw.js`(225) / `pineCore.js`(265) 的坐标与绘图层全部下掉，`pine.js` 只留脚本编辑与参数面板 |
| D2 | **艾略特波浪（abcd/xabcd/one~eightWaves 6 个工具）砍掉** | P3 少 1 人日，映射表删 6 行，工具栏直接不给这组 |
| D3 | **一个 `VelaWorkspace` + `setLayout()` 切换格数**（不是每 TAB 一个 workspace） | 内存低、状态单点；TAB 语义改成「命名的工作区快照」，靠 `getState/applyState` 存切 |
| D4 | **不并存**：`main` 只有 klinecharts，`vela` 分支只有 Vela，不做 `?chart=` 运行时开关 | 省掉 port 适配层（约 100–150 行 + 双实现维护）；代价见 §8.2 |

**D4 的直接后果**：这两条分支会长期分叉。业务层（`session.js` / `trade.js` / `ingest.js` / `download.js` / `db.js` / `theme.js`）与图表无关的改动仍可互相 cherry-pick，但 `main.js`、`draw.js`、`chart.js`、`workspace.js` 这几处一旦动手就是两条线，不再合并。所以 **`main` 在迁移期间要冻结图表相关改动**，只接业务和修 bug。

## 2. 现状盘点

`app/src` 共 14,018 行，其中 295 行是 `chart.js`（klinecharts 封装），**API 调用面却散在 17 个文件里**：

| klinecharts 方法 | 调用点 | 主要位置 |
|---|---:|---|
| `getDataList()` | 48 | `main.js`、`draw.js`、`pine*.js`、`session.js` |
| `getIndicators()` | 45 | `main.js`（图例/设置抽屉）、`indicators.js`、`pine.js` |
| `getOverlays()` | 43 | `main.js`、`draw.js`、`pineDraw.js`、`positionOverlay.js` |
| `removeIndicator()` | 28 | `main.js`、`indicators.js` |
| `removeOverlay()` | 17 | `draw.js`、`main.js` |
| `overrideOverlay()` | 12 | `draw.js`（拖拽提交）、`positionOverlay.js` |
| `createOverlay()` | 9 | `draw.js`、`pineDraw.js`、`positionOverlay.js` |
| `convertToPixel()` | 9 | `pineDraw.js`、`magnet.js`、`main.js`（十字光标读数） |
| `convertFromPixel()` | 3 | `crosshairSync.js`、`main.js` |
| `createIndicator()` / `overrideIndicator()` | 3 / 4 | `indicators.js`、`customIndicators.js`、`smc.js`、`flow.js` |
| `subscribeAction()` | 1 | `crosshairSync.js` |
| `setStyles()` / `resize()` / `setBarSpace()` | 4 / 5 / 1 | `theme.js`、`workspace.js`、`main.js` |

**关键结论**：`chart.js` 不是唯一的耦合点。48 处 `getDataList()` 说明业务代码直接摸 K 线数组——Vela 里对应的是 `chart.market` / 内部 `BarStore`，公开面上只能拿 `on('bar:changed')` 与 `getVisibleRange()`。所以迁移必须**先立一层 port**，否则要改 17 个文件。

## 3. Vela 能力对照（实测 API）

| 我们现在 | klinecharts 用法 | Vela 等价物（0.9.3 实测签名） | 判定 |
|---|---|---|---|
| 建图 | `createChart(el, {styles, layout})` | `new Vela(el, VelaOptions)` | 替换 |
| 全量数据 | `applyNewData(bars)` | `chart.setMarket({ data: OHLCV[], timeframe, symbol })`（`MarketSwitch.data` 走离线数据，`market.offline=true`） | 替换 |
| 增量推进 | `updateData(bar)` | `chart.replay.start({ from })` + `replay.step()` / `play(intervalMs)` / `stepUpdate()` | **可删自研 replay.js** |
| 回放速度 | 自家 timer 0.25×–16× | `play(intervalMs)` 只吃毫秒 → 速度映射表仍归我们（`replay:play` 回带 `intervalMs` 便于校速） | 适配 |
| 回放边界 | 自家 bounds | `chart.replay.bounds` / `state`（`ReplayState`） | 替换 |
| 多图分屏 | 自家 `workspace.js` + grid CSS | `new VelaWorkspace(el, { layout: '2h' \| '4' \| '8' })`，`cells()` / `cell(id)` / `setActiveCell()` | 替换 |
| 每格换品种 | `setCellSymbol()` 自研 | `ChartCell.setSymbol()` / `setTimeframe()` | 替换 |
| 跨图十字光标 | `crosshairSync.js`（104 行，`convertFromPixel` 反解） | `workspace.sync.set(kind, setting)` + `renderer.setExternalCrosshair(time, price)` | **可删 crosshairSync.js** |
| 绘图工具 | `app/vendor/klinecharts-extension` 20+ overlay 名 | `chart.drawings.setTool(type)` / `add(type, init)` / `update(id, patch)` / `removeMany(ids)`，类型走 `drawingTypes` 注册表 | **重写（映射表见 §5）** |
| 绘图持久化 | 自家 `draw:SYMBOL:PERIOD` 存 IndexedDB | `chart.drawings.toJSON()` / `fromJSON(doc)` ← `DrawingsDocument { version:1, drawings: SerializedDrawing[] }`；`workspace.getState()` 一次带走全部格子 | 简化 |
| 指标（内置） | `createIndicator(template)` | `addNativeIndicator(type, { inputs })`（`sma`、`vpvr`、`volume`…）+ `registerNativeIndicator()` 自注册 | **重写** |
| 指标（Pine） | 自接 PineTS 0.13.1 + 自研 `pineDraw.js` | `chart.registerEngine('pine', new PineEngine())` + `addIndicator(source, { inputs, pane })`（引擎来自 `@luxalgo/vela-pinets`） | **重写并删自研胶水** |
| 指标列表/图例 | `getIndicators()` 遍历 | `chart.indicators()` → `IndicatorHandle`（`id`/`visible`/`remove`）；`availableNativeIndicators()` 给"可添加"清单 | 替换 |
| 截图 | canvas → clipboard | `workspace.screenshot()` / `chart.renderer.screenshotCanvas()` | 替换（clipboard 逻辑留） |
| 主题 | `setStyles({candle, grid, axis})` | `new VelaTheme` 或 `theme: 'dark' \| 'light'`，`chart.setTheme()` / `workspace.setTheme()` | 适配（5 套主题 → 5 个 VelaTheme） |
| 可见区间 | `getVisibleRange()` / `scrollToDataIndex()` | `getVisibleRange()` / `setVisibleRange({from,to})` / `setVisibleRangePreset()` / `panBy(fraction)` | 替换 |
| 事件 | `subscribeAction('onCrosshairChange')` | `chart.on(ev, cb)`：`market:changed` / `load:start` / `load:end` / `replay:start,step,tick,play,pause,end` / `indicator:*` / `bar`；十字光标单独走 `chart.renderer.onCrosshairMove(cb)`（`CrosshairEvent` 给 `time`/`price`/OHLC） | 替换 |
| 坐标换算 | `convertToPixel/FromPixel` | **无公开访问器**；内部 `Projector`（`xOf`/`yOf`/`pxToPoint`）不对外 | 见 R1 |
| 本地化 | 无 | `setLocale('zh-Hans')`：自带 **20 套语言包，含 zh-Hans / zh-Hant**（`dist/locales/`） | **白捡（Vela 自带界面控件的中文）** |
| 撤销/重做 | 无 | `drawings.undo()/redo()/canUndo()/canRedo()` | **白捡** |
| 复制/粘贴/克隆绘图 | 无 | `drawings.copyToClipboard(ids)/paste()/clone(id)/duplicate(ids)` | **白捡** |
| 绘图层级/收藏 | 无 | `sendToBack(id)`、`favorites()/isFavorite(type)` | **白捡** |
| 对象树 / 数据窗口 / 符号搜索 | 自研 | `ObjectTree` / `DataWindow` / `SymbolPicker`（workspace 内置） | **白捡（要不要用另说）** |

## 4. 目标架构（D4：直接替换，不做双实现）

```
vela 分支                              main 分支（冻结图表层）
app/src/                               同结构，klinecharts
  vela.js       ← 新增：Vela 初始化 + 数据/回放/视图（替代 chart.js + replay.js）
  vela-draw.js  ← 新增：chart.drawings 封装（替代 draw.js）
  vela-ws.js    ← 新增：VelaWorkspace + setLayout + getState/applyState（替代 workspace.js）
  vela-ind.js   ← 新增：native indicator 注册 + Pine 引擎接线（替代 indicators.js 的 kline 部分）
  main.js       ← 改：只 import 上面四个，不 import 任何图表库
```

- 不写 `chartPort.js`：分支内没有第二种实现，port 只会是多余的一层间接。
- `crosshairSync.js` 直接删（用 `workspace.sync` + `setExternalCrosshair`）。
- `replay.js` 直接删（用 `chart.replay`）。
- `magnet.js`（82 行，`convertToPixel` 吸附）删掉，用 `drawings.setSnapMode()`。

**业务层要改的接口面**（因为 48 处 `getDataList()` 必须收敛）：

```js
// vela.js 暴露三个替代 getDataList() 的查询
barAt(time)        // 某根
lastBar()          // 当前游标那根（回放态 = 最后一根可见）
barsInRange(a, b)  // 区间（Pine 参数面板、统计用）
```

其余业务代码只改 `state.app.chart.getDataList()` → `state.app.bars.*`，机械替换。

## 5. 绘图工具映射表（需要实测逐条确认）

| 我们现有（klinecharts-extension overlay 名） | Vela `drawingTypes` | 备注 |
|---|---|---|
| `segment`（趋势线） | `trend-line` **[待实测]** | 名称待核 |
| `ray-line` / `straight-line` | 内置射线/延长线 |  |
| `horizontal-line` / `price-line` | 内置水平线/价格线 |  |
| `fibonacci` 系列（retracement/extension/segment/spiral/circle/fan） | 内置 fib 组 | 需核对我们自定义的 6 个 level 预设能否保留 |
| `parallel-channel` | 内置通道/平行通道 |  |
| `gann-box` / `measure` / `rect` / `circle` / `triangle` / `arrow` | 内置对应项 **[待实测]** |  |
| 涂鸦（free draw） | `DrawingPolyline` / `DrawingMode` |  |
| 每工具样式模板（`drawStyles.js` 192 行） | `SerializedDrawing.style` + `add(type, { style })` | 字段名不同，模板要重映射 |
| 绘图管理面板（全选/删除/清空周期） | `chart.drawings.removeMany(ids)` / `lock()` / `show()` | 面板 UI 保留，接新 API |

结论：**约 60% 可映射，艾略特波浪 6 个工具可能需要自研注册**（这是 §6 里 P3 的主要不确定性）。

## 6. 分阶段任务（D1–D4 之后的版本）

| 阶段 | 内容 | 产物 | 验收判据 | 人日 |
|---|---|---|---|---:|
| **P0 骨架 + 三个未知项验证** | vendor Vela（`app/vendor/vela/`）；`vela.js` 建空图；**验证 R1 坐标通路**、**vela-pinets 能否在本项目数据上跑指标**、**离线 `setMarket({data})` 的行为** | `vela.js`（骨架）、vendor 目录、`docs/VELA-P0-NOTES.md` | 三件事各有实测结论（能/不能/代价）；`check_js` 通过；空图能画出一根 K 线 | 2 |
| **P1 数据与回放** | **写 `vela-data.js` 自定义 `DataProvider`**（`getBars` 按 `{from,to,limit}` 从 IndexedDB 分块切片，**永不返回整段**）；**回放深度 = `bars` 参数 8k–20k**；设定起点/随机起点 → `setMarket({bars, visibleRange})` 重建（实测 40 ms 级）；`replay.start/step/play`；速度映射；离线数组仅留给 selftest/DEMO | `vela-data.js`，`replay.js` 删除 | 5,000 根首屏 ≤150 ms / 堆 ≤60 MB；20,000 根堆 ≤120 MB；任意日期跳转 ≤300 ms；回放组自检（3/9/18/29）全绿 | 3.5 |
| **P2 工作区与同步** | `VelaWorkspace` + `setLayout('2h'/'4'/'8')`；每格 `setSymbol/setTimeframe`；`sync.set()` 跨图同步；**TAB = `getState/applyState` 的工作区快照**（D3）；`volTag` 等状态栏接 `onCrosshairMove` | `vela-ws.js`，删 `workspace.js`/`crosshairSync.js` | 分屏 1–4 格可切；多品种同屏；十字光标同步；TAB 切换后布局/品种/游标全还原 | 4 |
| **P3 绘图** | 按 §5 映射表逐个接 `chart.drawings`；`drawStyles.js` 模板 → `SerializedDrawing.style`；绘图管理面板 → `removeMany/lock/show`；砍掉艾略特组（D2）；新建「撤销/重做」按钮（Vela 白给） | `vela-draw.js` | 每个工具：画出来 → 拖动 → 刷新后还在；绘图管理全选/删除可用；`Esc` 取消绘制 | 4 |
| **P4 指标** | `registerNativeIndicator` 重写关键位 5 / SMC 5 / flow / 自定义；图例 + 设置抽屉接 `chart.indicators()`；**Pine 换 `vela-pinets`**（D1）：`registerEngine('pine', new PineEngine())`、`addIndicator(src,{inputs,pane})`、删 `pineDraw/pineCore` 坐标层；`alert()` 接 `EngineAlert` | `vela-ind.js` | 每个指标给出「值/画法」截图；Pine 仪表盘、表格、`alert()` 面板仍工作；参数面板 `options` 仍出下拉 | 4.5 |
| **P5 收尾** | 5 套主题 → `VelaTheme`（含色盲）；截图 → `screenshotCanvas()`；`Esc`/右键/快捷键接 Vela keymap；`setLocale('zh-Hans')` 让 Vela 自带控件中文化；全量回归 + 文档 | 可交付的 vela 分支 | `?selftest=1..45`（改造后，main 已从 37 增至 45）全绿；包体与首屏对比记录；`main` 是否切换的结论 | 3 |

**合计 ≈ 21.5 人日**（2026-11-04 估算，基于 `main@7356dc2` 的代码面）。比 D4 之前少 1 人日（省掉 port），但**分叉成本不计在内**（见 §8.2）。

### 6.1 2026-11-05 修订：合计 24~25 人日

- main 此后又长出 **13 个提交**（实时行情 `live.js`/`liveStore.js`、SMC 改 overlay 渲染、换机迁移、exe 打包），其中 **6 个动图表层**，带来 **+5~6 人日**的计划外增量。
- P4 因 `vela-pinets` 实测可用（LuxAlgo Dashboard 全量脚本 ok、UDT/array/boxes ok、`strategy()` 出 trades）由 5 回落为 **4.5**。
- 逐项拆分、验收判据、执行顺序、风险编号（R11~R13）见 **[VELA-REMAINING.md](VELA-REMAINING.md)**；覆盖度实测矩阵见 **[VELA-PINETS-COVERAGE.md](VELA-PINETS-COVERAGE.md)**。

## 7. 风险与对策

| # | 风险 | 影响 | 对策 |
|---|---|---|---|
| R1 | **无公开 projector**：`time→x` 拿不到 | 只有「自己画」的代码受影响 | 主路：D1 已定用 `vela-pinets`，Pine 绘图交给引擎；备用：`registerRendererLayer()` 的插件层能拿 `CoordinateSystem.timeToX/yToPrice`（声明存在）——**P0 必须实测这条备用路**，否则以后想自绘任何东西都没接口 |
| R2 | **pre-1.0 版本漂移**（4 个月 47 个版本） | 迁移期 API 变动 | vendor 锁定 0.9.3 具体文件；P0 记录版本指纹；升级只走独立小提交 |
| ~~R3~~ | ~~艾略特 overlay 缺失~~ | — | **已关闭（D2 砍掉）** |
| R4 | Pine 引擎从 PineTS 直连换成 `vela-pinets`，**仍是 AGPL-3.0** | 许可性质不变 | 自用无碍；`NOTICE.md` 已声明。若要闭源分发需另行处理（与本次迁移无关） |
| R5 | Vela 包体更大（core 1.13 MB min，我们现有 klinecharts 240 KB） | 首屏 + | 本地自用、走 `file://`/本机 HTTP，非关键；记录实测对比即可 |
| R6 | 5 套主题（含色盲）要靠 `VelaTheme` 逐 token 映射 | 视觉回归 | P5 做主题截图对比，色盲主题单独校验 `--up/--down` 与 ▲▼ 是否仍由我们 CSS 提供 |
| R9 | **回填只有"初始化按 `bars` 翻页"**，往左拖不会自动拉更早历史（P0-c 实测） | 用户想看更早只能重建窗口 | 把「设起点 / 随机起点 / 日期定位」统一实现为 `setMarket({bars, visibleRange})`（40 ms 级）；禁用"拖到尽头自动加载"的预期 |
| R10 | **4M 根全量入内存 = 1 GB 堆**（P0-c 实测） | OOM / 卡顿 | `getBars` 内按 `limit` 自保截断；`bars` 默认 8k–20k；provider 永不返回整段 |
| R7 | `getDataList()` 48 处直接摸数组 | 业务层被牵连 | `vela.js` 只暴露 `barAt/lastBar/barsInRange` 三个查询，48 处机械替换（P1 内做） |
| R8 | **`main` 与 `vela` 长期分叉**（D4 的代价） | 图表层改动双向都得做两遍；`main.js` 会越差越远 | ①迁移期 `main` 冻结图表层，只接业务/修 bug；②`main.js` 里图表无关的部分（面板、TAB、报告）尽量在分支合并前同步一次；③设定时限：P0 起 6 周内出「切/不切」结论 |

## 8. 分叉管理与回滚（D4）

### 8.1 分支职责
| 分支 | 图表库 | 状态 |
|---|---|---|
| `main` | klinecharts 10.1.0 | **主线**，随时可用；迁移期冻结图表层改动（只接业务、修 bug、文档） |
| `vela` | Vela 0.9.3 + vela-pinets | 迁移实验，坏了自己修，不影响主线 |

### 8.2 分叉代价与对策
- **会双向漂移的**：`main.js`（4,025 行，UI 与图表混在一起）、`draw.js`、`chart.js`、`workspace.js`。
- **可安全 cherry-pick 的**：`session.js`、`trade.js`、`ingest.js`、`download.js`、`csvparse.js`、`zip.js`、`db.js`、`theme.js`、`instruments.js`、`tools/*`、`docs/*`。
- 对策：非图表改动**先落 `main`**，再 `git cherry-pick` 到 `vela`；反过来不要做（避免把 Vela 依赖带回主线）。
- 时限：P0 起 **6 周**内给「切 / 不切」结论，避免变成永久分叉。

### 8.3 回滚
- 单个阶段失败 → 在 `vela` 分支内 `git revert`，主线无感。
- 整体放弃 → `main` 原样不动，`vela` 分支归档（标记 `abandoned`），零成本。
- 决定切换 → `vela` 合入 `main` 后删分支；`app/vendor/klinecharts*` 与 `klinecharts-extension/` 一并删除（约 1.2 MB + 40 个文件）。

## 9. 决策记录

| # | 问题 | 决定 | 日期 |
|---|---|---|---|
| D1 | Pine 走哪条路 | **`@luxalgo/vela-pinets` 引擎**，自研 Pine 绘图层下掉 | 2026-11-04 |
| D2 | 艾略特波浪怎么办 | **砍掉**（6 个工具不给） | 2026-11-04 |
| D3 | TAB 与 workspace 关系 | **一个 `VelaWorkspace` + `setLayout()`**；TAB 变成工作区快照 | 2026-11-04 |
| D4 | 是否与 klinecharts 并存 | **不并存**，两分支各用一套，不做运行时开关 | 2026-11-04 |
| D5 | `vela-pinets` 能否覆盖 LuxAlgo 指标 | **能**：实测 Dashboard 全量脚本 ok（1 表/47 线/20 标签/5 框）、UDT+array 画框 ok、`strategy()` 出 21 笔 trades、`var table=na` 无需预处理补丁。带 `import LuxAlgo/...` 的脚本需要 `importResolver`，**暂按不支持记账** | 2026-11-05 |
| D6 | 与 `main` 落后的 13 个提交怎么处理 | **先整包 merge 进 `vela`**（实测零冲突），再在 P1–P5 里按 Vela 重做图表层；`main` 的图表层 WIP 处置完才真正冻结 | 2026-11-05 |

剩余待确认（不阻塞 P0）：裁掉艾略特后工具栏是否补别的形态（如「测量/持仓」上升为主按钮）；`zh-Hans` 内置文案与本项目自写中文是否统一口径。

## 10. 参考

- `docs/VELA-FEASIBILITY.md` — 可行性实测（包体、50k 根耗时、依赖）
- `node_modules/@luxalgo/vela/dist/*.d.ts` — 本文 §3 全部签名来源（0.9.3）
- `app/src/chart.js` / `draw.js` / `workspace.js` / `crosshairSync.js` / `replay.js` — 待收敛的现有实现
