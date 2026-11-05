# 剩余工作量评估：klinecharts → Vela 核心切换（2026-11-05）

> 承接 [VELA-MIGRATION.md](VELA-MIGRATION.md)（方案 + D1–D4 决策）与 [VELA-P0-NOTES.md](VELA-P0-NOTES.md)（P0 实测）。
> 本文只回答一件事：**从当前分支状态到「可交付的 vela 分支」还差什么、多少人日、按什么顺序。**
> 全部数字取自本机实测（命令见 §8），不是估着写的。

## 0. 分支现状（实测）

| 项 | 事实 |
|---|---|
| 工作副本 | `D:/Crypto/code/TraderTrain-vela`，分支 `vela`，工作树 clean，HEAD = `origin/vela` = `396f2b5` |
| vela 独有提交 | 6 个，**全部是 `docs(vela):`**，无一行代码 |
| 代码基线 | vela 的 `app/src/*.js` blob 与 `merge-base(vela, main)` **逐个相同** ⇒ 图表层改动为 **0** |
| 已完成 | P0 五项实测（离线数据/回放/pinets/workspace/自绘坐标）+ provider 模式 + 4M 根回填决定性实测 |
| 未开始 | P1–P5 全部 |

**结论：核心切换的代码进度 = 0%。已投入的 2 人日全部是可行性实测与方案，换来的价值是"未知项已清零"（R1 关闭、数据模式已定、内存上限已量化），不是"迁移做了一半"。**

## 1. 与 main 的差距（原计划没算的部分）

vela 从 `main@7356dc2` 拉出后，main 又前进 **13 个提交**（含实时行情、SMC 重画、换机迁移、exe 打包）。

**合并本身不贵**：`git merge-tree --write-tree origin/main origin/vela` → rc=0，零冲突（vela 没动过代码文件）。一次 merge 即可。

**贵的是 merge 进来的东西要靠 Vela 重新实现** —— 这 13 个提交里有 6 个直接动图表层：

| 提交 | 内容 | 对 vela 的含义 |
|---|---|---|
| `e01e1d0` `5da3084` | SMC / FVG / ICT 杀区 / 波段结构改 overlay 渲染，新增 `smcRender.js` 218 行 | Vela 没有 klinecharts 的 overlay 模板机制，只能走 `registerRendererLayer` 自绘或 native indicator painter |
| `f4bb41d` `023daab` | 内置 EMA / RMA / ZLEMA（新增「均线」分类） | 并入 P4 的 native indicator 重写，指标条数比原计划多 |
| `58e6f0c` `49f3ec5` `3e5ffae` `6d80d85` `c36fc0f` `cc43a64` | `live.js`/`liveStore.js` 实时采集、3 s→1 s 轮询、回放/实时互斥、「跳到最新 K 线」 | Vela 侧走 `MarketDataFeed.subscribe(onBar)` 推进 forming bar（P0-b 只标了"将来可用"，没实测） |

其余（`7f249ed` `8151de3` 补缺口、`dd2fb1a` 换机迁移/打包、`58e6f0c` 里的 `transfer.js`）与图表无关，merge 后可直接沿用。

**主线还挂着未提交的 WIP**（`main` 工作区 12 文件，+406/−90），其中 4 个是图表层：

- `chart.js` +16：`_warmPrev()` 空闲预读上一屏 → **在 provider 模式下作废**（R9 已定用 `setMarket({bars, visibleRange})` 重建窗口）
- `pineCore.js` ±1：`barstate.isconfirmed` 改成 `bar_index < n-1` → **迁到 vela-pinets 后这层自研预处理直接消失**，同等口径要在引擎侧重新对齐，不能丢
- `smcRender.js` +41、`main.js` +129/-…：随 P3/P4 重做

⇒ **「main 冻结图表层」事实上没做到**。WIP 要么先落 main 再在 vela 上重做，要么明确弃掉图表层那部分（保留 `fmt.js`/`package.json`/`eslint.config.js`/`tools/run_selftests.py`/`packaging/inno` 这些纯工程件）。

## 2. 原计划剩余：P1–P5 = 19.5 人日

（逐项判据沿用 MIGRATION §6，这里只标依赖顺序与前置）

| 阶段 | 内容 | 人日 | 前置 / 依赖 |
|---|---|---:|---|
| **P4-a 前置实验** | **live 模式 `barstate.isconfirmed` 口径**（static 实测末根 = 1，我们要「末根未确认」）+ `importResolver` 的取源策略；原「同图第二次 `runScript` 返回 `ok:false`」已于 2026-11-05 关闭（`PineEngine` 连跑两次均 ok） | 0.5 | 无；**必须在 P4 开工前做**，否则 P4 返工 |
| **P1 数据与回放** | `vela-data.js` 自定义 `DataProvider`（`getBars` 按 `{from,to,limit}` 从 IndexedDB 切片，永不返回整段）；`bars` 深度 8k–20k；`replay.start/step/play` + 速度映射；48 处 `getDataList()` 收敛成 `barAt/lastBar/barsInRange` | 3.5 | 数据模式已定（P0 §9–10），无阻塞 |
| **P2 工作区与同步** | `VelaWorkspace` + `setLayout('2h'/'4'/'8')`；每格 `setSymbol/setTimeframe`；`sync.set()`；TAB = `getState/applyState` 快照 | 4 | 依赖 P1（每格要数据） |
| **P3 绘图** | §5 映射表逐个接 `chart.drawings`；`drawStyles.js` → `SerializedDrawing.style`；管理面板接 `removeMany/lock/show`；砍艾略特（D2） | 4 | 独立，可与 P2 并行 |
| **P4 指标** | `registerNativeIndicator` 重写关键位 5 / SMC / flow / 自定义；图例接 `chart.indicators()`；Pine 换 `vela-pinets`（D1），删 `pineDraw/pineCore` 坐标层；Pine 桥实测可用（见 [VELA-PINETS-COVERAGE.md](VELA-PINETS-COVERAGE.md)），省 1.5，加 `importResolver` 0.5 + live `isconfirmed` 对齐 0.5 | 4.5 | 依赖 P4-a |
| **P5 收尾** | 5 套主题 → `VelaTheme`；截图 → `screenshotCanvas()`；快捷键/keymap；`setLocale('zh-Hans')`；全量回归 + 文档 | 3 | 依赖 P1–P4 |
| 小计 | | **19.5**（19 + 0.5） | |

## 3. 计划外增量：+5～6 人日

1. **SMC / FVG / ICT 自绘（+1.5～2）** —— `smcRender.js` 218 行 + `smc.js` 改动，全是 overlay/自绘。Vela 侧只有 `registerRendererLayer` 一条路（P0-E 已验 `args.coords.timeToX/priceToY` 可用，但要处理首帧 `bars.length===0`）。原 P4 只算了"指标值/画法"，没算这类跨全图的区域渲染。
2. **实时链路接 Vela（+1.5～2）** —— `live.js` / `liveStore.js` 要改走 `MarketDataFeed.subscribe(cfg, onBar)` 推进最后一根；「回放期间不把实时 bar 塞进历史」这条规则（`c36fc0f`）在 Vela 的 `replay.state` 语义下要重新表达；「跳到最新 K 线」= `replay.stop({reason})` + 切回 feed 的联调。**这项在 P0 里没验，属新的未知项**。
3. **新增均线指标（+0.5）** —— EMA/RMA/ZLEMA 要在 native indicator 里按 LuxAlgo 口径重写，不能沿用 klinecharts `createIndicator` 的 figures。
4. **自测基线重写（+1）** —— 实测：vela 树 27 个用例 / 109 处直接调图表 API；main 已到 **45** 个用例（38/40/42/43/44/45 专测 SMC、live、回放跳转）。P5 的判据「`?selftest=1..37` 全绿」已过期，要改成 1..45，且新增那 8 个里至少 6 个的断言要按 Vela 结构重写（`inspect()` 只有 `{indicators, totals}`，不是 `series/drawings/fills`）。
5. **WIP 与主线对齐（+0.5）** —— 见 §1：确认 `pineCore` 的 `barstate.isconfirmed` 口径在 vela-pinets 里的等价实现；判定 `chart.js` 的 `_warmPrev` 直接弃掉。

## 4. 总量与节奏

| 项 | 人日 |
|---|---:|
| 计划内 P1–P5 + P4 前置 | 19.5 |
| 计划外增量 | 5～6 |
| 小计 | 24.5～25.5 |
| P4 因 vela-pinets 可用回调（已含在上表 P4=4.5） | −0.5 |
| **合计** | **24～25** |

- 对比：`VELA-MIGRATION.md` 写的是 21.5（按 `main@7356dc2` 的代码面估），差出的 3～4 人日是 main 这半个月新长出来的实时/SMC 两条链，不是估算失误。
- 按 R8 的 6 周窗口：需要 **每周 4 人日** 的稳定投入；分支已搁置 1 天，窗口起点要重算。
- 可压缩项：P3 只做「趋势线/水平线/fib/通道/涂鸦」五类核心（+ 管理面板），其余工具延后 → 省 1.5；P2 先只做 2/4 格，8 格延后 → 省 1。压到 **21~22 人日** 但功能面缩水。
- 已排除的最大不确定项：Pine / LuxAlgo 指标能否用 `vela-pinets` 覆盖 —— 实测**能**，同时关闭 P0-C 遗留的「第二次 `runScript` 失败」问题（详见 [VELA-PINETS-COVERAGE.md](VELA-PINETS-COVERAGE.md)）。

## 5. 建议顺序

```
0. merge origin/main → vela（实测零冲突，10 分钟）+ 处置 WIP + 正式冻结 main 图表层
1. P4-a 前置实验（0.5）——并行做（live `isconfirmed` + import 策略）
2. P1 vela-data.js（3.5）
3. P2 vela-ws.js（4）        ←→ 3'. P3 vela-draw.js（4，可并行）
4. P4 vela-ind.js（4.5，含 SMC 自绘 + Pine 桥接线）
5. P1.5 实时接 feed（2）      ← 可与 P2/P3 并行，但必须在 P5 回归前完成
6. P5 收尾 + selftest 1..45 重写（3+1）
```

## 6. 验收判据（可量化，替代原「1..37 全绿」）

- 首屏：5,000 根 ≤150 ms、堆 ≤60 MB；20,000 根堆 ≤120 MB；任意日期跳转 ≤300 ms（沿用 P0-c 实测口径）
- 分屏：1/2/4/8 格切换后各格品种/周期/可见区间不变；TAB 快照 `applyState` 往返一致
- 绘图：每个保留工具「画 → 拖 → 刷新后仍在」；撤销/重做/复制粘贴可用
- 指标：关键位 5 / SMC / flow / 均线 7 条给出「值 + 画法」截图；Pine 仪表盘、表格、`alert()` 面板可用
- 实时：1 s 轮询下最后一根原地刷新；回放期间历史窗口不被污染；「跳到最新」后 feed 恢复
- 全量 `?selftest=1..45` 全绿；包体与首屏对比记录（预估 2.21 MB 未压缩 / ~1.3–1.5 MB min）

## 7. 风险（新增/变更的）

| # | 风险 | 影响 | 对策 |
|---|---|---|---|
| R11 | **实时链路是新的未知项**（`MarketDataFeed.subscribe` 未实测） | P1.5 可能翻倍 | 与 P4-a 一起做一次 1 小时探针：合成 bar 每秒 `onBar`，看 last bar 是否原地刷新 |
| R12 | **vela-pinets 无 `barstate.isconfirmed` 等价口径** | Pine 指标最后一根值与主线不一致 | P4-a 顺带验：同一脚本在 vela-pinets 下最后一根的 `complete` 字段是否就是这个语义 |
| R13 | selftest 断言面（109 处） | P5 回归成本高于预期 | P1 起就按「selftest 先改、功能后改」推进，不把 45 个用例堆到最后 |
| R2/R9/R10 | 版本漂移 / 不回填 / 4M=1 GB | 不变 | vendor 锁 0.9.3；`setMarket({bars, visibleRange})` 重建窗口；provider 永不返回整段 |

## 8. 本文数字的复现命令

```bash
git -C TraderTrain-vela status -sb                      # clean, vela = origin/vela
git rev-parse origin/vela:app/src/main.js               # 与 merge-base 同 blob ⇒ 零代码改动
git log --oneline origin/vela..origin/main               # 13 个提交
git merge-tree --write-tree --name-only origin/main origin/vela   # rc=0 ⇒ 零冲突
grep -roc "\.\(getDataList\|getOverlays\|createOverlay\)(" app/src/*.js   # API 面
wc -l app/src/*.js | tail -1                            # 14,018 行
ls app/src/selftest*.js | wc -l                         # vela 37 / main 45
```
