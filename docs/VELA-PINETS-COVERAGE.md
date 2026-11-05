# vela-pinets 对 LuxAlgo 指标的覆盖度（离线实测，2026-11-05）

环境：`@luxalgo/vela-pinets@0.3.2`（peer `pinets@0.13.1`，与本项目 `app/vendor/pinets.min.browser.es.js` 的 0.13.1 **同版本**）、Node 22、`PineEngine` 进程内直跑，合成 1m bars，`mode:'static'`。
复现脚本：`docs/probes/probe_pinets_cover.mjs`、`probe_security.mjs`、`probe_bridge.mjs`、`probe_imp.mjs`，结果 JSON 同目录。
跑法：`npm i @luxalgo/vela @luxalgo/vela-pinets pinets` 后 `node docs/probes/probe_pinets_cover.mjs`（纯 Node，无需浏览器）。

## 1. 结论

**可以用，而且比现在省事** —— 因为 vela-pinets 里跑的就是我们已在用的那个 PineTS 运行时；差别只在"外面那层桥"由 Vela 官方提供，我们不写。

## 2. 实测矩阵

| # | 用例 | 结果 | 实测数据 |
|---|---|---|---|
| 1 | **LuxAlgo Structure & Trend Dashboard 全量脚本**（本项目 `app/fixtures/*.pine`，302 行 v6，真实样本） | ✅ ok | prepare 37 ms / run 677 ms；输出 **1 表格**（2 列，`Trend`=`Bull` 单元格有值）、**47 线**、**20 标签**、**5 框**；内部 `request.security` 5 次全部走到 `fetchSeries` |
| 2 | 同图/同引擎连续两次跑同一脚本（P0-C 遗留的 `ok:false`） | ✅ ok | 两次都 ok（573 ms / 677 ms）⇒ P0-C 的 `ok:false` 是 `chart.runScript` 用法问题，**不是引擎限制** |
| 3 | `var table t = na` + `barstate.islast` 填格（LuxAlgo 面板通用写法） | ✅ ok | `cells` 数组有真实文本；**我们自己的预处理补丁（改写 `var` 赋值）在这里不需要** |
| 4 | `request.security` 多周期 / `[a,b]=request.security(...,[open,close])` | ✅ ok | `fetchSeries(symbol, timeframe, range)` → **返回 `OHLCV[]`**（不是包装对象，返回错形状会报 `bars.map is not a function`） |
| 5 | `request.security` **无** `fetchSeries`（跨品种、无数据源） | ✅ 不崩 | 值为 `na`，无异常（Pine 里 `na(v)` 判断可兜） |
| 6 | UDT（`type FVG`）+ `array.new<FVG>` + push/get + 循环画框（SMC 典型写法） | ✅ ok | 50 个 box |
| 7 | `strategy()` 脚本 | ✅ ok | `model.trades` = **21 笔 fills**（Vela 直接画到价格轴） |
| 8 | `alert()` | ✅ ok | 走 `onAlert` 回调（`model` 里没有 alerts 数组） |
| 9 | `label` 密集 + `max_labels_count=500` | ✅ ok | 500 个标签（Pine 默认 50 的语义保留） |
| 10 | `import LuxAlgo/Utilities/1 as u`（**无** resolver） | ❌ 明确报错 | `The script imports "LuxAlgo/Utilities/1" but no import resolver is configured` |
| 11 | 同上，**有** `importResolver` | ✅ ok | 返回库源码即可，1 个 series 正常出数 |

## 3. 四个必须打折的地方（不是"全覆盖"）

1. **`request.security` 的数据由宿主给**：跨品种脚本（`request.security("ETHUSDT", …)`）在我们单品种的 IndexedDB 数据下只能得到 `na`。同品种 HTF（`"240"`/`"D"`）也需要 provider 能按 timeframe 聚合后再交给 `fetchSeries`。**这是数据面（P1）的活，不是引擎的**。
2. **带 `import` 的 LuxAlgo 脚本需要 `importResolver`**：LuxAlgo 付费库里有一部分脚本 `import LuxAlgo/<lib>/<ver>`，没有解析器时**直接 prepare 失败**（实测报错原文见上表 #10）。要有库源码的合法来源才能补上，否则这类脚本用不了 —— 先按"不支持 import"记账。
3. **纯绘图/表格脚本没有图例数值**：Dashboard 这类脚本 `model.series` 为 0（实测），只有 tables/lines/labels/boxes。我们现在的桥靠"补一个占位 figure"凑出图例行，Vela 侧要确认图例对空 series 的表现，自检断言要按 `{indicators, totals}` 写。
4. **`barstate.isconfirmed` 在 static 模式末根 = 1**（实测 300 根，末根 `isconfirmed` 值 1、`islast` 值 1）。我们 WIP 里刚把口径改成"末根是正在走的那根，不算确认" —— **vela-pinets 默认不提供这个口径**；`mode:'live'` 下是否给出 0 未验证，这条留作 P4 前的必验项。

## 4. 对剩余工作量的影响

| 项 | 原估 | 修正 | 依据 |
|---|---:|---:|---|
| P4 的 Pine 部分（自研桥下掉、接引擎） | 含在 5 人日里 | **-1.5** | 表 #1/#3/#4/#7 全绿，不再需要 `pineCore`/`pineDraw` 的坐标层与预处理补丁 |
| P4 新增：`importResolver` 决策 + 接线 | — | +0.5 | 表 #10/#11；先做"不支持 import"也要在 UI 上给出明确报错 |
| P4 新增：live 模式 `isconfirmed` 口径对齐 | — | +0.5 | §3.4 |
| **P4 合计** | 5 | **≈4.5** | |

净影响：**总盘子从 25~26 人日降到 24~25 人日**，并且 P4 的最大不确定性（"vela-pinets 能不能跑 LuxAlgo 脚本"）**已经实测排除**。
