// 可下载标的清单（前端内置，搜索不依赖后端）
// source：dukascopy（外汇/金属/指数 CFD，UTC，交易日制） / binance（加密，真实成交量，7×24）
// point：价格 = 原始整数 / point（Binance 的 CSV 已是小数，不用 point）
export const INSTRUMENTS = [
  // ---- 金属 / 外汇 / 指数：Dukascopy ----
  { code: 'XAUUSD', alias: 'gold 黄金 伦敦金', name: '黄金/美元', category: '金属', point: 1000, source: 'dukascopy' },
  { code: 'XAGUSD', alias: 'silver 白银', name: '白银/美元', category: '金属', point: 1000, source: 'dukascopy' },
  { code: 'XAUEUR', name: '黄金/欧元', category: '金属', point: 1000, source: 'dukascopy' },
  { code: 'XAGEUR', name: '白银/欧元', category: '金属', point: 1000, source: 'dukascopy' },
  { code: 'EURUSD', alias: '欧美 欧元', name: '欧元/美元', category: '外汇', point: 100000, source: 'dukascopy' },
  { code: 'GBPUSD', alias: '镑美 英镑', name: '英镑/美元', category: '外汇', point: 100000, source: 'dukascopy' },
  { code: 'USDJPY', alias: '美日 日元', name: '美元/日元', category: '外汇', point: 1000, source: 'dukascopy' },
  { code: 'USDCHF', name: '美元/瑞郎', category: '外汇', point: 100000, source: 'dukascopy' },
  { code: 'USDCAD', name: '美元/加元', category: '外汇', point: 100000, source: 'dukascopy' },
  { code: 'AUDUSD', name: '澳元/美元', category: '外汇', point: 100000, source: 'dukascopy' },
  { code: 'NZDUSD', name: '纽元/美元', category: '外汇', point: 100000, source: 'dukascopy' },
  { code: 'EURJPY', name: '欧元/日元', category: '外汇', point: 1000, source: 'dukascopy' },
  { code: 'GBPJPY', name: '英镑/日元', category: '外汇', point: 1000, source: 'dukascopy' },
  { code: 'AUDJPY', name: '澳元/日元', category: '外汇', point: 1000, source: 'dukascopy' },
  { code: 'CADJPY', name: '加元/日元', category: '外汇', point: 1000, source: 'dukascopy' },
  { code: 'CHFJPY', name: '瑞郎/日元', category: '外汇', point: 1000, source: 'dukascopy' },
  { code: 'EURGBP', name: '欧元/英镑', category: '外汇', point: 100000, source: 'dukascopy' },
  { code: 'EURAUD', name: '欧元/澳元', category: '外汇', point: 100000, source: 'dukascopy' },
  { code: 'EURCHF', name: '欧元/瑞郎', category: '外汇', point: 100000, source: 'dukascopy' },
  { code: 'GBPCHF', name: '英镑/瑞郎', category: '外汇', point: 100000, source: 'dukascopy' },
  { code: 'GBPAUD', name: '英镑/澳元', category: '外汇', point: 100000, source: 'dukascopy' },
  { code: 'AUDNZD', name: '澳元/纽元', category: '外汇', point: 100000, source: 'dukascopy' },
  { code: 'USDRUB', name: '美元/卢布', category: '外汇', point: 1000, source: 'dukascopy' },
  { code: 'DEUIDXEUR', alias: '德指 dax ger40', name: '德国 DAX', category: '指数', point: 1000, source: 'dukascopy' },
  { code: 'USA500IDXUSD', alias: '标普 标普500 spx sp500 us500', name: '标普 500', category: '指数', point: 1000, source: 'dukascopy' },
  { code: 'USA30IDXUSD', alias: '道指 道琼斯 dow us30', name: '道琼斯 30', category: '指数', point: 1000, source: 'dukascopy' },
  { code: 'USATECHIDXUSD', alias: '纳指 纳斯达克100 ndx nasdaq nas100 ustec', name: '纳斯达克 100', category: '指数', point: 1000, source: 'dukascopy' },
  { code: 'JPNIDXJPY', alias: '日经 日经225 jp225', name: '日经 225', category: '指数', point: 1000, source: 'dukascopy' },
  { code: 'GBRIDXGBP', alias: '富时 英国 uk100 ftse', name: '英国 FTSE 100', category: '指数', point: 1000, source: 'dukascopy' },

  // ---- 加密：Binance 官方归档 ----
  { code: 'BTCUSDT', alias: '大饼 比特币 btc', name: '比特币/USDT', category: '加密', point: 1, source: 'binance' },
  { code: 'ETHUSDT', alias: '以太 eth', name: '以太坊/USDT', category: '加密', point: 1, source: 'binance' },
  { code: 'SOLUSDT', alias: 'solana', name: 'SOL/USDT', category: '加密', point: 1, source: 'binance' },
  { code: 'BNBUSDT', alias: '币安币', name: 'BNB/USDT', category: '加密', point: 1, source: 'binance' },
  { code: 'XRPUSDT', alias: '瑞波', name: 'XRP/USDT', category: '加密', point: 1, source: 'binance' },
  { code: 'DOGEUSDT', alias: '狗狗币', name: 'DOGE/USDT', category: '加密', point: 1, source: 'binance' },
  { code: 'ADAUSDT', name: 'ADA/USDT', category: '加密', point: 1, source: 'binance' },
  { code: 'AVAXUSDT', name: 'AVAX/USDT', category: '加密', point: 1, source: 'binance' },
  { code: 'LINKUSDT', name: 'LINK/USDT', category: '加密', point: 1, source: 'binance' },
  { code: 'LTCUSDT', name: 'LTC/USDT', category: '加密', point: 1, source: 'binance' },
  { code: 'DOTUSDT', name: 'DOT/USDT', category: '加密', point: 1, source: 'binance' },
  { code: 'TRXUSDT', name: 'TRX/USDT', category: '加密', point: 1, source: 'binance' },
  { code: 'TONUSDT', name: 'TON/USDT', category: '加密', point: 1, source: 'binance' },
  { code: 'SUIUSDT', name: 'SUI/USDT', category: '加密', point: 1, source: 'binance' },
  { code: 'APTUSDT', name: 'APT/USDT', category: '加密', point: 1, source: 'binance' },
  { code: 'ARBUSDT', name: 'ARB/USDT', category: '加密', point: 1, source: 'binance' },
  { code: 'OPUSDT', name: 'OP/USDT', category: '加密', point: 1, source: 'binance' },
  { code: 'NEARUSDT', name: 'NEAR/USDT', category: '加密', point: 1, source: 'binance' },
  { code: 'INJUSDT', name: 'INJ/USDT', category: '加密', point: 1, source: 'binance' }
];

export const SOURCE_LABEL = { dukascopy: 'Dukascopy', binance: 'Binance' };

/** 代码 / 中文名 / 类别 / 数据源 模糊匹配 */
export function searchInstruments(term) {
  const q = String(term || '').trim();
  if (!q) return INSTRUMENTS.slice(0, 12);
  const lower = q.toLowerCase();
  const hit = INSTRUMENTS.filter(s =>
    s.code.toLowerCase().includes(lower) ||
    s.name.includes(q) ||
    s.category.includes(q) ||
    (s.alias || '').toLowerCase().includes(lower) ||
    s.source.includes(lower)
  );
  // 前缀命中的排前面（输入 BTC 时 BTCUSDT 优先于 WBTC… 这种）
  hit.sort((a, b) => {
    const ai = a.code.toLowerCase().startsWith(lower) ? 0 : 1;
    const bi = b.code.toLowerCase().startsWith(lower) ? 0 : 1;
    return ai - bi;
  });
  return hit.slice(0, 12);
}


/* ---------- 数字格式（参照 financial-ui-suite · number-formatting） ----------
   股票/金属 2 位；外汇 3 位（本数据源 point=1000 就是 3 位精度）；加密按量级：
   ≥1000 → 2，≥1 → 2~4，≥0.01 → 4，≥0.0001 → 6，更小 → 8，兜底指数。 */
export function decimalsFor(code, price) {
  const inst = INSTRUMENTS.find(i => i.code === code);
  const p = Number(price);
  // 名单里没有的币对（自导入的 SHIBUSDT 之类）也按加密口径走
  const crypto = (inst && inst.source === 'binance') || /(USDT|USDC|BUSD|FDUSD)$/i.test(String(code || ''));
  if (crypto) {
    if (!isFinite(p) || p <= 0) return 2;
    if (p >= 1000) return 2;
    if (p >= 1) return 2;
    if (p >= 0.01) return 4;
    if (p >= 0.0001) return 6;
    if (p >= 0.00000001) return 8;
    return 8;
  }
  if (!inst) return 2;
  const c = String(code || '').toUpperCase();
  if (/JPY/.test(c)) return 3;
  if (/^(XAU|XAG|XPT|XPD)/.test(c)) return 2;
  if (inst.category === '指数' || inst.category === '股票') return 1;
  return 3;
}

/** 价格：千分位 + 该标的的小数位 */
export function fmtPrice(v, code) {
  const p = Number(v);
  if (!isFinite(p)) return '—';
  const dp = decimalsFor(code, p);
  return p.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** 数量：股票整数、加密最多 6 位（去掉多余 0） */
export function fmtQty(v, code) {
  const n = Number(v);
  if (!isFinite(n)) return '—';
  const inst = INSTRUMENTS.find(i => i.code === code);
  const crypto = (inst && inst.source === 'binance') || /(USDT|USDC|BUSD|FDUSD)$/i.test(String(code || ''));
  return n.toLocaleString('en-US', { maximumFractionDigits: crypto ? 8 : 2 });
}
