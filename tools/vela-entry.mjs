// Vela vendor 打包入口：全部图形/脚本能力暴露到 window.VelaSDK
// 构建：npm run build:vela（esbuild --bundle --format=iife → app/vendor/vela/vela.bundle.js）
import * as Vela from '@luxalgo/vela';
import { PineEngine } from '@luxalgo/vela-pinets';

window.VelaSDK = Object.assign({ PineEngine }, Vela);
