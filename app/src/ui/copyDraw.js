// 从 main.js 的「从其他图复制绘制」段落抽出；依赖由 install(ctx) 注入
export function install(ctx) {
  const { $, PERIODS, TBOX, applyThemePaneLayout, closeCtx, closeSubs, commitLayout, copyChartImage, kvGet, normalize, openCtx, openSub, renderTools, resetChartView, saveLayout, state, syncLayoutUI, updateStatus } = ctx;

/* ---- 从其他图复制绘制 ---- */

async function renderCopyDrawList() {
  const box = $('copyDrawList');
  box.innerHTML = '';
  const symbol = state.profile?.symbol;
  const cur = state.app?.periodKey;
  const found = [];
  for (const p of PERIODS) {
    if (p.key === cur) continue;
    let items = null;
    try { items = await kvGet(`draw:${symbol}:${p.key}`); } catch {}
    if (Array.isArray(items) && items.length) found.push({ key: p.key, label: p.label, items });
  }
  if (!found.length) {
    box.innerHTML = '<div class="sub-empty">没有其他周期的绘图</div>';
    return;
  }
  for (const f of found) {
    const b = document.createElement('button');
    b.className = 'sub-item';
    b.innerHTML = `<span>${f.label} 周期</span><small>${f.items.length} 条</small>`;
    b.onclick = () => copyDrawings(f);
    box.appendChild(b);
  }
}

async function copyDrawings(from) {
  const draw = state.draw;
  const list = state.app?.chart.getDataList() || [];
  if (!draw || !list.length) return;
  // 按「整段数据范围」判断能否复制（不在当前可视窗口也可以，滚过去就能看到）
  const first = state.profile?.first ?? list[0].timestamp;
  const last = state.profile?.last ?? list[list.length - 1].timestamp;
  let added = 0;
  for (const it of from.items) {
    const pts = (it.points || []).filter(pt => pt.timestamp >= first && pt.timestamp <= last);
    if (pts.length) { draw.items.push({ name: it.name, points: pts }); added++; }
  }
  if (!added) { updateStatus(`${from.label} 周期的绘图不在当前数据范围内`); return; }
  const shown = draw.restore();
  await draw.persist();
  updateStatus(`已从 ${from.label} 周期复制 ${added} 条绘图${shown < added ? '（部分在当前视图外）' : ''}`);
  closeCtx();
}

/** 正在画图（折线取点中 / 普通工具已落部分点）时，右键应该“结束/取消绘制”，不弹菜单 */
function abortDrawingIfAny() {
  const d = state.draw;
  if (!d) return false;
  const done = () => { state._suppressCtxUntil = Date.now() + 500; renderTools(); };
  if (d._poly) { d.endPolyline(true); done(); return true; }
  if (d.pending) { d.cancelPending(); done(); return true; }
  return false;
}

/** 右键收尾绘制后，紧跟的 contextmenu 要吞掉，否则会连带弹出图表菜单 */
function ctxSuppressed() { return Date.now() < (state._suppressCtxUntil || 0); }

function wireContextMenu() {
  // 右键：整页都拦掉浏览器原生菜单（只放过输入框/文本域），
  // 只有落在图表区域里才弹我们自己的菜单。
  const editable = (el) => !!(el && el.closest && el.closest('input, textarea, [contenteditable="true"]'));
  const inChart = (el) => !!(el && el.closest && el.closest('#chart'));
  // TAB 条有自己的右键菜单（重命名/关闭/新建），别被图表的全局拦截吃掉
  const inTabs = (el) => !!(el && el.closest && el.closest('#tabList, #tabMenu'));

  // 注：菜单只在 contextmenu 里打开（mousedown 只负责拦默认行为 + 收尾绘制），
  // 否则同一次右键里“点外部关闭菜单”的监听会把刚打开的菜单立刻关掉。
  const onRightDown = (e) => {
    if (e.button !== 2) return;
    if (inTabs(e.target)) return;
    if (editable(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    abortDrawingIfAny();                  // 绘制中：右键 = 收尾
    if (!inChart(e.target)) closeCtx();
  };
  const onCtx = (e) => {
    if (inTabs(e.target)) return;
    if (editable(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (abortDrawingIfAny()) return;
    if (ctxSuppressed()) return;
    if (inChart(e.target)) openCtx(e.clientX, e.clientY);
    else closeCtx();
  };

  // 挂 document（capture），图表/工具栏/状态栏任何位置右键都不会再弹浏览器菜单
  document.addEventListener('mousedown', (e) => { if (e.button === 2) onRightDown(e); }, true);
  document.addEventListener('contextmenu', onCtx, true);

  $('ctxMenu').querySelectorAll('.mi').forEach(item => {
    item.addEventListener('mouseenter', () => {
      const sub = item.dataset.sub;
      if (sub === 'layout') { syncLayoutUI(); openSub('layoutPanel', item); }
      else if (sub === 'draw') { renderCopyDrawList(); openSub('copyDrawPanel', item); }
      else closeSubs();
    });
    item.addEventListener('click', () => {
      const act = item.dataset.act;
      if (act === 'reset') { resetChartView(); closeCtx(); }
      else if (act === 'copy') { copyChartImage(); closeCtx(); }
      else if (item.dataset.sub === 'layout') { syncLayoutUI(); openSub('layoutPanel', item); }
      else if (item.dataset.sub === 'draw') { renderCopyDrawList(); openSub('copyDrawPanel', item); }
    });
  });

  $('closeLayout').onclick = () => { $('layoutPanel').hidden = true; };
  $('lyDone').onclick = () => { $('layoutPanel').hidden = true; };
  $('closeCopyDraw').onclick = () => { $('copyDrawPanel').hidden = true; };

  // 版面设置控件
  [...$('bgMode').children].forEach(b => {
    b.onclick = () => commitLayout({ bgMode: b.dataset.mode });
  });
  $('lyBg').oninput = (e) => commitLayout({ bg: e.target.value, bgMode: 'custom' });
  $('lyGrid').onchange = (e) => commitLayout({ grid: e.target.checked });
  $('lyGridColor').oninput = (e) => commitLayout({ gridColor: e.target.value });
  $('lyUp').oninput = (e) => commitLayout({ up: e.target.value });
  $('lyDown').oninput = (e) => commitLayout({ down: e.target.value });
  $('lyUpBorder').oninput = (e) => commitLayout({ upBorder: e.target.value });
  $('lyDownBorder').oninput = (e) => commitLayout({ downBorder: e.target.value });
  $('lyBorderAuto').onchange = (e) => {
    const on = e.target.checked;
    commitLayout(on ? { borderAuto: true } : { borderAuto: false, upBorder: state.layout.up, downBorder: state.layout.down });
  };
  $('lyReset').onclick = () => {
    state.layout = normalize(null);
    applyThemePaneLayout();
    syncLayoutUI();
    saveLayout(state.layout);
  };

  // 点外面 / Esc 关闭
  document.addEventListener('mousedown', (e) => {
    if ($('ctxMenu').hidden) return;
    if ($('ctxMenu').contains(e.target) || $('layoutPanel').contains(e.target) || $('copyDrawPanel').contains(e.target)) return;
    closeCtx();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('ctxMenu').hidden) closeCtx();
  });
}


  return { wireContextMenu };
}
