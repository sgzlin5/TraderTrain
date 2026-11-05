"""修正 main.js 末尾的模块装配块：按真实依赖拓扑排序，并校验每个 ctx 键的来源。

用法: python tools/fix_order.py
"""
import re
from pathlib import Path

ROOT = Path(r"D:\Crypto\code\TraderTrain")
MAIN = ROOT / "app/src/main.js"
UI = ROOT / "app/src/ui"

text = MAIN.read_text(encoding="utf-8")
lines = text.split("\n")


def module_exports():
    """模块文件 -> 它 return 出去的符号 -> 装配变量名"""
    prov = {}
    for f in UI.glob("*.js"):
        src = f.read_text(encoding="utf-8")
        m = re.search(r"import \{ install as install_(\w+) \}", src)
        var = m.group(1) if m else f.stem.upper()
        r = re.search(r"return \{([^}]*)\};", src)
        if not r:
            continue
        for name in r.group(1).split(","):
            name = name.strip()
            if re.fullmatch(r"[A-Za-z_$][\w$]*", name or ""):
                prov[name] = var
    return prov


prov = module_exports()

# 找装配块
start = next((i for i, l in enumerate(lines) if "拆分出去的模块装配" in l), None)
if start is None:
    raise SystemExit("没找到装配块")
end = next(i for i in range(start, len(lines)) if lines[i].startswith("boot().catch"))
block = [l for l in lines[start:end] if l.strip()]

calls = {}
for l in block:
    m = re.match(r"^const (\w+) = install_\1\((.*)\);$", l.strip())
    if m:
        inner = m.group(2).strip()
        if inner.startswith("{") and inner.endswith("}"):
            inner = inner[1:-1]
        calls[m.group(1)] = inner

# 每个模块的依赖变量
dep_vars = {}
for var, arg in calls.items():
    deps = set()
    inner = arg.strip()
    for item in [x.strip() for x in inner.split(",") if x.strip()]:
        if ":" in item:
            key, val = [x.strip() for x in item.split(":", 1)]
            vm = re.match(r"^(\w+)\.(\w+)$", val)
            if vm:
                deps.add(vm.group(1))
            else:
                print(f"  ! {var}: {key} => {val} 不是 VAR.sym 形式")
        else:
            if item in prov and prov[item] != var:
                deps.add(prov[item])
            elif item in calls and item != var:
                deps.add(item)
    dep_vars[var] = deps

# 拓扑排序
order, state = [], {}


def visit(v, stack=()):
    if state.get(v) == 2:
        return
    if state.get(v) == 1:
        print("  循环依赖:", " -> ".join(stack + (v,)))
        return
    state[v] = 1
    for d in sorted(dep_vars.get(v, ())):
        if d in calls:
            visit(d, stack + (v,))
    state[v] = 2
    order.append(v)


for v in calls:
    visit(v)

out = [l for l in lines[:start] if not l.startswith("/* --- 拆分出去的模块装配")]
out += ["", "/* --- 拆分出去的模块装配（按依赖排序） --- */"]
for v in order:
    out.append(f"const {v} = install_{v}({{{calls[v]}}});")
out += lines[end:]
MAIN.write_text("\n".join(out), encoding="utf-8", newline="")
print("顺序:", " -> ".join(order))

# 校验：bare 名字是否在 main.js 顶层有定义
top = set(re.findall(r"^(?:export\s+)?(?:async\s+)?function (\w+)|^(?:export\s+)?(?:const|let|var) (\w+)", MAIN.read_text(encoding="utf-8"), re.M))
tops = {a or b for a, b in top}
for l in MAIN.read_text(encoding="utf-8").split("\n"):
    mi = re.match(r"^import\s+(.+?)\s+from", l)
    if not mi:
        continue
    spec = mi.group(1)
    ns = re.search(r"\*\s+as\s+(\w+)", spec)
    if ns:
        tops.add(ns.group(1))
    for br in re.findall(r"\{([^}]*)\}", spec):
        for part in br.split(","):
            alias = part.split(" as ")[-1].strip()
            if re.fullmatch(r"[A-Za-z_$][\w$]*", alias or ""):
                tops.add(alias)
    d = re.match(r"^(\w+)\s*(,|$)", spec)
    if d and not spec.startswith("{"):
        tops.add(d.group(1))
missing = []
for var, arg in calls.items():
    for item in [x.strip() for x in arg.strip("{} ").split(",") if x.strip()]:
        if ":" in item:
            continue
        if item not in tops and item not in prov:
            missing.append((var, item))
print("未定义/未提供:", missing if missing else "无")
