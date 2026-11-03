#!/usr/bin/env node
// 引用体检：找出"调用了但没定义"的函数名（例如 closeLayoutMenu 这种漏定义的关闭函数）
// 用法：node tools/check_refs.mjs
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('app/src');
const files = fs.readdirSync(dir).filter(f => f === 'main.js');
const src = Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
const all = Object.values(src).join('\n');

const defined = new Set([
  ...[...all.matchAll(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm)].map(m => m[1]),
  ...[...all.matchAll(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=/gm)].map(m => m[1]),
  ...[...all.matchAll(/^\s*(?:export\s+)?class\s+([A-Za-z0-9_$]+)/gm)].map(m => m[1]),
  // 动态 import 解构：const { a, b } = await import('./x.js')
  ...[...all.matchAll(/const\s*\{([^}]*)\}\s*=\s*await\s+import\(/g)]
    .flatMap(m => m[1].split(',').map(x => x.trim().split(':').pop().trim())).filter(Boolean)
]);
const imported = new Set();
for (const t of Object.values(src)) {
  for (const m of t.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const p of m[1].split(',')) {
      const n = p.trim().split(/\s+as\s+/).pop().trim();
      if (n) imported.add(n);
    }
  }
  for (const m of t.matchAll(/import\s+([A-Za-z0-9_$]+)\s+from/g)) imported.add(m[1]);
}

const builtins = new Set(`if for while switch catch function return typeof new delete void await async of in instanceof
Math JSON Object Array String Number Boolean Date Promise Set Map RegExp Error Intl parseFloat parseInt isNaN
setTimeout setInterval clearTimeout clearInterval requestAnimationFrame cancelAnimationFrame fetch alert
document window console localStorage sessionStorage performance navigator structuredClone queueMicrotask
Blob File FileReader URL Image Path2D CustomEvent MouseEvent KeyboardEvent Event ClipboardItem createImageBitmap
Uint8Array Int32Array Float32Array DataView ArrayBuffer TextDecoder TextEncoder CompressionStream
DecompressionStream crypto confirm prompt print` .split(/\s+/).filter(Boolean));

let fail = 0;
for (const [f, t] of Object.entries(src)) {
  const calls = new Set([...t.matchAll(/(?<![.\w$'"])([a-z][A-Za-z0-9_$]*)\s*\(/g)].map(m => m[1]));
  const missing = [...calls].filter(c => !defined.has(c) && !imported.has(c) && !builtins.has(c));
  // 降噪：只报“从没被当作属性/方法调用过、且至少出现 2 次”的裸调用 —— 真正漏定义的工具函数都长这样
  const real = missing.filter(c => {
    const bareCount = (t.match(new RegExp(`(?<![.\\w$'"])${c}\\s*\\(`, 'g')) || []).length;
    const asProp = new RegExp(`[.\\w$]${c}\\s*\\(|${c}\\s*:`, 'g').test(all);
    const ignore = new Set(['import', 'rgba', 'fn', 'constructor', 'plot']);
    return bareCount >= 2 && !asProp && !ignore.has(c);
  });
  if (real.length) {
    console.log(`WARN ${f}: ${real.join(' ')}`);
    fail = 1;
  }
}
if (!fail) console.log(`REFS OK (${files.length} files)`);
process.exit(fail);
