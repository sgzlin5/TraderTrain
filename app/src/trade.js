// 模拟撮合：市价 / 限价挂单 / TP-SL；每根 1m bar 先撮合挂单，再判 SL→TP（同根都触及时保守取 SL）
// 仓位规模支持「%权益 / 盎司 / 美元」三种口径（对齐 TradingView 模拟账户的下单口径）。
export class TradeSim {
  constructor({ onChange } = {}) {
    this.equity = 100000;       // 账户权益（USD）
    this.qtyMode = 'pct';       // 'pct' 按权益百分比 / 'oz' 盎司 / 'usd' 名义金额
    this.qty = 10;              // 单位：盎司（XAUUSD 用 oz，1 oz 价格变动 1 美元 = 1 美元盈亏）
    this.pct = 5;               // qtyMode='pct' 时的权益百分比
    this.pos = null;            // {side, entry, qty, sl, tp, openTs}
    this.orders = [];           // {id, side, price, qty, sl, tp, ts, done}
    this.trades = [];           // 已平仓
    this.realized = 0;
    this.onChange = onChange || (() => {});
    this._seq = 0;
  }

  // 抽屉里手填数量 = 明确指定盎司数，口径随之切到 oz（面板的 %权益 走 setQtyMode）
  setQty(q) { this.qty = Math.max(0.01, Number(q) || 1); this.qtyMode = 'oz'; this.emit(); }
  setEquity(v) { this.equity = Math.max(1, Number(v) || 1); this.emit(); }
  setQtyMode(mode, value) {
    if (!['pct', 'oz', 'usd'].includes(mode)) return;
    this.qtyMode = mode;
    if (value != null) {
      const v = Math.max(0.01, Number(value) || 1);
      if (mode === 'pct') this.pct = Math.min(100, v); else this.qty = v;
    }
    this.emit();
  }

  /** 按当前口径换算下单数量（oz）；price 为成交/挂单参考价 */
  sizeFor(price) {
    const p = Number(price);
    if (!(p > 0)) return 0;
    if (this.qtyMode === 'pct') return Math.max(0.01, Math.round((this.equity * (this.pct / 100) / p) * 100) / 100);
    if (this.qtyMode === 'usd') return Math.max(0.01, Math.round((this.qty / p) * 100) / 100);
    return Math.max(0.01, this.qty);
  }

  /** 当前权益（含浮动） */
  get balance() {
    const fl = this.pos && this._lastPrice != null ? this._pnl(this._lastPrice) : 0;
    return +(this.equity + this.realized + fl).toFixed(2);
  }

  emit() { this.onChange(this.snapshot()); }

  snapshot() {
    const floating = this.pos && this._lastPrice != null ? +this._pnl(this._lastPrice).toFixed(2) : null;
    return {
      equity: this.equity, qtyMode: this.qtyMode, pct: this.pct,
      qty: this.qty, pos: this.pos, orders: this.orders, trades: this.trades,
      realized: +this.realized.toFixed(2),
      floating,
      balance: this.balance,
      margin: this.pos ? +(this.pos.entry * this.pos.qty).toFixed(2) : 0
    };
  }

  _pnl(price, pos = this.pos) {
    if (!pos) return 0;
    return (pos.side === 'long' ? price - pos.entry : pos.entry - price) * pos.qty;
  }

  openMarket(side, price, bar, { sl, tp } = {}) {
    if (this.pos) return { ok: false, reason: '已有持仓' };
    const qty = this.sizeFor(price);
    if (!(qty > 0)) return { ok: false, reason: '数量无效' };
    this.pos = { side, entry: price, qty, sl: sl ?? null, tp: tp ?? null, openTs: bar?.timestamp ?? null };
    this._lastPrice = price;
    this.emit();
    return { ok: true, pos: this.pos };
  }

  placeLimit(side, price, bar, { sl, tp, qty } = {}) {
    const q = qty != null ? Math.max(0.01, Number(qty) || 0) : this.sizeFor(price);
    if (!(q > 0)) return { ok: false, reason: '数量无效' };
    const o = {
      id: ++this._seq, side, price, qty: q, sl: sl ?? null, tp: tp ?? null,
      ts: bar?.timestamp ?? null, done: false
    };
    this.orders.push(o);
    this.emit();
    return o;
  }

  cancelOrder(id) { this.orders = this.orders.filter(o => o.id !== id); this.emit(); }
  cancelOrders() { this.orders = this.orders.filter(o => o.done); this.emit(); }

  /** 给「最近一笔未成交挂单，否则当前持仓」设/清 SL（price=null 清除） */
  setStop(price) {
    const o = this._stopTarget();
    if (!o) return { ok: false, reason: '没有持仓或挂单' };
    o.sl = price == null ? null : Number(price);
    this.emit();
    return { ok: true, target: o };
  }

  setTarget(price) {
    const o = this._stopTarget();
    if (!o) return { ok: false, reason: '没有持仓或挂单' };
    o.tp = price == null ? null : Number(price);
    this.emit();
    return { ok: true, target: o };
  }

  _stopTarget() {
    if (this.pos) return this.pos;
    const pend = this.orders.filter(o => !o.done);
    return pend.length ? pend[pend.length - 1] : null;
  }

  /** 当前 SL/TP 生效对象（图上画线用）：持仓优先，其次最近挂单 */
  activeTrade() {
    if (this.pos) return { kind: 'position', side: this.pos.side, entry: this.pos.entry, qty: this.pos.qty, sl: this.pos.sl, tp: this.pos.tp, ref: this.pos };
    const pend = this.orders.filter(o => !o.done);
    if (pend.length) {
      const o = pend[pend.length - 1];
      return { kind: 'order', id: o.id, side: o.side, entry: o.price, qty: o.qty, sl: o.sl, tp: o.tp, ref: o };
    }
    return null;
  }

  closePos(price, bar, why = 'manual') {
    if (!this.pos) return null;
    const p = this.pos;
    const pnl = this._pnl(price, p);
    this.realized += pnl;
    const rec = {
      side: p.side, entry: p.entry, exit: price, qty: p.qty, pnl: +pnl.toFixed(2),
      openTs: p.openTs, closeTs: bar?.timestamp ?? null, why
    };
    this.trades.push(rec);
    this.pos = null;
    this._lastPrice = price;
    this.emit();
    return rec;
  }

  /** 每根 bar 调用 */
  onBar(bar) {
    this._lastPrice = bar.close;
    const sigBefore = this._sig();
    // 1) 限价撮合（成交时带上挂单里的 SL/TP）
    for (const o of this.orders) {
      if (o.done) continue;
      const hit = o.side === 'long' ? bar.low <= o.price : bar.high >= o.price;
      if (!hit) continue;
      if (this.pos) continue;            // 已有持仓：挂单继续挂着（标 done 会让这笔单凭空消失）
      // 跳空：开盘已越过限价时按更优的开盘价成交（否则成交价好于真实市场）
      const open = bar.open ?? o.price;
      const fill = o.side === 'long' ? Math.min(o.price, open) : Math.max(o.price, open);
      o.done = true;
      this.pos = { side: o.side, entry: fill, qty: o.qty, sl: o.sl ?? null, tp: o.tp ?? null, openTs: bar.timestamp };
    }
    // 2) SL / TP（先 SL，保守）
    if (this.pos) {
      const p = this.pos;
      if (p.side === 'long') {
        if (p.sl != null && bar.low <= p.sl) return this.closePos(p.sl, bar, 'SL');
        if (p.tp != null && bar.high >= p.tp) return this.closePos(p.tp, bar, 'TP');
      } else {
        if (p.sl != null && bar.high >= p.sl) return this.closePos(p.sl, bar, 'SL');
        if (p.tp != null && bar.low <= p.tp) return this.closePos(p.tp, bar, 'TP');
      }
    }
    // 只有状态真的变了才通知 UI（回放每根都 emit 会把图表 overlay 重建成瓶颈）
    if (this._sig() !== sigBefore) this.emit();
    return null;
  }

  /** 状态签名：pos/挂单数/成交数/SL-TP 不变时不触发 UI 重建 */
  _sig() {
    const p = this.pos;
    const pend = this.orders.filter(o => !o.done).length;
    return `${p ? `${p.side}@${p.entry}/${p.sl}/${p.tp}` : '-'}|${this.trades.length}|${pend}`;
  }
}
