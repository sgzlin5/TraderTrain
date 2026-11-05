// 指标层（Vela 版，P4 第一批）：
// 1) 纯 calc 指标 → registerNativeIndicator 通用适配器（复用 customIndicators.js 的 calc，
//    figures → SeriesSpec，零重写）；
// 2) Pine 桥（D1）：registerEngine('pine', PineEngine) + D7 isconfirmed 预处理 +
//    D8 importResolver（接本项目「Pine 库」，见 VELA-PINETS-COVERAGE §5）。
// SMC×5 / flow×4 的 calc 返回 overlay 对象池（走 boxes/labels 输出分支）= P4 第二批。
import { CUSTOM_INDS } from './customIndicators.js';
import { libList } from './pine.js';
import { kvGet } from './db.js';

const V = () => window.VelaSDK;
const LINE_STYLE_MAP = { solid: 'solid', dashed: 'dashed', dotted: 'dotted', dash: 'dashed', dot: 'dotted' };

/** klinecharts figure → SeriesSpec（线/圆点） */
function figToSeries(tpl, fig, biz, rows, paramsHash) {
  const st = (typeof fig.styles === 'function' ? fig.styles(undefined, undefined) : fig.styles) || {};
  const kind = fig.type === 'circle' ? 'circles' : (fig.type === 'bar' ? 'histogram' : 'line');
  return {
    id: `tt-${tpl.name.toLowerCase()}-${fig.key}-${paramsHash}`,
    title: (fig.title || fig.key).replace(/:\s*$/, '').replace(/:\s*/, ''),
    kind,
    points: rows.map((r, i) => ({
      time: biz[i].time,
      value: r && r[fig.key] != null ? r[fig.key] : null,
      ...(st.color ? {} : {})
    })),
    style: {
      color: st.color || '#8adeff',
      width: st.size ?? 1,
      lineStyle: LINE_STYLE_MAP[st.style] || 'solid'
    }
  };
}

let _registered = false;
/** 把 CUSTOM_INDS（PDHL/ORB/AVWAP/EMA/RMA/ZLEMA）注册成 Vela native indicators */
export function registerNativeVelaIndicators() {
  const { registerNativeIndicator } = V() || {};
  if (_registered || typeof registerNativeIndicator !== 'function') return 0;
  let n = 0;
  for (const tpl of CUSTOM_INDS) {
    try {
      registerNativeIndicator({
        type: 'TT_' + tpl.name,
        title: tpl.shortName || tpl.name,
        paneHint: tpl.series === 'price' ? 'price' : 'new',
        overlay: tpl.series === 'price',
        multiInstance: false,
        inputsSchema() {
          return (tpl.calcParams || []).map((def, i) => ({
            key: 'p' + i, title: '参数 ' + (i + 1), type: 'number', default: def
          }));
        },
        defaultInputs() {
          const o = {};
          (tpl.calcParams || []).forEach((d, i) => { o['p' + i] = d; });
          return o;
        },
        create() {
          return {
            start(ctx, inputs) { this._ctx = ctx; this._inputs = inputs; this._run(); },
            onBars() { if (this._ctx) this._run(); },
            _run() {
              const ctx = this._ctx;
              if (!ctx) return;
              const bars = ctx.bars() || [];
              // calc 吃 klinecharts 形状 {timestamp,...}
              const biz = bars.map(b => ({ timestamp: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 }));
              const params = (tpl.calcParams || []).map((d, i) => this._inputs?.['p' + i] ?? d);
              let rows = [];
              try { rows = tpl.calc(biz, { params, calcParams: params }) || []; } catch (e) { console.warn('[vela-ind]', tpl.name, e?.message); }
              const ph = params.join('-').replace(/\./g, '_') || 'd';
              const series = [];
              for (const fig of (tpl.figures || [])) {
                if (!fig?.key) continue;
                try { series.push(figToSeries(tpl, fig, biz, rows, ph)); } catch (e) { console.warn('[vela-ind:fig]', tpl.name, fig.key, e?.message); }
              }
              ctx.emit({ series });
            }
          };
        }
      });
      n++;
    } catch (e) { console.warn('[vela-ind:reg]', tpl.name, e?.message); }
  }
  _registered = true;
  return n;
}

/* ---------------- D7：barstate.isconfirmed → not barstate.islast ---------------- */
/** 主线口径：末根（正在走的那根）不算确认。一行源码替换（P4-a 探针验证，见 COVERAGE §5 #13）。 */
export function preprocessPineV(src) {
  return String(src || '').replace(/barstate\.isconfirmed/g, 'not barstate.islast');
}

/* ---------------- D8：importResolver 接本项目「Pine 库」 ---------------- */
/** import 的 user/name/version → Pine 库条目源码；未命中返回 null（引擎报错原文透传 UI）。 */
export async function resolvePineImport(path) {
  try {
    const libs = await libList();
    const hit = (libs || []).find(x => x.path === path || x.name === path || `local/${x.name}/1` === path);
    if (hit) { const src = hit.src || (await kvGet('pine:lib:' + hit.id))?.src; if (src) return src; }
    const raw = await kvGet('pine:lib');
    const list = Array.isArray(raw) ? raw : [];
    const hit2 = list.find(x => x.path === path || x.name === path);
    return hit2 ? (hit2.src || null) : null;
  } catch { return null; }
}

/* ---------------- Pine 管理器（Vela 版） ---------------- */
/** 公开面 = 旧 pine.js 的 PineManager（apply/list/remove/compute/clear/symbol/findByIndName） */
export class PineManagerV {
  constructor(chart) {
    this.chart = chart;
    this.symbol = null;
    this.items = [];
    this._engine = null;
  }

  /** 注册 Pine 引擎（app.mount 后调一次；D8 resolver 接 Pine 库） */
  async ensureEngine() {
    if (this._engine || !this.chart) return this._engine;
    const { PineEngine } = V() || {};
    if (!PineEngine) return null;
    try {
      this._engine = new PineEngine({
        importResolver: async (path) => await resolvePineImport(path)
      });
      this.chart.registerEngine('pine', this._engine);
    } catch (e) { console.warn('[vela-ind:engine]', e?.message); }
    return this._engine;
  }

  list() { return this.items; }

  /** 编译/上图。entry = {id, name, src, inputs, lineStyles, overlay}，bars 参数兼容旧签名（忽略，Vela 自管数据） */
  async apply(entry) {
    if (!this.chart) return { ok: false, error: '图表未就绪' };
    await this.ensureEngine();
    const src = preprocessPineV(entry.src);
    try {
      const res = await this.chart.runScript(src, {
        id: entry.id || `pine${Date.now().toString(36)}`,
        ...(entry.inputs ? { inputs: entry.inputs } : {})
      });
      if (!res || res.ok === false) {
        return { ok: false, error: (res && (res.error?.message || res.error)) || 'runScript 失败' };
      }
      const names = (res.plots || []).map(p => p.title || p.id).filter(Boolean);
      const item = {
        id: res.id || entry.id,
        name: entry.name || 'PINE 指标',
        indName: 'PINE_' + (res.id || entry.id),
        names,
        overlay: (res.meta?.overlay ?? true),
        series: [],
        title: res.title || entry.name || 'PINE 指标'
      };
      this.items = this.items.filter(x => x.id !== item.id);
      this.items.push(item);
      return { ok: true, names, overlay: item.overlay, title: item.title, plots: res.plots || null, alerts: res.alerts || [] };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  /** 旧接口兼容：先编译返回元数据（不上图也可复用 apply） */
  async compute(entry) { return this.apply(entry); }

  async remove(id) {
    try {
      const h = (this.chart.indicators?.() || []).find(x => x.id === id);
      if (h) await h.remove?.();
    } catch {}
    this.items = this.items.filter(x => x.id !== id);
  }

  async clear() { for (const it of [...this.items]) await this.remove(it.id); }

  findByIndName(name) { return this.items.find(x => x.indName === name) || null; }
}
