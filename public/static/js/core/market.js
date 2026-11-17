// 市场数据层：真实公开目录 → 可比桶 → 仿真品种
// 真实部分：模型、版本、分项费率、供应商、精度、可用率、汇率
// 合成部分：成交、盘口、历史走势（由 sim.js 以真实报价为锚生成）
import { buildBuckets, basket, precisionLabel, eligible } from './normalize.js';
import { dayIdxOf, buildIndex, summary, params, seasonCdf, dayFactor } from './sim.js';
import { hashStr, mulberry32, mix } from './rng.js';

export const INDEX_BASE_DAYS = 90;

/** 国产模型品牌。公开目录没有"归属地"字段，这份名单是人工标注 */
export const CN_BRANDS = new Set(['deepseek', 'qwen', 'z-ai', 'moonshotai', 'minimax', 'tencent', 'baidu', 'bytedance', 'bytedance-seed', 'xiaomi', 'stepfun', 'meituan', 'inclusionai']);

/** 目录级固定篮子价（美元/百万Token）：只含精确版本 */
export function basketMap(models) {
  const m = new Map();
  for (const x of models) { if (x.kind !== 'model') continue; const b = basket(x.usd); if (b != null) m.set(x.id, b); }
  return m;
}

/** 两次真实观测之间的报价变动 */
export function diffBaskets(prev, cur) {
  const P = prev instanceof Map ? prev : new Map(Object.entries(prev));
  const C = cur instanceof Map ? cur : new Map(Object.entries(cur));
  const added = [], removed = [], changed = [];
  for (const [id, v] of C) {
    if (!P.has(id)) { added.push(id); continue; }
    const b = P.get(id);
    if (b > 0 && v > 0) { if (Math.abs(v / b - 1) > 1e-9) changed.push({ id, before: b, after: v, chg: v / b - 1 }); }
    else if (b !== v) changed.push({ id, before: b, after: v, chg: null });
  }
  for (const id of P.keys()) if (!C.has(id)) removed.push(id);
  changed.sort((x, y) => Math.abs(y.chg ?? 9) - Math.abs(x.chg ?? 9));
  return { added, removed, changed };
}

export const state = {
  ready: false,
  snapshotAt: null,      // 端点快照时间
  catalogAt: null,       // 模型目录时间
  catalogLive: false,    // 目录是否为实时拉取
  fx: null,
  models: [],
  modelById: new Map(),
  providers: [],
  providerByName: new Map(),
  insts: [],
  instById: new Map(),
  instsByModel: new Map(),
  centers: [],
  centerByName: new Map(),
  indices: null,
};

const cny = (usd, fx) => (usd == null ? null : usd * fx);
const ratesCny = (usd, fx) => ({ in: cny(usd.in, fx), out: cny(usd.out, fx), cr: cny(usd.cr, fx), cw: cny(usd.cw, fx) });

function buildInstruments(models, endpoints, fx, anchorDay) {
  const insts = [];
  for (const m of models) {
    if (m.kind !== 'model') continue;
    const buckets = buildBuckets(endpoints[m.id] || []);
    buckets.forEach((b, i) => {
      // 主桶必入；其余桶须达到供应商门槛才单独成序列
      if (i > 0 && !b.meets) return;
      const quotes = b.quotes.map((e) => ({
        p: e.p, q: e.q, ctx: e.ctx, maxOut: e.maxOut, up1d: e.up1d, st: e.st, cache: e.cache,
        ok: eligible(e), cny: ratesCny(e.usd, fx), basket: e.basketUsd * fx,
      }));
      const anchorQ = quotes.find((x) => x.p === b.anchorProvider) || quotes[0];
      insts.push({
        id: `${m.id}@${b.q}`,
        modelId: m.id, model: m, name: m.name, brand: m.brand,
        q: b.q, qLabel: precisionLabel(b.q), variant: m.variant, open: !!m.hf, main: i === 0,
        suppliers: b.suppliers, eligibleSuppliers: b.eligibleSuppliers, meets: b.meets,
        anchor: b.anchorUsd * fx, anchorProvider: b.anchorProvider,
        minCny: b.minUsd * fx, maxCny: b.maxUsd * fx, medCny: b.medianUsd * fx,
        medRatio: b.medianUsd / b.anchorUsd,
        dispersion: b.maxUsd / b.minUsd - 1,
        inCny: anchorQ.cny.in, outCny: anchorQ.cny.out,
        quotes,
        listedDay: m.created ? dayIdxOf(m.created) : null,
        anchorDay, // 真实报价的观测日（快照日）
      });
    });
  }
  return insts;
}

/** 算力中心（推理服务商）画像：全部来自真实公开端点 */
function buildCenters(insts, providers) {
  const map = new Map();
  const meta = new Map(providers.map((p) => [p.name, p]));
  for (const inst of insts) {
    for (const quote of inst.quotes) {
      let c = map.get(quote.p);
      if (!c) {
        const info = meta.get(quote.p);
        c = { name: quote.p, hq: info?.hq || null, dcs: info?.dcs || [], listed: !!info, rows: [], brands: new Set(), precisions: new Map() };
        map.set(quote.p, c);
      }
      c.rows.push({ inst, quote, premium: quote.basket / inst.minCny - 1, rank: inst.quotes.indexOf(quote) + 1 });
      c.brands.add(inst.brand);
      c.precisions.set(inst.q, (c.precisions.get(inst.q) || 0) + 1);
    }
  }
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); const k = s.length >> 1; return s.length ? (s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2) : null; };
  const centers = [];
  for (const c of map.values()) {
    const contested = c.rows.filter((r) => r.inst.suppliers > 1);
    const ups = c.rows.map((r) => r.quote.up1d).filter((x) => x != null);
    centers.push({
      ...c,
      brands: [...c.brands],
      precisions: [...c.precisions.entries()].sort((a, b) => b[1] - a[1]),
      n: c.rows.length,
      contested: contested.length,
      // 报价溢价率：在有竞争的桶里，相对该桶最低报价的中位溢价
      premium: contested.length ? med(contested.map((r) => r.premium)) : null,
      cheapest: contested.filter((r) => r.rank === 1).length,
      uptime: ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : null,
      degraded: c.rows.filter((r) => r.quote.st !== 0).length,
      medBasket: med(c.rows.map((r) => r.quote.basket)),
    });
  }
  centers.sort((a, b) => b.n - a.n);
  return centers;
}

function rebuild(models, endpoints, fx, anchorDay) {
  state.models = models;
  state.modelById = new Map(models.map((m) => [m.id, m]));
  state.anchorDay = anchorDay;
  state.insts = buildInstruments(models, endpoints, fx, anchorDay);
  state.instById = new Map(state.insts.map((i) => [i.id, i]));
  state.instsByModel = new Map();
  for (const i of state.insts) {
    if (!state.instsByModel.has(i.modelId)) state.instsByModel.set(i.modelId, []);
    state.instsByModel.get(i.modelId).push(i);
  }
  for (const m of models) {
    const list = state.instsByModel.get(m.id);
    m.suppliers = list ? Math.max(...list.map((i) => i.suppliers)) : 0;
    m.basketCny = (() => { const b = basket(m.usd); return b == null ? null : b * fx; })();
    m.cny = ratesCny(m.usd, fx);
  }
  state.centers = buildCenters(state.insts, state.providers);
  state.centerByName = new Map(state.centers.map((c) => [c.name, c]));
  state.indices = null;
}

export async function load() {
  const res = await fetch('/static/data/snapshot.json');
  if (!res.ok) throw new Error(`快照加载失败（HTTP ${res.status}）`);
  const snap = await res.json();
  state.snapshotAt = snap.asOf;
  state.catalogAt = snap.asOf;
  state.fx = snap.fx;
  state.providers = snap.providers;
  state.providerByName = new Map(snap.providers.map((p) => [p.name, p]));
  state.endpoints = snap.endpoints;
  state.snapBasket = basketMap(snap.models); // 快照时刻的真实报价，用于与实时目录比较
  state.catalogDiff = null;
  state.history = [];
  try {
    const h = await fetch('/static/data/history.json');
    if (h.ok) { const j = await h.json(); if (Array.isArray(j.intervals)) state.history = j.intervals; }
  } catch { /* 没有历史文件：只有一次端点快照 */ }
  rebuild(snap.models, snap.endpoints, snap.fx.rate, dayIdxOf(Date.parse(snap.asOf) / 1000));
  state.ready = true;
  return state;
}

/**
 * 后台刷新模型目录（经 Worker 代理实时拉取）。
 * 只更新"模型图谱"的目录字段；仿真品种的锚定报价在本次会话内保持不变，
 * 否则历史序列会整体平移，导致持仓盈亏出现与市场无关的跳变。
 */
export async function refreshCatalog() {
  try {
    const res = await fetch('/api/catalog');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body.models) || !body.models.length) throw new Error('目录为空');
    const fx = state.fx.rate;
    let added = 0, repriced = 0;
    // /api/catalog 返回的已是归一后的模型，这里不能再归一一次（否则字段全部丢失）
    for (const m of body.models) {
      if (!m || typeof m.id !== 'string' || !m.usd) continue;
      const old = state.modelById.get(m.id);
      const b = basket(m.usd);
      m.basketCny = b == null ? null : b * fx;
      m.cny = ratesCny(m.usd, fx);
      if (!old) { m.suppliers = 0; m.fresh = true; state.models.unshift(m); state.modelById.set(m.id, m); added++; continue; }
      if (old.usd.in !== m.usd.in || old.usd.out !== m.usd.out) repriced++;
      Object.assign(old, m, { suppliers: old.suppliers });
    }
    state.catalogAt = body.asOf;
    state.catalogLive = true;
    const cur = basketMap(body.models);
    saveObs(body.asOf, cur);
    state.catalogDiff = { asOf: body.asOf, ...diffBaskets(state.snapBasket, cur) };
    return { ok: true, added, repriced, total: body.models.length };
  } catch (e) {
    state.catalogLive = false;
    return { ok: false, error: String(e.message || e) };
  }
}

/** 单个模型的实时供应商报价（按需拉取，用于终端"供应商报价"面板） */
export async function fetchLiveQuotes(modelId) {
  const res = await fetch(`/api/endpoints?id=${encodeURIComponent(modelId)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  const fx = state.fx.rate;
  const buckets = buildBuckets(body.endpoints || []);
  return {
    asOf: body.asOf,
    buckets: buckets.map((b) => ({
      q: b.q,
      quotes: b.quotes.map((e) => ({
        p: e.p, q: e.q, ctx: e.ctx, up1d: e.up1d, st: e.st, cache: e.cache, ok: eligible(e),
        cny: ratesCny(e.usd, fx), basket: e.basketUsd * fx,
      })),
    })),
  };
}

const OBS_KEY = 'zjt.obs.v1';
function readObs() {
  try { const r = JSON.parse(localStorage.getItem(OBS_KEY)); if (Array.isArray(r)) return r; } catch { /* 无存储 */ }
  return [];
}
/** 每个北京日保留最后一次实时目录观测，最多 10 天 */
function saveObs(asOf, map) {
  const day = dayIdxOf(Date.parse(asOf) / 1000);
  const list = readObs().filter((o) => o.day !== day);
  list.push({ day, asOf, b: Object.fromEntries(map) });
  list.sort((a, b) => a.day - b.day);
  try { localStorage.setItem(OBS_KEY, JSON.stringify(list.slice(-10))); } catch { /* 存不下就只保留本次会话 */ }
}
/** 真实观测序列：离线快照 + 本机此后每天的实时目录。相邻两次之间的差异就是真实的报价变动 */
export function observations() {
  const snapAt = Date.parse(state.snapshotAt);
  const out = [{ asOf: state.snapshotAt, kind: '离线快照', b: state.snapBasket }];
  for (const o of readObs()) if (Date.parse(o.asOf) > snapAt) out.push({ asOf: o.asOf, kind: '实时目录', b: new Map(Object.entries(o.b)) });
  return out;
}

/** 研究性参考指数：只纳入达到供应商门槛的主桶 */
export function indices(nowSec) {
  const today = dayIdxOf(nowSec);
  if (state.indices && state.indices.today === today) return state.indices;
  const pool = state.insts.filter((i) => i.meets && i.main && i.variant === 'std');
  const base = state.anchorDay - INDEX_BASE_DAYS; // 固定基期
  state.indices = {
    today, base,
    all: buildIndex(pool, today, base),
    open: buildIndex(pool.filter((i) => i.open), today, base),
    closed: buildIndex(pool.filter((i) => !i.open), today, base),
    cn: buildIndex(pool.filter((i) => CN_BRANDS.has(i.brand)), today, base),
  };
  return state.indices;
}

/** 供需景气指标：今日已出现样本数 ÷ 按日内节律应出现的样本数 × 100 */
export function prosperity(nowSec) {
  const share = Math.max(0.002, seasonCdf(nowSec)) * dayFactor(dayIdxOf(nowSec));
  let got = 0, exp = 0;
  for (const i of state.insts) {
    if (!i.meets) continue;
    got += summary(i, nowSec).n;
    exp += params(i).lambda * share;
  }
  return exp ? (100 * got) / exp : null;
}

// ---------- 评测（合成）----------
export const TASKS = [
  { id: 'kb', name: '售后知识问答', inTok: 3200, outTok: 520, review: 0.012, floor: 0.9, note: '带来源追溯的技术问答' },
  { id: 'extract', name: '合同条款抽取', inTok: 9000, outTok: 900, review: 0.03, floor: 0.93, note: '长文档结构化抽取' },
  { id: 'code', name: '代码评审建议', inTok: 6000, outTok: 1400, review: 0.02, floor: 0.88, note: '变更集审阅与建议' },
];

/**
 * 合成合格率：没有真实评测数据，仅为演示"单合格任务有效成本"的计算机制。
 * 由模型 ID 与任务 ID 种子确定，贵的模型略高，但不代表任何真实测评结论。
 */
export function passRate(inst, task) {
  const r = mulberry32(mix(hashStr(inst.modelId), hashStr(task.id)));
  const tier = Math.max(0, Math.min(1, (Math.log10(Math.max(inst.anchor, 0.1)) + 1) / 3.6));
  return Math.min(0.985, 0.74 + 0.16 * tier + 0.09 * r());
}

export const flagOf = (cc) => {
  if (!cc || cc.length !== 2) return '';
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
};

export const REGION_NAME = {
  US: '美国', CN: '中国', SG: '新加坡', FI: '芬兰', KR: '韩国', IS: '冰岛', ES: '西班牙', NL: '荷兰', ID: '印尼',
  AU: '澳大利亚', JP: '日本', IN: '印度', DE: '德国', IL: '以色列', GB: '英国', FR: '法国', SE: '瑞典', CA: '加拿大',
  IE: '爱尔兰', CH: '瑞士', NO: '挪威', AE: '阿联酋', HK: '中国香港', TW: '中国台湾',
};
export const regionName = (cc) => REGION_NAME[cc] || cc || '未披露';
