// 回放引擎：游标 = 1m 时间戳；推进靠 dataLoader.subscribeBar 推单根（非 1m 周期按桶聚合后推）
import { periodSpanMs } from './aggregate.js';

export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];
const BASE_MS = 500;                       // 1x = 500 ms/根

export class Replay {
  constructor(app, { onTick, onState } = {}) {
    this.app = app;
    this.source = app.source;
    this.cursor = app.profile.last;
    this.playing = false;
    this.speed = 1;
    this.timer = null;
    this.bucket = null;
    this.onTick = onTick || (() => {});
    this.onState = onState || (() => {});
  }

  get spanMs() { return periodSpanMs(this.app.periodKey); }
  msPerBar() { return Math.max(16, BASE_MS / this.speed); }

  state() {
    return {
      cursor: this.cursor, playing: this.playing, speed: this.speed,
      period: this.app.periodKey, total: this.app.profile.last,
      buckets: this.bucket ? this.bucket.timestamp : null
    };
  }
  emit() { this.onState(this.state()); }

  /** 设定回放起点并重载窗口（窗口右端 = 起点） */
  async setStart(ts) {
    this.pause();
    this.cursor = ts;
    this.bucket = null;
    await this.app.seek(ts);
    this.bucket = null;
    this.emit();
  }

  /** 前进 n 根 1m；返回实际推进根数（批量取数，避免每根一次异步往返） */
  async step(n = 1) {
    const bars = await this.source.nextBars(this.cursor, n);
    let advanced = 0;
    for (const bar of bars) {
      this.cursor = bar.timestamp;
      this.push(bar);
      advanced++;
    }
    if (advanced) this.emit();
    return advanced;
  }

  /** 回退 n 根（重建窗口，游标落在目标根） */
  async back(n = 1) {
    this.pause();
    let ts = this.cursor;
    for (let i = 0; i < n; i++) {
      const p = await this.source.prevBar(ts);
      if (!p) break;
      ts = p.timestamp;
    }
    await this.setStart(ts);
  }

  async jump(ts) { await this.setStart(ts); }

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
    this.emit();
  }

  toggle() { this.playing ? this.pause() : this.play(); }
  setSpeed(x) { this.speed = x; this.emit(); }

  /** 推一根到图表；跨度 >1m 时按当前周期聚合后再推（同桶覆盖，跨桶追加） */
  push(bar) {
    const span = this.spanMs;
    if (span === 60_000) {
      this.bucket = bar;
      this.app.pushBar(bar);
      this.onTick(bar, bar);
      return;
    }
    const bucketTs = Math.floor(bar.timestamp / span) * span;
    if (!this.bucket || this.bucket.timestamp !== bucketTs) {
      const last = this.app.lastBar();
      // 续接窗口里已有的同桶数据，避免把该桶前几分钟丢掉
      this.bucket = (last && last.timestamp === bucketTs)
        ? { ...last }
        : { timestamp: bucketTs, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume };
      if (this.bucket.timestamp === bucketTs) {
        this.bucket.high = Math.max(this.bucket.high, bar.high);
        this.bucket.low = Math.min(this.bucket.low, bar.low);
        this.bucket.close = bar.close;
        this.bucket.volume += bar.volume;
      }
    } else {
      this.bucket.high = Math.max(this.bucket.high, bar.high);
      this.bucket.low = Math.min(this.bucket.low, bar.low);
      this.bucket.close = bar.close;
      this.bucket.volume += bar.volume;
    }
    this.app.pushBar({ ...this.bucket });
    this.onTick(bar, this.bucket);
  }
}
