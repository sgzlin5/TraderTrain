# Pine 支持现状（2026-11-03）

运行时：**PineTS 0.13.1**（`app/vendor/pinets.min.browser.es.js`，810 KB，npm 最新版，2026-10-27 发布，AGPL-3.0-only，纯自用无义务）
桥接层：`pine.js`（编译/缓存/指标注册）+ `pineDraw.js`（line/box/label/table 渲染），共 ≈680 行
自检：`?selftest=3 / 26 / 27 / 29 / 30 / 35`

> PineTS 就是 Vela 官方 addon（`@luxalgo/vela-pinets`）跑的那个运行时。我们用的版本与最新一致，差别只在**外面那层桥**：Vela 帮你处理好 worker、inputs schema、数据缓存；我们自己做。

---

## 一、实测矩阵（23 类脚本，全部编译通过并核对了输出）

| # | 特性 | 结果 | 实测证据 |
|---|---|---|---|
| 1 | `plot` + `input.int` | ✅ | 输出 1 条序列 |
| 2 | `ta.ema / ta.rsi / ta.atr / ta.crossover` | ✅ | ema 4078.03、rsi 85.94 |
| 3 | `ta.pivothigh / pivothigh` | ✅ | 输出摆动值 |
| 4 | `plotshape / plotchar` | ✅ | 2 条输出 |
| 5 | `bgcolor / fill` | ✅ | 4 条输出（含填充色序列） |
| 6 | `hline(70)` | ✅（降级） | 变成 1200 点常量序列（视觉等价） |
| 7 | `request.security(sym, "240", ...)` | ✅ | c4 = 4089.248 |
| 8 | `request.security_lower_tf` | ✅ | `array.size` = 1 |
| 9 | `line.new / label.new / box.new` | ✅ | 1 线 / 1 标签 / 1 框，带 `x1,y1,x2,y2` |
| 10 | `table.new / table.cell` | ✅ | 1 表 / 2 格（走 DOM 覆盖层渲染） |
| 11 | `var / varip` | ✅ | 累加值正确 |
| 12 | `for` / `for-in` | ✅ | — |
| 13 | `array.* / map.*` | ✅ | map.get = 1.5 |
| 14 | `matrix.*` | ✅ | matrix.get = 2.5 |
| 15 | `str.* / math.*` | ✅ | — |
| 16 | `switch` / `match` | ✅ | — |
| 17 | 自定义类型（UDT `type Pivot`） | ✅ | 字段可读写 |
| 18 | `method` 声明 | ✅ | — |
| 19 | `strategy.*` | ⚠️ 编译通过、**无输出** | `ctx.strategy` 存在，但没图表/成交统计 |
| 20 | `alertcondition / alert` | ⚠️ 编译通过、**无落点** | 没有提醒面板/推送 |
| 21 | `barstate.islast / isconfirmed / isnew` | ✅ | 历史数据恒 1（回溯场景语义正确） |
| 22 | `syminfo.mintick / tickerid / pricescale / timezone` | ✅（本轮修复） | 0.01 / XAUUSD / 100 / UTC |
| 23 | `time / time_close / timestamp` | ✅ | `time` = 1782539880000 |

`?selftest=35` 已把其中 9 组关键项固化成回归（554 ms 通过）。

## 二、本轮修掉的问题

**`syminfo.mintick` 一直是 NaN。** 根因：PineTS 只在 `source` 是 **provider 对象**时才调 `getSymbolInfo()`，我们传的是裸数组，于是整个 syminfo 都是默认空值。

修法（`pine.js`）：包一层最小 provider —— `getMarketData()` 返回我们的 bars，`getSymbolInfo()` 按品种精度给 `mintick / pricescale / tickerid / timezone / session`。
效果：`mintick=0.01`、`tickerid=XAUUSD`、`pricescale=100`、`timezone=UTC`，依赖最小变动/点数计算的脚本（ATR 止损、tick 过滤、价格取整）不再出错。

## 三、仍然存在的差距

| 差距 | 影响 | 修法 / 成本 |
|---|---|---|
| **没有 Worker** | 重脚本同步阻塞主线程：轻脚本 10 ms，1.8 万次迭代 **1,084 ms**，再重直接 >5 s 卡住 | PineTS 支持 worker 模式，接进来约 **1 天** |
| `strategy.*` 不产出成交 | 策略脚本只能看图形，没有回测统计 | 读 `ctx.strategy` 的交易列表 → 复盘档案，**2–3 天** |
| `alert()` 无落点 | 提醒类脚本静默 | 加提醒面板/桌面通知，**1 天** |
| 只算当前窗口（1200 根） | `bar_index` 是窗口内下标；长周期统计需更大窗口 | 可选扩大到 5k–10k 根（内存/耗时线性） |
| 单品种数据 | 跨品种 `request.security("BTCUSDT", …)` 拿不到 | 需要多品种数据源，暂不做 |
| 表格走 DOM | 截图/导出时表格是 DOM 覆盖层（已随窗口一起截） | 已处理 |
| `max_labels_count` 默认 50 | 每根都画标签的脚本只显示 50 个（Pine 原生默认值，脚本里写 500 就生效） | 无需改 |

## 四、和 Vela 的关系

- 同一个运行时：Vela 的 Pine 能力 = PineTS + 他们的 addon 外壳（worker、inputs schema、`request.security` 缓存、图表坐标映射）。
- 我们已经**自建了等价外壳**：inputs schema（含 `input.timeframe` 下拉）、`request.security`（补 `openTime/closeTime` 后可用）、`xloc.bar_time` 的二分映射、表格 DOM、`barstate.islast` 与 `var table` 两个预处理补丁。
- 所以「换 Vela」在 Pine 这块**不带来新能力**，只是省掉外壳维护——这与 `docs/VELA-FEASIBILITY.md` 的结论一致：迁移的收益不在 Pine。

## 五、建议的下一步（按性价比）

1. **接 Worker**（1 天）：`heavyMs` 从秒级阻塞降到 0，这是目前唯一会「卡住整个 app」的问题。
2. **strategy 交易列表 → 复盘统计**（2–3 天）：补上 v2 计划里的策略支持。
3. **alert 面板**（1 天）：脚本提醒落到列表 + 桌面通知。
4. 可选：窗口长度做成设置项（1 2 0 0 → 可调 5k）。

## 六、复现

```
?selftest=35     # 支持矩阵抽样（9 组：TA / syminfo / security / 绘图 / 表格 / 语言特性 / strategy / barstate / 性能）
?selftest=30     # LuxAlgo Structure & Trend Dashboard 全量脚本
?selftest=26     # 参数面板（input.int/float/bool/source/timeframe）
```
