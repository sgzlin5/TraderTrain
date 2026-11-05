"""给拆出去的模块补漏掉的 ctx 依赖（模块体里用了、但既没本地定义也没注入的符号）。

用法: python tools/fix_deps.py [--apply]
"""
import re
import sys
from pathlib import Path

ROOT = Path(r"D:\Crypto\code\TraderTrain")
MAIN = ROOT / "app/src/main.js"
UI = ROOT / "app/src/ui"

decl = re.compile(r"^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=", re.M)
IDENT = re.compile(r"[A-Za-z_$][\w$]*")
KEYWORDS = set("""if else for while return const let var function async await new try catch finally throw switch case break continue default
typeof instanceof in of delete void this true false null undefined class extends super yield do export import from as
arguments length push slice map filter forEach join split replace includes indexOf find some every reduce concat sort
Object Array String Number Math JSON Date Promise Error Uint8Array Float32Array Int32Array BigInt64Array DataView Map Set WeakMap
console window document localStorage indexedDB setTimeout setInterval clearTimeout clearInterval requestAnimationFrame
performance crypto btoa atob Blob File FileReader URL TextDecoder TextEncoder AbortController EventSource
requestIdleCallback queueMicrotask structuredClone isNaN parseInt parseFloat encodeURIComponent decodeURIComponent
toFixed toString valueOf String""".split())

main_src = MAIN.read_text(encoding="utf-8")
# 多行 import 折成一行，方便解析
flat = re.sub(r"^import\s+([^;]*?)\s+from\s+", lambda m: "import " + m.group(1).replace("\n", " ") + " from ", main_src, flags=re.M)

# main.js 里可用的顶层符号（声明 + import）
avail = set()
for m in re.finditer(r"^(?:export\s+)?(?:async\s+)?function (\w+)|^(?:export\s+)?(?:const|let|var) (\w+)\s*=", main_src, re.M):
    avail.add(m.group(1) or m.group(2))
for m in re.finditer(r"^import\s+(.+?)\s+from", flat, re.M):
    spec = m.group(1)
    ns = re.search(r"\*\s+as\s+(\w+)", spec)
    if ns:
        avail.add(ns.group(1))
    for br in re.findall(r"\{([^}]*)\}", spec):
        for part in br.split(","):
            alias = part.split(" as ")[-1].strip()
            if re.fullmatch(r"[A-Za-z_$][\w$]*", alias or ""):
                avail.add(alias)
    d = re.match(r"^(\w+)\s*(,|$)", spec)
    if d and not spec.startswith("{"):
        avail.add(d.group(1))
avail.add("$")

# 模块 → 装配变量
calls = {}
for m in re.finditer(r"^const (\w+) = install_\1\((.*)\);$", main_src, re.M):
    calls[m.group(1)] = m.group(2)

apply = "--apply" in sys.argv
fixed_any = False

# 模块导出的符号 -> 提供它的装配变量
providers = {}
for f in UI.glob("*.js"):
    src0 = f.read_text(encoding="utf-8")
    r0 = re.search(r"return \{([^}]*)\};", src0)
    if not r0:
        continue
    v0 = mid[r0.group(0)] if False else None
for f in UI.glob("*.js"):
    pass

# 模块路径 -> 装配变量（从 main.js 的 import 里读）
file_var = {}
for m in re.finditer(r"import \{ install as install_(\w+) \} from '\./ui/([\w.]+)';", main_src):
    file_var[m.group(2)] = m.group(1)

# 先建立 符号 -> 模块变量 的映射
providers = {}
for f in UI.glob("*.js"):
    src0 = f.read_text(encoding="utf-8")
    var0 = file_var.get(f.name)
    r0 = re.search(r"return \{([^}]*)\};", src0)
    if var0 and r0:
        for name in r0.group(1).split(","):
            name = name.strip()
            if re.fullmatch(r"[A-Za-z_$][\w$]*", name or ""):
                providers[name] = var0

for f in UI.glob("*.js"):
    src = f.read_text(encoding="utf-8")
    var = file_var.get(f.name)
    if var not in calls:
        continue
    ctxm = re.search(r"const \{([^}]*)\} = ctx;", src)
    injected = {x.strip() for x in (ctxm.group(1).split(",") if ctxm else []) if x.strip()}

    body = src
    local = set(injected)
    for m in decl.finditer(body):
        local.add(m.group(1) or m.group(2))
    # 参数（箭头/函数形参）
    for m in re.finditer(r"\(([^)]*)\)\s*=>|\bfunction\s*[\w$]*\s*\(([^)]*)\)", body):
        for a in (m.group(1) or m.group(2) or "").split(","):
            a = a.strip().split("=")[0].strip()
            if re.fullmatch(r"[A-Za-z_$][\w$]*", a or ""):
                local.add(a)

    used = set(IDENT.findall(body))
    missing = sorted(n for n in used - local - KEYWORDS
                     if (n in avail or n in providers) and n != var)
    from_mod = [n for n in missing if n in providers and n not in avail]

    if missing:
        print(f"{var}: 缺 {missing}")
        if apply:
            arg = calls[var].strip()
            inner = arg[1:-1] if arg.startswith("{") else arg
            parts = [x.strip() for x in inner.split(",") if x.strip()]
            for n in missing:
                if n in from_mod:
                    parts.append(f"{n}: {providers[n]}.{n}")
                elif n not in parts:
                    parts.append(n)
            newcall = f"const {var} = install_{var}({{ {', '.join(parts)} }});"
            main_src = main_src.replace(f"const {var} = install_{var}({arg});", newcall)
            # 模块 ctx 也要能解构到
            if ctxm:
                newctx = ", ".join(sorted(set(list(injected) + missing)))
                src = src.replace(ctxm.group(1), " " + newctx + " ", 1)
                f.write_text(src, encoding="utf-8", newline="")
            calls[var] = "{ " + ", ".join(parts) + " }"
            fixed_any = True

if apply and fixed_any:
    MAIN.write_text(main_src, encoding="utf-8", newline="")
    print("已写回 main.js 与模块文件")
