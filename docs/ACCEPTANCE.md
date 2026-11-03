# M1 验收记录

日期：2026-10-30　数据：XAUUSD 1m 全量（2015-01-02 → 2026-06-27，4,016,034 根，107.2 MB）
运行方式：`start.bat` → 固定端口 http://127.0.0.1:8731/app/index.html → 自检页 `?selftest=1`

## 结论文本

`pass: true`，errors 为空，全流程 2.1 s。

## 逐项数字（浏览器内实测，Chrome 156 / WebView2 同源内核）

| 验收项 | 判据 | 实测 | 结果 |
|---|---|---|---|
| 全量导入 | 成功且可重开 | **107.2 MB / 4,016,034 根 / 924 ms**（含 SHA-256 校验） | PASS |
| 持久化 | 重开程序数据仍在 | profiles=1，分片可读 9,836,764 B | PASS |
| 1m 窗口读取 | <50 ms | 冷 13.5 ms / 热 **0.9 ms** | PASS |
| 5m 窗口读取 | <50 ms | 冷 34.6 ms / 热 **0.2 ms** | PASS |
| 1d 窗口读取 | 热态 <50 ms | 冷 88.2 ms / 热 **0.0 ms** | PASS |
| 周期严格对齐 | 桶数相等 | 1m 1200 根 → **241 桶**，5m 聚合 **241 桶** | PASS |
| 桶内 OHLC | 首开/末收/最高/最低/量 | `{o:4080.605, h:4089.798, l:4079.998, c:4089.248}` 与成员逐项相等 | PASS |
| 窗口升序 | 跨年不乱序 | 1m / 5m / 1d 全为严格升序无重复 | PASS |
| 抽样对账 | 与源 CSV 一致 | 2024-04-13 04:16 → 2336.245 / 2337.695 / 2336.245 / 2337.318 完全一致（定点 ×1000，0 误差） | PASS |
| 渲染 | canvas>0 且无空 VOL | canvas=6，dataList=1200，indicators=[]（无 VOL 面板） | PASS |
| 切周期 | 5m 全部落在 5 分钟边界 | 900 根，`ts % 300000 === 0` 全部成立 | PASS |
| 单次导入 1 GB 闸门 | 2 GB 必须拒绝 | 拒绝，提示「本次导入 2048.0 MB，超过单次上限 1024 MB，请拆分区间后分批导入」 | PASS |
| 取消导入 | 只回滚本次，旧数据完好 | AbortError 命中；档案 key 未变；旧分片 9,836,764 B 仍可读；无孤儿分片（12 片） | PASS |
| 存储占用 | 上报配额 | 已用 69.1 MB / 配额 10,309 MB | PASS |

## 各周期首次/命中耗时（同一会话，切一轮）

| 周期 | 首次（含年块聚合构建） | 命中 |
|---|---|---|
| 1m | 13.5 ms | 0.9 ms |
| 5m | 34.6 ms | 0.2 ms |
| 15m | 44.1 ms | — |
| 30m | 71.8 ms | — |
| 1h | 29.2 ms | — |
| 4h | 14.8 ms | 0.0 ms |
| 1d | 88.2 ms | 0.0 ms |

首次成本 = 从 ArrayBuffer 直接聚合一个年块（355k 根）；每（年块 × 周期）只算一次，之后是二分 + 切片。

## 复跑方式

```bat
start.bat                       rem 固定端口 8731 起服务并打开应用窗口
```
浏览器打开 `http://127.0.0.1:8731/app/index.html?selftest=1`，等 `window.__RESULT__.done === true` 读 JSON。
命令行等价物：CDP 打开该 URL 后 `JSON.stringify(window.__RESULT__)`。

## M1 已知限制（转入 M2/M3）

1. 定位日期以「当日 23:59:59 UTC」为窗口右端；M2 回放起点选择会改成「从该时刻向后推进」。
2. 只有 1 个品种、不做成交量面板（源 volume 恒 0）。
3. 无回放/交易/画图（M2）、无 Pine（M3）。
4. 冷启动首个窗口含读年块 10–20 ms；未做年块预热。

---

# M2 验收记录（回放 / 绘图 / 交易）

日期：2026-10-30　同一份 XAUUSD 全量数据
运行方式：`http://127.0.0.1:8731/app/index.html?selftest=2`　结果：`pass: true`，errors 为空，3.3 s

| 验收项 | 判据 | 实测 | 结果 |
|---|---|---|---|
| 回放起点 | 窗口右端 = 起点 | `setStart(2024-03-20 00:00)` → cursor == 最后一根 == 1710892800000（48 ms 完成重载） | PASS |
| 逐根步进 | 游标与图表同步 | step(5) → 推进 5 根（9.3 ms），图表最后一根 == 游标 | PASS |
| **跨缺口** | 跨周末/长休不卡死 | 2024-03-29 03:00 → 2024-04-01 09:21，**跨越 4,442 分钟**（耶稣受难日+周末），游标严格单调 | PASS |
| 播放成本 | 300 根 <50 ms | **300 根 15 ms（0.05 ms/根）** | PASS |
| 跨周期推桶 | 5m 桶对齐且 OHLC 正确 | 连推 7 根后最后一根 ts %300000==0，high/low/close 与该桶内 1m 成员逐一相等 | PASS |
| 交互式画线 | 点两次成一条 | 合成鼠标两次点击 → overlay 数 +1 | PASS |
| 绘图持久化 | 清空后能还原 | capture → persist → 清图 → load → **overlay 1 条复原** | PASS |
| 市价+TP 撮合 | PnL 与手算一致 | 多 10 oz @ 2154.39，TP 2156.39 触发平仓，**pnl 19.95 = (2156.39-2154.39)×10** | PASS |
| 交易持久化 | 重开仍在 | kv `trades:XAUUSD` 有记录（本次累计 4 笔） | PASS |

## 界面（`docs/m2-ui.png`）

底部回放条（起点/设为起点/◀/▶/播放/速度/游标）、左侧 10 个绘图按钮（8 工具 + 删除 + 清空）、右侧交易面板（数量/止损止盈/市价买卖/平仓/限价挂单/持仓与浮动盈亏/成交列表）、状态栏（周期、根数、读窗 ms、持仓、已实现）。

## 键盘

`空格` 播放/暂停　`→` 前进一根　`←` 回退一根　`R` 回到起点　`Esc` 取消当前绘制

## M2 实现取舍（与计划的差异）

1. **回放只在 1m 精度推进**：非 1m 周期按当前周期把 1m 聚成桶再推（同桶覆盖、跨桶追加），窗口内已有的同桶数据会续接，不会丢该桶前几分钟。
2. **交易标记用 `priceLine`**（入场/SL/TP 三条虚线），未做箭头/标签（M3 可加自定义 overlay）。
3. **交易记录按品种持久化**（kv `trades:<symbol>`），"场次（session）"概念留到 M3。
4. 手数单位是**盎司**，PnL = 价差 × 盎司数（不做合约乘数）。

---

# M3 验收记录（场次 / 统计 / Pine 指标 / 打包）

日期：2026-10-30　同一份 XAUUSD 全量数据
运行方式：`http://127.0.0.1:8731/app/index.html?selftest=3`　结果：`pass: true`，errors 为空，**793 ms**

| 验收项 | 判据 | 实测 | 结果 |
|---|---|---|---|
| 场次统计口径 | 已知 4 笔样本逐项对账 | 4 笔 / 胜率 50% / 净盈亏 17 / 盈亏比 2.31 / 期望 4.25 / 最大回撤 8 / 连赢 1 连输 1 / 收官权益 100017 | PASS |
| 场次持久化 | 新建→写 2 笔 + 1 截图→重读 | tradesAfterReload 2、shots 1、shotUrlOk、activeId 一致、列表含该场次 | PASS |
| 刷新续上场次 | 整页重载后自动恢复 | 冒烟场次：2 笔、4 张截图、模拟器 2 笔、已实现 −31.40 全部还原 | PASS |
| 导出 CSV | 表头 + 每笔一行，可独立解析 | 5 行（表头 + 4 笔）；`1,多,10,100,101,10,TP,,,`；时间列 UTC + 持仓分钟 | PASS |
| 导出 JSON | 含场次元数据、交易、截图索引、统计 | `sessionToJson()` 输出 | PASS |
| 盘面截图 | 拼合多 canvas，非空 | 77,037 B / **16 ms**；实战开平各 1 张，55 KB/张 | PASS |
| Pine 编译 | 样例 2 条输出、值正确 | 51 ms / 1200 根：e20 `4078.0267`、e50 `4073.6042` | PASS |
| Pine 上图 | 指标挂主图且与窗口对齐 | 324 ms；`PINE_b6610417` 在 `candle_pane`，result 长度 1200 == 窗口根数 | PASS |
| Pine 参数面板 | `input.int` 可改并重算 | 默认 14 → `4078.5116`；改 50 → `4071.4226` | PASS |
| Pine 报错定位 | 报错带行号 | `第 3 行：Failed to transpile … at 3:23` | PASS |
| Pine 子图 | `overlay=false` 建独立 pane | `indicator_pane_*`，输出 rsi/up/dn 3 条，长度 1200 | PASS |
| Pine 移除 | 移除后图表无残留 | `remaining 0` | PASS |
| 回归 | M1/M2 不被破坏 | `?selftest=1` 3.09 s、`?selftest=2` 2.82 s、`?selftest=3` 0.79 s 全绿 | PASS |

## M3 实现取舍

1. **未做 pywebview 打包**：`start.bat` 用 Chrome `--app=` 模式 + 独立 profile，零运行时依赖、双击即开；代价是依赖本机 Chrome。
2. **Pine 计算范围 = 当前窗口**（1200–1280 根），窗口/周期变化或回放暂停时重算（51 ms/次）；没有把全历史结果落盘缓存。
3. **Pine v1 只支持 `indicator()`**：`plot / hline / input.* / ta.*` 通过；`request.security` 返回 null、`syminfo.mintick` 为 NaN、`barstate.isconfirmed` 恒 false，`strategy.*` 回测留 v2。
4. **`hline()` 按常量序列绘制**（实线），不是图表原生水平线对象。
5. **交易真值改由场次承载**（`session.trades`），不再单独写 `kv trades:<symbol>`；M2 的按品种持久化失效。
6. **删除确认改为「再点一次」**：原生 `confirm()/prompt()` 在 WebView / 自动化驱动下会阻塞页面，已全部移除。
7. **截图依赖图表可见**：后台标签页 rAF 被节流时可能抓空图，`captureChart` 加画布就绪等待 + 空图重试（后台最坏约 300 ms）。

---

# UI 改版记录（2026-10-30，参考溯刻 RE:TICK）

设计语言取自 `tradergenius.online/backchart` 的实际计算样式，落成 `app/styles.css` 的 token：

| Token | 值 | 用途 |
|---|---|---|
| `--bg` | `#03070d` | 全局深底（近黑深蓝） |
| `--line` / `--line-strong` | `rgba(255,255,255,.075)` / `rgba(158,198,223,.20)` | 发丝分隔线 |
| `--text` / `--muted` / `--faint` | `#edf7fc` / `#94a9bb` / `#6f8b9e` | 三级文字 |
| `--ice` / `--cyan` | `#aceaff` / `#b6efff` | 主按钮实色填充 / 强调文字 |
| `--up` / `--down` | `#5fe3c0` / `#ff6f85` | 涨/跌（青绿对珊瑚） |
| `--mono` | SFMono / Consolas | 数字、小标签、代码 |
| 圆角 | 3px（控件）/ 5px（面板） | 与原站点一致 |

落地要点：

1. 顶栏 60px：字标 + 品种 + 周期（等宽小标签段控）+ 日期 + 功能按钮（`01 场次`…）；面板打开时按钮高亮。
2. 回放条 56px：起点、◀ 播放 ▶、速度、游标读数（等宽、tabular-nums）；状态栏 25px 等宽 9px。
3. 抽屉 440/400px：实底（**不用 opacity 动画** —— 后台标签页会暂停动画，实测停在半透明可透视）。
4. 图表主题走 `chart.setStyles(THEME)`：发丝虚线网格、去刻线、十字光标青色、提示框跟随光标且只显示 OHLC（源 volume 恒 0）。
5. 入场线用 `horizontalStraightLine`（不带价格标签），SL/TP 用 `priceLine`（带标签），避免与最新价标签重叠。

改版后回归：

| 入口 | 结果 |
|---|---|
| `?selftest=1` | pass，2.90 s |
| `?selftest=2` | pass，1.59 s（交易持久化改为断言「撮合 → 场次 → IDB 往返」） |
| `?selftest=3` | pass，0.70 s（截图 99,975 B / 16 ms） |

截图：`docs/ui-main.jpg`、`docs/ui-session.jpg`、`docs/ui-data.jpg`。

改版过程中修掉的两个连带问题：

1. **截图探针误判空图**：新皮肤顶部是空白区，按「顶部 80px 亮度」判断会把正常画面判成空 → 改为全画面稀疏采样（160×100 点，阈值 12）。
2. **自检等待点不足**：`loadProfile` 里 `replay` 早于 `trade` 创建，自检只等 `replay` 会拿到 `null` → 新增 `window.__APP_READY__` promise，`loadProfile` 装完才 resolve。

## 追加：右键版面设置（2026-10-30）

| 验收项 | 判据 | 实测 |
|---|---|---|
| 呼出 | 右键图表弹出面板，浏览器默认菜单被阻止 | 合成右键（mousedown 兜底 + contextmenu）→ 面板出现在 `(x+2, y+2)`，越界自动夹到视口内 |
| 背景 | 跟随皮肤 / 自定义 | 自定义 `#101820` → `--chart-bg` 生效、截图底色随之一致 |
| 网格 | 开关 + 颜色 | 关掉后 `chart.getStyles().grid.show === false` |
| 涨跌色 | 立即改色 | `#e2574c` / `#3fa66a` 写入 `candle.bar.upColor/downColor` |
| 边框 | 跟随涨跌 / 单独设色 | 跟随态下边框 = 涨跌色；关闭后独立取色 |
| 持久化 | 重开仍在 | 刷新后 `up/grid/chartBg` 与面板色块一致 |
| 恢复默认 | 回到皮肤默认 | up `#5fe3c0`、down `#ff6f85`、grid true、bg `#03070d` |

回归：`?selftest=1/2/3` 全绿（3.16 s / 2.29 s / 0.85 s，截图 99,968 B / 35 ms）。

顺带修正：窗口被遮挡/最小化启动时 canvas 会停在 300×150（rAF 被暂停）—— 加 `visibilitychange → chart.resize()`，回到可见即重绘。

## 追加：右键二级菜单（2026-10-30）

一级菜单：`复位图表 / 图表设置… › / ── / 复制此图表 / 从其他图复制绘制 ›`

| 验收项 | 判据 | 实测 |
|---|---|---|
| 呼出 | 右键图表出菜单，浏览器默认菜单被阻止 | 面板落在 `(x, y)`，越界自动夹到视口内 |
| 二级菜单定位 | 贴一级菜单外沿展开，不遮挡 | 一级菜单右边界 742 → 二级 `left 744`；右侧放不下时翻到左侧 |
| 二级切换 | 悬停哪项出哪个二级 | 悬停「图表设置…」出设置面板，悬停「从其他图复制绘制」出周期列表；悬停普通项收起 |
| 复位图表 | 回到最新一根 | `setBarSpace(8)` + `scrollToDataIndex(last)` |
| 复制此图表 | 剪贴板优先，失败下载 | `ClipboardItem('image/jpeg')`；不支持时下载 `chart-<symbol>-<ts>.jpg` |
| 复制绘制 | 列表出其他周期条目 | 1m 图上列出「5m 周期 · 1 条」；点击后写入 `draw:<symbol>:1m` 并提示「已从 5m 周期复制 1 条绘图（部分在当前视图外）」 |
| 空态 | 没有可复制来源时给文案 | 显示「没有其他周期的绘图」 |

### 顺带修掉的两个真问题

1. **窗口外的绘图会被吸附到边缘**（回放走远后，旧绘图贴在图上像新画的）→ `restore()` 只重建「整条完全落在当前窗口内」的绘图，窗口外保留在存储里，滚回去再显示；窗口内的时间戳先对齐到最近的 bar（跨周期复制时不必逐根相等）。
2. **切周期时数据未就绪会把绘图丢掉** → `restore()` 在 `getDataList()` 为空时返回 -1，`load()` 保留 items 并在 120 ms 后重建一次。

回归：`?selftest=1/2/3` 全绿（3.38 s / 2.52 s / 0.82 s）。

## 追加：顶栏三键（主题 / 指标库 / 布局）（2026-10-30）

自检入口 `?selftest=4`，结果 `pass: true`，5.31 s。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 主题切换 | 暗 ↔ 亮，图表一起换 | `dark → light → dark`；涨色 `#5fe3c0` ↔ `#12a37c`；亮色图表底 `rgb(255,255,255)` |
| 主题记忆 | 重开仍是上次主题 | 存 `ui:theme`，刷新后 `data-theme` 一致 |
| 指标库 | 面板开、分类、搜索、列表 | 打开成功，内置指标 **27 个**，分类全部/主图/副图/Pine 自编 |
| 指标开关 | 添加/移除与徽标同步 | 0 → 加 1 个（AVP）→ 徽标 `1`；移除后回 0 |
| 布局 | 面板数量与高度 | 1 → 3 面板：candle 380 / 副 149 / 副 149；回 1 面板自动清掉多余副图 |
| 布局菜单 | 打开、当前项高亮、点外关闭 | 打开成功，`on` 跟随实际面板数 |

### 实现要点

- **主题**：全部颜色收进 CSS 变量，`:root[data-theme="light"]` 覆盖一套；图表侧 `buildChartTheme(mode)` 同步网格/蜡烛/坐标轴/十字光标/指标/绘图四组样式。
- **涨跌色与主题的关系**：版面设置里存的颜色若等于「任一主题的默认值」，切主题时跟随变化；用户自己挑过的颜色不动。
- **布局**：`getPaneOptions()` + `createIndicator` + `removeIndicator({paneId})` + `setPaneOptions({height})`（单位是 px，实现时按比例算）。
- **指标库**：`klinecharts.getSupportedIndicators()` 取全部内置指标，叠加类（MA/EMA/SMA/BOLL/SAR/BBI）挂 `candle_pane`，其余自动建副图。

回归：`?selftest=1/2/3/4` 全绿（1.79 s / 2.42 s / 0.86 s / 5.31 s）。

## 追加：悬浮绘图工具栏（2026-10-30）

原来是左侧 46px 竖排导轨，改成浮在图表顶部的圆角工具条（对齐参考站点的形态）。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 形态 | 悬浮、圆角、分组分隔线、线性图标 | 14 个按钮：握把 + 8 工具 + 撤销/重做/删除/清空 + 收起 |
| 激活态 | 点工具后高亮并给提示 | `state.draw.activeTool = segment`，`class=active`，提示「绘制：趋势线（点两次完成，Esc 取消）」 |
| 撤销/重做 | 快照栈 | 画 1 → 删 → 撤销回到 1 → 重做回到 0；按钮 disabled 状态跟随栈 |
| 拖动 | 握把拖动，位置记住 | 拖到 `(608, 50)`，`class="toolbar dragged"`，`kv ui:tools = {x:608,y:50,hidden:false}` |
| 收起/唤出 | 收起后左下角小按钮 | 收起 → `#tools.hidden=true`、左下角出现「⌃ 绘图工具」；刷新后仍是收起；点一下恢复 14 个按钮 |
| 主题 | 暗/亮都成立 | 亮色下为白色圆角条 + 细描边，暗色下为深色玻璃条 |

回归：`?selftest=1/2/3/4` 全绿（1.90 s / 2.56 s / 0.85 s / 5.48 s）。

## 追加：工具栏双形态（悬浮 / 左侧竖排）（2026-10-30）

| 验收项 | 判据 | 实测 |
|---|---|---|
| 收起 = 左侧竖排 | 不再隐藏，改成贴左 42px 工具列 | `class="toolbar rail"`，`#main.has-rail`，工具条 `rect=[0,60,42,704]` |
| 图表让位 | 图表左边距跟随 | `#chart` 左边界 0 → 42，`ResizeObserver` 触发 `chart.resize()` |
| 切回悬浮 | 左下角按钮 | 点「◉ 悬浮工具栏」→ `class="toolbar"`，图表左边界回 0，`ui:tools.mode = "float"` |
| 记忆 | 刷新后保持上次形态 | 存储在 `ui:tools`，刷新后仍是 `rail` |
| 竖排细节 | 握把隐藏、分隔线转横向 | `.rail .drag{display:none}`、`.rail .tb-sep{width:18px;height:1px}` |
| 回归 | 四套自检 | `?selftest=1/2/3/4` 全绿（1.96 / 2.24 / 0.78 / 5.49 s） |

截图：`docs/ui-toolbar-rail.jpg`（亮色，形态对齐参考站点）、`docs/ui-toolbar-rail-dark.jpg`。

## 追加：绘图样式与斐波那契层级（2026-10-30）

自检入口 `?selftest=5`，结果 `pass: true`，2.59 s。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 样式面板 | 工具栏齿轮打开，8 行工具 | `panelOpen=true`，8 行，每行 颜色/线型/粗细/恢复 |
| 线型生效 | 斐波那契改实线 | 面板选「实线」→ 覆盖层 `styles.line.style='solid'` |
| 粗细生效 | 改 3px | `styles.line.size=3`，已画好的斐波那契立即重画 |
| 层级增删 | 输入 0.705 自动排序插入 | 7 → 8 个 chip，`levels=[1,0.786,0.705,0.618,0.5,0.382,0.236,0]` |
| 层级下发 | 传给内核算进 extendData | 覆盖层 `extendData.levels.length=8` |
| 预置方案 | 标准/扩展/密集 | 点「标准」回到 7 个层级 |
| 独立设置 | 各工具互不影响 | 趋势线单独设点线，斐波那契仍是实线 |
| 持久化 | 重开仍生效 | `ui:drawStyles` 读回 `fibStyle=solid / fibSize=3 / segStyle=dotted` |

### 实现要点

- KLineChart 内置 `fibonacciLine` 把层级写死为 `[1,.786,.618,.5,.382,.236,0]`，所以用 `registerOverlay` **覆盖同名模板**，层级改从 `overlay.extendData.levels` 读，绘制/交互逻辑照抄内置。
- 每个工具的颜色/线型/粗细是**全局设置**（不是每张图单独存），重建时统一套用，所以改设置后已有绘图立即跟着变。
- `createOverlay({ styles: { line: { color, size, style, dashedValue } }, extendData })`；`dashedValue` 虚线 `[5,4]`、点线 `[1,3]`。

回归：`?selftest=1/2/3/4/5` 全绿（2.08 / 2.47 / 0.85 / 5.51 / 2.59 s）。

## 追加：选中绘图的浮动操作条（2026-10-30）

自检入口 `?selftest=6`，结果 `pass: true`，1.96 s。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 选中 | 点线条中点弹出操作条 | `barShown=true`，名称「趋势线」 |
| 改色 | 只改这一条 | `styles.line.color='#ffcc66'` |
| 改宽 | 0.8–3px | `styles.line.size=2` |
| 线型 | ⋯ → 虚线 | `style='dashed'`、`dashedValue=[5,4]` |
| 单条持久化 | 存进绘图条目 | `items[0].lineStyle` 与 IndexedDB 里一致 |
| 删除 | 🗑 删除并收起操作条 | 覆盖层 0，`barHidden=true` |
| 回归 | 六套自检 | `?selftest=1..6` 全绿（1.35 / 2.49 / 0.84 / 5.49 / 2.74 / 1.96 s） |

### 实现要点

- **没有 `onOverlayClick` 事件**：自己在 `#chart` 的 click 里做命中测试 —— 覆盖层点位用 `chart.convertToPixel([{timestamp, value}], {paneId})` 转成像素（**返回的是图表左上角坐标系**，要加 `#chart` 的 `getBoundingClientRect` 偏移），再算点到线段距离，<9px 即命中。
- 改样式用 `chart.overrideOverlay({ id, styles: { line: {...} } })`（返回 true 且即时生效，和 `overrideIndicator` 不一样）。
- 每条绘图的样式存进 `items[].lineStyle`，`restore()` 优先用它，没有才用全局「绘图样式」默认值。

## 追加：绘图样式模板（2026-10-30）

自检入口 `?selftest=7`，结果 `pass: true`，2.75 s。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 保存模板 | ⋯ → 保存为模板… | 模板「测试模板A」入列并成为默认 |
| 默认模板生效 | 新画的同类图形自动套用 | 新趋势线 `#ff6b81 / 3px / solid`（= 模板） |
| 应用模板 | 点模板条目 | 已弹回模板样式（绿点线 → 红实线 3px） |
| 删除模板 | 条目右侧 × | 删完 `templates.segment` 为空 |
| 持久化 | 重开仍在 | `ui:drawTemplates` 读回模板名与默认 id |
| 回归 | 七套自检 | `?selftest=1..7` 全绿（4.09 / 1.97 / 0.78 / 5.47 / 2.74 / 1.94 / 2.75 s） |

### 实现要点

- 存储两层：`ui:drawStyles`（每工具的基础样式）+ `ui:drawTemplates`（`{templates:{tool:[...]}, defaults:{tool:id}}`）。
- 新建绘图时用 `resolveToolStyles(全局样式, 模板库)` 合成：有默认模板的工具用模板的线型/颜色/层级，其余用基础样式。
- 已存在的绘图优先用自己的 `lineStyle`，所以「设默认模板」不会动老图，只有新图受影响——符合直觉。
- 菜单内容随内容变化会变高，给 `.ov-menu` 加 `max-height + overflow`，并在重渲染后重新夹取位置。

## 追加：做多 / 做空盈亏比工具（2026-10-30）

自检入口 `?selftest=8`，`pass: true`，4.81 s；回归 `?selftest=1..8` 全绿（3.16 / 2.43 / 0.85 / 5.52 / 1.99 / 2.75 / 4.81 s）。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 模板注册 | `getSupportedOverlays()` | 含 `longPosition` / `shortPosition` |
| 三次点击成图 | 入场 → 止损 → 止盈 | 每次点击点数 1→2→3，第三次后自动结束 |
| 落盘 | `draw.items` | 各 3 点，`lineStyle` 一并保存 |
| 重建 | `draw.load()` + `draw.restore()` | 两条都回到图上（2/2） |
| 标注 | 图上文字 | `做多/做空 价`、`SL 价 百分比`、`TP 价 百分比`、`盈亏比 1 : R` |
| 反向用例 | 止损在入场上方/下方 | 区域按 min/max 画，不会画反 |

### 实现要点

- 3 次点击 → `totalStep: 4`（klinecharts 的 `totalStep` = 点击数 + 1）。
- 每个图元可带自己的 `styles`：风险区/收益区用 `rect` 填充，入场/止损/止盈三条 `line` 各自颜色，文字统一 `text` 图元。
- 盈亏比用点的 `value` 从价格算，不用像素，缩放不受影响。
- **修掉一个真 bug**：批量 `chart.removeOverlay()` 会触发各 overlay 的 `onRemoved` 回调，回调里 `capture()` 读到空集合把 `draw.items` 抹掉，导致重建时丢图（偶发只重建出 1 条）。现在 `restore()`/`clear()` 期间置 `_busy`，回调直接返回；`restore()` 也先把 `items` 拷一份再用。

## 追加：折线工具 + 吸附开关（2026-10-30）

自检入口 `?selftest=9`，`pass: true`，3.07 s；回归 `?selftest=1..9` 全绿（2.93 / 2.44 / 0.84 / 5.49 / 1.97 / 2.72 / 4.79 / 3.07 s）。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 折线取点 | 连点 4 次 + 双击结束 | 收集 4 点，`items` 里 `polyline` 4 点，`activeTool` 归空，监听已解绑 |
| 折线落盘重建 | `draw.load()` | 重建 1 条、4 点 |
| 吸附关 | `snapPoint` 原样返回 | `value`/`timestamp` 均未变 |
| 吸附开 | 值 ∈ 该 bar 的 OHLC | 命中（4054.415 = 该 bar 的四价之一） |
| 吸附持久化 | `ui:magnet` | 重载后仍为开，按钮高亮 |
| 开关 UI | 点磁铁按钮 | 切换 + 重渲染，状态栏提示 |

### 实现要点

- klinecharts 没有多段折线工具，`polyline` 是自注册模板：`createPointFigures` 把相邻坐标两两连成 `line` 图元，顶点用默认点图元（可拖）。
- 折线不走 klinecharts 的绘制态（它的 `totalStep` 是固定的，长不了），改成自建取点：`mousedown` 收点 → `overrideOverlay` 实时更新 → 双击/右键/回车收尾。`Esc` 与工具切换都会解绑监听并丢弃不足 2 点的草稿。
- 吸附按**像素距离**在 O/H/L/C 里挑最近的，而不是按价格差——价格轴非线性时才准。同时把 x 对齐到 bar 时间戳。
- 折线/仓位的多点在 `restore()` 里先建前两点再 `overrideOverlay` 全量，避免创建时按 `totalStep` 截断。

## 追加：多主题（2026-10-30）

自检入口 `?selftest=10`，`pass: true`，3.77 s；回归 `?selftest=1..10` 全绿（2.77 / 2.50 / 0.88 / 6.20 / 1.98 / 2.75 / 4.81 / 3.06 / 3.77 s）。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 四套主题 | 下拉 4 行，点选即换 | `dataset.theme` = 所选 key，`dataset.mode` = 对应亮暗 |
| 界面底色 | `--bg` / `--chart-bg` | dark `#03070d`、light `#eef2f7`/`#ffffff`、sky `#e9f4fc`/`#f4fbff`、amber `#fdf4e8`/`#fffaf2` |
| 图表涨色 | `getStyles().candle.bar.upColor` | `#5fe3c0` / `#12a37c` / `#0f8bc4` / `#e08a2b`，四种互不相同 |
| 选中态 | 下拉里只一行 `.on` | 1 行，且是当前主题 |
| 持久化 | `ui:theme` | 读回所选 key |
| 收尾 | 复原原主题 | 回到进入时的主题 |

### 实现要点

- 两套维度分离：`data-theme`（主题 key，决定配色）+ `data-mode`（light/dark，决定控件亮暗底子）。CSS 里原来的 `[data-theme="light"]` 全部改成 `[data-mode="light"]`，新主题只需追加一组 token 覆盖。
- 图表配色表 `CHART_THEME` 按主题 key 存一份，`buildChartTheme()` 取当前 key；`isLight` 由表里的 `mode` 推出，不再依赖 `data-theme === 'light'`。
- 换主题时的涨跌色迁移：只要当前色等于**任一**主题默认色，就认为用户没自定义过，直接换成新主题默认色（早期只比对上/下一个主题，导致跨主题切换时颜色"粘住"）。

## 追加：回放随机起点（2026-10-30）

自检入口 `?selftest=11`，`pass: true`，3.80 s；回归 `?selftest=1..11` 全绿（2.79 / 2.63 / 0.83 / 6.17 / 2.00 / 2.75 / 4.78 / 3.08 / 3.75 / 3.80 s）。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 连点 4 次 | 4 次落点互不相同 | distinct 4 |
| 落在数据范围内 | `first ≤ cursor ≤ last` | 4/4 |
| 窗口右端 = 起点 | `getDataList()` 末根 ts == cursor | 4/4 |
| 窗口有效 | 根数 > 100 | 每次 1200 根 |
| 输入框同步 | `#startAt` 有值 | 4/4 |
| 状态栏 | 出现「随机起点」 | `随机起点 2022-10-19 09:36 · 12 ms` |

### 实现要点

- 随机范围取 `[first + 1d, last - 1d]`，再用 `source.nextBars(ts, 1)` 把落点顺延到下一根真实存在的 1m bar（否则会抽到周末/每日 06:00 缺口里）。
- 「设为起点」和「随机时间」共用一个 `applyStart(ts)`：写输入框 → `replay.setStart` → 重载绘图 → 重算 Pine，两条路径不会各走一套。

## 追加：配置存档（保存按钮，2026-10-30）

自检入口 `?selftest=12`，`pass: true`，4.28 s；回归 `?selftest=1..12` 全绿（3.10 / 2.48 / 0.82 / 6.19 / 2.01 / 2.74 / 4.78 / 3.07 / 3.76 / 3.78 / 4.28 s）。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 按钮存在、初始干净 | `#btnSave` 无 `.dirty` | 通过 |
| 改动标脏 | 换主题后出现红点 | sky 生效且红点出现 |
| 保存 | 红点消失 + `.saved` 闪一下 | 通过 |
| 存档内容 | `cfg:workspace` 字段 | theme/period/symbol/layout/drawStyles/drawTemplates/tools/savedAt 齐全 |
| 存档独立性 | 再改不保存，存档不变 | 界面 amber，存档仍 sky |
| Ctrl+S | 同一点保存 | 存档变 amber，红点消失 |
| 启动恢复 | 保存 sky → 改 amber 不保存 → 刷新 | 回到 **sky**，红点干净 |

### 实现要点

- 存档是「显式快照」，和原有逐项自动持久化并存：有快照就按快照恢复，没快照就照旧读各项 key。
- 标脏只挂在真正的写路径上（`setTheme` / `saveLayout` / `commitDrawStyles` / 模板增删与设默认 / `saveTools` / 吸附开关 / 切周期 / 改起点），不做 DOM 监听，避免误报。
- 恢复时先套主题/版面/吸附/样式/模板/工具栏，再按需 `switchPeriod`；任何一步抛错只记 warn，不阻断启动。

## 追加：复盘档案（2026-10-30）

自检入口 `?selftest=13`，`pass: true`，7.19 s；回归 `?selftest=1..13` 全绿（3.08 / 2.65 / 0.83 / 6.16 / 2.00 / 2.75 / 4.77 / 3.08 / 3.76 / 3.79 / 4.26 / 7.19 s）。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 新建入档 | 3 份 → 索引 +3 | 72→75 |
| 列表 | 面板打开、行数正确 | 75 行 |
| 搜索 | 按本轮随机 tag 搜 | 命中 3 行，名称全对 |
| 排序 | 净盈亏降/升 | 首行分别是最赚 / 最亏那份 |
| 状态筛选 | 全部进行中 → 已结束 | 0 行（进行中 3 行） |
| 打开还原 | 周期 + 起点 + 交易 | 周期回 `1m`、游标落在起点±1 天内、载入 2 笔、面板自动关 |
| 标签/评分/结论 | 存回档案 | `['标签改过','第二']` / 4 星 / 「改过的结论」 |
| 删除 | 连点两次 | 索引 -1 |
| 收尾 | 清掉测试档案 | 回到测试前的数量 |

### 实现要点

- 档案索引（`sessions`）里存**汇总字段**（period/startTs/tags/rating/netProfit/winRate/count/shots），档案页排序筛选不用逐份读全量。
- `updateMeta(id, patch)` 是唯一改元信息的入口，改完顺带刷新索引。
- **修掉一个真 bug**：`store.create()` 里 `save()` 已经维护索引，后面又手动 push 了一次，导致同一份档案在索引里出现两条、列表里重复显示、计数虚高。删掉多余 push 后新建 = +1。
- 打开档案只还原周期/起点/交易：本项目是单品种（XAUUSD），品种不同时只提示、不换数据源。

## 追加：标题与彩虹标语（2026-10-30）

| 验收项 | 判据 | 实测 |
|---|---|---|
| 窗口标题 | `<title>` | `TraderTrain`（curl 直取 HTML 确认） |
| 页面标语 | 字标文案 | `复盘行情，沉淀判断。` |
| 彩虹走马灯 | `animationName` + `backgroundPosition` 随时间变化 | `rainbowFlow`；64.7% → 113.4%（1.2 s 内推进） |
| 副标题不换行 | 单行显示 | `TRADERTRAIN / REFLECT · REFINE`，顶栏高度仍 60 px |
| 回归 | 十三套自检 | `?selftest=1..13` 全绿（2.93 / 1.87 / 0.84 / 6.17 / 1.97 / 2.75 / 4.74 / 3.06 / 3.72 / 3.76 / 4.26 / 7.14 s） |

实现：`linear-gradient(100deg, …)` + `background-clip:text` + `background-size:280%`，`@keyframes rainbowFlow` 平移 `background-position`；`prefers-reduced-motion` 下停动画。

## 追加：多图分屏（2026-10-30）

自检入口 `?selftest=14`，`pass: true`，10.12 s；回归 `?selftest=1..14` 全绿（3.06 / 2.40 / 2.02 / 6.18 / 1.97 / 2.74 / 4.80 / 3.06 / 3.76 / 3.79 / 4.30 / 7.16 / 10.12 s）。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 单图 | 1 格、无 split | cells 1，`#chart` 无 `.split` |
| 左右两格 | 2 格等宽、周期 1m/5m | 741 / 741，tag `1M` `5M` |
| 游标同步 | 各格 cursor 相同、1m 图末根 = cursor | 3 格一致；`1782457260000` = cursor |
| 四格 | 4 格、四周期各异 | 1m / 5m / 15m / 1h |
| 激活切换 | 点第三格 | active=2、周期 15m、绘图 key `draw:XAUUSD:15m`、Pine 管理器同步 |
| 绘图隔离 | 只在激活格新增 | 3 号格 0→1，其余不变 |
| 布局落盘 | `ui:split` | `{key:'4g', periods:[1m,5m,15m,1h]}` |

### 实现要点

- 新模块 `workspace.js`：`Workspace` 管 N 个 `ChartApp` + 各自 `DrawLayer` / `PineManager` / `Replay`；`MultiReplay` 把「设起点 / 步进 / 回退 / 播放」同时驱动所有格，游标以 0 号格为准。
- `state.app / state.draw / state.pine` 始终指向**激活格**，所以交易、工具栏、周期段控、右键菜单这些老代码一行不用改；切格时由 `bindActiveCell()` 重新绑定。
- 分屏布局用 CSS grid：每个布局给出 `cols/rows/areas`，图标也由 `areas` 自动画出来（`layoutIcon`），加一种排布只改一行数据。
- 隐藏的格不销毁（切回来秒开），`applyGrid` 里按 `cells` 数显示/隐藏。
- 修的两个连带问题：① 重写布局菜单时**误删了主题菜单的三个函数**，导致 boot 在 `wireThemeMenu` 处中断（现象是主题/保存/档案按钮全没反应）——恢复后正常；② 多格初始化后首帧更慢，`captureChart` 重试从 3 次加到 5 次、自检里先等 500 ms 再截。

## 追加：图表 TAB（2026-10-30）

自检入口 `?selftest=15`，`pass: true`，13.59 s；回归 `?selftest=1..15` 全绿（3.07 / 2.52 / 1.40 / 6.16 / 1.94 / 2.71 / 4.77 / 3.05 / 3.73 / 3.76 / 4.24 / 7.13 / 10.54 / 13.59 s）。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 新增 TAB | 点 `＋` | tabs 1→2，DOM 2 个，新 TAB 为激活 |
| 新 TAB 周期 | 自动挑一个未占用的 | 已用 1m → 新 TAB 5m |
| 只有一个 TAB 在渲染 | `#chart` 里只有 1 个 `.ws` | 1 个，另 1 个停在 `#tabPark` |
| 周期独立 | TAB2 改 15m，切回 TAB1 | TAB1 仍 1m，TAB2 仍 15m |
| 游标独立 | 两 TAB 设不同起点 | `1782453480000` / `1781935080000`，来回切各自保持 |
| 落盘 | `ui:tabs` | 2 条，字段 id/name/layout/periods/period 齐全 |
| 关闭 | 点 `✕` | 2→1，DOM 同步 |
| 保护 | 关最后一个 | 拒绝，提示「至少保留一个图表」 |

### 实现要点

- 一个 TAB = 一个 `Workspace`（内含 N 个 `ChartApp`），DOM 根是 `.ws`；**只有激活 TAB 的 `.ws` 在 `#chart` 里**，其余挪到 `#tabPark`（`display:none`）。这样老的 `#chart canvas` 选择器、截图拼合、点击坐标全都不用改，也天然避免隐藏 TAB 被一起截图。
- `state.workspace / app / draw / pine / replay` 始终指向激活 TAB；切 TAB 时统一重绑，并把该 TAB 的 `MultiReplay` 作为 `state.replay`。
- 每个 TAB 的 `onActive` 回调**带自己的 tabId**，只有 `state.activeTab === tabId` 才同步全局状态——否则新建 TAB 时会把周期写到旧 TAB 上（踩过，表现是 TAB 标签显示旧周期）。
- 新建 TAB 自动挑一个还没被占用的周期（1m→5m→15m→1h），避免开出来全是一模一样的图。

## 追加：集成 @klinecharts/extension（2026-10-30）

自检入口 `?selftest=16`，`pass: true`，6.88 s；回归 `?selftest=1..16` 全绿（1.80 / 2.59 / 1.29 / 6.16 / 1.95 / 2.74 / 4.77 / 3.05 / 3.73 / 3.76 / 4.25 / 7.11 / 10.50 / 13.58 / 6.88 s）。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 注册 | `getSupportedOverlays()` 含 18 个扩展名 | 18/18，missing 为空 |
| 弹层 | `⋯` 打开扩展工具 | 18 个按钮 |
| 可画 | 依次激活 measure / gannBox / fibonacciExtension | activeTool 正确、落点后 `currentStep=-1` |
| 成图 | `getOverlays()` | measure 2 点、gannBox 2 点、fibonacciExtension 3 点 |
| 重建 | `draw.restore()` | 3/3 回来 |

### 集成方式

- 官方包 `@klinecharts/extension@0.1.0`，dist 是 ESM，但内部 `import { utils } from 'klinecharts'` 是裸模块名；本项目用 UMD 全局（`window.klinecharts`），所以：
  - 把 `dist/` 全量拷到 `app/vendor/klinecharts-extension/`（150 KB，去掉了 .cjs）；
  - 加一层 `klinecharts-shim.js`：`export const utils = window.klinecharts.utils`，并把所有 `from "klinecharts"` 改写成相对 shim 路径（6 个文件）。
- 启动时 `registerExtensionOverlays()` 批量 `registerOverlay`，只注册一次。
- 工具栏放不下的原因 → 单独 `⋯`「扩展工具」弹层，18 个按钮网格；选中后走和内置工具完全相同的 `draw.activate()` 路径，所以拖点、样式、落盘、重建、右键菜单全都自动可用。
- 顺带修：`TOOL_ACTIONS` 在 `draw.js` 里，我把 `more` 图标误加到 main.js 导致工具栏显示 "undefined"；截图阈值 12→6、重试 5→8 以适配多图/多 TAB 后的首帧延迟。

## 修复：折线右键收尾会连带弹出图表菜单（2026-10-30）

**现象**：折线画完按右键，线条收尾了，但同时弹出右键图表菜单（复位图表/图表设置…）。

**根因**：右键菜单是挂在 `#chart` 的 **capture 阶段 mousedown(button===2)** 上（`wireContextMenu`，启动时注册），比折线激活时才注册的监听更早执行，并且它自己 `stopPropagation()`——折线的右键收尾逻辑根本没收到事件。随后 `contextmenu` 再触发一次，此时折线已结束，菜单照常弹出。

**修法**（`main.js`）：
- `abortDrawingIfAny()`：正在折线取点（`draw._poly`）或普通工具已有半个图形（`draw.pending`）时，右键 = 收尾/取消，直接 return 不开菜单；
- `ctxSuppressed()`：右键收尾后 500 ms 内吞掉紧随的 `contextmenu`（否则 mousedown 收尾成功、contextmenu 又把菜单弹出来）；
- 两条监听都先判这两个条件，再 `openCtx()`。

**验收**（并入 `?selftest=9`）：折线取 2 点后右键 → `_poly` 为 null、`#ctxMenu` 仍隐藏、`activeTool` 归空、绘图已落盘；再右键一次 → 菜单正常弹出。

回归 `?selftest=1..16` 全绿（2.68 / 2.65 / 1.29 / 6.16 / 1.94 / 2.73 / 4.75 / 5.32 / 3.72 / 3.76 / 4.23 / 7.14 / 10.52 / 13.59 / 6.87 s）。

## 追加：内核 logo + Ctrl 临时吸附 + Shift 水平线段（2026-10-30）

自检入口 `?selftest=17`，`pass: true`，5.70 s；回归 `?selftest=1..17` 全绿（2.97 / 2.58 / 1.31 / 6.18 / 2.00 / 2.72 / 4.75 / 5.35 / 3.73 / 3.78 / 4.26 / 7.13 / 10.53 / 13.60 / 6.86 / 5.70 s）。

| 验收项 | 判据 | 实测 |
|---|---|---|
| logo | 字标位置换成 klinecharts 官方 PNG | `assets/logo.png`（RGBA 256px），深色皮肤 `--logo-filter:invert(1)` |
| Ctrl 临时吸附 | `isSnapActive()` 三态 | 关→按住 true→松开 false |
| Ctrl 画线 | 两点都落在 OHLC 上 | `4068.945` / `4073.215`，均命中 |
| Shift 水平 | 两点 `value` 相等 | `4067.604` = `4067.604` |
| 无修饰键 | 两点不等高 | `4067.267` ≠ `4074.560` |

### 实现要点

- `magnet.js` 增加 `temp`（Ctrl 瞬时）+ `mods.shift`；`isSnapActive() = 常开开关 || Ctrl`；`bindModifierKeys()` 在 window 上监听 keydown/keyup（含 `blur` 复位，防止切窗口后"粘住"）。
- 趋势线改成**自己的模板**（`segmentOverlay.js` 覆盖同名 `segment`）：
  - `performEventMoveForDrawing({ points, performPointIndex })` 里直接改 `points[i]` → 预览阶段就能看到吸附/水平效果（参数里没有 chart，所以模板注册时注入 `() => state.app.chart`）；
  - `createPointFigures` 只画一条线，样式沿用 overlay 的 `styles.line`。
- 收尾兜底：`draw.js` 的 `onDrawEnd` 再判一次 Shift（`levelOverlay`）与吸附（`snapOverlay`）。
- **坑**：自定义模板的 overlay 在交互画完后不会自动重绘（只画了默认控制点，线不出现），`overrideOverlay` 一次同样的 points 才会出现。已在 `onDrawEnd` 末尾无条件补一次重绘。

## 修复：右键冒出 Chrome 原生菜单（2026-10-30）

**现象**：在界面上右键，弹的是浏览器的菜单（返回/重新加载/另存为/检查…），不是我们的「版面设置」菜单。

**根因**：右键拦截只挂在 `#chart` 上。图表区以外（状态栏、TAB 条、工具栏、回放条、右侧抽屉）右键没有任何处理，浏览器照常弹原生菜单；文件选择、图片、链接上右键还会带出「使用 Google 搜索图片 / 另存为」这类条目。

**修法**（`main.js` 的 `wireContextMenu`）：
- 右键监听提到 **document（capture）**：整页右键一律 `preventDefault`，只有输入框/文本域/`contenteditable` 放过（保留粘贴、选择等原生能力）。
- 菜单只在 **contextmenu** 事件里打开（`mousedown` 只负责拦默认行为 + 收尾正在画的图）。原因：同一次右键里“点外部关闭菜单”的监听也会在 `mousedown` 触发，如果两件事都放在 `mousedown`，刚打开的菜单会被同一个事件立刻关掉。
- 落在图表区外只做 `closeCtx()`，不弹菜单。

**验收**（并入 `?selftest=9`）：`#chart` canvas 右键 → 默认行为被拦 + 我们菜单打开；`#status`、`#tabBar` → 被拦但不弹菜单；`#startAt` 输入框 → 不拦（原生菜单保留）。

回归 `?selftest=1..17` 全绿（3.37 / 2.70 / 1.31 / 6.18 / 1.98 / 2.72 / 4.78 / 5.82 / 3.73 / 3.78 / 4.25 / 7.13 / 10.57 / 13.59 / 6.89 / 5.68 s）。

## 调整：画图控制点从实心大圆改成细空心圈（2026-10-30）

**现象**：画线时十字光标交点上是一个实心大圆点（直径 ~16px，含 3px 描边），把 K 线整个盖住。

**原因**：`chart.js` 的 `overlay.point` 只改了颜色，没改尺寸，沿用 klinecharts 默认 `radius:5 / activeBorderSize:3`，再叠加同色实心填充 → 视觉上是一团。

**改法**：`overlay.point` 改成空心细圈 —— `color: 'rgba(0,0,0,0)'`（不填充）、`radius: 2.6`、`borderSize: 1.1`；选中态 `activeRadius: 3.6`、`activeBorderSize: 1.6`。主题切换时颜色仍跟随 `--cross`（暗色冰蓝 / 亮色蓝）。

**验收**：`overlay.point` 读回为 `{color: transparent, radius: 2.6, borderSize: 1.1}`；截图里控制点是细圈，蜡烛清晰可读。

![画图控制点](docs/ui-draw-handles.jpg)

## 修复：按 Shift 变水平「反应慢」（2026-10-30）

**现象**：画趋势线时按住 Shift，要等鼠标再动一下、或者干脆落完点才变水平，感觉滞后。

**两个原因**：
1. klinecharts 的 `performEventMoveForDrawing({ points, performPointIndex, performPoint })` 里，**移动中的那个点是 `performPoint`，还没写回 `points`**。之前只改 `points[i]`，所以只影响最终落点，预览一直是自由斜线 → 看着"没反应/慢半拍"。
2. 按住 Shift 这个动作本身不产生鼠标事件；就算逻辑对，也要等下一次 `mousemove` 才重算。

**改法**：
- `segmentOverlay.js` 里同时写 `performPoint`（预览）和 `points[i]`（落点）。
- `main.js` 新增 `nudgeDrawingPreview()`：Shift / Control 的 keydown/keyup 时，按最后记录的鼠标位置补发一次 `mousemove`，让预览立刻重算；`watchPointer()` 记位置，失焦复位。

**验收**（并入 `?selftest=17`）：第一点落到 `4069.006` → 鼠标移到另一个高度（预览 `4074.56`）→ **不动鼠标只按 Shift** → 直接落点，第二点为 `4069.006`（水平）。

回归 `?selftest=1..17` 全绿（1.82 / 2.34 / 1.30 / 6.18 / 1.98 / 2.74 / 4.77 / 5.86 / 3.74 / 3.77 / 4.25 / 7.15 / 10.52 / 13.59 / 6.90 / 7.93 s）。

## 追加：指标设置（参数 / 颜色，2026-10-30）

自检入口 `?selftest=18`，`pass: true`，6.29 s。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 加 EMA 默认 | `calcParams` | `[6,12,20]`，设置里 3 行 |
| 改参数 | 填 `20` → 行数 | 3 → 1 行 |
| 应用 | `getIndicators()` 回读 | `calcParams:[20]`，`lines:[{#ffcc66,1}]` |
| 偏好落盘 | `ind:prefs` | `{EMA:{calcParams:[20], lines:[…]}}` |
| 移除再加 | 带偏好回来 | `[20]` + `#ffcc66` |
| 恢复默认 | 清偏好并重建 | 通过 |

### 实现要点

- klinecharts **不会回吐指标的默认线条样式**（`getIndicators()[i].styles.lines` 是空的），所以设置面板里按主题调色板 `indicatorPalette()` 现生成每条线的颜色，改完再用 `overrideIndicator({name, calcParams, styles:{lines}})` 写回。
- `overrideIndicator` **生效但返回 false**（老坑），判断成功必须回读 `getIndicators()` 比对 `calcParams`，否则会误报失败、偏好也不落盘。
- 参数输入实时联动：改参数个数时行数跟着变，已有颜色按序号保留。
- 偏好按指标名存 `ind:prefs`，`toggleBuiltin` 添加时带着它建图，所以"移除再加"能恢复上次的设置。

## 追加：图上图例 + 每个指标单独配置面板（2026-10-30）

自检入口 `?selftest=19`，`pass: true`，8.99 s；回归 `?selftest=1..19` 全绿（1.97 / 2.61 / 1.29 / 6.15 / 1.94 / 2.73 / 4.75 / 5.82 / 3.72 / 3.77 / 4.24 / 7.12 / 10.55 / 13.59 / 6.86 / 7.93 / 6.27 / 8.99 s）。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 图上图例 | 已上图指标各一行 | 2 行：`指数均线 EMA(6,12,20)`、`MACD(12,26,9)` |
| 指标显示/隐藏 | 图例眼睛 | `visible:false`，图例行 `.off` |
| 恢复显示 | 再点一次 | `visible:true` |
| 设置面板 | 图例 ⚙ 打开右侧抽屉 | 参数 `6, 12, 20`、3 条线、有眼睛/线型控件 |
| 参数改单线 | 填 `20` → 行数 | 3 → 1 |
| 单条线隐藏 | 线条眼睛 + 应用 | `lines[0].color = rgba(0,0,0,0)`，偏好里记 `hidden:true` 与原色 |
| 偏好落盘 | `ind:prefs` | 有 `calcParams/lines/visible` |
| 恢复默认 | 面板按钮 | 回到 `6,12,20` |

### 实现要点

- 图例挂在 `#main` 上（右上角，避开 klinecharts 自带的指标文字），每行：色块 · 名称(参数) · 👁 · ⚙ · ✕。指标级隐藏用 `overrideIndicator({name, visible})`。
- 设置从 popover 升级成**右侧抽屉面板**：`在图上显示` 开关 / 参数 / 每条线（显示·颜色·线宽·线型）/ 取消·应用，够放多参数指标。
- klinecharts 没有“单条线隐藏”的样式位，隐藏用**颜色置透明**实现；真实颜色与 `hidden` 标记存在偏好里，重新打开能还原。
- 注意 `transparentColor(undefined)` 会被判为真（`!c`），初值要判 `typeof color === 'string'`，否则面板一打开所有线都是“隐藏”状态（踩过，导致应用后线不可见）。

## 调整：把自定义图例与内核指标图例合并成一条（2026-10-30）

**问题**：图上原本有两处指标信息——内核在左上角画的一行 `EMA(6,12,20) EMA6: …`，和我们自己的图例盒（右上角，只有名字+按钮）。重复、割裂。

**做法**：
- 内核那行图例用样式关掉（`indicator.tooltip.title.show=false` + `title/legend.color='rgba(0,0,0,0)'`；`legend` 没有 `show` 字段，只能置透明）。
- 我们的图例行挪到左上角同一位置，自己渲染：`名称(参数)` + 每条线的标题与数值（颜色取自该线样式）+ `◉ ⚙ ✕`。
- 数值来源：`ind.result[idx][figureKey]`，`figureKey/title` 取自 `ind.figures`；`idx` 由十字光标位置换算，移出图表回落到最后一根。
- 指标是异步计算的，加完指标要 `refreshLegend()`（立即 + 280ms 各刷一次），否则会先显示 `n/a`。

**验收**：图例两行分别显示 `指数均线 EMA(6,12,20) EMA6: 4084.97 …` 与 `MACD(12,26,9) DIF: 4.4968 …`，按钮齐备；回归 `?selftest=1..19` 全绿。

## 调整：指标列表改成可折叠卡片，不压 OHLC 信息（2026-10-30）

**问题**：图例贴在 `top:4px` 左上角，和内核画的 `开/高/低/收` 那行、以及单元格标签重叠。

**做法**：
- 图例下移到 `top:34px`（OHLC 行下面），左侧 `left:8px`。
- 外面套一层卡片：头部 `⌄ 指标 N`（N 是数量，带圆角徽标），点一下折叠/展开，状态存 `ui:legend`，刷新后保持。
- 卡片有底色和发丝边框，宽度按内容自适应，最大 `min(720px, 100% - 120px)`；没有指标时整块隐藏。
- 每行仍是 `名称(参数) + 每条线的值 + ◉ ⚙ ✕`，按钮平时 28% 透明、悬停全亮。

**验收**：`?selftest=19` 通过（9.6 s）——卡片头存在、正文展开、2 行、6 个数值、折叠后 `hidden`、再点恢复展开；回归 `?selftest=1..19` 全绿。

## 追加：程序图标 + 桌面快捷方式（2026-11-02）

| 验收项 | 判据 | 实测 |
|---|---|---|
| 图标素材 | `app/assets/icon.ico` 多尺寸 | 7 个尺寸（16/24/32/48/64/128/256），每个内嵌 PNG 都能解出对应宽高 |
| 图标可读 | 16/24/32/48/64 真实像素对照图 | `docs/icon-sizes.png`；16px 仍能看出青绿+玫红两根蜡烛 |
| 页面声明 | `<link rel="icon">` / manifest | `icon.ico`(any)、16/32/192 png、apple-touch-icon、manifest |
| 静态服务 | 资源可取 | `icon.ico` 200 `image/x-icon`、`manifest.webmanifest` 200 `application/manifest+json` |
| 窗口图标 | 从窗口句柄读实际图标 | `WM_GETICON` 取到 32×32 图标，肉眼确认是蜡烛图标（不是 Chrome 默认） |
| 快捷方式 | `.lnk` 回读 | 桌面 + 程序目录各 1 个，`TargetPath=start.bat`、`IconLocation=icon.ico,0`、`WindowStyle=7`，`Ok=True` |

自动化方法（可复用）：`EnumWindows` 找标题含 `TraderTrain` 的窗口 → `SendMessage(WM_GETICON)`（ICON_SMALL2/ICON_BIG）→ `Icon.FromHandle().ToBitmap().Save()` → 看 PNG。

## 调整：换成用户提供的 Logo（2026-11-02）

| 验收项 | 判据 | 实测 |
|---|---|---|
| 源图 | `app/assets/logo-source.png` | 192×192 RGB，墨迹外框 128×122，线宽 5–7 px |
| 尺寸齐全 | 8 个 PNG + maskable + ICO | 16/24/32/48/64/128/192/512，ICO 内嵌 16/24/32/48/64/128/256 |
| 小尺寸可辨 | 16/24/32 真实像素 | 16px 圆环可辨、内部折线约略可读（线宽经加粗到 ≈1px） |
| 页面声明 | favicon/manifest | 与图标文件一致，静态服务 200（`image/x-icon`、`application/manifest+json`） |
| 窗口图标 | `WM_GETICON` 读回 | 32×32 显示深底浅线圆环 Logo（`docs/icon-window-32px.png`） |
| 快捷方式 | `.lnk` 回读 | 桌面+程序目录各一个，图标指向同一 `icon.ico`，`Ok=True` |

两种观感都保留：

- 深底浅线（当前）：`--dark --ink e8f2fa`，深色任务栏下最清楚，和程序的近黑皮肤一致；
- 白底灰线（忠实原图）：去掉 `--dark`。

切回白底只需重跑一次命令 + 重跑 `make-shortcut.bat`（Chrome 窗口 `Ctrl+R`）。

## 调整：图标换成新版 Logo（2026-11-02）

| 验收项 | 判据 | 实测 |
|---|---|---|
| 源图 | `app/assets/logo-source.png` | 256×256 RGBA，粗笔画（比上一版粗一倍），旧图留档 `logo-source-v1.png` |
| 透明角 | 覆盖率乘 alpha | 四角透明（alpha=0），生成结果四角为白、未被涂黑 |
| 尺寸 | 8 PNG + maskable + ICO | ICO 内嵌 16/24/32/48/64/128/256，27 KB |
| 小尺寸 | 16/24/32 真实像素 | 16px 仍可辨三段竖条与弧线；24/32 清晰 |
| 页面声明 | favicon/manifest | 指向同一批文件，静态服务 200 |
| 窗口图标 | `WM_GETICON` 读回 | 32×32 白底黑线新 Logo（`docs/icon-window-32px.png`） |
| 快捷方式 | `.lnk` 回读 | 桌面 + 程序目录，`Ok=True` |

当前使用：**白底黑线**（忠实原图）。切深底亮线只需加 `--dark --ink e8f2fa` 重跑 + `make-shortcut.bat`。

## 新增：ZIP / CSV 直接导入（2026-11-02）

`?selftest=20` pass（2.45 s）。回归 `?selftest=1..20` 全绿。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 列 zip 目录 | 3 个条目 → 过滤出 2 个 csv | deflate + stored 各一个，`__MACOSX/` 被跳过 |
| 两种压缩 | method 8 / method 0 都能解 | `TTZIP_2024.csv`(8) 与 `TTZIP_2025.csv`(0) 都读通 |
| 多文件合并 | 420 根 / 2 个年分片 | 2024=240 根、2025=180 根，合成一个 `TTZIP-1m` 档案 |
| 价格精度 | 与 csv 对齐 | 首根 `2150 / 2150.30 / 2149.30 / 2149.60`，`volume 100` |
| 周期校验 | 5m 数据必须拒 | 报「多数相邻间隔不是 60s（1m 占比 0%）」且不写库 |
| UI 全链路 | 塞文件 → 点导入 | 消息「导入完成：420 根」、`chartBarsAfterImport=420`、`tabCount=1` |
| 大文件 | 355,234 行 | **0.5 s**（9.5 MB 入库） |
| 多年多文件 | 1,018,913 行 / 3 年 / 12.1 MB zip | **1.5 s**（27.2 MB 入库，3 个分片） |

### 顺带修掉的 bug：切换数据源后图表 0 根

`loadProfile()` 没有清理 `state.tabs`：第二次加载会往 DOM 里再摞一层 workspace，然后 `activateTab(state.tabs[0])` 激活的是**上一轮的废弃 TAB**，
表现是「数据面板点『加载』→ 图表空白、状态栏 0 根」。修法：`loadProfile()` 开头 `resetTabs()`（pause + dispose + 移除 DOM + 清 state），
恢复存档 TAB 时按 id 去重。selftest20 里加了断言：导入后 `chart.getDataList().length > 0` 且 `.tab` 数量为 1。

## 调整：工具栏只保留左侧竖排（2026-11-02）

**原因**：悬浮条和左侧竖排是同一批按钮的两种形态，用户判断为重复，只保留竖排。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 只有竖排 | `#tools` class 含 `rail` | true |
| 悬浮恢复按钮 | `#toolsRestore` 已删 | DOM 里不存在 |
| 拖动握把 / 收起按钮 | `#tools .drag`、`[data-act=collapse]` | 都不存在 |
| 图表让宽 | `#chart` margin-left | 42px |
| 图例避让 | `.chart-legend` left | 52px（不再压在工具栏上） |
| 工具数量 | `#tools button` | 18 个（吸附 + 9 工具 + 4 操作 + 更多 + 样式 …） |
| 弹层可用 | 「更多」在竖排下打开 | `#moreTools` 268×235，位于按钮下方 |
| 旧存档兼容 | `ui:tools.mode='float'` | `toolsState()` 统一改成 `'rail'` |
| 回归 | `?selftest=1..20` | 全绿 |

## 修正：只删「◉ 悬浮工具栏」提示按钮，双形态保留（2026-11-02）

上一版把悬浮形态一起删了，过头了。用户要的是删掉左下角那个提示按钮——它和工具栏里的切换按钮功能重复。

| 项 | 期望 | 实测 |
|---|---|---|
| 「◉ 悬浮工具栏」按钮 | 不存在 | `#toolsRestore` 已从 DOM 移除，代码里无引用 |
| 悬浮形态 | 保留 | 点 `data-act=collapse` → `mode:'float'`、`#chart` margin-left 回 0 |
| 左侧竖排 | 保留 | 再点 → `mode:'rail'`、`margin-left:42px` |
| 拖动握把 / 切换按钮 | 保留 | `#tools .drag`、`[data-act=collapse]` 都在 |
| 图例避让 | 竖排时右移 | `#main.has-rail .chart-legend{left:52px}`，悬浮时回到 8px |
| 自检等待点 | UI 就绪 | 新增 `window.__UI_READY__`；`selftest10` 等它再点主题（原先赶在 `wireThemeMenu()` 之前，偶发 menuOpen=false） |
| 回归 | `?selftest=1..20` | 全绿（selftest10 连跑 3 次稳定） |

## 兼容 Dukascopy / MT5 导出的 CSV 列与时间格式（2026-11-02）

| 项 | 判据 | 实测 |
|---|---|---|
| `time` 单列 | 表头只有 `time,open,high,low,close,volume` | 当时间列使用 |
| `DD.MM.YYYY HH:MM:SS[.mmm]` | Dukascopy 默认格式 | `03.06.2024 00:00:00` → `2024-06-03T00:00:00Z` |
| 5 位小数价格 | `2320.00000` | 定点后 `2320` |
| 用例 | `TTDK.zip`（120 根） | `?selftest=20` pass：120 根、首根 o=2320 |
| 回归 | `?selftest=1..20` | 全绿 |

## 新增：页面内历史数据下载（Dukascopy，2026-11-02）

| 验收项 | 判据 | 实测 |
|---|---|---|
| 标的口径 | `/api/instruments` | 28 个（金属/外汇/加密/指数），每个带中文名、类别、point |
| 搜索 | 代码 `xau` / 名称 `黄金` | 都命中 XAUUSD、XAUEUR |
| 选中 | 点结果 | `已选 XAUUSD 黄金/美元 · 金属` |
| 周期/价格 | 控件 | 周期只有 `M1`；价格 `BID/ASK` |
| 单日（缓存） | 下载→导入 | 1,381 根，2 s |
| 单日（现下） | 同上 | 1,381 根，12 s |
| 一个月 | 20 个交易日 | 26,989 根 / 0.7 MB / 124 s，首 2024-06-03T00:00Z，末 2024-06-28T21:00Z（严格有序） |
| 假 K 线过滤 | 一日 1440 → 1381 根 | 去掉 59 根休市填充 |
| 缓存 | `.cache/duka/` | 20 天 3.9 MB，重复下载不再走网络 |
| 无接口时 | `python -m http.server` | 面板提示"没有下载接口"，`?selftest=21` 标记 skipped 而非失败 |
| 自检 | `?selftest=21` | 带 API 1.73 s pass；无 API 545 ms pass(skipped) |
| 回归 | `?selftest=1..21` | 全绿（`selftest2` 绘图用例偶发不稳，重跑通过） |

服务端实现要点：
- `.bi5` 是 **LZMA alone** 格式，浏览器没有 `DecompressionStream('lzma')`，所以解压必须放在本地服务里（`tools/serve.py`，标准库 `lzma`）。
- 价格是整数定点：`raw / point`，point 由品种决定（XAU/XAG/JPY/IDX=1000，外汇主对=100000）。
- 二进制 24 B/根、**大端**、字段顺序是 `time_offset, open, close, low, high, volume`（注意 close 在 low 前）。
- URL 的月份是 **0 基**（`2024/05/03` = 6 月 3 日）。
- Dukascopy 会返回 503 限流：单进程 6 并发 + 指数退避（最长 20 s）+ 抖动，实测可用。
- 日本/欧美休市日文件可能为空或 404：按"跳过"计，不报错。

## 修正：下载面板搜索没反应（2026-11-02）

**现象**：输入 `XAU` / `XAUUSD` 没有任何结果。

**根因**：标的名录只来自服务端 `/api/instruments`，而当时 8731 端口上跑的仍是旧的 `python -m http.server`（没有 `/api`）→ 请求 404 → `dlSearch` 抛错被吞，列表空、无提示。

**修法**：
1. 名录内置到前端 `app/src/instruments.js`（31 个标的 + `searchInstruments()`），搜索不再依赖后端，边打边筛；
2. 只在下单时探测 `/api/duka/*`，不可用就明确提示"下载需要本地服务：请用 start.bat 重启"；
3. 结果点击的回查改用模块内清单（原来 `DL.instruments` 为 null 时 `find` 抛错，点了没反应）；
4. `start.bat` 已改为启动 `tools/serve.py`；本次也把 8731 的服务换成了 serve.py（静态 MIME 校验：`main.js=text/javascript`、`webmanifest=application/manifest+json`、`icon.ico=image/x-icon`）。

| 验收 | 结果 |
|---|---|
| 输入 `XAU` | 列表 = `XAUUSD, XAUEUR` |
| 输入 `XAUUSD` | 列表 = `XAUUSD` |
| 输入 `黄金` | `XAUUSD, XAUEUR` |
| 无 API 时（旧 http.server） | 搜索结果正常 + 提示"下载需要本地服务" |
| 真实下载（EURUSD 2024-06-03） | 1,429 根导入成功，另一档案 XAUUSD 4,016,034 根未受影响 |
| 回归 `?selftest=1..21` | 全绿；`selftest2` 改为轮询等待（连跑 5 次稳定 1.8 s） |

## 加密与纳指数据源核实 + point 值修正（2026-11-02）

| 项 | 判据 | 实测 |
|---|---|---|
| Dukascopy BTCUSD M1 | 2024-06-05 单日 | 1,440 根，首根 `70516.80`（BTC 实价 ≈7.05 万） |
| Dukascopy ETHUSD M1 | 同左 | 1,440 根，首根 `3808.80` |
| Dukascopy USATECHIDXUSD M1 | 2024-06-05 | **1,330 根**，首根 `18689.886`（纳指 100 ≈18,690） |
| Dukascopy USA500IDXUSD M1 | 同左 | 1,440 根，`5298.396` |
| **point 值 bug** | BTC/ETH 原写 100 | 正确是 **10**（`raw 705168 / 10 = 70516.8`）；已在前端清单与服务端同步修正 |
| Binance Vision 月包 | `BTCUSDT-1m-2024-06.zip` | 1.9 MB / 0.7 s 下载，43,200 根，**无表头 + epoch 毫秒** |
| Binance 包直接导入 | 走「ZIP / CSV 导入」 | **43,200 根 / 1.2 MB / 0.2 s**，首根 `o=67540.01 h=67585.89 l=67540 c=67573.41 v=11.674` |
| Binance 历史起点 | 2017-08 月包 | HTTP 200 可用 |

## 合并两个数据源到一个列表（2026-11-02）

需求：不加「数据源」下拉，一个标的列表同时含 Dukascopy 与 Binance，选中即决定源。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 列表合并 | `/api/instruments` | 48 个：`dukascopy 29 / binance 19`，每条带 `source` |
| 行内标记 | 搜索结果 | `BTCUSDT 比特币/USDT 加密 · BINANCE`、`USATECHIDXUSD 纳斯达克 100 指数 · DUKA` |
| 中文别名 | `纳指 / 标普 / 黄金 / btc` | `纳指`→USATECHIDXUSD、`标普`→USA500IDXUSD、`btc`→BTCUSDT |
| 选 Binance 标的 | 价格下拉 | 自动 `disabled`（归档只有成交价） |
| Binance 下载 | BTCUSDT 2024-06 | **43,200 根 / 1.2 MB / 2 s**（月包缓存命中），首根 `67540.01` |
| Dukascopy 下载 | USATECHIDXUSD 2024-06-05 | **1,330 根**，首根 `18689.886` |
| 服务端分派 | `/api/job?...&source=` | `dukascopy`→按交易日；`binance`→按自然月，当月缺月包自动按日补 |
| API 兼容 | `/api/duka/job` 旧路径 | 仍可用（别名） |
| 搜索竞态 | focus 与 input 并发 | 加序号守卫，只渲染最后一次输入（曾出现“输入被空查询覆盖”） |
| 自检 | `?selftest=21` | 3.43 s pass（含 merged 断言） |
| 回归 | `?selftest=1..21` | 全绿 |

## 修正：按品种区分交易日历 + 区间严格裁剪（2026-11-02）

| 场景 | 期望 | 实测 |
|---|---|---|
| **加密 纯周末区间**（BTCUSDT 2024-06-08~09，周六+周日） | 2 天都要有数据 | `done`，**2,880 根**（周六 1440 + 周日 1440），首 `06-08T00:00Z` 末 `06-09T23:59Z` |
| 加密 区间中段（BTCUSDT 06-15~06-20） | 只保留所选 6 天 | **8,640 根**（6×1440），首 `06-15T00:00Z` 末 `06-20T23:59Z`（月包整月下载后被裁掉） |
| 外汇 纯周末区间（XAUUSD 06-08~06-09） | 明确说明不是 bug | `error`，`total=0`，文案「所选区间里没有工作日（Dukascopy 周末休市）；加密品种请选 Binance 源」 |
| UI 链路 | 周末区间能直接导入 | `已导入 BTCUSDT · 2,880 根 · 2024-06-08 → 2024-06-09` |
| 自检 | `?selftest=21` | 4.39 s pass，新增 `calendar` 断言（crypto 2880 / fx error） |
| 回归 | `?selftest=1..21` | 全绿 |

实现要点：
- `is_crypto(symbol)`：Dukascopy 任务只在**非加密**品种上跳周末；
- Binance 任务单位是自然月，按月抓完后用 `[from 00:00, to 23:59:59] UTC` 裁剪，再写 CSV。

## 新增：「补到昨天」增量续传（2026-11-02）

按钮位置：04 数据 → 历史数据下载 → 「下载并导入」右边。可用性看档案：没档案 → 置灰提示先整段导入；最后一天 ≥ UTC 昨天 → 置灰「已是最新」。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 增量合并（离线单测 `?selftest=22`） | 420 根档案 + 续 61 行（含 1 根重叠） | 结果 **480 根**（+60），首根不变，2024 分片 300 根 |
| 复用未变动年份 | 2025 分片 key | **前后 key 完全相同**（没重写） |
| 重写受影响年份 | 2024 分片 key | 变了（合并后重写） |
| 边界同 ts | 03:59 那根 | 取**新值**：`close=9999, volume=7` |
| 无档案时续传 | 报错而非新建 | 「没有 TNOPE-1m 的档案，先整段导入一次再续传」 |
| 真实链路（BTCUSDT） | 44,640 根（到 10-31）→ 点补到昨天 | 新增 **1,440 根**（11-01），现共 46,080，`last=2026-11-01T23:59Z`，重叠的 10-31 已去重 |
| 已是最新 | BTCUSDT 再点 | 「已是最新：最后一天 2026-11-01」，按钮 `disabled` |
| XAUUSD 场景 | 4,016,034 根、最后 2026-06-27 | 按钮提示 `2026-06-27 → 2026-11-01（已有 4,016,034 根）` |
| 自检/回归 | `?selftest=1..22` | 全绿（`selftest2/3` 加了“先切到 XAUUSD 档案”的守卫） |

修掉的三个坑：
1. **Binance 时间单位不统一**：2026 年的日文件 `open_time` 是**微秒**（1.7e15），月包是毫秒。按 `>1e11 就 /1000` 循环归一到秒，否则 `datetime.fromtimestamp` 抛 `[Errno 22] Invalid argument`。
2. **空缓存毒化**：某月抓空时会写出“只有表头”的缓存文件，下次直接命中返回 0 行。现在读缓存前判 `size > 60`。
3. **合并入参类型**：`getChunk` 返回 ArrayBuffer、新数据是 Uint8Array，`new DataView()` 只吃 ArrayBuffer —— 统一用 `(arr.buffer, byteOffset, byteLength)`。

## 新增：指标库分类 / 收藏 / 组合模板 + 自建关键位指标（2026-11-02）

`?selftest=23` pass（7.6 s）；回归 `?selftest=1..23` 全绿。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 自建指标注册 | `getSupportedIndicators()` | `PDHL / ORB / AVWAP` 都在 |
| 分类 chips | `#indCats` | `fav, combos, key, smc, general, pine` |
| 关键位列表 | 分类内容 | 3 个，带一句说明 |
| 搜索跨分类 | 输入 `vwap` | 命中 `AVWAP`（去重后仅 1 条） |
| 上图 | 三个都加 | `getIndicators()` = PDHL/ORB/AVWAP，result 各 1200 行 |
| 收藏 | 点 ☆ | 写入 `ind:fav`，`我的收藏` 可见 |
| 组合模板 | 保存当前组合 | `ind:combos` 1 条，items = 三个指标 |
| 应用组合 | 清空后点应用 | 三个指标按序重建 |
| 内置指标仍在 | 通用分类 | 27 个（`selftest4` 断言 ≥20） |

### 过程中踩到并修掉的三个问题

1. **klinecharts v10 里 indicator 的 `draw` 回调不会被调用**（用最小用例复现：红块没画出来）。所以自建指标一律用 `figures`（line/circle）表达，不写自定义 draw。
2. **稀疏序列会污染价格轴**：只给「最后一天」赋值的三条线会把纵轴拉爆。加 `NEAR_RATIO=1.5%` 过滤，离现价太远的参考位不输出。
3. **恢复 `syncLayoutMenu()` 时漏了 `state.replay` 重绑**：`Workspace.applyLayout()` 会 new 一个 `MultiReplay`，不同步替换 `state.replay` 的话，切换分屏后各格游标不再联动（`selftest14` 直接抓出来）。已补 `state.replay = workspace.multi` + `setEmitter` + `setStart(旧游标)`。

顺带把三个老用例改成用 `[data-add]` 选择器（列表行里现在第一个按钮是收藏星标）。

## 指标库 UI 对齐参考站点（2026-11-02 第二轮）

`?selftest=23` 7.6 s pass；回归 `?selftest=1..23` 全绿。

| 参考图元素 | 实现 | 实测 |
|---|---|---|
| 小标 `INDICATOR LIBRARY` + 大标题「指标库」+ 右上 ✕ | `.ind-kicker/.ind-title/.ind-x` | 渲染正常 |
| 胶囊搜索（放大镜 + 占位文案） | `.ind-find` + 内联 SVG | 命中 `EMA` |
| `当前分类 · N 个指标` + 右侧「保存当前组合」 | `.ind-meta` + `#indTotal` | `当前分类 · 27 个指标`（通用） |
| 4×2 分类网格，选中格琥珀底 | `.ind-cats` / `.ind-cat.on` | `我的收藏/组合模板/订单流/关键位 · SMC/通用/Pine / 自编` |
| 目标说明行 | `.ind-caption` | `当前目标：主盘 · 1m · 收藏保存在本机浏览器中。` |
| 列表：星级 + 名称 + 一行说明 + ☆ + 添加 | `.ind-item .rate/.nm/.star/.add` | 添加后按钮变灰「已添加」，再点移除 |
| 面板内滚动 | `.ind-body` + 细滚动条 | 27 条时 `scrollHeight 1990 / clientHeight 773` |

修掉的一个真问题：`.ind-body` 是 flex 列，分类网格 `overflow:hidden` 时会**被压到 2px 高**（切到条目多的分类才暴露）。给 `.ind-body>*{flex:0 0 auto}` 后恢复 90px。

### 面板关不掉的修复（同日）

**现象**：刷新后指标库面板一直浮在右侧、点 ✕ 无效、内容还是 `当前分类 · 0 个指标`。

**机制**：新样式 `#indicatorPanel.ind-lib{display:flex}` 的优先级高于浏览器默认的 `[hidden]{display:none}` —— `hidden` 属性还在（`el.hidden === true`），但计算样式是 `flex`，所以面板永远可见；因为没人点过按钮，`renderIndicatorPanel()` 也没跑过，列表就是空的。看起来像"卡住"。

**修法**：`#indicatorPanel.ind-lib[hidden]{display:none}` + 全局兜底 `.panel[hidden],.drawer[hidden]{display:none!important}`；`selftest23` 增加三条断言（关闭态 `display:none` / 打开态非 none / 点 ✕ 后 `hidden` 且 `display:none`）。

**验证**：9 个面板在 hidden 时 `display` 全是 `none`；打开→关闭往返正常；回归 `1..23` 全绿（`selftest2` 偶发画布抖动，单独连跑 3 次均通过）。

## SMC / ICT 指标（2026-11-02 第三轮）

`?selftest=24` pass（6.6 s）；回归 `?selftest=1..24` 全绿。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 注册 | `getSupportedIndicators()` | `SMC_FVG / SMC_MST / SMC_ICT / SMC_HTF` |
| 库内条目 | SMC 分类 4 条，标题与参考图一致 | FVG / IFVG、聪明钱概念、ICT 杀区工具箱、波段 & 中期结构 |
| 上图 | 逐个点添加 | `getIndicators()` 4 个全在 |
| 计算 | payload 非空 | FVG zones 8 / MST events 8 + eq 4 / ICT zones 3 + fvgs 4 / HTF swings ≥0 |
| 图例 | 中文名、无占位 figure 的 n/a | `FVG / IFVG(8)` 等 4 行 |
| 移除 | 点「已添加」 | 4 → 3 |
| 视觉 | 截图 | 杀区竖带 + BOS/CHoCH + OB 区 + FVG/IFVG 标签 |

### 这轮挖到的 klinecharts 事实（修正之前“draw 不会被调用”的判断）

1. **`draw` 会调用，但模板必须至少有一个 `figures`**：`figures: []` 时 draw 一次都不进（我先前的红块测试就是踩这个）。
2. **`createIndicator({name, paneId})` 不传 `isStack` 会替换掉该 pane 上已有的指标**：连加 4 个只剩最后 1 个。必须 `createIndicator(value, true)`（`toggleBuiltin` 本来就是对的，是我手写探针踩了）。
3. **draw 里没有 `visibleRange`**：用两点采样反推可见下标区间 —— `step = px(1) - px(0)`，`from = (0 - px(0)) / step`，`to = (width - px(0)) / step`，超出就跳过，否则远处的历史结构会画到视窗外还拖慢渲染。
4. 自绘图例要过滤掉占位 figure（`title` 为空、颜色透明的），否则图例出现 `SMC_MST(5) v n/a`。

## 订单流四件套（2026-11-02 第四轮）

`?selftest=25` pass（5.6 s）；回归 `?selftest=1..25` 全绿。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 注册 | `getSupportedIndicators()` | `FLOW_VOL / FLOW_VP / FLOW_WALL / FLOW_DEPTH` |
| 库内条目 | 订单流分类 4 条 | 成交量、综合 VP、订单墙、挂单深度 |
| 上图 | 四个都加 | 面板数 2（主图 + 成交量副图），指标 4 个 |
| VP 计算 | POC/VAH/VAL | 60 个价格桶，POC 4069、VAH 4094、VAL 4065 |
| 墙 | 无量退化 | `hasVolume=false`，5 个触及簇 |
| 深度 | 无量退化 | 24 个价位桶，参考价 4089.248 |
| 口径标注 | 图例/画面 | `VP·TIME` / `DEPTH·时间差` 标签，副图提示“没有成交量” |

### 这轮的两个新坑

1. **副图指示灯的 `bounding.top` 是容器坐标，不是画布本地坐标**：主图 top=0 时看不出来，副图 top≈549、画布只有 100 高，写 `bounding.top + 12` 就把文字画到画布外了（表现为“draw 明明跑了但什么都看不到”）。一律用 `ctx.canvas.height` 和本地 `0` 做纵向坐标与裁剪。
2. **多个贴右缘的面板会叠在一起**：VP 与 DEPTH 都从右缘向左画，第一次同时打开时重合成一条。修法是在 draw 里用 `chart.getIndicators()` 判断兄弟指标，DEPTH 主动让出 118px；墙的标签也从右缘挪到线段起点并加底色。

## Pine 自编指标的参数面板（2026-11-02 第五轮）

`?selftest=26` pass（9.3 s）；回归 `?selftest=1..26` 全绿。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 参数全量 | 脚本 4 个 input 全列 | 周期(int,14)、倍数(float,2)、使用中值(bool,true)、价格源(source,close) |
| 控件类型 | 按声明类型给控件 | `int,float,bool,source` 四种都对 |
| 通用参数行 | Pine 时隐藏 | `#indSetParamsRow` 计算样式 `none` |
| 线条 | 按 plot 列出 | `basis / upper / lower` 三条 |
| 应用 | 改 30 / 3 + 首线改色 | 新指标 `PINE_10b09b2f`，basis 4078.51 → 4073.61，`lines[0].color=#ffcc66` |
| 持久化 | 存回脚本条目 | `inputs={len:30,mult:3,useMid:true,src:close}`、`lineStyles[0]=#ffcc66` |
| 恢复默认 | 清空保存值 | `inputs={}`、`lineStyles=[]`，指标回到脚本默认 |

### 这轮的两个真问题

1. **Pine 分支被通用逻辑盖掉**：`openIndSettings()` 里我把 Pine 面板渲染完又继续走通用代码，`renderIndSetLines([])` 立刻把线条区清空（表现为“脚本参数有了，线条却还是空”）。Pine 分支必须 **early return**。
2. **又一次 `[hidden]` 被 `display` 吃掉**：`.ind-set-row{display:flex}` 让“参数”这一行隐藏不掉。规则：凡是自己写了 `display` 的类，都要补 `[hidden]{display:none}`（本项目已第三次踩，已在 `.panel/.drawer/.ind-set-row/.ind-combo-form` 分别补上）。

## Pine 指标命名 + 刷新后恢复（2026-11-02 第六轮）

`?selftest=27` pass（4.2 s）；回归 `?selftest=1..27` 全绿。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 指标名用脚本名 | 图例首行 | `Candle 2 Closure [LuxAlgo] basis …` |
| 内核短名 | `shortName` | `Candle 2 Closure [Lu`（截 20 字符） |
| 持久化映射 | `pine:map` | `PINE_a1065bd8 → {id, name:'Candle 2 Closure [LuxAlgo]'}` |
| 模拟刷新（清空内存管理器） | 设置面板仍可开 | 标题 `Candle 2 Closure [LuxAlgo] · PINE_a1065bd8`，参数 `len,show,src`，线条 `basis,upper` |
| 真刷新 | 指标自动回来 | 重载后 `getIndicators()` 仍有该指标、图例名字正确 |

### 这轮修掉的三个真问题

1. **`.ind-set-body` 也是 `display:flex`**，`hidden` 属性不生效 → 面板里那块“脚本参数”永远显示（还是空的），看起来像“参数没出来”。这是本项目第四次踩 `[hidden]`，已加 `.ind-set-body[hidden]{display:none}`。
2. **刷新后 Pine 指标全丢**：管理器是内存对象，页面重载就空了（`refreshPine()` 只遍历内存里的记录）。改为持久化 `pine:active`（已上图脚本 id）与 `pine:map`（实例名→脚本名），启动时 `restorePineIndicators()` 按 id 重新 `apply`；设置面板在管理器为空时用 `pine:map` + 图上指标的 `figures` 兜底构造记录。
3. **并发 apply 会留下重复指标**：恢复与手动添加同时跑时会“删了又建”，图例出现两条同名。`apply()` 改成 Promise 队列串行执行，并在创建后按名字去重（只留刚建的那条）。

> 老数据提示：这轮之前挂上去的 `PINE_*` 没有 `pine:map` 记录，刷新后不会自动回来；到「Pine / 自编」里重新点一次添加即可，之后就会被记住。

## 结构 & 趋势面板（对齐 LuxAlgo Structure & Trend Dashboard，2026-11-02 第七轮）

`?selftest=28` pass（6.0 s）；回归 `?selftest=1..28` 全绿。

按 LuxAlgo 页面上的四个模块落地：结构标签（BOS/CHoCH）、多周期面板对齐、流动性扫单、FVG。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 注册 | `getSupportedIndicators()` | `SMC_DASH` |
| 库内条目 | SMC 分类 | 5 条（含「结构 & 趋势面板」） |
| 默认口径 | `calcParams` | `[10, 60, 60, 15, 3, 1, 0]` → 结构 1H、面板 1H/15M、FVG 3、扫单开 |
| 计算 | payload | 面板两行 `1H/15M`、结构趋势 1、扫单 8 处、FVG 3 个 |
| 改参数 | `[10,240,240,60,5,1,1]` | 面板变 `4H/1H`、FVG 5、蜡烛染色开 |
| 移除 | `removeIndicator` | 图上消失 |

### 这轮踩到并修掉的

1. **高周期桶太少 → 整列“震荡”**：1200 根 1m 只有 20 个 1H 桶，摆动回看 10 一个 pivot 都出不来。改成按桶数自适应缩小回看（`min(lb, bars/8)`），结构没方向时用 EMA(12/50) 兜底。
2. **面板一开始挤成一条**：168px 宽两列文字重叠 → 加到 208px、行高 21、标题与对齐行分开展示。
3. **自检互污染**：`selftest26/27` 依赖 Pine 脚本库，被上一轮手工测试残留影响；现在两个用例开头都清 `pine:lib / pine:active / pine:map` 并移除图上 `PINE_*`。`selftest24` 的 SMC 条数同步从 4 改 5。

## Pine v6 支持与兼容性预检（2026-11-02 第八轮）

`?selftest=29` pass（3.9 s）；回归 `?selftest=1..29` 全绿。

| 验收项 | 判据 | 实测 |
|---|---|---|
| v6 识别 | `ctx.pineVersion` | **6**（不是当成 v5 跑） |
| v6 语法 | 5 组脚本 | `switch / array / pivothigh+pivotlow / valuewhen / hline` 全部 ok，pivot 出 2 条线、hline 出 `mid` |
| bgcolor | 输出过滤 | 只剩 `c` 一条（`bgcolor#0` 被丢掉，不再画噪声线） |
| 兼容预检 | `scanCompat()` | 仪表盘脚本 → `worst=bad`，命中 table/label 两条；正常 v6 → `worst=ok` |
| 面板提示 | `#pineMsg` | 多行列出：0 条输出 / v6 说明 / table / label / 没有 plot() |

### 这轮发现并修的两个问题

1. **“v6 不支持”其实是绘图原语不渲染**：PineTS 解析 v6 没问题，但 `table.new / label.new / box / line` 会被静默忽略（不报错、0 条输出），用户只看到“图上什么都没有”。现在预检把这类语法、缺失的 `plot()` 都点出来。
2. **Pine 编辑器被指标库挡在后面**：两个面板都贴右边，「新建 Pine」只是显示 pinePanel，指标库没关 → 看起来像点不动。现在打开一个会关掉另一个（并给 pinePanel 更高 z-index）。

## 诊断：LuxAlgo Structure & Trend Dashboard 为什么不显示（2026-11-02）

用用户提供的原始脚本直接跑了一遍（`compilePine`），结论：

| 现象 | 证据 |
|---|---|
| 编译通过但不是指标 | `ok=true`、`names=[]`（0 条数值输出） |
| 脚本没有任何 `plot()` | `scanCompat().hasPlot = false` |
| 面板表格是空的 | `ctx.plots.__tables__.data[0].value[0].cells` 全为 null，`filledCells=0` |
| 表格为什么空 | 写单元格的代码在 `if dashboardInput and barstate.islast` 里，而 PineTS 的 `barstate.islast` 恒为 false |
| 多周期拿不到数据 | 6 个 `request.security(..., "1D"/"240"/"60"/"15"/"5"/"1", …)` 全部返回 null |
| 绘图对象也没法用 | `__lines__` 498 条、`__labels__` 500 条、`__boxes__` 5 条都记录了，但只有 `y1/y2/top/bottom`，**没有 x 坐标** |

处理：`input.timeframe` 之前没被解析（脚本 11 个参数只认出 9 个），已补；并把内置 `SMC_DASH` 升级为三组周期对齐表（HTF / LTF / 对齐 + 全周期对齐），参数 11 个，`?selftest=28` 6.1 s 通过。

## LuxAlgo 脚本直接粘贴（第一版，2026-11-02）

按用户选择走"打补丁"路线。详细计划见 `docs/PINE-LUXALGO-PORT.md`。

| 补丁 | 作用 | 验证 |
|---|---|---|
| `preprocessPine` 的 `barstate.*` 替换 | `islast` 恒 false 时"只在最后一根画面板"的整块不执行 | `plot(barstate.islast?1:0)` 末值 = 1 |
| `preprocessPine` 的 `var … ? … : na` 改写 | 三元 + na 初始化会让变量变成 na（对象建了但 `.cell()` 全空操作） | 表格 `filledCells` 0 → 33 |
| `pineDraw.collectDrawings` + DOM 面板 | 运行时只记录不渲染；表格改 DOM 画，label/box/line 走 canvas | LuxAlgo 面板显示 `Trend Alignment / HTF / LTF / 1D (Bear) …`，`td` 21 个 |

**仍然缺**：`time/time_close` 等时间内建（bt 坐标丢失）、`request.security` 多周期（趋势值全 null）、绘图对象 x 记录。已在计划文档里列成 5 项待办。

## LuxAlgo 脚本完整可用（2026-11-02 收尾）

`?selftest=30` pass（4.6 s）；回归 `?selftest=1..30` 全绿。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 脚本解析 | LuxAlgo 原文 14,141 字符 | 编译 ok |
| 时间序列 | `plot(time)` / `hour` | `1782539880000` / `5` |
| 多周期 | `security(…,"60")` / `"240"` | `4089.248` / `4089.248`（非 null） |
| 绘图对象 | 带坐标数量 | 线 183/183、框 5/5、标签 78/78 |
| 表格 | 单元格 | 33 个，含 `HTF / LTF / Aligned / ☑` |
| DOM 面板 | 挂图后 | `.pine-board` 1 个、`td` 21 个 |
| 移除 | `remove()` 后 | 面板与指标都消失 |

**关键修复**：给运行时的 bar 补 `openTime / closeTime`（`toPineBars()`）。这一处同时解决了时间内建、`request.security` 多周期、以及所有 `xloc.bar_time` 绘图对象的坐标 —— 之前判断的"要打四个补丁"其实是一个根因。

## Pine 参数面板支持 options 下拉（2026-11-02）

`?selftest=30` 扩展到 7.8 s 通过（新增下拉断言）；回归 `?selftest=1..30` 全绿。

| 判据 | 实测 |
|---|---|
| `parseInputs` 解析 `options=[...]` | `dashboardPositionInput → [Top Right, Bottom Right, Bottom Left]`、`dashboardSizeInput → [Tiny, Small, Normal, Large, Huge]` |
| 面板控件 | 两个 `<select>`，当前值 `Top Right` / `Small` |
| 数值范围提示 | 只有 min 时显示 `≥1`（之前显示成 `1~` 被截断） |
| 面板宽度 | 320 → 360px，长标签省略号，控件固定 136px，无横向溢出（`clientWidth == scrollWidth`） |
| 纯绘图脚本的线条区 | 提示“这个脚本没有 plot()：内容都是绘图对象…” |

## Pine / 自编 分类界面（2026-11-02）

| 参考图元素 | 实现 | 实测 |
|---|---|---|
| 搜索框 + 刷新（占位「搜索名称或账号」） | `.ind-search-row` | 输入框 + `#indRefresh` 同排 |
| `我的指标 · N 个` | `setMeta('我的指标', n, '个')` | `我的指标 · 2 个` |
| 4×2 分类网格 + 琥珀选中格 | `.ind-cats` | 7 个分类，Pine / 自编 高亮 |
| `新建 Pine 指标` 整行按钮 | `.ind-wide` | 452px 面板内占满一行 |
| 空库居中卡 | `.ind-empty-card` | 标题「编译一次，随时取用」+ 说明 |
| 列表行 | `.ind-pine-row` | 星级 + 脚本名 + `子图 · 14141 字符 · 2026/11/2` + ✎ + `+ 添加` |
| 页脚提示 + 信息条 | `.ind-foot` / `.ind-info` | 「从图表移除后仍保留…」+ ⓘ 数据窗口说明 |
| Pine 分类不显示「保存当前组合」 | `#indSaveCombo.hidden` | 切到 Pine 自动隐藏，切回其他分类恢复 |

回归 `?selftest=1..30` 全绿（23 / 26 / 27 / 29 / 30 逐个复跑均通过）。

## 截屏当前窗口 → 剪贴板（2026-11-02）

`?selftest=31` pass（2.9 s）；回归 `?selftest=1..31` 全绿（`selftest2` 画布抖动偶发一次，连跑 3 次均通过）。

| 验收项 | 判据 | 实测 |
|---|---|---|
| 按钮 | `#btnShot` 存在且有 `title` | `截屏当前窗口并复制到剪贴板` |
| 事件 | `onclick` 已绑定 | `function` |
| 图片 | PNG 尺寸 | `1542×806`（图表 `1542×730` + 信息条/状态条 `76px`） |
| 体积 | — | 76.8 KB |
| 结果文案 | 状态栏 | `窗口截图已复制到剪贴板（0.1 MB）` |
| 降级 | 剪贴板不可用 | 自动下载 PNG，提示「已下载 PNG」 |

实现要点：`captureWindowShot(host, meta)` 先把 `#chart` 里所有 canvas 按 `getBoundingClientRect` 拼成一张，再在上下各画一条信息带（主题色取 CSS 变量，深/浅主题都对得上）；剪贴板用 `ClipboardItem({ 'image/png': blob })`。

## Tab 改名 + 面板关闭链路（2026-11-02）

`?selftest=32`（改名）3.2 s、`?selftest=33`（关闭链路）11.6 s 通过；回归 `?selftest=1..33` 全绿（5 未使用）。

### Tab 改名
| 判据 | 实测 |
|---|---|
| 双击进入编辑 | `.tab-in` 出现，值为原名 `日内复盘` |
| Enter 保存 | `日内复盘 A`，`ui:tabs[0].name` 同步 |
| Esc 取消 | 名字回到 `日内复盘 A`，输入框消失 |
| 空名提交 | 不覆盖，仍是 `日内复盘 A` |
| blur 保存 | `日内复盘 B`，reload 后仍是 `日内复盘 B` |
| 副标题 | 仍为 `XAUUSD · 1M` |

### 关闭链路（根因：Esc 关闭器元组按下标取错了元素）
| 场景 | 结果 |
|---|---|
| 指标库 ✕ | 关 |
| 指标库 再点按钮 | 关 |
| 指标库 Esc | 关（**修复前不响应**） |
| Pine 编辑器 Esc | 关（**修复前不响应**） |
| 指标设置抽屉 Esc | 关 |
| 改名输入框开着时点 tab ✕ | 图关闭（`before 2 → after 1`），靠 `mousedown` 触发 |

代码要点：关闭器改写成 `{ key, open, close }` 对象（原来是 `['indicator', isOpen, close]` 三元组，`hit[1]()` 取到的是 `isOpen` 而不是 `close`，所以点了等于没点）；Esc 监听放在 `window` 捕获阶段，避免被 klinecharts / 画图逻辑的 `stopPropagation` 吃掉。

## 顶部第 2 行（2026-11-02）

把原来的「保存 / 布局 / 指标库 / 主题」四个图标从第 1 行下移成独立一行 `#topbar2`；`01~04` 的四个胶囊按钮仍在第 1 行。

| 判据 | 实测 |
|---|---|
| 第 2 行按钮 | `["btnSave","btnLayout","btnIndicator","btnTheme"]` |
| 第 1 行剩余按钮 | `["btnSession","btnArchive","btnTrade","btnData"]` |
| 指标库按钮 | 点击后 `#indicatorPanel` 打开 |
| 布局按钮 | 点击后 `#layoutMenu` 打开 |
| 保存按钮 | 状态栏 `配置已保存 · 23:58:58` |
| 主题按钮 | 点击弹出主题菜单 |
| 结构 | `#top`(60px) → `#topbar2`(38px) → `#tabBar`(34px) → `#main` |

回归抽测 1/2/3/4/6/9/11/12/16/23/31/32/33 全绿。

## 布局菜单示意图化（2026-11-03）

| 判据 | 实测 |
|---|---|
| 分屏格子数 | `#splitRows .lay-cell` = 12（对应 LAYOUTS 的 12 种） |
| 分组行 | 分别 1 / 2 / 6 / 3 个（按 cells 分组，标签在左） |
| 无文字残留 | `#layoutMenu .lay-cell` 的 `textContent` 全为空 |
| 切换生效 | 点「上下」→ `wsLayout=2h`、状态栏 `分屏：上下` |
| 副图 | `#paneRows .lay-cell` = 4 个；点第 3 个后只有它是 `on` |
| 菜单宽度 | 300px，自动换行 |

附带：`tools/check_js.sh`（`node --input-type=module --check` + 顶层重名检查），当前 64 个模块全 OK。

## 布局浮层关不掉（2026-11-03，根因：函数未定义）

`closeLayoutMenu()` 在 `wireLayoutMenu()` 的点击切换、Esc、外部点击三处都被调用，但**从来没有定义过** —— 每次关闭都抛 `ReferenceError`，菜单只能一直挂着。这就是“打开后无法关闭”的真正原因。

| 修复 | 内容 |
|---|---|
| 补定义 | `closeLayoutMenu()` 设 `hidden=true` 并清掉按钮 `.on` / `aria-expanded` |
| 加显式入口 | 浮层标题右侧加 `✕`（`#closeLayout`），`#moreTools` 同样加了 `#closeMoreTools` |
| 选完自动收 | 点任一布局后调 `closeLayoutMenu()` |

实测（`?selftest=33` 扩到布局浮层，15.2 s 通过）：

```
layoutMenu: opened=true, byX=true, byOutside=true, byToggle=true, byEsc=true
```

防线：新增 `tools/check_refs.mjs`（找“调用过但没定义”的裸调用），当前 `REFS OK`；`tools/check_js.sh` 仍是 `ALL OK (64 files)`。

## 版本看门狗 + 一键重启（2026-11-03）

| 判据 | 实测 |
|---|---|
| 页面构建号 | `20261103e` |
| 磁盘换版本后触发 `focus` | `#buildBar` 显示：`发现新版本，当前窗口还在跑旧代码 / 立即刷新 / 稍后` |
| 点击「立即刷新」 | `location.replace(pathname + '?v=新版本')` |
| 切回窗口 | 已发现新版本 → 静默刷新；否则重新检查 |
| `restart.bat` | 只杀本 app 的 `.chrome-profile` 进程，清 4 个缓存目录，保留 IndexedDB |

原因：`start.bat` 打开的是 `/app/index.html`（与自检同源），服务端已经返回新文件且 `Cache-Control: no-store`，所以「看不到新功能」只可能是窗口里的页面从未重新加载过。

## 数字格式按资产（2026-11-03，参照 financial-ui-suite）

| 标的 | 小数位 | 实测输出 |
|---|---|---|
| XAUUSD 3874.5912 | 2 | `3,874.59` |
| EURUSD 1.08342 | 3 | `1.083` |
| USDJPY 148.521 | 3 | `148.521` |
| USATECHIDXUSD | 1 | 1 位 |
| BTCUSDT 43251.5 | 2 | `43,251.50` |
| SHIBUSDT 0.0000123456 | 8 | `0.00001235` |
| 数量 0.00123456 BTC | ≤8 | `0.00123456` |

`chart.getSymbol().pricePrecision` = 2（XAUUSD），交易面板成交价显示 `4,089.25`。
回归抽测 1/2/4/9/14/15/23/26/30/31/32/33 全绿；`check_js` 与 `check_refs` 均 OK。

## P1 三项（2026-11-03，`?selftest=34` 3.3 s 通过）

| 判据 | 实测 |
|---|---|
| 类型刻度 | `--fs-2xs=9px / --fs-md=12px / --fs-xl=15px / --fs-2xl=21px` |
| 数字字体 | `#status` 与 `.stats .s b`：`Avenir Next … sans-serif` + `tabular-nums` |
| 涨跌箭头 | `.pos::before = "▲ "`、`.neg::before = "▼ "` |
| 主题菜单 | 5 行，含「色盲友好」 |
| 色盲主题 | `data-theme=cb`、`mode=dark`、`--up=#4fa3ff`、`--down=#ffa14a`、`ui:theme=cb` |
| 切回 | 还原为 `dark` |

回归 `?selftest=1..34`（33 项，5 未使用）**全绿**；`check_js` 65 个模块 OK。

## 全局字号 +1px（2026-11-03）

| 项 | 之前 | 现在 |
|---|---|---|
| 类型刻度 | 9 / 10 / 11 / 12 / 13 / 15 / 21 | **10 / 11 / 12 / 13 / 14 / 16 / 22** |
| 正文 | 12px | 13px（`body` 跟随 `--fs-md`） |
| 图表 canvas 文字 | 轴标签/十字光标 10px、overlay 11px | **11px** / **12px** |

检查：1484px 宽（等于 `start.bat` 的窗口）下 `#top` 无横向溢出（`scrollWidth == clientWidth`）；`#status`、`#replayBar`、`#topbar2`、`#tabBar` 均无纵向裁切；左侧工具栏 `overflow:auto` 仅 4px 滚动余量、20 个按钮全部可见。
回归 `?selftest=1..34` 全绿（`selftest34` 改为断言刻度单调递增 + 正文 = `--fs-md` + 下限 13/22，不再写死 px 值）。

## Pine 支持核查 + syminfo.mintick 修复（2026-11-03）

23 类脚本逐项跑过（表见 `docs/PINE-SUPPORT.md`），全部编译通过；本轮修掉：

| 问题 | 根因 | 修复 |
|---|---|---|
| `syminfo.mintick` = nan（`tickerid`/`pricescale`/`timezone` 同样为空） | PineTS 只在 source 是 **provider 对象**时调 `getSymbolInfo()`，传裸数组就拿不到 | `pine.js` 包一层 provider（`getMarketData` + `getSymbolInfo`），按品种精度给 mintick/pricescale/tickerid/timezone/session |

实测：`mintick=0.01`、`tickerid=XAUUSD`、`pricescale=100`、`timezone=UTC`、`security("240")=4089.248`、`lower_tf.size=1`、绘图 1线/1标签/1框、表格 1表2格、UDT/method/switch/map/matrix 均可用。

`?selftest=35`（新增，554 ms 通过）固化 9 组关键项；Pine 相关 3/26/27/29/30 全部复跑通过。

性能：轻脚本 10 ms；1.8 万次迭代 1,084 ms（同步阻塞）；更重 >5 s —— **未接 Worker 是当前唯一会卡住界面的问题**。

## A1 Worker / A2 十字光标同步 / A3 策略回测（2026-11-03，`?selftest=36` 5.6 s 通过）

| 项 | 判据 | 实测 |
|---|---|---|
| A1 Worker | `viaWorker`、重脚本期间主线程心跳 | `viaWorker=true`；1.9 s 的重脚本期间主线程 122 次心跳（≈62 fps）；轻脚本 20 ms |
| A1 兜底 | Worker 不可用 | 15 s 超时 / `onerror` → 自动回主线程，`setPineWorker(false)` 可强制 |
| A2 同步 | 两格竖线 | `cells=2`，两格 `.cx-line` 均为 `block`，`left=771px / 1247px` |
| A2 开关 | 关闭后隐藏 + 持久化 | `offHidden=true`，`ui:cxsync=false` |
| A3 回测 | 统计与明细 | 24 笔、净盈亏 -12.98、胜率 33.3%、PF 0.83、回撤 38.66 (0.4%)、权益曲线 25 点、明细 24 行 |
| A3 面板 | 渲染 | `.strat-stats` 8 格、`#stratCurve` 有绘制、`#stratTrades` 24 行 + 表头 |

回归 `?selftest=1..36`（35 项，5 未使用）**全绿**；`check_js` 71 个模块 OK。

## B1–B3 / C1–C3 / D1–D3（2026-11-04，`?selftest=37` 6.6 s 通过）

| 项 | 判据 | 实测 |
|---|---|---|
| B1 焦点/无障碍 | `:focus-visible` 规则、图标按钮全部有名 | `focusRule=true`、`aria-label` 71 处、未命名图标按钮 0 |
| B2 空状态 | 交易 / 绘图管理空态 | `tradeEmpty=true`、`drawEmpty=true` |
| B3 时间戳 | 状态栏 + 游标显式 UTC | `数据截至 2026-06-27 05:58 UTC`、游标带 UTC |
| C1 多品种同屏 | 换某一格品种 | 格 1 `DEMO → XAUUSD`，标签 `XAUUSD · 5M`，随 TAB 持久化 |
| C2 成交量 | 无成交量标注 | `hasVolume=false`、`#volTag` 显示「无成交量」 |
| C3 ZIP64 | 手写 ZIP64 包（EOCD64 + 0x0001） | 2 条目、size 6272/6272、CSV 正常解压 |
| D1 报告 | 8 格统计 + 明细 + 打印 | `cells=8`、`rows=3`（=成交数）、`printCalled=1` |
| D2 提醒 | alert 收集 + 面板 | 1 条、badge=1、列表 1 行 |
| D3 绘图管理 | 面板 + 批量按钮 | 空态渲染正确、全选/删除不空转 |

顺带修掉的真问题：**启动时总是打开“最后一个导入”的品种**（导入一个测试文件后会跳到它）→ 现在持久化 `ui:profile`，优先上次使用的品种。
回归 `?selftest=1..37`（36 项）**全绿**；`check_js` 72 个模块 OK。

## Tab 改名入口补齐（2026-11-04，`?selftest=32` 5.1 s）

原来只有双击。现在四个入口都可用：双击名字 / 点已激活 tab 的名字 / 右键菜单「重命名」/ 键盘 F2（Enter 同效，Delete 关闭该图）。

| 判据 | 实测 |
|---|---|
| 点名字进入改名 | `byClickName=true` |
| F2 进入改名 | `byF2=true` |
| 右键菜单 | `["重命名F2","关闭这个图表","新建图表"]` |
| 图表右键未被影响 | `chartMenu=true`（tab 条的右键被单独放行） |

注：全局 `contextmenu` 是 capture + `stopPropagation`，会把 tab 的处理器一起吃掉的 —— 加了 `inTabs()` 判断放行 `#tabList / #tabMenu`。
回归 `?selftest=1..37`（36 项）全绿。

## 内置指标：ZLEMA 零延迟均线（2026-11-04，`?selftest=38` 3.9 s）

`ZLEMA = EMA(2×close − close[lag], N)`，`lag = floor((N−1)/2)`，SMA 种子；前 `lag` 根退化成收盘价。

| 判据 | 实测 |
|---|---|
| 注册进内核 | `getSupportedIndicators()` 含 `ZLEMA` = **true** |
| 指标库条目 | `通用` 分类、`overlay=true`、名「零延迟均线 ZLEMA」、星级 4.5 |
| 挂到主图 | `paneId = candle_pane`，`calcParams=[20]`，`result.length = 1200 = 数据根数` |
| 数值正确性 | 与独立参考实现逐点对比 **1,181 点，最大差 0**（< 1e-6） |
| 退化口径 | `period=1` → `lag=0, k=1` ⇒ 与收盘价最大差 **0** |
| 多线 | `[9,20,50]` 三条线末值 `4089.69 / 4085.03 / 4078.11`，全部有限 |
| 指标库面板 | 「通用」下 28 条，找到该行、按钮显示「已添加」 |
| 移除 | `removeIndicator({name})` 后不在 `getIndicators()` |

顺带修的真问题：**图例把未使用的参数线显示成 `n/a`**（ZLEMA 只设 1 个周期时出现 `ZLEMA2: n/a / ZLEMA3: n/a`）。`renderLegend()` 改成「同一指标里只要有线有值，就把恒为 null 的线过滤掉」，并按原始 figure 序号取颜色（否则过滤后线色串位）。BOLL/MACD 这类一条参数多条线的指标不受影响（它们三线都有值）。

回归 `?selftest=1..38`（37 项）全绿；其中 31（截屏）在 reload 后首帧偶发「图表还没画出来」，`Page.bringToFront` + 重跑即通过，属已知 flake。
