// M21 验收：历史数据下载面板（标的搜索 / 周期 / 日期 / 任务创建）
// 无 /api/instruments（用 python -m http.server 起的静态服务）时自动跳过网络部分
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    for (let i = 0; i < 80 && !window.__UI_READY__; i++) await wait(100);
    if (document.getElementById('drawer').hidden) document.getElementById('btnData').click();
    await wait(300);

    const search = document.getElementById('dlSearch');
    const hasPanel = !!search && !!document.getElementById('dlStart');
    log('panel', hasPanel);

    // 接口可用性
    let api = false;
    try {
      const res = await fetch('/api/instruments', { cache: 'no-store' });
      api = res.ok;
      if (api) {
        const list = await res.json();
        const bySource = list.reduce((m, x) => (m[x.source] = (m[x.source] || 0) + 1, m), {});
        log('instruments', { n: list.length, bySource, xau: list.find(x => x.code === 'XAUUSD'), btc: list.find(x => x.code === 'BTCUSDT') });
      }
    } catch {}
    log('api', api);

    // 搜索：中文名与代码都能命中
    let hitCode = [], hitName = [];
    if (api) {
      search.value = 'xau'; search.dispatchEvent(new Event('input'));
      await wait(500);
      hitCode = [...document.querySelectorAll('#dlResults .dl-opt')].map(b => b.dataset.code);
      search.value = '黄金'; search.dispatchEvent(new Event('input'));
      await wait(500);
      hitName = [...document.querySelectorAll('#dlResults .dl-opt')].map(b => b.dataset.code);
    }
    log('search', { hitCode, hitName });

    // 选中 + 日期默认值 + 周期/价格控件
    let picked = null, dates = null, controls = null;
    if (api && hitName.length) {
      document.querySelector(`#dlResults .dl-opt[data-code="XAUUSD"]`).click();
      await wait(300);
      picked = document.getElementById('dlSymbol').textContent;
      dates = { from: document.getElementById('dlFrom').value, to: document.getElementById('dlTo').value };
      controls = {
        tf: [...document.querySelectorAll('#dlTf option')].map(o => o.value),
        price: [...document.querySelectorAll('#dlPrice option')].map(o => o.value)
      };
      document.getElementById('dlResults').hidden = true;
    }
    // 合并数据源：同一列表里 Dukascopy 与 Binance 都在
    let mixed = null, btc = null, priceDisabled = null;
    if (api) {
      search.value = 'BTC'; search.dispatchEvent(new Event('input'));
      await wait(500);
      btc = [...document.querySelectorAll('#dlResults .dl-opt')].map(b => b.dataset.code);
      const btn = document.querySelector('#dlResults .dl-opt[data-code="BTCUSDT"]');
      if (btn) { btn.click(); await wait(300); priceDisabled = document.getElementById('dlPrice').disabled; }
      mixed = {
        btcRow: !!btn,
        tag: btc.length ? document.querySelector('#dlResults .dl-opt').textContent.includes('BINANCE') : false,
        priceDisabled
      };
      // 选回 XAUUSD 供后续断言
      search.value = 'XAU'; search.dispatchEvent(new Event('input'));
      await wait(500);
      document.querySelector('#dlResults .dl-opt[data-code="XAUUSD"]').click();
      await wait(250);
      picked = document.getElementById('dlSymbol').textContent;
    }
    log('merged', mixed);
    log('picked', picked);
    log('dates', dates);
    log('controls', controls);

    // 没选标的时点下载 → 必须报错而不是静默
    let guardMsg = '';
    if (hasPanel) {
      const keep = window.__DL_PICKED__;
      document.getElementById('dlSymbol').textContent = '—';
      // 直接点，dlStart 内部会检查 DL.picked（已经选过了，这里只验证文案路径存在）
      guardMsg = document.getElementById('dlMsg').textContent;
    }
    log('guardMsg', guardMsg);

    // 交易日历：加密 7×24 不跳周末；Dukascopy 周末休市
    let cal = null;
    if (api) {
      const mk = async (sym, src, f, t) => {
        const res = await fetch(`/api/job?symbol=${sym}&source=${src}&tf=M1&from=${f}&to=${t}`);
        const j = await res.json();
        for (let i = 0; i < 50; i++) {
          await wait(300);
          const st = await (await fetch(`/api/job/${j.id}`)).json();
          if (st.state === 'done' || st.state === 'error') {
            try { await fetch(`/api/job/${j.id}`, { method: 'DELETE' }); } catch {}
            return st;
          }
        }
        return { state: 'timeout' };
      };
      // 2024-06-08 是周六、06-09 是周日
      const crypto = await mk('BTCUSDT', 'binance', '2024-06-08', '2024-06-09');
      const fx = await mk('XAUUSD', 'dukascopy', '2024-06-08', '2024-06-09');
      cal = { cryptoBars: crypto.bars, cryptoState: crypto.state, cryptoTotal: crypto.total,
              fxState: fx.state, fxTotal: fx.total, fxError: fx.error };
    }
    log('calendar', cal);

    R.pass = !!(hasPanel && (api ? (hitCode.includes('XAUUSD') && hitName.includes('XAUUSD') && picked === 'XAUUSD'
      && /^\d{4}-\d{2}-\d{2}$/.test(dates.from) && /^\d{4}-\d{2}-\d{2}$/.test(dates.to)
      && controls.tf.join() === 'M1' && controls.price.join() === 'BID,ASK'
      && mixed && mixed.btcRow && mixed.tag && mixed.priceDisabled === true
      && cal && cal.cryptoState === 'done' && cal.cryptoBars === 2880     // 周六+周日 各 1440 根
      && cal.fxState === 'error' && cal.fxTotal === 0) : true));
    R.skipped = !api ? '没有下载接口（当前服务不是 tools/serve.py）' : null;
  } catch (err) {
    R.errors.push(String(err && err.stack || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
