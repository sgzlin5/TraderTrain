# 让 LuxAlgo 一类 Pine 脚本「直接拿来用」：现状与补丁计划

目标脚本样本：`Structure & Trend Dashboard`（LuxAlgo，Pine v6，2026-11 版）。

## 一、现在能跑到什么程度（实测）

| 能力 | 状态 | 证据 |
|---|---|---|
| v6 语法解析 | ✅ | `ctx.pineVersion = 6`，`switch / array / ta.pivothriv/pivotlow / valuewhen / hline` 全部通过 |
| 指标数值输出（plot） | ✅ | 正常脚本 `names` 有输出 |
| `barstate.islast` | ✅ 已修 | 源码预处理替换为 `bar_index >= N-1`；`plot(barstate.islast?1:0)` 末值 = 1 |
| `var table x = cond ? table.new(...) : na` | ✅ 已修 | 运行时会把变量存成 `na`（对象已建、后续 `.cell()` 全空操作）；预处理改写为直接赋值 |
| 表格 `table.*` | ✅ 已渲染 | LuxAlgo 面板实测 33 个单元格、6 处合并，DOM 面板渲染出 `Trend Alignment / HTF / LTF / 1D (Bear) …` |
| `label.*` / `box.*` / `line.*` | ✅ 已渲染 | 183 条线 / 5 个框 / 78 个标签全部带 x（bt 时间戳）并画在图上 |
| `time` / `time_close` / `hour` 等时间内建 | ✅ 已修 | 根因是 bar 少了 `openTime/closeTime` 字段；补齐后 `time=1782539880000`、`hour=5`、`time[5]` 有值 |
| `request.security` 多周期 | ✅ 已修 | 同一根因；`security(…,"60",close)=4089.248`、`"240"` 也有值，LuxAlgo 面板 6 个周期全是真实方向 |
| `strategy.*` | ❌ 不执行 | 设计如此（只支持 indicator） |

## 二、已落地的补丁（不动 vendor，全部在应用侧）

1. `app/src/pine.js → preprocessPine()`
   - `barstate.islast / isconfirmed / isnew / isfirst / islastconfirmedhistory` 语义补齐。
   - `var <table|line|label|box|polyline> x = <cond> ? <expr> : na` → 直接赋值。
2. `app/src/pineDraw.js`（新增）
   - `collectDrawings(plots)`：从 `__tables__ / __labels__ / __boxes__ / __lines__` 伪序列里取出对象并去重。
   - `drawPineDrawings()`：canvas 侧画 label / box / line（坐标可用时）。
3. `PineManager`
   - 表格改用 **DOM 面板**渲染（`.pine-board`，贴图表角落、跟随 position），原因是纯绘图脚本数值全空时 canvas 的 `draw` 不会被调用；
   - 模板在没有 `plot()` 时补一个占位 figure，保证 draw 有机会执行；
   - 移除指标时同步移除 DOM 面板。

## 三、全部完成（2026-11-02 收尾）

| # | 任务 | 结果 |
|---|---|---|
| 1 | `time / time_close / hour` 等时间内建 | ✅ 一行修好：喂给运行时的 bar 补 `openTime / closeTime`（`toPineBars()`） |
| 2 | `request.security` 多周期 | ✅ 同一处修复即通（运行时内部会自己聚合） |
| 3 | 绘图对象 x 坐标 | ✅ 时间可用后 183/183 线、5/5 框、78/78 标签都带坐标；`pineDraw` 里加 时间→下标 的二分映射 |
| 4 | UDT / `array.new<T>` / 方法语法 | ✅ 原脚本 `type FVG` + `array.new<FVG>()` + `tb.cell()` 全通 |
| 5 | 面板样式 | ✅ 表格走 DOM（`.pine-board`），行分隔线、等宽数字、不拦截鼠标 |

## 四、验收方式

- 脚本库粘贴 LuxAlgo 原始脚本 → 「检查代码」→ 「应用」，预期：图上出现 `Trend Alignment` 面板且前 3 列有值。
- 现有自检：`?selftest=29`（v6 + 兼容预检）、`?selftest=26/27`（Pine 参数面板/持久化）。
- 面板渲染回归：`document.querySelectorAll('.pine-board td').length > 20`。
