# 回测口径与 TradingView 对账（vela 分支）

结论先行：**回测引擎（vendored PineTS）在市价成交时点、止损/止盈的 bar 内触发、pyramiding、手续费、滑点五项上与 TV 语义一致**；
不一致/未实现的是 `use_bar_magnifier`、`fill_orders_on_standard_ohlc`（只解析不生效，已在面板与存档里标 ⚠）。
统计层曾有两个偏差（手续费翻倍、口径快照恒空），已修。

可执行证据：`app/src/selftest47.js`（`?selftest=47`，纯合成 bar，不依赖行情）。引擎升级后这条必须重跑。

## 1. 方法

不能凭「bundle 里有这个参数名」判断支持 —— 参数名在 schema/默认值里各出现一次就能命中。做法是**同一脚本只换一个参数**，
用构造好的合成 bar 跑两次，比对 `closedtrades` 的开/平仓 bar 下标、成交价、净盈亏：

| 场景 | bar 设计 |
|---|---|
| 成交时点 | bar10 收盘触发信号；bar11 开盘 101、收盘 101；比较 entry_time 落在哪根 |
| stop 触发 | bar11 收盘才挂出 exit → bar12 只在下影线穿价（low 96 / close 100.5），收盘价不穿 |
| limit 触发 | 同上，bar12 上影线到 106 / close 100.5，挂 limit 103 |
| pyramiding | 连续同向信号，数同一方向同时存在的笔数 |
| 手续费/滑点 | 同一批信号分别加 `commission_*` / `slippage`，看净盈亏与成交价偏移 |

## 2. 实测结果（Pine v5，mintick 0.01）

| 口径项 | 实测行为 | 与 TV | 证据 |
|---|---|---|---|
| `process_orders_on_close=false`（默认） | 市价单在**下一根 bar 开盘价**成交 | 一致 | entry 落在 bar11，价 101 = bar11.open |
| `process_orders_on_close=true` | 市价单在**信号 bar 收盘价**成交 | 一致 | entry 落在 bar10，价 101 = bar10.close |
| `strategy.exit(stop=)` | 按 bar 内 **low** 触发，成交价 = 挂单价 | 一致 | bar12 close 100.5 > 99 仍成交 @99 |
| `strategy.exit(limit=)` | 按 bar 内 **high** 触发，成交价 = 挂单价 | 一致 | bar12 close 100.5 < 103 仍成交 @103 |
| `strategy.close` | 下一根 bar 开盘价成交 | 一致 | 出场 bar = 入场 bar + 1 |
| `pyramiding=N` | 同向最多 N 笔；`0` 与缺省都等于 1 笔 | 一致 | 缺省 1 / 3 → 3 / 9 → 9 |
| `calc_on_order_fills=true` | 成交后同 bar 重算，同 bar 平仓（净盈亏≈0） | 一致（会显著改变结果） | 持仓从 1 根缩到 0 根 |
| `slippage` | 单位是 **tick**（× mintick），0.5 → 偏移 0.005 | 一致 | entry 101 → 101.005 |
| `commission_type=cash_per_contract` | 每张每边扣 `commission_value` | 一致 | 净盈亏 −2 → −4 |
| `commission_type=percent` | 按名义金额百分比、每边扣 | 一致 | −2 → −2.2（0.1%） |
| `close_entries_rule` | FIFO / ANY 均实现 | 一致 | bundle 内有结算分支 |
| `backtest_fill_limits_assumption` | 已实现（单位 tick） | — | 未做用例，暂按默认 0 |
| `use_bar_magnifier` | **未实现**（只在 schema/默认值里） | 不一致 | 面板/存档标 ⚠ |
| `fill_orders_on_standard_ohlc` | **未实现** | 不一致 | 面板/存档标 ⚠ |

## 3. 本轮修掉的统计层偏差

1. **手续费翻倍**。引擎的 `grossprofit/grossloss` 已是**扣费后**口径，且 `grossloss` 存的是正数（`np = gp − gl`）；
   旧公式 `fees = (gp + gl) − netprofit` 在净亏时算成 2 倍（实测 −4 的交易报出 8）。
   改为逐笔反推：`fees = Σ[profit − (exit_price − entry_price) × size]`，取正值（cash_per_contract=1、51 笔 → 102，与 2×笔数吻合）。
2. **口径快照恒空**。`analyze()` 里写死 `parseStrategyParams('')`，`sum.params` 永远是 `{}`；改为把 `src` 传进来（`analyze({..., src})`），
   并新增 `btParity(src)` / `parityLabel(par)` 供面板、存档、CSV、对比表复用。
3. 存档/CSV/对比新增「口径」行：成交时点、是否 bar 内触发、pyramiding、滑点、手续费；A/B 口径不同时给「数字不可直接比」警示。

## 4. 已知残差（未修，按风险排序）

- **成交价按 mintick 取整**（0.01）：实测 close 100.1741 → 成交 100.17。黄金无影响；换到 5 位小数外汇/加密会引入 0.5 tick 级误差。
- **数据只有 1m 且成交量是 tick 计数**：量价/流动性类结论打折，与 TV 的 tick 级撮合不可能完全对齐。
- `request.security` 重绘 = 潜在未来函数：已检测告警，但没做「只用已闭合 HTF bar」的强制口径。
- `use_bar_magnifier` / `fill_orders_on_standard_ohlc` 标注为「引擎未实现」，**没有替代实现**；依赖它们的 TV 结论不能直接搬。
- 未做逐笔级别与 TV「导出交易列表」的实测对账（需 TV 账号手工导出，属人工环节）。

## 5. 复跑方式

```bash
python tools/serve.py --port 8733 --root .
chrome --headless=new --remote-debugging-port=9333 --user-data-dir=.chrome-profile \
  --disable-background-timer-throttling --disable-renderer-backgrounding \
  http://127.0.0.1:8733/app/index.html
python tools/run_selftests.py --port 9333 --tests 47 --fresh --timeout 120
```

失败时看 `window.__RESULT__.checks`：每个口径项都留了原始数值（bar 下标、成交价、费率），不是单纯 true/false。
