// 从 main.js 的「从 ZIP / CSV 直接导入」段落抽出；依赖由 install(ctx) 注入
export function install(ctx) {
  const { $, MB, fmtDay, loadProfile, refresh, state } = ctx;

/* ---------------- 从 ZIP / CSV 直接导入 ---------------- */

function csvMsg(text, isErr = false) {
  const el = $('csvMsg');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('err', !!isErr);
}

/** 把选中的 File 列表摊平成 [{name, getText}]，zip 里的每个 csv 算一个源 */
async function collectCsvSources(files) {
  const { listZipEntries, csvEntries, readZipEntry } = await import('../zip.js');
  const { decodeText } = await import('../csvparse.js');
  const sources = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const entries = csvEntries(await listZipEntries(f));
      if (!entries.length) throw new Error(`${f.name} 里没有 csv/txt`);
      for (const e of entries) {
        sources.push({
          name: `${f.name}/${e.name}`,
          getText: async () => decodeText(await readZipEntry(f, e))
        });
      }
    } else if (/\.(csv|txt|tsv)$/i.test(f.name)) {
      sources.push({ name: f.name, getText: async () => decodeText(new Uint8Array(await f.arrayBuffer())) });
    }
  }
  return sources;
}

async function doCsvImport(fileList) {
  if (state.csvImporting) return;
  const files = [...fileList];
  if (!files.length) return;
  const ac = new AbortController();
  state.csvImporting = ac;
  $('csvProgWrap').hidden = false;
  $('csvProg').value = 0;
  $('csvText').textContent = '准备中…';
  $('csvCancel').onclick = () => ac.abort();
  csvMsg('');
  const t0 = performance.now();

  try {
    const sources = await collectCsvSources(files);
    csvMsg(`解析 ${sources.length} 个文件…`);
    const { importCsvSources } = await import('../ingest.js');
    const saved = await importCsvSources(sources, {
      symbol: $('csvSymbol').value.trim() || undefined,
      signal: ac.signal,
      onProgress: ({ phase, file, fileIndex, fileCount, rows }) => {
        if (phase === 'parse') {
          $('csvProg').value = fileCount ? (fileIndex / fileCount) * 45 : 0;
          $('csvText').textContent = `解析 ${file || ''} (${fileIndex + 1}/${fileCount}) · ${(rows || 0).toLocaleString()} 行`;
        } else if (phase === 'sort') {
          $('csvProg').value = 50;
          $('csvText').textContent = `排序 ${(rows || 0).toLocaleString()} 行…`;
        } else if (phase === 'write') {
          $('csvProg').value = 55 + (fileCount ? ((fileIndex + 1) / fileCount) * 45 : 0);
          $('csvText').textContent = `写入分片 ${file} (${fileIndex + 1}/${fileCount})`;
        }
      }
    });
    $('csvProg').value = 100;
    $('csvText').textContent = '完成';
    csvMsg(`导入完成：${saved.symbol} · ${saved.bars.toLocaleString()} 根 · ${MB(saved.bytes)} MB · ${fmtDay(saved.first)} → ${fmtDay(saved.last)} · 用时 ${((performance.now() - t0) / 1000).toFixed(1)} s`
      + (saved.dupeTimestamps ? ` · 去重 ${saved.dupeTimestamps} 行` : '')
      + (saved.skipped ? ` · 跳过 ${saved.skipped} 行` : ''));
    await refresh();
    await loadProfile(saved);
  } catch (err) {
    if (err.name === 'AbortError') csvMsg('已取消，本次写入的分片已回滚');
    else csvMsg(`导入失败：${err.message}`, true);
  } finally {
    state.csvImporting = null;
    setTimeout(() => { $('csvProgWrap').hidden = true; }, 1200);
  }
}

function wireCsvImport() {
  const drop = $('csvDrop');
  const input = $('csvFile');
  if (!drop || !input) return;
  let pending = null;                       // 选完文件先不导，等用户点「导入」

  const setPending = (files) => {
    pending = [...files];
    drop.querySelector('.dz-main').textContent = pending.length
      ? `${pending.map(f => f.name).join('、').slice(0, 60)}（${pending.length} 个文件）`
      : '把 .zip（内含多个 csv）或 .csv 拖到这里';
  };

  $('csvPick').onclick = () => input.click();
  input.onchange = () => { setPending(input.files); };

  for (const ev of ['dragenter', 'dragover']) {
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('on'); });
  }
  for (const ev of ['dragleave', 'drop']) {
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('on'); });
  }
  drop.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) setPending(files);
  });

  $('csvGo').onclick = () => {
    const files = pending && pending.length ? pending : [...input.files];
    if (!files.length) { csvMsg('先选一个 .zip 或 .csv', true); return; }
    doCsvImport(files).then(() => setPending([]));
  };
}


  return { wireCsvImport };
}
