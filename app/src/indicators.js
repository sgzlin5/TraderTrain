import { kvGet, kvSet } from './db.js';
import { CUSTOM_META } from './customIndicators.js';
export { CUSTOM_META };

// 指标库：klinecharts 内置指标 + 本地 Pine 自编
// 只做“有没有上图”的开关与面板数量控制，指标本身的算法全交给内核 / PineTS
export const OVERLAY_INDS = new Set(['MA', 'EMA', 'SMA', 'BOLL', 'SAR', 'BBI',
  ...Object.keys(CUSTOM_META)]);                 // 自建指标都是主图叠加

export const LABELS = {
  MA: '均线 MA', EMA: '指数均线 EMA', SMA: '简单均线 SMA', BOLL: '布林带 BOLL',
  SAR: '抛物线 SAR', BBI: '多空指数 BBI',
  MACD: 'MACD', RSI: '相对强弱 RSI', KDJ: '随机指标 KDJ', CCI: '顺势 CCI',
  WR: '威廉指标 WR', BIAS: '乖离率 BIAS', DMI: '趋向指标 DMI', CR: '能量指标 CR',
  PSY: '心理线 PSY', ROC: '变动率 ROC', MTM: '动量 MTM', TRIX: '三重指数 TRIX',
  OBV: '能量潮 OBV', VR: '量比 VR', DMA: '平均差 DMA',
  AVP: '均价 AVP', AO: '动量 AO', EMV: '简易波动 EMV', PVT: '价量 PVT', VOL: '成交量 VOL'
};

/** 一句话说明（指标库里展示） */
const DESCS = {
  MA: '多条简单移动平均，判断趋势方向与排列',
  EMA: '指数加权均线，比 MA 更贴近最近价格',
  SMA: '简单移动平均',
  BOLL: '均线 ±N 倍标准差，看波动区间与挤压缩放',
  SAR: '抛物线转向，跟踪止损/趋势翻转',
  BBI: '多空指数：多条均线再平均，过滤假突破',
  MACD: '快慢 EMA 差与信号线，动量与背离',
  RSI: '相对强弱，超买超卖与背离',
  KDJ: '随机指标，短线超买超卖',
  CCI: '顺势指标，判断异常波动',
  WR: '威廉指标，超买超卖',
  BIAS: '乖离率：价格偏离均线的百分比',
  DMI: '趋向指标：+DI/-DI/ADX，衡量趋势强度',
  CR: '能量指标，量价配合',
  PSY: '心理线：上涨天数占比',
  ROC: '变动率：N 根涨跌幅',
  MTM: '动量：当前价与 N 根前的差',
  TRIX: '三重指数平滑，过滤噪音',
  OBV: '能量潮：按涨跌累计成交量',
  VR: '量比：涨跌成交量比值',
  DMA: '平均差：快慢均线之差',
  AVP: '均价线',
  AO: '动量震荡：中值均线差',
  EMV: '简易波动：量价综合的波动强度',
  PVT: '价量趋势：按涨跌幅累计成交量',
  VOL: '成交量柱'
};

/** 指标库分类（顺序即面板里的顺序） */
export const IND_CATS = [
  { key: 'fav', label: '我的收藏' },
  { key: 'combos', label: '组合模板' },
  { key: 'flow', label: '订单流' },
  { key: 'key', label: '关键位' },
  { key: 'smc', label: 'SMC' },
  { key: 'ma', label: '均线' },
  { key: 'general', label: '通用' },
  { key: 'pine', label: 'Pine / 自编' }
];

/** 推荐度（编辑口径：常用/好上手，不是回测胜率），用于列表左侧星级 */
const RATE = {
  EMA: 4.5, MA: 4, BOLL: 4.5, MACD: 4.5, RSI: 4.5, KDJ: 4, VOL: 4, ATR: 4,
  SAR: 3.5, BBI: 3.5, DMI: 3.5, OBV: 3.5, WR: 3.5, CCI: 3.5, BIAS: 3,
  TRIX: 3, ROC: 3, MTM: 3, DMA: 3, CR: 3, PSY: 3, VR: 3, AO: 3, EMV: 3, PVT: 3,
  AVP: 3, SMA: 3.5,
  PDHL: 4.5, ORB: 4.5, AVWAP: 4, ZLEMA: 4.5, EMA: 4.5, RMA: 4,
  SMC_FVG: 4.5, SMC_MST: 4.5, SMC_ICT: 4, SMC_HTF: 4, SMC_DASH: 4.5,
  FLOW_VOL: 3.5, FLOW_VP: 4.5, FLOW_WALL: 4.5, FLOW_DEPTH: 4.5,
  PINE: 4
};

export function rateOf(name) {
  return RATE[name] ?? 3.5;
}

/** ★★★★☆ 形式 */
export function starsHtml(rate) {
  const full = Math.round(rate);
  return '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full);
}

/** 全部可用指标（内置 + 自建），带分类与说明 */
export function builtinList() {
  // 自建指标也注册进了 klinecharts，这里排掉，避免同一个指标出现两次
  const all = (window.klinecharts?.getSupportedIndicators?.() || []).filter(n => !CUSTOM_META[n]);
  const list = all.map(name => ({
    name,
    label: LABELS[name] || name,
    overlay: OVERLAY_INDS.has(name),
    cat: 'general',
    desc: DESCS[name] || (OVERLAY_INDS.has(name) ? '主图叠加指标' : '副图指标'),
    rate: RATE[name] ?? 3.5
  }));
  for (const [name, m] of Object.entries(CUSTOM_META)) {
    const catMap = { SMC: 'smc', '订单流': 'flow', '关键位': 'key', '均线': 'ma', '通用': 'general' };
    list.push({ name, label: m.label, overlay: m.overlay !== false, cat: catMap[m.cat] || 'key',
      desc: m.desc, custom: true, rate: RATE[name] ?? 4 });
  }
  return list;
}

/* ---------------- 我的收藏 ---------------- */

const FAV_KEY = 'ind:fav';

export async function loadFavs() { try { return (await kvGet(FAV_KEY)) || []; } catch { return []; } }
export async function saveFavs(list) { try { await kvSet(FAV_KEY, [...new Set(list)]); } catch {} }

/* ---------------- 组合模板（当前上图的一套指标存下来） ---------------- */

const COMBO_KEY = 'ind:combos';

export async function loadCombos() { try { return (await kvGet(COMBO_KEY)) || []; } catch { return []; } }
export async function saveCombos(list) { try { await kvSet(COMBO_KEY, list || []); } catch {} }

/** 把当前图上的指标存成一个组合 */
export async function saveComboFromChart(chart, name, prefs) {
  const items = (chart.getIndicators?.() || []).map(i => i.name);
  if (!items.length) throw new Error('当前图上一个指标都没有');
  const combos = await loadCombos();
  const combo = {
    id: `C${Date.now().toString(36)}`,
    name: (name || '').trim().slice(0, 20) || `组合 ${combos.length + 1}`,
    items,
    prefs: Object.fromEntries(items.map(n => [n, prefs?.[n] || null])),
    createdAt: new Date().toISOString()
  };
  const next = [combo, ...combos.filter(c => c.name !== combo.name)].slice(0, 30);
  await saveCombos(next);
  return combo;
}

/** 应用一个组合：清掉现有一切指标，再按保存的顺序建回来 */
export function applyCombo(chart, combo) {
  if (!chart || !combo) return 0;
  for (const ind of chart.getIndicators() || []) {
    try { chart.removeIndicator({ name: ind.name }); } catch {}
  }
  let n = 0;
  for (const name of combo.items) {
    const prefs = combo.prefs?.[name] || null;
    toggleBuiltin(chart, name, OVERLAY_INDS.has(name), prefs);
    n++;
  }
  return n;
}

export async function removeCombo(id) {
  const next = (await loadCombos()).filter(c => c.id !== id);
  await saveCombos(next);
  return next;
}

export function activeNames(chart) {
  return (chart?.getIndicators() || []).map(i => i.name);
}

/* ---------------- 指标参数 / 颜色偏好 ---------------- */

const PREF_KEY = 'ind:prefs';

export async function loadIndPrefs() {
  try { return (await kvGet(PREF_KEY)) || {}; } catch { return {}; }
}

export async function saveIndPrefs(prefs) {
  try { await kvSet(PREF_KEY, prefs || {}); } catch {}
}

/** 把偏好（calcParams / lines）套到一个已在图的指标上 */
export function applyIndPrefs(chart, name, prefs) {
  if (!chart || !prefs) return false;
  const cur = (chart.getIndicators?.() || []).find(i => i.name === name);
  if (!cur) return false;
  const patch = { name, paneId: cur.paneId };
  if (Array.isArray(prefs.calcParams) && prefs.calcParams.length) patch.calcParams = prefs.calcParams;
  if (Array.isArray(prefs.lines) && prefs.lines.length) patch.styles = { lines: prefs.lines };
  try { return chart.overrideIndicator(patch); } catch { return false; }
}

/** 开关一个内置指标（叠加指标挂主图，其余自动新建副图）；带上已保存的参数/颜色 */
export function toggleBuiltin(chart, name, overlay, prefs = null) {
  const has = (chart.getIndicators?.() || []).some(i => i.name === name);
  if (has) { chart.removeIndicator({ name }); return false; }
  const create = { name };
  if (overlay) create.paneId = 'candle_pane';
  if (prefs && Array.isArray(prefs.calcParams) && prefs.calcParams.length) create.calcParams = prefs.calcParams;
  if (prefs && Array.isArray(prefs.lines) && prefs.lines.length) create.styles = { lines: prefs.lines };
  chart.createIndicator(create, true);
  return true;
}

export const PANE_LAYOUTS = [
  { key: 1, label: '单图' },
  { key: 2, label: '双图' },
  { key: 3, label: '三图' },
  { key: 4, label: '四图' }
];

const SUB_FILL = ['MACD', 'RSI', 'KDJ'];
const RATIOS = {
  1: [1],
  2: [0.68, 0.32],
  3: [0.56, 0.22, 0.22],
  4: [0.46, 0.18, 0.18, 0.18]
};

/** 除主图外的面板数（时间轴面板不算） */
export function paneCount(chart) {
  return (chart?.getPaneOptions?.() || []).filter(p => p.id !== 'x_axis_pane').length;
}

function subPanes(chart) {
  return (chart.getPaneOptions?.() || [])
    .filter(p => p.id !== 'x_axis_pane' && p.id !== 'candle_pane')
    .sort((a, b) => a.order - b.order);
}

/** 切换面板布局：补/删副图面板，并按比例分配高度 */
export function applyPaneLayout(chart, target) {
  if (!chart) return 0;
  const want = Math.max(1, Math.min(PANE_LAYOUTS.length, Number(target) || 1));

  // 补：缺的副图用默认指标填上（MACD → RSI → KDJ 循环）
  let guard = 0;
  while (paneCount(chart) < want && guard++ < 8) {
    const name = SUB_FILL[(paneCount(chart) - 1) % SUB_FILL.length];
    chart.createIndicator({ name }, true);
  }
  // 删：从最后一个副图面板开始清空
  guard = 0;
  while (paneCount(chart) > want && guard++ < 8) {
    const subs = subPanes(chart);
    const last = subs[subs.length - 1];
    if (!last) break;
    chart.removeIndicator({ paneId: last.id });
  }

  // 高度：主图比例略大，副图均分
  const total = Math.max(200, chart.getSize().height - 26);
  const ratios = RATIOS[want] || RATIOS[1];
  const panes = (chart.getPaneOptions?.() || [])
    .filter(p => p.id !== 'x_axis_pane')
    .sort((a, b) => a.order - b.order);
  panes.forEach((p, i) => {
    const r = ratios[i] ?? ratios[ratios.length - 1];
    try { chart.setPaneOptions({ id: p.id, height: Math.max(48, Math.round(total * r)) }); } catch {}
  });
  return paneCount(chart);
}
