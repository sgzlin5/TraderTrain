# K 线库迁移方案：klinecharts 10.1.0 → Vela 0.9.3

> 分支：`vela`（从 `main@7356dc2` 拉出）。本文只写**可执行方案**，不含营销。目标库 API 全部取自本机实测的 `@luxalgo/vela@0.9.3` 类型声明（`node_modules/@luxalgo/vela/dist/*.d.ts`），标 **[待实测]** 的是声明存在但行为未验证的部分。

## 1. 结论

**可以迁，且净收益明确**，但不是"换图表库"，是**换掉一整层图表基础设施**。

- Vela 自带回放（`chart.replay`）、绘图（`chart.drawings` + `toJSON/fromJSON` 序列化）、多图工作区（`VelaWorkspace` 含 `sync` 跨图同步、`getState/applyState` 持久化）、截图（`screenshotCanvas()`），这些在我们项目里是自研的：`replay.js` 123 行 + `crosshairSync.js` 114 行 + `workspace.js` 249 行 + `chart.js` 295 行 ≈ **780 行可以直接删**；`draw.js` 385 行改写后也会瘦一半。另外白捡撤销/重做、复制粘贴、对象树、数据窗口（见 §3 末）。
- 代价是**绘图与指标全部要重写**：klinecharts 的 overlay 模板和 `createIndicator({ figures })` 在 Vela 里对应的是 **drawing types 注册表**和 **native indicator 插件**，不是参数级替换。
- 最大不确定项：Vela **没有公开的 projector**（`time→x` 只存在于内部 `Projector` 类型，`chart` 上没有访问器）。这会影响我们"用时间戳自己算坐标画 Pine line/box/label"的做法，需要用 `@luxalgo/vela-pinets` 引擎替代（见 §7 风险 R1）。

**前置决策**：迁移期间主线 `main` 继续用 klinecharts，`vela` 分支用 `?chart=vela` 开关并行开发，验收通过再合并（见 §8）。

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

## 4. 目标架构

```
业务层（不改或小改）
  main.js  session.js  trade.js  ingest.js  download.js  db.js …
        │  只认 Port 接口，不 import 任何图表库
        ▼
  app/src/chartPort.js        ← 新增：统一的图表能力接口（60–80 行）
        ├── app/src/chart-kline.js   ← 现有 chart.js/draw.js/workspace.js 收敛到这里（默认）
        └── app/src/chart-vela.js    ← 新增：Vela 实现
```

Port 接口草案（按 §2 的实际调用面倒推，只保留业务需要的）：

```js
// 生命周期
mount(el, opts) / destroy() / resize()
// 数据与回放
setBars(bars, {symbol, timeframe}) / cursorTime() / seek(ts)
replay: { play(ms) / pause() / step(n) / stop() / onState(cb) }
// 视图
visibleRange() / setVisibleRange(r) / onCrosshair(cb)   // cb: {time, price, ohlc}；Vela 侧接 renderer.onCrosshairMove
// 绘图
drawings(): { list() / add(type, pts, style) / update(id, patch) / remove(ids) / select(id) / setTool(type) }
        + persist(): {load(key), save(key, doc)}
// 指标
indicators(): { list() / add(src|type, inputs) / remove(id) / setVisible(id, v) }
// 多图
layout: { cells() / setLayout(spec) / setActive(id) / setCellMarket(id, {symbol, timeframe}) / sync(kind, setting) }
// 输出
screenshotCanvas()
```

`?chart=vela` 决定 `chartPort.js` 里实例化哪个实现；两套实现共用同一个 `selftest`。

## 5. 绘图工具映射表（需要实测逐条确认）

| 我们现有（klinecharts-extension overlay 名） | Vela `drawingTypes` | 备注 |
|---|---|---|
| `segment`（趋势线） | `trend-line` **[待实测]** | 名称待核 |
| `ray-line` / `straight-line` | 内置射线/延长线 |  |
| `horizontal-line` / `price-line` | 内置水平线/价格线 |  |
| `fibonacci` 系列（retracement/extension/segment/spiral/circle/fan） | 内置 fib 组 | 需核对我们自定义的 6 个 level 预设能否保留 |
| `parallel-channel` | 内置通道/平行通道 |  |
| `abcd` / `xabcd` / `oneWave`…`eightWaves`（艾略特） | **可能没有** | 若缺，需 `registerDrawingType()` 自实现 6 个 |
| `gann-box` / `measure` / `rect` / `circle` / `triangle` / `arrow` | 内置对应项 **[待实测]** |  |
| 涂鸦（free draw） | `DrawingPolyline` / `DrawingMode` |  |
| 每工具样式模板（`drawStyles.js` 192 行） | `SerializedDrawing.style` + `add(type, { style })` | 字段名不同，模板要重映射 |
| 绘图管理面板（全选/删除/清空周期） | `chart.drawings.removeMany(ids)` / `lock()` / `show()` | 面板 UI 保留，接新 API |

结论：**约 60% 可映射，艾略特波浪 6 个工具可能需要自研注册**（这是 §6 里 P3 的主要不确定性）。

## 6. 分阶段任务

| 阶段 | 内容 | 产物 | 验收判据 | 人日 |
|---|---|---|---|---:|
| **P0 骨架** | vendor Vela（`app/vendor/vela/`，与 klinecharts 并存）；`chartPort.js` 抽接口；`?chart=` 开关；两套 selftest 跑通空图 | `chartPort.js`、`chart-vela.js`（空壳）、vendor 目录 | `?chart=vela` 能建空图、`?chart=kline` 行为零变化；`check_js` 通过 | 2 |
| **P1 数据与回放** | 二进制 → `OHLCV[]`；`setMarket({data})`；接 `replay.start/step/play/stop`；速度映射表；随机起点 | 回放走 Vela | `selftest` 回放组（3/9/18/29）在 vela 模式下全绿；4M 根加载 < 5 s、内存 < 400 MB | 3 |
| **P2 多图与同步** | `VelaWorkspace` 替换 `workspace.js`；每格 `setSymbol/setTimeframe`；`sync.set()` 开十字光标；TAB = 多 workspace 实例；`getState/applyState` 接现有 `ui:tabs` | 多图/多品种/同步 | 分屏 1/2/3/4、多品种同屏、十字同步（selftest 14/15/37-C1）全绿 | 4 |
| **P3 绘图** | 按 §5 映射表接 `chart.drawings`；样式模板重映射；绘图管理面板改 `removeMany`；缺的工具用 `registerDrawingType` 补 | 20+ 工具可用 | 每个工具至少一次「画出来 → 拖动 → 刷新后还在」；selftest 4/7/8/16/23/36-D3 全绿 | 5 |
| **P4 指标** | 内置指标改 `registerNativeIndicator`（关键位 5 / SMC 5 / flow / 自定义）；图例与设置抽屉接 `indicator.handle`；Pine 换 `@luxalgo/vela-pinets` 引擎，删 `pineDraw.js`/`pineCore.js` 的坐标层 | 指标库全量可用 | 每个指标给出"值/画法"截图；Pine 仪表盘/表格/`alert()` 面板仍工作 | 5 |
| **P5 收尾** | 5 套主题 → `VelaTheme`；截图 → `screenshotCanvas()`；`Esc`/右键菜单/快捷键接 Vela 的 keymap；删 `crosshairSync.js`、`replay.js`、`chart.js` 旧实现；文档与 `?selftest` 全量回归 | 主线可合并 | `?selftest=1..37` 全绿；`check_refs` 干净；包体与首屏对比记录 | 3 |

**合计 ≈ 22 人日**（与 `docs/VELA-FEASIBILITY.md` 的 17–27 区间一致）。P3、P4 是唯一可能超支的两段。

## 7. 风险与对策

| # | 风险 | 影响 | 对策 |
|---|---|---|---|
| R1 | **无公开 projector**：`time→x` 拿不到，自研 `pineDraw.js`（用时间戳二分映射画 line/box/label）无路可走 | Pine 绘图失效 | 改用 `@luxalgo/vela-pinets` 的 `PineEngine`，让 Vela 自己画；或注册 renderer layer 在插件层拿 `CoordinateSystem`（`timeToX/yToPrice` 有声明）——P0 阶段先验证这条通路 |
| R2 | **pre-1.0 版本漂移**（4 个月 47 个版本） | 迁移期 API 变动 | vendor 锁定 0.9.3 具体文件；P0 记录版本指纹；升级只走独立小提交 |
| R3 | 艾略特 6 个 overlay 可能不存在 | 功能缺口 | P3 先实测，缺则 `registerDrawingType` 自研（估 +2 人日，已含在 P3） |
| R4 | Pine 引擎从 PineTS 直连换成 `vela-pinets`，**仍是 AGPL-3.0** | 许可性质不变 | 自用无碍；`NOTICE.md` 已声明。若要闭源分发需另行处理（与本次迁移无关） |
| R5 | Vela 包体更大（core 1.13 MB min，我们现有 klinecharts 240 KB） | 首屏 + | 本地自用、走 `file://`/本机 HTTP，非关键；记录实测对比即可 |
| R6 | 5 套主题（含色盲）要靠 `VelaTheme` 逐 token 映射 | 视觉回归 | P5 做主题截图对比，色盲主题单独校验 `--up/--down` 与 ▲▼ 是否仍由我们 CSS 提供 |
| R7 | `getDataList()` 48 处直接摸数组 | 业务层被牵连 | Port 只暴露 `barAt(time)` / `lastBar()` / `barsInRange()` 三个方法，把 48 处改成按需查询（P1 做，不计入 P2 的 4 天） |

## 8. 回滚与并行策略

1. **分支隔离**：迁移只在 `vela` 分支；`main` 保持 klinecharts，随时可发。
2. **运行时开关**：`?chart=vela|kline`，默认 `kline`；`localStorage['ui:chartlib']` 记忆选择。
3. **硬开关条件（任一不满足就不合并）**：`?selftest=1..37` 全绿；P1–P4 的验收判据全部满足；主线 30 分钟压测无内存增长。
4. **回滚**：删 `chart-vela.js` 与 vendor 目录，端口恢复 `chart-kline`，不改业务层——这是 Port 层存在的唯一理由。

## 9. 待确认（开工前需要你拍板）

1. **Pine 路线**：用 `@luxalgo/vela-pinets`（省 2–3 人日，但把绘图/表格全交给它，行为可能与我们现在的 DOM 表格不同），还是保留自研 Pine 层 + 只把坐标换算换成插件层（多 2–3 人日，行为可控）？
2. **艾略特波浪**：如果 Vela 没有，是自己补 6 个 drawing type，还是直接砍掉这组工具？
3. **TAB 与 workspace**：每个 TAB 一个 `VelaWorkspace` 实例（隔离好、内存高），还是一个 workspace 用 `layout` 切换格数（内存低、状态耦合）？
4. **是否保留 klinecharts 长期并存**：如果只打算迁完就删，Port 层可以更薄（少写 100 行适配），但并行期风险更高。

## 10. 参考

- `docs/VELA-FEASIBILITY.md` — 可行性实测（包体、50k 根耗时、依赖）
- `node_modules/@luxalgo/vela/dist/*.d.ts` — 本文 §3 全部签名来源（0.9.3）
- `app/src/chart.js` / `draw.js` / `workspace.js` / `crosshairSync.js` / `replay.js` — 待收敛的现有实现
