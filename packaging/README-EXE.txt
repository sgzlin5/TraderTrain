TraderTrain v0.2.0-beta —— Windows 桌面版
=====================================

一、怎么启动
   双击 TraderTrain-0.2.0-beta.exe。
   默认发行包**不内置历史行情**（108 MB 不适合塞进 exe）：启动时会扫描盘上已有的 data\bin，
   扫到就出现在「04 数据 → 可导入」里，点「导入」直接用（读原目录，不复制、不额外占空间）。
   查找顺序：%TT_DATA% → exe 同级的 data\（便携）→ 上一级 data\ → 仓库根 data\ → %LOCALAPPDATA%\TraderTrain\data\
   都没扫到时清单为空，行情用「04 数据 → 在线下载」或「导入 CSV」。
   数据目录：%LOCALAPPDATA%\TraderTrain\
     app\      程序文件（升级时自动重铺）
     data\     行情清单
     webview\  浏览器数据（IndexedDB 里的行情就在这）
     server.log  运行日志（排查问题先看它）

二、两种数据空间（重要）
   1) 默认（本 exe 窗口）：数据在 %LOCALAPPDATA%\TraderTrain\webview，跟 Chrome 版互不相通。
   2) 兼容模式：TraderTrain.exe --chrome
      用 Chrome --app 打开，数据目录是 %LOCALAPPDATA%\TraderTrain\chrome-profile。
      想把 v0.1 之前 Chrome 版（.chrome-profile）里的行情接着用，可以把这个目录
      拷到 %LOCALAPPDATA%\TraderTrain\chrome-profile 再以 --chrome 启动；
      或者在 exe 里重新导入一次 CSV（更快、更干净）。

三、常见问题
   · 双击没反应：看 %LOCALAPPDATA%\TraderTrain\server.log 最后几行。
   · 提示端口 8733 被占用：先关掉已开着的 TraderTrain 窗口（或用 start.bat 起的服务）。
     端口就是 origin，不能换 —— 换了 IndexedDB 读不到旧库，看起来像“历史数据丢了”。
     旧版（端口 8731）的数据在 %LOCALAPPDATA%\TraderTrain\webview 下的 8731 库，只能用
     「04 数据 → 导出行情 / 导入」把它搬到 8733（直接拷目录无效：库文件里记着 origin）。
   · 窗口起来是最小化的：等 1-2 秒会自动恢复（程序内有 9 秒看门狗）。
   · 杀软报毒：PyInstaller 单文件包常被误报，加白即可。

四、重新打包
   bash packaging/build.sh                       （需要 Python 3.12；脚本会自建 .venv 并装 pywebview + pyinstaller）
   产物：packaging/dist/TraderTrain-0.2.0-beta.exe
   要连历史行情一起打包（+108 MB，给没有数据的机器）：
     WITH_DATA=1 bash packaging/build.sh
   注意：清单由 exe 启动时按扫到的 data\bin 自动生成（写到 %LOCALAPPDATA%\TraderTrain\data\manifest.json），不用手工维护。
   改了 app/ 里的代码必须重新打包，exe 内嵌的是打包那一刻的副本。
