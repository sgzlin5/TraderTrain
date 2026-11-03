// 模拟撮合：市价 / 限价挂单 / TP-SL；每根 1m bar 先撮合挂单，再判 SL→TP（同根都触及时保守取 SL）
export class TradeSim {
  constructor({ onChange } = {}) {
    this.qty = 10;              // 单位：盎司（XAUUSD 用 oz，1 oz 价格变动 1 美元 = 10 美元盈亏）
    this.pos = null;            // {side, entry, qty, sl, tp, openTs}
    this.orders = [];           // {id, side, price, qty, ts, done}
    this.trades = [];           // 已平仓
    this.realized = 0;
    this.onChange = onChange || (() => {});
    this._seq = 0;
  }

  setQty(q) { this.qty = Math.max(0.01, Number(q) || 1); this.emit(); }

  emit() { this.onChange(this.snapshot()); }

  snapshot() {
    return {
      qty: this.qty, pos: this.pos, orders: this.orders, trades: this.trades,
      realized: +this.realized.toFixed(2),
      floating: this.pos && this._lastPrice != null ? +this._pnl(this._lastPrice).toFixed(2) : null
    };
  }

  _pnl(price, pos = this.pos) {
    if (!pos) return 0;
    return (pos.side === 'long' ? price - pos.entry : pos.entry - price) * pos.qty;
  }

  openMarket(side, price, bar, { sl, tp } = {}) {
    if (this.pos) return { ok: false, reason: '已有持仓' };
    this.pos = { side, entry: price, qty: this.qty, sl: sl ?? null, tp: tp ?? null, openTs: bar?.timestamp ?? null };
    this._lastPrice = price;
    this.emit();
    return { ok: true, pos: this.pos };
  }

  placeLimit(side, price, bar) {
    const o = { id: ++this._seq, side, price, qty: this.qty, ts: bar?.timestamp ?? null, done: false };
    this.orders.push(o);
    this.emit();
    return o;
  }

  cancelOrders() { this.orders = this.orders.filter(o => o.done); this.emit(); }

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
    // 1) 限价撮合
    for (const o of this.orders) {
      if (o.done) continue;
      const hit = o.side === 'long' ? bar.low <= o.price : bar.high >= o.price;
      if (hit) {
        o.done = true;
        if (!this.pos) {
          this.pos = { side: o.side, entry: o.price, qty: o.qty, sl: null, tp: null, openTs: bar.timestamp };
        }
      }
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

  /** 状态签名：pos/挂单数/成交数 不变时不触发 UI 重建 */
  _sig() {
    const p = this.pos;
    return `${p ? `${p.side}@${p.entry}/${p.sl}/${p.tp}` : '-'}|${this.trades.length}|${this.orders.filter(o => !o.done).length}`;
  }
}
