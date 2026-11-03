# -*- coding: utf-8 -*-
"""TraderTrain v0.1.0 —— 单文件 exe 入口。

做什么：
  1) 把打包进来的 app/ 铺到 %LOCALAPPDATA%\\TraderTrain\\app（可写，带 BUILD 戳做版本升级）；
  2) 用内置的 tools/serve.py 在固定端口 8731 起本地服务（静态站 + /api/* 下载导入）；
  3) 用 pywebview(WebView2) 开一个无地址栏窗口，用户数据目录固定在
     %LOCALAPPDATA%\\TraderTrain\\webview —— origin 恒定 http://127.0.0.1:8731，
     IndexedDB 里的行情不会因为换版本而丢。

保留 Chrome 数据老路：`TraderTrain.exe --chrome` 会改用当前目录的 .chrome-profile
（跟 start.bat 一样），这样 v0.1 之前导入的行情能继续用。
"""
import ctypes
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request

VERSION = "0.1.0"
APP_NAME = "TraderTrain"
PORT = int(os.environ.get("TT_PORT", "8731"))   # 仅供冒烟测试改端口；正式用 8731
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 源码运行时用


# ---------------------------------------------------------------- 路径 / 日志

def resource_root():
    """PyInstaller onefile 解包目录，或源码运行时的项目根。"""
    if getattr(sys, "_MEIPASS", None):
        return sys._MEIPASS
    return PROJECT_DIR


def data_home():
    root = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), APP_NAME)
    os.makedirs(root, exist_ok=True)
    return root


def setup_log(home):
    try:
        f = open(os.path.join(home, "server.log"), "a", encoding="utf-8", buffering=1)
        sys.stdout = f
        sys.stderr = f
    except Exception:
        pass


def log(*a):
    try:
        print(f"[{time.strftime('%H:%M:%S')}]", *a)
    except Exception:
        pass


# ---------------------------------------------------------------- 铺 app/

def ensure_app(bundle, home):
    src = os.path.join(bundle, "app")
    dst = os.path.join(home, "app")
    want = VERSION
    try:
        with open(os.path.join(src, "BUILD"), encoding="utf-8") as f:
            want = f.read().strip() or VERSION
    except Exception:
        pass
    have = None
    try:
        with open(os.path.join(dst, "BUILD"), encoding="utf-8") as f:
            have = f.read().strip()
    except Exception:
        pass
    if have != want:
        log("铺 app/ →", dst, "(build", want, ")")
        shutil.rmtree(dst, ignore_errors=True)
        shutil.copytree(src, dst)
    # 行情清单（服务侧 /api 与前端都读它）；每次覆盖，很小
    mf = os.path.join(bundle, "data", "manifest.json")
    if os.path.exists(mf):
        os.makedirs(os.path.join(home, "data"), exist_ok=True)
        shutil.copyfile(mf, os.path.join(home, "data", "manifest.json"))
    return dst


# ---------------------------------------------------------------- 本地服务

def port_busy(port):
    with socket.socket() as s:
        s.settimeout(0.35)
        return s.connect_ex(("127.0.0.1", port)) == 0


def http_ok(port, host="127.0.0.1"):
    try:
        with urllib.request.urlopen(f"http://{host}:{port}/app/index.html", timeout=0.8) as r:
            return r.status == 200
    except Exception:
        return False


def start_server(home):
    sys.path.insert(0, os.path.join(resource_root(), "tools"))
    import serve as tt_serve            # tools/serve.py：静态站 + 下载/导入 API

    os.chdir(home)                      # Handler 用 cwd 提供静态文件；缓存放 <home>/.cache

    class Server(tt_serve.ThreadingHTTPServer):
        daemon_threads = True

    srv = Server(("127.0.0.1", PORT), tt_serve.Handler)
    srv.root = home
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    for _ in range(80):
        if http_ok(PORT):
            log("server ready on", PORT)
            return srv
        time.sleep(0.1)
    raise RuntimeError(f"本地服务没起来（端口 {PORT}）")


# ---------------------------------------------------------------- 窗口：防“起来就最小化”

def fix_window_once(pid):
    """把本进程的主窗口从最小化恢复（不动正常显示的窗口，也不抢焦点）。"""
    user32 = ctypes.windll.user32
    hits = []

    WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

    def _cb(hwnd, _lparam):
        owner = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value != pid:
            return True
        if not user32.IsWindowVisible(hwnd):
            return True
        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, 9)      # SW_RESTORE
            hits.append(hwnd)
        return True

    try:
        user32.EnumWindows(WNDENUMPROC(_cb), 0)
    except Exception as e:
        log("fix_window:", e)
    return len(hits)


def watch_window(seconds=9.0):
    pid = os.getpid()
    t0 = time.time()
    while time.time() - t0 < seconds:
        time.sleep(0.4)
        n = fix_window_once(pid)
        if n:
            log("窗口被系统最小化过，已恢复", n, "次")


# ---------------------------------------------------------------- --chrome：沿用 Chrome 数据

def launch_chrome_mode():
    """用 Chrome --app 打开（跟 start.bat 同一条路），数据在 .chrome-profile 里。"""
    url = f"http://127.0.0.1:{PORT}/app/index.html"
    profile = os.path.join(data_home(), "chrome-profile")
    cands = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.join(os.environ.get("LOCALAPPDATA", ""), r"Google\Chrome\Application\chrome.exe"),
    ]
    exe = next((c for c in cands if os.path.exists(c)), None)
    if not exe:
        return False
    subprocess.Popen([exe, f"--app={url}", f"--user-data-dir={profile}",
                      "--no-first-run", "--no-default-browser-check",
                      "--window-size=1520,940"])
    return True


# ---------------------------------------------------------------- main

def main():
    home = data_home()
    setup_log(home)
    log("=" * 60)
    log(f"{APP_NAME} v{VERSION} start; home={home}")

    if "--chrome" in sys.argv:
        ensure_app(resource_root(), home)
        if not port_busy(PORT):
            start_server(home)
        ok = launch_chrome_mode()
        log("chrome mode:", "ok" if ok else "chrome 未找到")
        time.sleep(1.2)
        return

    ensure_app(resource_root(), home)

    if port_busy(PORT):
        if not http_ok(PORT):
            raise SystemExit(f"端口 {PORT} 被别的程序占用，请先关掉它再启动。")
        log("端口已在服务中，直接开窗")
    else:
        start_server(home)

    import webview

    url = f"http://127.0.0.1:{PORT}/app/index.html"
    webview.create_window(
        f"{APP_NAME} v{VERSION}", url,
        width=1520, height=940, min_size=(1100, 700),
        background_color="#03070d",
    )

    def _after_start():
        # 页面已加载，补两次主动恢复 + 8 秒盯盘（pywebview 偶发以最小化状态建窗）
        threading.Thread(target=watch_window, args=(9.0,), daemon=True).start()

    webview.start(gui="edgechromium", private_mode=False,
                  storage_path=os.path.join(home, "webview"),
                  func=_after_start)


if __name__ == "__main__":
    main()
