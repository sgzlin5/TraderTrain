// 工作区配置存档：把当前主题/版面/绘图样式/模板/工具栏/周期落成一份快照
import { kvGet, kvSet } from './db.js';

export const CONFIG_KEY = 'cfg:workspace';

export async function loadConfigSnapshot() {
  try { return (await kvGet(CONFIG_KEY)) || null; } catch { return null; }
}

export async function saveConfigSnapshot(cfg) {
  const snap = { ...cfg, v: 1, savedAt: Date.now() };
  try { await kvSet(CONFIG_KEY, snap); } catch { return null; }
  return snap;
}
