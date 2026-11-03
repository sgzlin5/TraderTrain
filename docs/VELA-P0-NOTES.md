# P0 验证记录：Vela 0.9.3 + vela-pinets

环境：`@luxalgo/vela@0.9.3`、`@luxalgo/vela-pinets`（含 pine 运行时）、esbuild 打包（2.21 MB 未压缩），静态页 `127.0.0.1:8732`，Chromium 实测。数据为合成 3,000 根 1m（价格 ~2000）。

![P0 实测](vela-p0.jpg)

## 结论速览

| 项 | 结论 | 依据 |
|---|---|---|
| A 离线数据 | **可用** | `setMarket({ data, symbol, timeframe })` → `market.offline === true`，K 线正常绘制 |
| B 回放 | **可用且字段够用** | `replay.start/step/play(ms)/pause/stop`、`state`、`bounds`、`replay:*` 事件全部按声明工作 |
| C Pine（vela-pinets） | **能跑通，但第二次调用返回 ok:false** | 首个脚本 `ok:true`；同一图上再跑第二个脚本 `ok:false`（原因未捕获，见 §5） |
| D 工作区 | **可用**，`applyState` 往返正常 | `layout '2h'→'4'→'8'` 格子数 2→4→8；快照恢复后回到 8 格 |
| E 自绘坐标（R1 备用路） | **成立** | `registerRendererLayer` 的 `render(args)` 里 `args.coords` 有 `timeToX / priceToY / yToPrice / xToLogical / setBars` |

## 1. A · 离线数据

```js
await chart.setMarket({ symbol:'DEMO', timeframe:'1m', data: bars });
await chart.ready();
```

- `chart.market` → `{ offline:true, symbol:'DEMO', timeframe:'1m' }`
- `getVisibleRange()` → 默认只框住尾部 **180 分钟**（3000 根 1m 里最后 180 根）。**首屏默认窗口是 180 根左右**，我们要的是"看得见一段历史"，所以 P1 必须显式给 `visibleRange`（`MarketConfig.visibleRange` 支持 preset 或 `{from,to}`）。
- `chart.inspect()` 的键是 `['indicators','totals']`，**不是** `series/drawings/fills`（可行性文档里按类型名猜的那套不对），自检断言要按实际结构写。

## 2. B · 回放

`replay.start({ from })` 之后：

```json
{ "active": true, "playing": false, "cursorTime": 1767387600000,
  "remaining": 299, "nextTime": 1767387660000, "intervalMs": 1000 }
```

- `step()` 返回 `true`（还有下一根）/`false`（到头），**语义正好是我们回放条要的**。
- `play(120)` → `state.intervalMs = 120`；700 ms 内触发 4 次 `replay:step`（≈ 120 ms/次，符合预期）。
- `bounds` → `{ first, last }`（epoch ms），随机起点/进度条直接用它。
- `replay:end` 的 `reason` = `stopped`（也支持 `finished` / `market`）。
- **注意**：`intervalMs` 是"每次揭示一根"的间隔，我们的 0.25×–16× 需要一张映射表（例如 0.25× → 4000 ms，16× → 60 ms）。

## 3. C · Pine（vela-pinets）

```js
chart.registerEngine('pine', new PineEngine());
const r1 = await chart.runScript('//@version=6\nindicator("p0","p0",overlay=true)\nplot(close, color=color.yellow)', { id:'p0ind' });
// → ok:true；handle 出现在 chart.indicators() = [{id:'p0ind', visible:true}]
```

`run` 的字段：`id, title, kind, cause, first, bar, time, forming, complete, plots, vars, warnings, trades, series` —— **`warnings` 和 `trades` 直接给了我们原来要自己抽的东西**（策略回测统计可以少写一层）。

**问题**：同一图第二次 `runScript`（换 `id` 或换脚本）返回 `ok:false`，且 `error` 字段没被捕获到（我的探针只打了 `res.error`，实际可能在 `warnings`/异常里）。P4 开工前必须先把这个搞清：
- 是 `id` 重复（第一次用了 `p0ind`，第二次 `p0b`，应当不冲突）；
- 还是引擎不支持同图多脚本；
- 还是需要在 `market:changed` / `bars` 就绪后再跑。

→ 记为 **P4 前置实验 #1**。

## 4. D · 工作区

```js
new VelaWorkspace('#c2', { layout:'2h', theme:'dark',
  cells: { a:{symbol:'AAA',timeframe:'1m',data:bars}, b:{symbol:'BBB',timeframe:'5m',data:bars} } })
```

- `cells()` → `['a','b']`；`setLayout('4')` → `['a','b','c1','c2']`；`setLayout('8')` → 8 格 ✓（**D3 决策可行**）
- 每格离线数据用 `cells[id].data` ✓（`CellSeed.data` 明确支持"replaces the provider (boot-only)"）
- `getState()` → `{ version, layout, timezone, sync, charts, activeCellId }`；`charts` 里每格有 `symbol/provider/timeframe/priceStyle/bars/session/watermark/indicatorTitles/indicatorValues/statuslineParts/rendererConfig/drawings/indicators`
- `applyState(snap)` 往返：8 格快照 → 切到 `2h` → `applyState` → 回到 8 格且 id 一致 ✓（**TAB 快照方案可行**）
- 内置顶栏显示 `AAA · 1M` / `BBB · 5M` 与成交量（见截图），我们的 `volTag`、格子品种标签要跟它对齐，别做两套。

## 5. E · 自绘坐标（R1 备用通路已证实）

```js
registerRendererLayer({ id:'p0probe', create: () => ({
  mount(canvas) {}, render(args) { /* args.coords.timeToX(...) */ } }) });
```

实测 `render(args)` 里 `args.coords` 方法齐全：`['timeToX','yToPrice','xToLogical','priceToY','setBars']`，`args.bars` 是当前视图的 OHLCV 数组。

- 结论：**即使将来要自己画任何东西（自定义指标 painter、Pine 之外的图形），通路是有的**，不必依赖 `vela-pinets`。
- 注意：首帧 `args.bars.length === 0`，要等 `bars` 事件或下一帧才拿到数据 —— 自绘层必须处理空数组。

## 6. 对迁移方案的影响

1. **P1 增加一项**：显式 `visibleRange`（默认 180 根太短，不符合"打开就看到一段历史"）。
2. **P4 增加前置实验**：同图多脚本 `runScript` 的 `ok:false` 问题（§3）。
3. **P2 简化**：`cells[id].data` 直接支持离线数据，**不需要写 DataProvider**；但"增量追加"（我们现有的 append 语义）在离线模式下是整表替换 → 追增量时要么重建 `setMarket`，要么改用自定义 `DataProvider`（`MarketDataFeed`/`DataProvider` 接口）。→ **P1 内定方案**。
4. `inspect()` 结构与我们预想不同，自检断言按 `{indicators, totals}` 写。
5. 包体：esbuild 打包 vela+vela-pinets+workspace = **2.21 MB**（未压缩，min 后估算 ~1.3–1.5 MB），对比现状 klinecharts 240 KB + pinets 796 KB ≈ 1.04 MB，**净增约 0.3–0.5 MB**，本地自用可接受。

## 7. 复现方式

```bash
cd %LOCALAPPDATA%\Temp\vela-spike
npm i @luxalgo/vela @luxalgo/vela-pinets esbuild
npx esbuild p0.js --bundle --format=esm --minify --outfile=p0.bundle.js
python -m http.server 8732 --bind 127.0.0.1
# 打开 http://127.0.0.1:8732/p0.html ，页面右上角打印 window.__P0__
```
