// 本项目的 klinecharts 是 UMD 全局（window.klinecharts），扩展包用裸模块名 'klinecharts' 引 utils，
// 这里做一层本地 shim，避免再加 import map / ESM 构建。
const K = window.klinecharts;
export const utils = K.utils;
export const registerOverlay = K.registerOverlay;
export default { utils, registerOverlay };
