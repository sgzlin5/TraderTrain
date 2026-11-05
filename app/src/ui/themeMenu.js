// 从 main.js 的「主题 + 主题下拉」段落抽出；依赖由 install(ctx) 注入
export function install(ctx) {
  const { $, THEMES, applyChartThemeAll, applyThemeMode, applyThemePaneLayout, markDirty, migrateLayoutColors, placeAt, saveLayout, saveTheme, state, syncLayoutUI, themeMeta, updateStatus } = ctx;

/* ---------------- 主题 ---------------- */

function updateThemeButton() {
  const meta = themeMeta(state.theme);
  $('themeIcon').textContent = meta.mode === 'light' ? '☾' : '☀';
  $('btnTheme').title = `主题：${meta.label}（点击切换）`;
}

async function setTheme(key) {
  const next = themeMeta(key).key;
  const prev = state.theme;
  state.theme = applyThemeMode(next);
  updateThemeButton();
  renderThemeMenu();
  await saveTheme(state.theme);
  markDirty();
  // 用户没改过涨跌色时，让它跟着主题走
  if (prev !== next) {
    state.layout = migrateLayoutColors(state.layout, prev, next);
    saveLayout(state.layout);
    markDirty();
    syncLayoutUI();
  }
  const chart = state.app?.chart;
  if (chart) {
    applyChartThemeAll();
    applyThemePaneLayout();             // 版面里自定义的涨跌色要重新盖回去
  }
}


/* ---------------- 主题下拉 ---------------- */

function renderThemeMenu() {
  const box = $('themeRows');
  if (!box) return;
  box.innerHTML = THEMES.map(t => {
    const s = t.swatch;
    const candles = `
      <i style="height:14px;background:${s.up}"></i>
      <i style="height:20px;background:${s.down}"></i>
      <i style="height:11px;background:${s.up};opacity:.85"></i>`;
    return `<button class="theme-row ${state.theme === t.key ? 'on' : ''}" data-theme="${t.key}" role="menuitemradio" aria-checked="${state.theme === t.key}">
      <span class="theme-prev" style="background:${s.bg};border-color:${s.line}">${candles}</span>
      <span class="theme-meta"><span class="theme-name">${t.label}</span><span class="theme-desc">${t.desc}</span></span>
    </button>`;
  }).join('');
  box.querySelectorAll('.theme-row').forEach(b => {
    b.onclick = async () => {
      await setTheme(b.dataset.theme);
      closeThemeMenu();
      updateStatus(`主题：${themeMeta(state.theme).label}`);
    };
  });
}

function closeThemeMenu() {
  $('themeMenu').hidden = true;
  $('btnTheme').classList.remove('on');
  $('btnTheme').setAttribute('aria-expanded', 'false');
}

function wireThemeMenu() {
  renderThemeMenu();
  $('btnTheme').onclick = (e) => {
    e.stopPropagation();
    const el = $('themeMenu');
    if (!el.hidden) { closeThemeMenu(); return; }
    renderThemeMenu();
    const r = $('btnTheme').getBoundingClientRect();
    placeAt(el, Math.round(r.right - 246), Math.round(r.bottom + 8));
    el.hidden = false;
    $('btnTheme').classList.add('on');
    $('btnTheme').setAttribute('aria-expanded', 'true');
  };
  document.addEventListener('mousedown', (e) => {
    if ($('themeMenu').hidden) return;
    if ($('themeMenu').contains(e.target) || $('btnTheme').contains(e.target)) return;
    closeThemeMenu();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('themeMenu').hidden) closeThemeMenu();
  });
}


  return { updateThemeButton, closeThemeMenu, wireThemeMenu };
}
