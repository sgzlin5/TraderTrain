// 本项目的 klinecharts 是 UMD 全局（window.klinecharts），扩展包用裸模块名 'klinecharts' 引 utils，
// 这里做一层本地 shim，避免再加 import map / ESM 构建。
// [vela P1] 本分支图表内核是 Vela：window.klinecharts 不存在时给空壳（overlay 模板在 P3 接回 Vela），
// 保证 main.js 对本包的 import 不炸；registerExtensionOverlays() 已有 window.klinecharts 守卫。
const K = window.klinecharts || {};
export const utils = K.utils || {};
export const registerOverlay = K.registerOverlay || (() => {});
export default { utils, registerOverlay };
