"""一次性把 main.js 的多个分区搬到独立模块（install(ctx) 注入依赖）。

要点：
- 所有分区范围从**原始文件**一次算好，再统一改写，避免后一次抽区被前一次的行号漂移带偏
- 模块之间的依赖用 “VAR.sym” 传，不再靠 main.js 顶层同名符号
- 装配调用统一 hoist 到 boot() 之前，并按依赖拓扑排序（防 TDZ）

用法: python tools/split_main.py
"""
import re
from pathlib import Path

ROOT = Path(r"D:\Crypto\code\TraderTrain")
MAIN = ROOT / "app/src/main.js"

decl = re.compile(r"^(export\s+)?(async\s+)?function\s+([A-Za-z_$][\w$]*)|^(export\s+)?(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=")
IDENT = re.compile(r"[A-Za-z_$][\w$]*")
KEYWORDS = set("""if else for while return const let var function async await new try catch finally throw switch case break continue default
typeof instanceof in of delete void this true false null undefined class extends super yield do export import from as
arguments length push slice map filter forEach join split replace includes indexOf find some every reduce concat sort
Object Array String Number Math JSON Date Promise Error Uint8Array Float32Array Int32Array BigInt64Array DataView Map Set WeakMap
console window document localStorage indexedDB setTimeout setInterval clearTimeout clearInterval requestAnimationFrame
performance crypto btoa atob Blob File FileReader URL TextDecoder TextEncoder AbortController EventSource
requestIdleCallback queueMicrotask structuredClone isNaN parseInt parseFloat encodeURIComponent decodeURIComponent
toFixed toString valueOf""".split())

PLAN = [
    (["官方扩展工具（@klinecharts/extension 0.1.0）"], "app/src/ui/ovExtensions.js", "OV"),
    (["扩展工具弹层"], "app/src/ui/extTools.js", "EXT"),
    (["主题", "主题下拉"], "app/src/ui/themeMenu.js", "THEME"),
    (["数据管理"], "app/src/ui/dataPanel.js", "DATA"),
    (["从 ZIP / CSV 直接导入"], "app/src/ui/csvImport.js", "CSV"),
    # 第二批
    (["复盘档案"], "app/src/ui/archive.js", "ARCH"),
    (["从其他图复制绘制"], "app/src/ui/copyDraw.js", "COPYDRAW"),
    (["绘图样式面板"], "app/src/ui/drawStyle.js", "DSTYLE"),
    (["绘图"], "app/src/ui/draw.js", "DRAW"),
    (["悬浮工具栏：拖动 / 收起"], "app/src/ui/floatingToolbar.js", "FTB"),
    (["回放"], "app/src/ui/replay.js", "RPL"),
    (["场次"], "app/src/ui/session.js", "SESS"),
    (["交易"], "app/src/ui/trade.js", "TRADE"),
]


def sections(lines):
    marks = [i for i, l in enumerate(lines) if re.match(r"^/\* -{4,} .* -{4,} \*/$", l.strip())]
    marks.append(len(lines))
    out = {}
    for k in range(len(marks) - 1):
        title = re.sub(r"^/\*\s*-+\s*|\s*-+\s*\*/$", "", lines[marks[k]].strip())
        out[title] = (marks[k], marks[k + 1])
    return out


def decls_of(lines):
    out = {}
    for i, l in enumerate(lines):
        m = decl.match(l)
        if m:
            out[m.group(3) or m.group(6)] = i
    return out


def import_names(lines):
    """import 进来的绑定当作顶层可用符号（否则搬出去的模块会引用到不存在的名字）"""
    out = set()
    for l in lines:
        m = re.match(r"^import\s+(.+?)\s+from\s+['\"]", l)
        if not m:
            continue
        spec = m.group(1).strip()
        ns = re.match(r"\*\s+as\s+([A-Za-z_$][\w$]*)", spec)
        if ns:
            out.add(ns.group(1))
            continue
        brace = re.search(r"\{([^}]*)\}", spec)
        if brace:
            for part in brace.group(1).split(","):
                part = part.strip()
                if not part:
                    continue
                alias = part.split(" as ")[-1].strip()
                if re.fullmatch(r"[A-Za-z_$][\w$]*", alias):
                    out.add(alias)
        dflt = re.match(r"^([A-Za-z_$][\w$]*)\s*(,|$)", spec)
        if dflt and not spec.startswith("{"):
            out.add(dflt.group(1))
    return out


def local_names(body):
    local = set()
    for l in body:
        m = decl.match(l)
        if m:
            local.add(m.group(3) or m.group(6))
        for mm in re.finditer(r"\(([^)]*)\)\s*=>|\bfunction\s*[\w$]*\s*\(([^)]*)\)", l):
            args = mm.group(1) or mm.group(2) or ""
            for a in args.split(","):
                a = a.strip().split("=")[0].strip()
                if re.fullmatch(r"[A-Za-z_$][\w$]*", a or ""):
                    local.add(a)
    return local


def fix_relative_imports(module_rel, text):
    """模块搬进子目录后，原文件里的 './x.js' 会解析到新目录；改回指向 app/src/ 的 '../x.js'"""
    mod_path = ROOT / module_rel
    depth = len(mod_path.relative_to(ROOT / "app/src").parts) - 1
    up = "../" * depth if depth else "./"

    def repl(m):
        quote, spec = m.group(2), m.group(3)
        if not spec.startswith("./"):
            return m.group(0)
        target = (ROOT / "app/src" / spec[2:]).resolve()
        here = (mod_path.parent / spec[2:]).resolve()
        if not here.exists() and target.exists():
            return m.group(1) + quote + up + spec[2:] + quote
        return m.group(0)

    return re.sub(r"(import\s*\(\s*)(['\"])([^'\"]+)\2", repl, text)


def existing_providers(lines):
    """已有 app/src/ui/*.js 模块导出的符号 → 由哪个装配变量提供"""
    prov = {}
    ui = ROOT / "app/src/ui"
    if not ui.exists():
        return prov
    vars_by_file = {}
    for l in lines:
        m = re.match(r"^const (\w+) = install_\1\(.*\);$", l.strip())
        if m:
            vars_by_file[f"{m.group(1).lower()}"] = m.group(1)
    for f in ui.glob("*.js"):
        src = f.read_text(encoding="utf-8")
        mm = re.search(r"import \{ install as install_(\w+) \}", src)
        var = mm.group(1) if mm else f.stem.upper()
        ret = re.search(r"return \{([^}]*)\};", src)
        if not ret:
            continue
        for name in ret.group(1).split(","):
            name = name.strip()
            if re.fullmatch(r"[A-Za-z_$][\w$]*", name):
                prov[name] = var
    return prov


def load_plan():
    """优先用环境变量 SPLIT_PLAN（JSON: [[[分区名...], 模块路径, 变量名], ...]）"""
    import json
    import os
    raw = os.environ.get("SPLIT_PLAN")
    if raw:
        return [tuple(x) for x in json.loads(raw)]
    return PLAN


def main():
    lines = MAIN.read_text(encoding="utf-8").split("\n")
    secs = sections(lines)
    top = decls_of(lines)
    for name in import_names(lines):
        top.setdefault(name, 0)
    providers = existing_providers(lines)
    for name in providers:
        top.setdefault(name, 0)

    # 1) 每个模块：所属行区间、定义的符号
    mods = []
    owner = {}     # sym -> var
    for names, rel, var in load_plan():
        ranges = sorted(secs[n] for n in names)
        body = []
        for a, b in ranges:
            body += [re.sub(r"^export\s+", "", l) for l in lines[a:b]]
        defined = [m.group(3) or m.group(6) for m in (decl.match(l) for l in body) if m]
        for s in defined:
            owner[s] = var
        mods.append({"names": names, "rel": rel, "var": var, "ranges": ranges,
                     "body": body, "defined": defined})

    moved = {i for m in mods for a, b in m["ranges"] for i in range(a, b)}
    rest_text = "\n".join(l for i, l in enumerate(lines) if i not in moved)

    # 2) 每个模块的依赖：既不是本地声明、也不属于本模块的顶层符号
    for m in mods:
        local = set(m["defined"]) | local_names(m["body"])
        used = {n for n in IDENT.findall("\n".join(m["body"])) if n not in KEYWORDS}
        deps, xdeps = [], []
        for name in sorted(used - local):
            if name in owner and owner[name] != m["var"]:
                if owner[name] not in xdeps:
                    xdeps.append(owner[name])
            elif name in top and not any(a <= top[name] < b for a, b in m["ranges"]):
                deps.append(name)
        m["deps"] = deps
        m["xdeps"] = xdeps

    # 3) 写模块文件（跨模块引用改写为 VAR.sym）
    for m in mods:
        body = list(m["body"])
        # 跨模块符号：把裸引用改成 VAR.sym
        local = set(m["defined"]) | local_names(m["body"])
        fixed = list(body)
        deps = m["deps"] + m["xdeps"]
        # 导出条件：main.js 剩余部分**或其它模块**用到了它（跨模块依赖必须能拿到）
        others = "\n".join("\n".join(o["body"]) for o in mods if o is not m)
        used_outside = rest_text + "\n" + others
        exports = [s for s in dict.fromkeys(m["defined"]) if re.search(rf"(?<![\w$.]){re.escape(s)}\b", used_outside)]
        head = [f"// 从 main.js 的「{' + '.join(m['names'])}」段落抽出；依赖由 install(ctx) 注入",
                "export function install(ctx) {"]
        if deps:
            head.append(f"  const {{ {', '.join(sorted(set(deps)))} }} = ctx;")
        head.append("")
        tail = [""]
        if exports:
            tail.append(f"  return {{ {', '.join(exports)} }};")
        tail += ["}", ""]
        path = ROOT / m["rel"]
        path.parent.mkdir(parents=True, exist_ok=True)
        src = fix_relative_imports(m["rel"], "\n".join(head + fixed + tail))
        path.write_text(src, encoding="utf-8", newline="")
        m["exports"] = exports
        m["all_deps"] = sorted(set(deps))
        print(f"OK {m['var']}: {sum(b-a for a,b in m['ranges'])} 行 -> {m['rel']} | 依赖{len(m['all_deps'])} | 导出{len(exports)}")

    # 4) 重建 main.js：区间内替换成装配调用（每个模块一次），并改写导出符号引用
    starts = {min(a for a, b in m["ranges"]): m for m in mods}
    out = []
    for i, l in enumerate(lines):
        if i in starts:
            m = starts[i]
            parts = []
            for d in m["all_deps"]:
                if d in providers and providers[d] != m["var"]:
                    parts.append(f"{d}: {providers[d]}.{d}")
                else:
                    parts.append(d)
            ctx = ", ".join(parts)
            out.append(f"const {m['var']} = install_{m['var']}({{ {ctx} }});" if ctx else f"const {m['var']} = install_{m['var']}({{}});")
            continue
        if i in moved:
            continue
        if re.match(r"^const \w+ = install_\w+\(", l.strip()):
            out.append(l)
            continue
        for m in mods:
            for sym in m["exports"]:
                l = re.sub(rf"(?<![\w$.]){re.escape(sym)}\b", f"{m['var']}.{sym}", l)
        out.append(l)
    text = "\n".join(out)

    # 5) import 语句
    imps = [f"import {{ install as install_{m['var']} }} from './{m['rel'][len('app/src/'):]}';" for m in mods]
    ms = list(re.finditer(r"^import .*;$", text, re.M))
    pos = ms[-1].end() if ms else 0
    text = text[:pos] + "\n" + "\n".join(imps) + text[pos:]

    # 6) hoist 装配调用到 boot() 之前，按依赖拓扑排序
    lines = text.split("\n")
    calls, keep = {}, []
    for l in lines:
        mm = re.match(r"^const (\w+) = install_\1\(.*\);$", l.strip())
        if mm:
            calls[mm.group(1)] = l.strip()
        else:
            keep.append(l)
    order, done = [], set()

    def visit(v, stack=()):
        if v in done or v in stack:
            return
        for other, call in calls.items():
            if other != v and re.search(rf"\b{other}\b", call):
                visit(other, stack + (v,))
        done.add(v)
        order.append(v)

    for v in calls:
        visit(v)
    block = ["", "/* --- 拆分出去的模块装配（顺序按依赖） --- */"] + [calls[v] for v in order if v in calls]
    final, inserted = [], False
    for l in keep:
        if not inserted and l.startswith("boot().catch(showBootError);"):
            final += block
            inserted = True
        final.append(l)
    if not inserted:
        final += block
    MAIN.write_text("\n".join(final), encoding="utf-8", newline="")
    print("装配顺序:", " -> ".join(order))


main()
