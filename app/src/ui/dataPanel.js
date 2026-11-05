// 从 main.js 的「数据管理」段落抽出；依赖由 install(ctx) 注入
export function install(ctx) {
  const { $, MAX_IMPORT_BYTES, MB, deleteProfile, fmtDay, importProfile, loadProfile, msg, refresh, state, storageEstimate, store } = ctx;

/* ---------------- 数据管理 ---------------- */

async function renderProfiles() {
  const ul = $('profileList');
  ul.innerHTML = '';
  if (!state.profiles.length) { ul.innerHTML = '<li class="muted">（空）先导入数据</li>'; return; }
  for (const p of state.profiles) {
    const li = document.createElement('li');
    li.innerHTML = `<span><strong>${p.symbol}</strong> <span class="tag">1m</span>
      <div class="meta">${p.bars.toLocaleString()} 根 · ${MB(p.importedBytes || p.bytes)} MB · ${fmtDay(p.first)} → ${fmtDay(p.last)}</div></span>`;
    const box = document.createElement('span');
    const use = document.createElement('button');
    use.textContent = state.profile?.id === p.id ? '加载中' : '加载';
    use.onclick = () => loadProfile(p);
    const del = document.createElement('button');
    del.textContent = '删除';
    del.className = 'ghost';
    let armed = false, timer = null;
    del.onclick = async () => {
      if (!armed) {
        armed = true; del.textContent = '再点一次';
        timer = setTimeout(() => { armed = false; del.textContent = '删除'; }, 3000);
        return;
      }
      clearTimeout(timer);
      await deleteProfile(p.id);
      if (state.profile?.id === p.id) { state.profile = null; state.app?.dispose(); state.app = null; }
      await refresh();
    };
    box.append(use, del);
    li.appendChild(box);
    ul.appendChild(li);
  }
}

async function renderAvail() {
  const ul = $('availList');
  ul.innerHTML = '';
  if (!state.manifest) { ul.innerHTML = '<li class="muted">无 manifest</li>'; return; }
  for (const p of state.manifest.profiles) {
    const li = document.createElement('li');
    const tooBig = p.bytes > MAX_IMPORT_BYTES;
    li.innerHTML = `<span><strong>${p.symbol}</strong> <span class="tag">1m</span>
      <div class="meta">${p.bars.toLocaleString()} 根 · ${MB(p.bytes)} MB · ${fmtDay(p.first)} → ${fmtDay(p.last)}
      ${p.zeroVolume ? ' · volume 全 0' : ''}</div></span>`;
    const btn = document.createElement('button');
    btn.textContent = tooBig ? '超 1 GB' : '导入';
    btn.disabled = tooBig;
    btn.onclick = () => doImport(p);
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

async function renderUsage() {
  const est = await storageEstimate();
  const local = state.profiles.reduce((s, p) => s + (p.importedBytes || p.bytes), 0);
  const shots = await store.shotBytes();
  $('usage').textContent = est
    ? `行情 ${MB(local)} MB · 截图 ${MB(shots)} MB · 浏览器已用 ${est.usageMB} MB / 配额 ${est.quotaMB} MB`
    : `行情 ${MB(local)} MB · 截图 ${MB(shots)} MB`;
}

async function doImport(profile) {
  if (state.importing) return;
  const ac = new AbortController();
  state.importing = ac;
  $('progWrap').hidden = false;
  $('cancel').onclick = () => ac.abort();
  msg(`准备导入 ${profile.symbol} …`);
  const t0 = performance.now();
  try {
    const saved = await importProfile(profile, {
      signal: ac.signal,
      onProgress: ({ phase, file, fileIndex, fileCount, doneBytes, totalBytes }) => {
        $('prog').value = totalBytes ? (doneBytes / totalBytes * 100) : 0;
        $('progText').textContent = `${phase === 'fetch' ? '读取' : '写入'} ${file} (${fileIndex + 1}/${fileCount}) · ${MB(doneBytes)}/${MB(totalBytes)} MB`;
      }
    });
    msg(`导入完成：${saved.bars.toLocaleString()} 根 · ${MB(saved.importedBytes)} MB · 用时 ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    await refresh();
    await loadProfile(saved);
  } catch (err) {
    if (err.name === 'AbortError') msg('已取消导入，本次写入的分片已回滚');
    else msg(`导入失败：${err.message}（本次写入已回滚）`, true);
  } finally {
    state.importing = null;
    $('progWrap').hidden = true;
  }
}



  return { renderProfiles, renderAvail, renderUsage };
}
