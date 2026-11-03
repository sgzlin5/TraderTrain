// Pine 执行 Worker：PineTS 在主线程外跑，重脚本不再卡住界面
// 协议：{ id, src, bars, inputs, symbol } → { id, ok, names, overlay, series, title, plots, strategy }
import { PineTS } from '../vendor/pinets.min.browser.es.js';
import { runInThread } from './pineCore.js';

self.onmessage = async (e) => {
  const { id, src, bars, inputs, symbol } = e.data || {};
  const t0 = performance.now();
  try {
    const out = await runInThread(PineTS, src, bars, inputs, symbol);
    const payload = {
      id, ok: true,
      names: out.names, overlay: out.overlay, series: out.series, title: out.title,
      plots: out.plots,
      strategy: out.strategy || null,
      pineVersion: out.pineVersion ?? null,
      alerts: out.alerts || [],
      ms: Math.round(performance.now() - t0)
    };
    try { self.postMessage(payload); }
    catch {
      // 绘图对象里混进了不可克隆的东西：降级成纯 JSON
      try { self.postMessage(JSON.parse(JSON.stringify(payload))); }
      catch (err) { self.postMessage({ id, ok: false, error: 'Worker 回传失败：' + (err?.message || err) }); }
    }
  } catch (err) {
    const msg = String(err && err.message || err);
    const m = msg.match(/line[^\d]*(\d+)/i) || msg.match(/at\s+(\d+):(\d+)/);
    self.postMessage({ id, ok: false, error: msg.slice(0, 400), line: m ? Number(m[1]) : null });
  }
};
