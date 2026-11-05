// 多图分屏工作区：N 个图表实例（同品种不同周期），共享回放游标
// [vela P1] 图表层换 Vela：VelaChartApp / ReplayV 原生回放；Draw/Pine 走占位层（P3/P4 接回）
import { VelaChartApp, ReplayV, DrawStub, PineStub } from './vela.js';

/** 分屏布局表：cells = 格子数，css = 容器 grid 模板，areas = 每格 grid-area */
export const LAYOUTS = [
  { key: '1', label: '单图', cells: 1, cols: '1fr', rows: '1fr', areas: ['1 / 1 / 2 / 2'] },
  { key: '2h', label: '上下', cells: 2, cols: '1fr', rows: '1fr 1fr', areas: ['1 / 1 / 2 / 2', '2 / 1 / 3 / 2'] },
  { key: '2v', label: '左右', cells: 2, cols: '1fr 1fr', rows: '1fr', areas: ['1 / 1 / 2 / 2', '1 / 2 / 2 / 3'] },
  { key: '3h', label: '三行', cells: 3, cols: '1fr', rows: '1fr 1fr 1fr', areas: ['1 / 1 / 2 / 2', '2 / 1 / 3 / 2', '3 / 1 / 4 / 2'] },
  { key: '3v', label: '三列', cells: 3, cols: '1fr 1fr 1fr', rows: '1fr', areas: ['1 / 1 / 2 / 2', '1 / 2 / 2 / 3', '1 / 3 / 2 / 4'] },
  { key: '3lv', label: '左一 右二', cells: 3, cols: '1.15fr 1fr', rows: '1fr 1fr', areas: ['1 / 1 / 3 / 2', '1 / 2 / 2 / 3', '2 / 2 / 3 / 3'] },
  { key: '3rv', label: '左二 右一', cells: 3, cols: '1fr 1.15fr', rows: '1fr 1fr', areas: ['1 / 1 / 2 / 2', '2 / 1 / 3 / 2', '1 / 2 / 3 / 3'] },
  { key: '3th', label: '上一下二', cells: 3, cols: '1fr 1fr', rows: '1.15fr 1fr', areas: ['1 / 1 / 2 / 3', '2 / 1 / 3 / 2', '2 / 2 / 3 / 3'] },
  { key: '3bh', label: '上二下一', cells: 3, cols: '1fr 1fr', rows: '1fr 1.15fr', areas: ['1 / 1 / 2 / 2', '1 / 2 / 2 / 3', '2 / 1 / 3 / 3'] },
  { key: '4g', label: '四格', cells: 4, cols: '1fr 1fr', rows: '1fr 1fr', areas: ['1 / 1 / 2 / 2', '1 / 2 / 2 / 3', '2 / 1 / 3 / 2', '2 / 2 / 3 / 3'] },
  { key: '4t', label: '上一下三', cells: 4, cols: '1fr 1fr 1fr', rows: '1.15fr 1fr', areas: ['1 / 1 / 2 / 4', '2 / 1 / 3 / 2', '2 / 2 / 3 / 3', '2 / 3 / 3 / 4'] },
  { key: '4b', label: '上三下一', cells: 4, cols: '1fr 1fr 1fr', rows: '1fr 1.15fr', areas: ['1 / 1 / 2 / 2', '1 / 2 / 2 / 3', '1 / 3 / 2 / 4', '2 / 1 / 3 / 4'] }
];

export function layoutByKey(key) {
  return LAYOUTS.find(l => l.key === key) || LAYOUTS[0];
}

const DEFAULT_PERIODS = ['1m', '5m', '15m', '1h'];

/** 多图工作区 */
export class Workspace {
  constructor(rootEl, profile, opts = {}) {
    this.root = rootEl;
    this.profile = profile;
    this.cells = [];              // [{ i, el, app, draw, pine, replay }]
    this.activeIndex = 0;
    this.layoutKey = '1';
    this.opts = opts;             // { getStyles, onChange, onTick, onState, periods }
  }

  get active() { return this.cells[this.activeIndex] || this.cells[0] || null; }
  get app() { return this.active?.app || null; }
  get draw() { return this.active?.draw || null; }
  get pine() { return this.active?.pine || null; }
  get chart() { return this.active?.app?.chart || null; }

  _mkEl(i) {
    const el = document.createElement('div');
    el.className = 'cell';
    el.dataset.cell = String(i);
    el.innerHTML = '<div class="cell-tag"></div>';
    el.addEventListener('mousedown', () => this.setActive(i), true);
    this.root.appendChild(el);
    return el;
  }

  _gridSignature(layout) {
    return `${layout.cols}|${layout.rows}`;
  }

  applyGrid(layout) {
    this.root.classList.toggle('split', layout.cells > 1);
    this.root.style.gridTemplateColumns = layout.cols;
    this.root.style.gridTemplateRows = layout.rows;
    this.cells.forEach((c, i) => {
      const area = layout.areas[i] || layout.areas[layout.areas.length - 1];
      c.el.style.gridArea = area;
      c.el.style.display = i < layout.cells ? '' : 'none';
    });
  }

  /** 建一格：挂图表 + 绘图层 + Pine 管理器 */
  async _createCell(i, period, profile = null) {
    const prof = profile || this.profile;
    const el = this._mkEl(i);
    const app = new VelaChartApp(el, prof);
    await app.mount();
    if (period) await app.switchPeriod(period);
    await app.waitLoaded();
    const draw = new DrawStub(app.chart, {
      symbol: prof.symbol,
      periodKey: app.periodKey,
      onChange: () => this.opts.onChange?.()
    });
    const pine = new PineStub(app.chart);
    const replay = new ReplayV(app, {
      onTick: (bar) => { if (i === 0) this.opts.onTick?.(bar); },
      onState: () => { if (i === 0) this.opts.onState?.(this.multi.state()); }
    });
    app.replayRef = replay;   // lastBar() 回放中取渲染态 forming 桶用
    try { await draw.load(); } catch {}
    const cell = { i, el, app, draw, pine, replay, profile: prof };
    const tag = cell.el.querySelector('.cell-tag');
    tag.textContent = `${prof.symbol} · ${app.periodKey.toUpperCase()}`;
    tag.title = '点击切换该格品种';
    tag.style.cursor = 'pointer';
    tag.onclick = (e) => { e.stopPropagation(); this.opts.onPickSymbol?.(i); };
    return cell;
  }

  /** 按布局同步格子数量（保留已有格子） */
  async applyLayout(key, { periods, profiles } = {}) {
    const layout = layoutByKey(key);
    this.layoutKey = layout.key;

    // 补格子
    for (let i = this.cells.length; i < layout.cells; i++) {
      const period = (periods && periods[i]) || DEFAULT_PERIODS[i] || '1m';
      const prof = (profiles && profiles[i]) || this.cells[i]?.profile || this.profile;
      const cell = await this._createCell(i, period, prof);
      this.cells.push(cell);
    }
    // 多出来的格子先留着（切回时复用），只隐藏并暂停
    this.applyGrid(layout);
    this.multi = new MultiReplay(this.cells.map(c => c.replay));
    if (this.activeIndex >= layout.cells) this.activeIndex = 0;
    this.setActive(this.activeIndex);
    return layout;
  }

  /** 切换主/激活格：绘图、交易、指标都跟着走 */
  setActive(i) {
    this.activeIndex = Math.max(0, Math.min(i, this.cells.length - 1));
    this.cells.forEach((c, k) => c.el.classList.toggle('active', k === this.activeIndex));
    this.opts.onActive?.(this.active, this.activeIndex);
    return this.active;
  }

  /** 只重建某一格（换品种） */
  async setCellSymbol(i, profile) {
    const cell = this.cells[i];
    if (!cell || !profile) return false;
    if (cell.profile?.id === profile.id) return true;
    const period = cell.app.periodKey;
    const layout = this.layoutKey;
    try { cell.app.dispose(); } catch {}
    cell.el.remove();
    const fresh = await this._createCell(i, period, profile);
    this.cells[i] = fresh;
    this.applyGrid(layoutByKey(layout));
    this.multi = new MultiReplay(this.cells.map(c => c.replay));
    // 新格的数据区间可能不覆盖当前游标：落到它自己的最后一根，避免“空图”
    const cur = this.multi.cursor;
    if (cur && profile.last && cur > profile.last) {
      try { await fresh.app.seek(profile.last); } catch {}
    }
    this.setActive(this.activeIndex);
    this.opts.onCellsChanged?.();
    return true;
  }

  setPeriodAll(key) { this.cells.forEach(c => { c.app.periodKey = key; }); }

  /** 主题：所有格子一起换 */
  setStyles(styles) {
    this.cells.forEach(c => { try { c.app.chart.setStyles(styles); } catch {} });
  }

  resizeAll() { this.cells.forEach(c => { try { c.app.chart.resize(); } catch {} }); }

  dispose() {
    this.cells.forEach(c => { try { c.app.dispose(); } catch {} c.el.remove(); });
    this.cells = [];
  }
}

/** 共享游标的回放控制：所有格子同步（每格按自己的周期聚合） */
export class MultiReplay {
  constructor(replays) {
    this.list = replays.filter(Boolean);
    this.playing = false;
    this.speed = 1;
    this.timer = null;
    this._emit = null;
  }

  get primary() { return this.list[0]; }
  get source() { return this.primary?.source || null; }
  get spanMs() { return this.primary?.spanMs || 60000; }
  get cursor() { return this.primary?.cursor || null; }
  set cursor(v) { this.list.forEach(r => { r.cursor = v; }); }
  get bucket() { return this.primary?.bucket || null; }
  set bucket(v) { this.list.forEach(r => { r.bucket = v; }); }

  state() {
    const s = this.primary?.state() || {};
    return { ...s, cells: this.list.length, playing: this.playing, speed: this.speed };
  }

  emit() { this._emit?.(this.state()); }
  setEmitter(fn) { this._emit = fn; }

  async setStart(ts) {
    this.pause();
    // [vela P1] 交给每格的 ReplayV：回放中 = 原生 seek；未在回放 = 重灌窗口
    await Promise.all(this.list.map(r => r.setStart(ts).catch(() => {})));
    this.emit();
  }

  async step(n = 1) {
    let advanced = 0;
    for (const r of this.list) {
      const a = await r.step(n);
      advanced = Math.max(advanced, a);
    }
    // 共享时钟：主格（cells[0]）的 1m 游标就是全工作区的时钟（旧模型各格 cursor 同值）。
    // 各格原生回放的内部游标（桶级/tick 级）允许有半步差，但对 UI/撮合暴露的 cursor 必须一致。
    const c = this.primary?.cursor;
    if (advanced && c != null) this.list.forEach(r => { r.cursor = c; });
    if (advanced) this.emit();
    return advanced;
  }

  async back(n = 1) {
    this.pause();
    const p = this.primary;
    if (!p) return;
    let ts = p.cursor;
    for (let i = 0; i < n; i++) {
      const prev = await p.source.prevBar(ts);
      if (!prev) break;
      ts = prev.timestamp;
    }
    await this.setStart(ts);
  }

  msPerBar() { return Math.max(16, 260 / Math.max(0.25, this.speed)); }

  play() {
    if (this.playing) return;
    this.playing = true;
    this.emit();
    const tick = async () => {
      if (!this.playing) return;
      const n = await this.step(1);
      if (!this.playing) return;
      if (!n) { this.pause(); return; }
      this.timer = setTimeout(tick, this.msPerBar());
    };
    this.timer = setTimeout(tick, 0);
  }

  pause() {
    this.playing = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.list.forEach(r => r.pause());
    this.emit();
  }

  toggle() { this.playing ? this.pause() : this.play(); }
  setSpeed(x) { this.speed = x; this.emit(); }
}
