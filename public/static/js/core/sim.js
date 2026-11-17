// 市场机制仿真引擎（全部为确定性合成数据，以真实公开报价为锚）
// 规则来源：方案 §07（有观测才有蜡烛、无成交留空、单样本 OHLC 相同）与 §08（发布门槛、指数、缺失处理）
import { hashStr, mix, mulberry32, gauss, poisson } from './rng.js';
import { THRESHOLD } from './normalize.js';

export const DAY = 86400;
export const TZ = 8 * 3600;       // 交易日按北京时间切分
export const HIST_DAYS = 180;
export const FEE_RATE = 0.001;    // 仿真撮合手续费〔示例假设〕
export const GRACE_DAYS = 5;      // 指数缺失样本宽限期〔示例假设〕
const BURN = 40;                  // 序列预热天数，消除起点影响
const K_DAY = 0.25;               // 成交价向报价均值回归的日速度
export const INTRADAY_MIN = 60;   // 日均样本达到该密度才提供日内粒度（§07：样本密度满足后再评审更细粒度）

// 日内节律（北京时间午后最活跃）的累积分布，用于把当日样本分配到各分钟
const SEASON = (() => {
  const c = new Float64Array(1440);
  let s = 0;
  for (let m = 0; m < 1440; m++) { s += 0.35 + 1.25 * Math.exp(-((m / 60 - 15) ** 2) / 32); c[m] = s; }
  for (let m = 0; m < 1440; m++) c[m] /= s;
  return c;
})();
function pickMinute(u) {
  let lo = 0, hi = 1439;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (SEASON[mid] >= u) hi = mid; else lo = mid + 1; }
  return lo;
}

export const dayIdxOf = (sec) => Math.floor((sec + TZ) / DAY);
export const dayStart = (d) => d * DAY - TZ;
/** 周末样本减半（d 为日序号，0=1970-01-01 周四） */
export const dayFactor = (d) => { const dow = (d + 4) % 7; return dow === 0 || dow === 6 ? 0.45 : 1; };
/** 截至该时刻，当日样本按日内节律应已出现的比例 */
export const seasonCdf = (sec) => SEASON[Math.min(1439, Math.max(0, Math.floor((sec - dayStart(dayIdxOf(sec))) / 60)))];

/** 价格最小变动：保留 4 位有效数字 */
export function tickOf(p) {
  return Number(`1e${Math.floor(Math.log10(p)) - 3}`);
}
export const decimalsOf = (tick) => Math.max(0, -Math.round(Math.log10(tick)));
export const roundTick = (p, tick) => Number((Math.round(p / tick) * tick).toFixed(decimalsOf(tick)));

const pcache = new Map();
/** 每个可比桶的仿真参数：由桶 ID 种子与真实供应商数决定 */
export function params(inst) {
  let p = pcache.get(inst.id);
  if (p && p.anchor === inst.anchor) return p;
  const seed = hashStr(inst.id);
  const r = mulberry32(mix(seed, 1));
  const s = inst.suppliers;
  const tick = tickOf(inst.anchor);
  p = {
    anchor: inst.anchor, seed, tick, dec: decimalsOf(tick),
    lambda: 2.2 * s * s * (0.6 + r()),              // 日均成交样本数：供应越充分越活跃
    sigD: 0.005 + 0.012 * r() + 0.018 / Math.sqrt(s), // 日波动：供应越少越不稳
    cutRate: (1.2 + 2.8 * r()) / 180,               // 报价调整事件的日概率
    buyers: Math.round(4 + s * (1.5 + 3 * r())),    // 独立买方池
    notional: 150 + 900 * r(),                      // 单笔样本金额中位（元）
    disc: 0.04 * r(),                               // 成交相对公开报价的议价折扣
  };
  p.target = Math.log(inst.anchor * (1 - p.disc));
  pcache.set(inst.id, p);
  return p;
}

/** 是否提供日内粒度 */
export const hasIntraday = (inst) => inst.meets && params(inst).lambda >= INTRADAY_MIN;

/**
 * 报价对数路径。锚点固定在"真实报价观测日"（快照日）：
 * 观测日之前按事件日阶梯回溯（降价为主）；观测日之后保持不变——不虚构观测之后的报价变化。
 */
function quoteLogPath(inst, P, start, end) {
  const out = new Float64Array(end - start + 1);
  let q = Math.log(inst.anchor);
  for (let d = end; d >= start; d--) {
    out[d - start] = q;
    if (d > inst.anchorDay) continue;
    const r = mulberry32(mix(mix(P.seed, 77), d));
    // d 日发生调价：d-1 日是调价前的价格
    if (r() < P.cutRate) q += r() < 0.15 ? -Math.log(1.03 + 0.07 * r()) : -Math.log(1 - (0.05 + 0.17 * r()));
  }
  return out;
}

const distinct = (pool, n, r) => Math.max(1, Math.min(pool, n, Math.round(pool * (1 - Math.pow(1 - 1 / pool, n)) + r() - 0.5)));

function publishCheck(n, sup, buy) {
  if (n < THRESHOLD.samples) return `样本 ${n} 笔，不足 ${THRESHOLD.samples} 笔`;
  if (sup < THRESHOLD.suppliers) return `独立供应主体 ${sup} 家，不足 ${THRESHOLD.suppliers} 家`;
  if (buy < THRESHOLD.buyers) return `独立买方 ${buy} 个，不足 ${THRESHOLD.buyers} 个`;
  return null;
}

const dcache = new Map();
/**
 * 日线。序列起点固定（相对报价观测日），因此任何一天的日线都与"今天是哪天"无关：
 * 换日后历史不会变化。返回 days（已完结交易日）与 target（今日全天结果，仅供日内分解，界面不直接展示）。
 */
export function daily(inst, today) {
  let c = dcache.get(inst.id);
  if (c && c.today === today && c.anchor === inst.anchor) return c;
  const P = params(inst);
  const first = Math.min(inst.anchorDay, Math.max(inst.anchorDay - HIST_DAYS, inst.listedDay ?? -Infinity));
  const start = first - BURN;
  const end = Math.max(today, inst.anchorDay);
  const qp = quoteLogPath(inst, P, start, end);
  const shift = Math.log(1 - P.disc);
  let x = qp[0] + shift;
  let prevC = roundTick(Math.exp(x), P.tick);
  let prevClose = prevC;
  let target = null;
  const days = [];
  for (let d = start; d <= today; d++) {
    const r = mulberry32(mix(mix(P.seed, 13), d));
    x += K_DAY * (qp[d - start] + shift - x) + P.sigD * gauss(r);
    const cl = roundTick(Math.exp(x), P.tick);
    if (d < first) { prevC = cl; continue; }
    if (d === today) prevClose = prevC;
    const n = poisson(r, P.lambda * dayFactor(d) * (0.7 + 0.6 * r()));
    let bar;
    if (n === 0) bar = { d, n: 0, pub: false, why: '无成交样本' };
    else {
      let o = roundTick(prevC * Math.exp(0.25 * P.sigD * gauss(r)), P.tick);
      let h = Math.max(o, cl), l = Math.min(o, cl);
      if (n === 1) { o = h = l = cl; } // 单样本：OHLC 相同
      else if (n >= 3) {
        const eh = roundTick(h * Math.exp(Math.abs(gauss(r)) * P.sigD * 0.55), P.tick);
        const el = roundTick(l * Math.exp(-Math.abs(gauss(r)) * P.sigD * 0.55), P.tick);
        // 3 笔样本只有 1 笔处于首尾之间，只能再触及一个极值
        if (n >= 4) { h = eh; l = el; } else if (r() < 0.5) h = eh; else l = el;
      }
      const v = Math.max(n, Math.round((n * P.notional * Math.exp(0.35 * gauss(r))) / cl));
      const sup = distinct(inst.suppliers, n, r);
      const buy = distinct(P.buyers, n, r);
      const why = publishCheck(n, sup, buy);
      bar = { d, o, h, l, c: cl, v, n, sup, buy, pub: !why, why };
      prevC = cl;
    }
    if (d === today) target = bar; else days.push(bar);
  }
  c = { today, anchor: inst.anchor, days, target, prevClose, first, qp, qpStart: start };
  dcache.set(inst.id, c);
  return c;
}

/** 报价视图序列：最低合格报价与报价中位。只有观测日一点为真实值，之前为合成回溯，之后沿用（陈旧） */
export function quoteSeries(inst, today) {
  const D = daily(inst, today);
  const P = params(inst);
  const out = [];
  for (let d = D.first; d <= today; d++) {
    const min = Math.exp(D.qp[d - D.qpStart]);
    if (d >= inst.anchorDay) { out.push({ d, min: inst.anchor, med: inst.anchor * inst.medRatio, real: d === inst.anchorDay, stale: d > inst.anchorDay }); continue; }
    const wob = mulberry32(mix(mix(P.seed, 91), Math.floor(d / 14)))();
    out.push({ d, min, med: min * (1 + (inst.medRatio - 1) * (0.8 + 0.4 * wob)), real: false, stale: false });
  }
  return out;
}

/**
 * 把一根日线分解为逐笔样本（确定性）：首笔 = 开、末笔 = 收、必触及高与低、数量合计 = 日交付量。
 * 因此盘中聚合到收盘时与该日日线完全一致，任何历史日的分钟线也可按需重建。
 */
export function dayTrades(inst, bar) {
  const n = bar?.n || 0;
  if (!n) return [];
  const P = params(inst);
  const r = mulberry32(mix(mix(P.seed, 29), bar.d));
  const base = dayStart(bar.d);
  const ts = new Float64Array(n);
  for (let i = 0; i < n; i++) ts[i] = base + pickMinute(r()) * 60 + Math.floor(r() * 60000) / 1000;
  ts.sort();
  const px = new Array(n);
  if (n === 1) px[0] = bar.c;
  else if (n === 2) { px[0] = bar.o; px[1] = bar.c; }
  else {
    const lo = Math.log(bar.o), lc = Math.log(bar.c), lh = Math.log(bar.h), ll = Math.log(bar.l);
    const e = new Float64Array(n);
    let s = 0;
    for (let i = 1; i < n; i++) { s += gauss(r); e[i] = s; }
    const tail = e[n - 1];
    let aP = Infinity, aN = Infinity;
    for (let i = 1; i < n - 1; i++) {
      e[i] -= (i / (n - 1)) * tail; // 布朗桥：首尾偏离为 0
      const L = lo + ((lc - lo) * i) / (n - 1);
      if (e[i] > 0) aP = Math.min(aP, (lh - L) / e[i]);
      else if (e[i] < 0) aN = Math.min(aN, (L - ll) / -e[i]);
    }
    for (let i = 1; i < n - 1; i++) {
      const L = lo + ((lc - lo) * i) / (n - 1);
      const dev = e[i] > 0 ? aP * e[i] : e[i] < 0 ? aN * e[i] : 0;
      px[i] = Math.min(bar.h, Math.max(bar.l, roundTick(Math.exp(L + dev), P.tick)));
    }
    px[0] = bar.o; px[n - 1] = bar.c;
    // 极值必须由首尾之间的样本触及（四舍五入后可能差一个最小变动，这里兜底）
    const needH = bar.h > Math.max(bar.o, bar.c), needL = bar.l < Math.min(bar.o, bar.c);
    let hIdx = -1;
    if (needH) {
      for (let i = 1; i < n - 1; i++) if (px[i] === bar.h) { hIdx = i; break; }
      if (hIdx < 0) { hIdx = 1; for (let i = 2; i < n - 1; i++) if (px[i] > px[hIdx]) hIdx = i; px[hIdx] = bar.h; }
    }
    if (needL) {
      let lIdx = -1;
      for (let i = 1; i < n - 1; i++) if (i !== hIdx && px[i] === bar.l) { lIdx = i; break; }
      if (lIdx < 0) {
        for (let i = 1; i < n - 1; i++) if (i !== hIdx && (lIdx < 0 || px[i] < px[lIdx])) lIdx = i;
        if (lIdx > 0) px[lIdx] = bar.l;
      }
    }
  }
  const w = new Float64Array(n);
  let tot = 0;
  for (let i = 0; i < n; i++) { w[i] = Math.exp(0.9 * gauss(r)); tot += w[i]; }
  const extra = bar.v - n;
  const out = new Array(n);
  let acc = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    acc += w[i];
    const cum = i === n - 1 ? extra : Math.round((extra * acc) / tot);
    out[i] = { t: ts[i], p: px[i], q: 1 + cum - prev, u: r() };
    prev = cum;
  }
  return out;
}

function applyBar(bars, tr) {
  const m = Math.floor(tr.t / 60);
  let b = bars[bars.length - 1];
  if (!b || b.m !== m) { b = { m, t: m * 60, o: tr.p, h: tr.p, l: tr.p, c: tr.p, v: 0, amt: 0, n: 0 }; bars.push(b); }
  b.h = Math.max(b.h, tr.p); b.l = Math.min(b.l, tr.p); b.c = tr.p;
  b.v += tr.q; b.amt += tr.q * tr.p; b.n++;
}

function apply(st, tr) {
  applyBar(st.bars, tr);
  if (st.n === 0) { st.o = st.h = st.l = tr.p; }
  st.h = Math.max(st.h, tr.p); st.l = Math.min(st.l, tr.p);
  st.v += tr.q; st.amt += tr.q * tr.p; st.n++;
  tr.side = tr.p > st.last ? 'buy' : tr.p < st.last ? 'sell' : tr.u < 0.5 ? 'buy' : 'sell';
  st.last = tr.p;
  st.tape.push(tr);
  if (st.tape.length > 160) st.tape.splice(0, 80);
}

const lcache = new Map();
/** 今日盘中状态：分钟线、逐笔、当日聚合。只展开到当前时刻，刷新页面结果一致 */
export function live(inst, nowSec) {
  const today = dayIdxOf(nowSec);
  let st = lcache.get(inst.id);
  // 被问到比已展开位置更早的时刻（时钟回拨、乱序查询）时重建，保证结果只取决于 nowSec
  const rewound = st && st.pi > 0 && st.all[st.pi - 1].t > nowSec;
  if (!st || st.day !== today || st.anchor !== inst.anchor || rewound) {
    const D = daily(inst, today);
    st = {
      day: today, anchor: inst.anchor, base: dayStart(today), all: dayTrades(inst, D.target), pi: 0,
      last: D.prevClose, prevClose: D.prevClose, bars: [], o: null, h: null, l: null, v: 0, amt: 0, n: 0, tape: [],
    };
    lcache.set(inst.id, st);
  }
  while (st.pi < st.all.length && st.all[st.pi].t <= nowSec) apply(st, st.all[st.pi++]);
  return st;
}

/** 区间 (t0, t1] 内的仿真成交，用于撮合用户挂单 */
export function tradesBetween(inst, t0, t1) {
  const st = live(inst, t1);
  const out = [];
  for (let i = st.pi - 1; i >= 0 && st.all[i].t > t0; i--) if (st.all[i].t <= t1) out.push(st.all[i]);
  return out.reverse();
}

const mcache = new Map();
/** 最近若干日的分钟线（历史日由日线分解重建，今日取盘中状态） */
export function minuteBars(inst, nowSec, daysBack = 2) {
  const st = live(inst, nowSec);
  const D = daily(inst, st.day);
  let out = [];
  for (let d = st.day - daysBack; d < st.day; d++) {
    const bar = D.days[d - D.first];
    if (!bar || !bar.n) continue;
    const key = `${inst.id}|${d}|${inst.anchor}`;
    let bars = mcache.get(key);
    if (!bars) {
      bars = [];
      for (const tr of dayTrades(inst, bar)) applyBar(bars, tr);
      if (mcache.size > 24) mcache.delete(mcache.keys().next().value);
      mcache.set(key, bars);
    }
    out = out.concat(bars);
  }
  return out.concat(st.bars);
}

/** 今日日线：盘中聚合，同样受发布门槛约束；收盘时与该日日线完全一致 */
export function todayCandle(inst, nowSec) {
  const st = live(inst, nowSec);
  if (!st.n) return { d: st.day, n: 0, pub: false, why: '今日暂无成交样本', live: true };
  const P = params(inst);
  const T = daily(inst, st.day).target;
  const sofar = (pool, final) => (st.n >= T.n ? final : Math.min(final, Math.max(1, Math.round(pool * (1 - Math.pow(1 - 1 / pool, st.n))))));
  const sup = sofar(inst.suppliers, T.sup);
  const buy = sofar(P.buyers, T.buy);
  const why = publishCheck(st.n, sup, buy);
  return { d: st.day, o: st.o, h: st.h, l: st.l, c: st.last, v: st.v, amt: st.amt, n: st.n, sup, buy, pub: !why, why, live: true };
}

/** 行情列表摘要 */
export function summary(inst, nowSec) {
  const st = live(inst, nowSec);
  return {
    last: st.last, prev: st.prevClose, chg: st.last / st.prevClose - 1,
    o: st.o, h: st.h, l: st.l, v: st.v, amt: st.amt, n: st.n,
  };
}

export function sparkOf(inst, nowSec, n = 30) {
  const D = daily(inst, dayIdxOf(nowSec));
  const xs = [];
  for (let i = D.days.length - 1; i >= 0 && xs.length < n - 1; i--) if (D.days[i].pub) xs.push(D.days[i].c);
  xs.reverse();
  xs.push(live(inst, nowSec).last);
  return xs;
}

export function weekly(days) {
  const out = [];
  for (const b of days) {
    if (!b.pub) continue;
    const wk = Math.floor((b.d + 3) / 7);
    const w = out[out.length - 1];
    if (!w || w.wk !== wk) out.push({ wk, d: b.d, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: b.n, pub: true });
    else { w.h = Math.max(w.h, b.h); w.l = Math.min(w.l, b.l); w.c = b.c; w.v += b.v; w.n += b.n; }
  }
  return out;
}

/** 分钟线合并为 N 分钟线，按北京时间整点对齐 */
export function groupMinutes(bars, size) {
  if (size <= 1) return bars;
  const span = size * 60;
  const out = [];
  for (const b of bars) {
    const k = Math.floor((b.t + TZ) / span);
    const g = out[out.length - 1];
    if (!g || g.k !== k) out.push({ k, t: k * span - TZ, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, amt: b.amt, n: b.n });
    else { g.h = Math.max(g.h, b.h); g.l = Math.min(g.l, b.l); g.c = b.c; g.v += b.v; g.amt += b.amt; g.n += b.n; }
  }
  return out;
}

// ---------- 仿真盘口 ----------
const eaten = new Map(); // 用户吃掉的档位：`${id}|${slot}|${side}|${price}` → 数量
const SLOT = 3;

export function book(inst, nowSec, levels = 10) {
  const P = params(inst);
  const st = live(inst, nowSec);
  const slot = Math.floor(nowSec / SLOT);
  const r = mulberry32(mix(mix(P.seed, 0xb00c), slot));
  const half = Math.max(1, Math.round((st.last * (0.0008 + 0.012 / inst.suppliers)) / P.tick / 2));
  const depth = P.notional * (1 + inst.suppliers / 4);
  const side = (dir, name) => {
    const out = [];
    let px = st.last + dir * half * P.tick;
    for (let i = 0; i < levels; i++) {
      const p = roundTick(px, P.tick);
      if (p <= 0) break;
      const raw = Math.max(1, Math.round((depth * (0.4 + 1.6 * r()) * (1 + 0.25 * i)) / p));
      const q = raw - (eaten.get(`${inst.id}|${slot}|${name}|${p}`) || 0);
      if (q > 0) out.push({ p, q });
      px += dir * (1 + Math.floor(r() * 3)) * P.tick;
    }
    return out;
  };
  const asks = side(1, 'ask');
  const bids = side(-1, 'bid');
  return { asks, bids, last: st.last, tick: P.tick, slot };
}

/** 记录用户成交吃掉的盘口量，本档位刷新前不再重复可用 */
export function eatBook(inst, nowSec, side, fills) {
  const slot = Math.floor(nowSec / SLOT);
  const name = side === 'buy' ? 'ask' : 'bid';
  for (const f of fills) {
    const k = `${inst.id}|${slot}|${name}|${f.p}`;
    eaten.set(k, (eaten.get(k) || 0) + f.q);
  }
  if (eaten.size > 400) for (const k of eaten.keys()) if (Number(k.split('|')[1]) < slot) eaten.delete(k);
}

// ---------- 研究性参考指数 ----------
/**
 * 固定样本篮子的加权价格相对数：基期 = 100，等品牌组权重、组内等权。
 * 缺失样本沿用最近发布值，超过宽限期则当日剔除；不达门槛的日子不参与。
 * base 为固定基期日，不随查看日期滚动。
 */
export function buildIndex(insts, today, base) {
  const days = today - base;
  const members = [];
  for (const inst of insts) {
    const D = daily(inst, today);
    const vals = new Array(days).fill(null);
    let lastV = null, lastD = -Infinity;
    for (const b of D.days) {
      if (b.pub) { lastV = b.c; lastD = b.d; }
      if (b.d >= base && lastV != null && b.d - lastD <= GRACE_DAYS) vals[b.d - base] = lastV;
    }
    if (vals[0] == null) continue; // 基期无有效发布值 → 不入篮
    members.push({ inst, base: vals[0], vals });
  }
  const groups = new Map();
  for (const m of members) {
    if (!groups.has(m.inst.brand)) groups.set(m.inst.brand, []);
    groups.get(m.inst.brand).push(m);
  }
  const level = (pick) => {
    let sum = 0, g = 0;
    for (const list of groups.values()) {
      let s = 0, k = 0;
      for (const m of list) { const v = pick(m); if (v != null) { s += v / m.base; k++; } }
      if (k) { sum += s / k; g++; }
    }
    return g ? (100 * sum) / g : null;
  };
  const series = [];
  for (let i = 0; i < days; i++) {
    const v = level((m) => m.vals[i]);
    if (v != null) series.push({ d: base + i, v });
  }
  return {
    series, members: members.length, groups: groups.size, base,
    now: (nowSec) => level((m) => live(m.inst, nowSec).last),
  };
}

/** 单合格任务有效成本 =（单次推理成本 + 单次复核成本）÷ 合格率；合格率为 0 时不可计算（§06） */
export function taskCost({ inCny, outCny, inTok, outTok, pass, review }) {
  if (!(pass > 0)) return null;
  const infer = (inTok * inCny + outTok * outCny) / 1e6;
  return (infer + review) / pass;
}
