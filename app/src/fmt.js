// 时间/数字格式化（无依赖，供 main.js 与其它 UI 模块共用）
export const fmtTs = (ts) => ts ? new Date(ts).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '-';
export const fmtTsShort = (ts) => ts ? new Date(ts).toISOString().slice(5, 16).replace('T', ' ') : '-';
export const fmtDay = (ts) => ts ? new Date(ts).toISOString().slice(0, 10) : '-';
export const fmtLocalInput = (ts) => ts ? new Date(ts).toISOString().slice(0, 16) : '';

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const num = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '-');
