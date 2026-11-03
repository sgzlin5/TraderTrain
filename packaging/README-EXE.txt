TraderTrain v0.1.0 —— Windows 桌面版
=====================================

一、怎么启动
   双击 TraderTrain-0.1.0.exe。
   窗口打开后用「04 数据」下载或导入行情（首次是空的，数据存在本机）。
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
   · 提示端口 8731 被占用：先关掉已开着的 TraderTrain 窗口（或用 start.bat 起的服务）。
     端口不能换 —— IndexedDB 的 origin 依赖它，换了数据就“丢”了。
   · 窗口起来是最小化的：等 1-2 秒会自动恢复（程序内有 9 秒看门狗）。
   · 杀软报毒：PyInstaller 单文件包常被误报，加白即可。

四、重新打包
   bash packaging/build.sh      （需要 Python 3.12；脚本会自建 .venv 并装 pywebview + pyinstaller）
   产物：packaging/dist/TraderTrain-0.1.0.exe
   改了 app/ 里的代码必须重新打包，exe 内嵌的是打包那一刻的副本。
