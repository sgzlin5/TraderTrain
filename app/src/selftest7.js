// M7 验收自检：绘图工具样式模板（保存 / 默认 / 应用 / 删除）
export async function run(state) {
  const R = (window.__RESULT__ = { checks: {}, errors: [], t0: Date.now() });
  const log = (k, v) => { R.checks[k] = v; };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    for (let i = 0; i < 80 && !(window.__APP__ && window.__APP__.app); i++) await wait(150);
    if (window.__APP_READY__) await window.__APP_READY__;
    const app = state.app;
    if (!app) throw new Error('应用未就绪（先导入数据）');
    const chart = app.chart;
    const draw = state.draw;
    const ds = await import('./drawStyles.js');
    const l = chart.getDataList();

    // 0. 清空模板，保证本测试可重复
    state.drawTemplates = ds.emptyTemplateStore();
    await ds.saveTemplateStore(state.drawTemplates);
    state.drawStyles.segment = { color: '', size: 1, style: 'solid' };

    // 1. 造一条趋势线并选中
    chart.removeOverlay();
    draw.items = [];
    const a = l.length - 70, b = l.length - 20;
    chart.createOverlay({
      name: 'segment',
      points: [{ timestamp: l[a].timestamp, value: l[a].low }, { timestamp: l[b].timestamp, value: l[b].high }],
      ...draw.styleFor('segment')
    });
    draw.capture();
    await draw.persist();
    await wait(200);

    const o = chart.getOverlays()[0];
    const px = chart.convertToPixel(o.points.map(p => ({ timestamp: p.timestamp, value: p.value })), { paneId: 'candle_pane' });
    const rect = document.getElementById('chart').getBoundingClientRect();
    const cx = rect.left + (px[0].x + px[1].x) / 2;
    const cy = rect.top + (px[0].y + px[1].y) / 2;
    document.getElementById('chart').querySelectorAll('canvas').forEach(cv =>
      cv.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: cx, clientY: cy, view: window })));
    await wait(300);

    // 2. 改成红实线 3px，保存为模板 T1
    const id = state.selOverlay;
    draw.updateOverlayStyle(id, { color: '#ff6b81', size: 3, style: 'solid', dashedValue: [0, 0] });
    await wait(200);
    document.getElementById('ovMore').click();
    await wait(250);
    const menuOpen = !document.getElementById('ovMenu').hidden;
    document.querySelector('#ovMenu .mi[data-ov="save"]').click();
    document.getElementById('ovTplName').value = '测试模板A';
    document.getElementById('ovTplSaveOk').click();
    await wait(400);
    const savedTemplates = (state.drawTemplates.templates.segment || []).map(t => t.name);
    const defaultId = state.drawTemplates.defaults.segment;

    // 3. 新建绘图应该直接套用默认模板（红 3px 实线）
    const a2 = l.length - 50, b2 = l.length - 8;
    const id2 = chart.createOverlay({
      name: 'segment',
      points: [{ timestamp: l[a2].timestamp, value: l[a2].high }, { timestamp: l[b2].timestamp, value: l[b2].low }],
      ...draw.styleFor('segment')
    });
    draw.capture();
    await draw.persist();
    await wait(250);
    const ov2 = chart.getOverlays().find(x => x.id === id2) || chart.getOverlays()[chart.getOverlays().length - 1];
    const newLine = ov2.styles.line;

    // 4. 把第二条改成绿点线，再点模板 T1 → 应用回来
    draw.updateOverlayStyle(ov2.id, { color: '#00ff00', size: 1, style: 'dotted', dashedValue: [1, 3] });
    await wait(200);
    state.selOverlay = ov2.id;
    window.__renderOvMenu__ ? window.__renderOvMenu__() : null;
    const tplRow = document.querySelector('#ovTplList .tpl');
    if (tplRow) tplRow.click();
    await wait(400);
    const applied = chart.getOverlays().find(x => x.id === ov2.id).styles.line;

    // 5. 持久化 + 删除模板
    const stored = await ds.loadTemplateStore();
    const el = document.querySelector('#ovTplList .tpl .del');
    if (el) el.click();
    await wait(300);
    const afterDel = (state.drawTemplates.templates.segment || []).length;

    log('templates', {
      menuOpen, savedTemplates, defaultSet: !!defaultId,
      newLine: { c: newLine.color, s: newLine.size, st: newLine.style },
      applied: { c: applied.color, s: applied.size, st: applied.style },
      storedNames: (stored.templates.segment || []).map(t => t.name),
      afterDel
    });

    chart.removeOverlay();
    draw.items = [];
    await draw.persist();

    R.pass = (
      menuOpen
      && savedTemplates.includes('测试模板A')
      && !!defaultId
      && newLine.color === '#ff6b81' && newLine.size === 3 && newLine.style === 'solid'
      && applied.color === '#ff6b81' && applied.size === 3
      && (R.checks.templates.storedNames || []).includes('测试模板A')
      && afterDel === 0
    );
  } catch (err) {
    R.errors.push(String(err && err.message || err));
    R.pass = false;
  } finally {
    R.done = true;
    R.elapsedMs = Date.now() - R.t0;
  }
}
