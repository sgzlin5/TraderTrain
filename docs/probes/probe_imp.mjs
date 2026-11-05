import { PineEngine } from '@luxalgo/vela-pinets';
const T0=1767387600000;
const BARS=Array.from({length:200},(_,i)=>({time:T0+i*60000,open:2000+i,high:2003+i,low:1998+i,close:2001+i,volume:100}));
async function t(name, src, opts={}) {
  const engine = new PineEngine(opts.engineOpts||{});
  let prepared=null, err=null;
  try { prepared = await engine.prepare(src,'x'); } catch(e){ err='prepare: '+(e.message||e).slice(0,200); }
  if (!prepared) return console.log(name, '->', err);
  let model=null, rerr=null, warns=[];
  const t0=Date.now();
  await new Promise(res=>{let d=false;const fin=()=>{if(!d){d=true;res();}};
    engine.execute({prepared, market:{symbol:'BTCUSDT',timeframe:'60',symbolInfo:{tickerid:'BTCUSDT',mintick:0.01,pricescale:100,timezone:'UTC'}}, bars:BARS, getBars:()=>BARS, mode:'static'},
      {onModel(m){model=m;},onError(e){rerr=String(e.message||e).slice(0,200);},onWarning(w){warns.push(String(w).slice(0,160));},onDone(){fin();}}); setTimeout(fin,30000);});
  console.log(name,'-> ok='+(!rerr&&!!model), 'ms='+(Date.now()-t0), 'err='+rerr, 'warns='+JSON.stringify(warns.slice(0,2)), 'series='+(model?.series?.length??0));
}
// 1) import 库（无 resolver）
await t('import 无 resolver', `//@version=6
indicator("IMP", overlay=true)
import LuxAlgo/Utilities/1 as u
plot(close)`);
// 2) import 有 resolver（返回伪库源码）
await t('import 有 resolver', `//@version=6
indicator("IMP2", overlay=true)
import mylib/util/1 as u
plot(close)`, { engineOpts: { importResolver: async (path) => `//@version=6
library("util", overlay=false)
export f(float x) => x * 2` } });
// 3) request.security 无 fetchSeries（跨品种）
await t('security 无 fetchSeries', `//@version=6
indicator("SEC2", overlay=false)
v = request.security("ETHUSDT", "60", close)
plot(na(v) ? -1 : v)`);
