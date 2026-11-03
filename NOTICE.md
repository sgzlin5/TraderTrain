TraderTrain — third-party notices
=================================

本项目自身代码按仓库根目录的 Apache License 2.0 发布。以下第三方组件各自遵循其原始许可，
其许可全文见对应路径：

1. klinecharts（app/vendor/klinecharts.min.js、app/vendor/klinecharts-extension/）
   Apache License 2.0 —— 全文见 app/vendor/klinecharts.LICENSE

2. PineTS（app/vendor/pinets.min.browser.es.js）
   GNU AGPL-3.0 —— https://github.com/LuxAlgo/PineTS/blob/main/LICENSE
   说明：PineTS 以 AGPL-3.0 授权。本仓库把其编译产物用于浏览器端的 Pine 脚本运行时；
   若你要再分发本项目（尤其是作为网络服务提供），需自行评估 AGPL-3.0 的源码提供义务，
   或改为不随仓库分发该文件、由使用者自行安装。

3. 设计参考资料（docs/design/financial-ui-suite/）
   MIT —— 来自 https://github.com/rgourley/financial-ui-suite
   仅作为设计文档与 CSS 变量取值的参考，未参与构建。

4. LuxAlgo Vela（仅评估，未引入依赖）
   相关评估结论见 docs/VELA-FEASIBILITY.md；仓库内不含其代码。

5. 行情数据
   仓库不含行情数据（data/bin/ 已在 .gitignore 中排除）。使用者的数据来源与授权自负责。
