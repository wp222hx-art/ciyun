// 每日波动：逐日一览、指数日涨跌、当日涨跌分布、桶 × 日矩阵，以及两次真实观测之间的报价变动
import * as sim from '../core/sim.js';
import * as market from '../core/market.js';
import { marketDays } from '../core/daily.js';
import { $, esc, fmtPx, fmtPct, fmtQty, fmtInt, fmtDay, fmtIso, dir, nowSec, REAL, SYN, COLOR } from '../ui.js';
import { makeChart } from '../chart.js';
import { $t } from '../i18n.js';

const prefs = { day: null, iv: null, hv: null };
const N = 30, COLS = 14, ROWS = 18;
const heat = (c, k) => (c == null ? 'transparent' : `rgba(${c >= 0 ? '246,70,93' : '14,203,129'},${Math.min(0.85, 0.16 + Math.abs(c) * k).toFixed(2)})`);
const BINS = [['≤ −3%', -Infinity, -0.03], ['−3% ~ −1%', -0.03, -0.01], ['−1% ~ 0', -0.01, 0], [$t("持平"), 0, 0], ['0 ~ +1%', 0, 0.01], ['+1% ~ +3%', 0.01, 0.03], ['≥ +3%', 0.03, Infinity]];

export function mount(el) {
  const S = market.state;
  const pool = S.insts.filter((i) => i.meets);
  const top = pool.filter((i) => i.main && i.variant === 'std').sort((a, b) => b.suppliers - a.suppliers).slice(0, ROWS);

  el.innerHTML = `
  <div class="page-head"><h2>${$t("每日波动")}</h2>
    <p>${$t("每天发生了什么，一天一格。上半部分是真实的：两次观测之间，哪些服务商确实调了价。下半部分是仿真成交的逐日涨跌，规则与K线相同——没有样本的日子留空，不算涨跌。")}</p></div>
  <section class="panel" style="margin-bottom:12px" id="real"></section>
  <section class="panel" style="margin-bottom:12px">
    <header><h3>${$t("逐日一览")}</h3>${SYN}<span class="sp"></span><span class="mute small">${$t("最近 {0} 天 · 颜色 = 综合参考指数当日涨跌 · 红涨绿跌 · 点击查看当天", N)}</span></header>
    <div class="daycells" id="cells"></div>
  </section>
  <div class="grid-2">
    <section class="panel"><header><h3>${$t("综合参考指数：每日涨跌幅")}</h3>${SYN}<span class="sp"></span><span class="mute small">${$t("相对上一日 · 成分 {0} 个桶", market.indices(nowSec()).all.members)}</span></header><div class="chart" id="d-chart"></div></section>
    <section class="panel" id="detail"></section>
  </div>
  <section class="panel" style="margin-bottom:12px" id="lists"></section>
  <section class="panel">
    <header><h3>${$t("桶 × 日 涨跌矩阵")}</h3>${SYN}<span class="sp"></span><span class="mute small">${$t("供应商最多的 {0} 个桶 · 最近 {1} 天", top.length, COLS)}</span></header>
    <div class="table-wrap" id="matrix"></div>
    <p class="pad mute small">${$t("日涨跌 = 当日收盘 ÷ 上一个已发布交易日的收盘 − 1。\"·\" 表示当天留空（无样本或未达发布门槛），不算涨跌，也不作为下一日的比较基准。最右一列是今天，盘中数值会变。全部为仿真成交，不是真实行情。")}</p>
  </section>`;

  const chart = makeChart($('#d-chart', el));
  const hist = chart.addHistogramSeries({ priceFormat: { type: 'custom', minMove: 0.01, formatter: (v) => `${v.toFixed(2)}%` }, priceLineVisible: false, lastValueVisible: false });

  function indexChanges(now) {
    const ix = market.indices(now).all;
    const pts = ix.series.map((p) => ({ d: p.d, v: p.v }));
    const cur = ix.now(now);
    if (cur != null) pts.push({ d: sim.dayIdxOf(now), v: cur });
    const m = new Map();
    for (let k = 1; k < pts.length; k++) m.set(pts[k].d, pts[k].v / pts[k - 1].v - 1);
    return m;
  }

  let fitted = false;
  function paint(now) {
    const today = sim.dayIdxOf(now);
    const days = marketDays(pool, now, N);
    const idx = indexChanges(now);
    if (prefs.day == null || !days.some((d) => d.d === prefs.day)) prefs.day = today;

    hist.setData([...idx].map(([d, c]) => ({ time: fmtDay(d), value: c * 100, color: c >= 0 ? COLOR.up : COLOR.down })));
    if (!fitted) { chart.timeScale().fitContent(); fitted = true; }

    $('#cells', el).innerHTML = days.map((d) => {
      const c = idx.get(d.d);
      return `<button type="button" data-day="${d.d}" class="${d.d === prefs.day ? 'on' : ''}" style="background:${c == null ? 'var(--panel2)' : heat(c, 70)}" title="${$t("{0}：上涨 {1} · 下跌 {2} · 留空 {3}", fmtDay(d.d), d.adv, d.dec, d.held + d.blank)}">${fmtDay(d.d).slice(5)}<small>${c == null ? '—' : fmtPct(c)}</small></button>`;
    }).join('');

    const day = days.find((d) => d.d === prefs.day);
    const c = idx.get(day.d);
    const live = day.d === today;
    const moved = day.rows.filter((r) => r.bar.pub && r.chg != null).sort((a, b) => b.chg - a.chg);
    const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
    $('#detail', el).innerHTML = `<header><h3>${fmtDay(day.d)}</h3>${live ? `<span class="ev ev-syn">${$t("盘中")}</span>` : ''}${SYN}</header><div class="pad">
      ${kv($t("综合参考指数当日涨跌"), `<span class="${dir(c)}">${fmtPct(c)}</span>`)}
      ${kv($t("上涨 / 下跌 / 持平"), `<span class="up">${day.adv}</span> / <span class="down">${day.dec}</span> / ${day.flat}`)}
      ${kv($t("当日留空的桶"), $t("{0}（未达门槛 {1} · 无样本 {2}）", day.held + day.blank, day.held, day.blank))}
      ${kv($t("公开交付量"), $t("{0} 百万Token", fmtQty(day.vol)))}
      ${kv($t("公开样本数"), $t("{0} 笔", fmtInt(day.samples)))}
      ${kv($t("当日在市的达标桶"), $t("{0} 个", day.rows.length))}
      <p class="hint">${$t("交付量与样本数只汇总当天发布了日线的桶；被抑制发布的样本不计入公开统计。")}</p></div>`;

    // 分箱：负区间左闭右开，正区间左开右闭，0 单独一箱；每个桶恰好落入一箱
    const inBin = (c, lo, hi) => (lo === 0 && hi === 0 ? c === 0 : hi <= 0 ? c >= lo && c < hi : c > lo && c <= hi);
    const counts = BINS.map(([, lo, hi]) => moved.filter((r) => inBin(r.chg, lo, hi)).length);
    const peak = Math.max(1, ...counts);
    const row = (r) => `<a href="#/trade/${encodeURIComponent(r.inst.id)}"><span>${esc(r.inst.name)}</span><span class="num ${dir(r.chg)}">${fmtPct(r.chg)}</span></a>`;
    $('#lists', el).innerHTML = `<header><h3>${$t("{0} 当日涨跌", fmtDay(day.d))}</h3>${SYN}<span class="sp"></span><span class="mute small">${$t("{0} 个桶有可比的日涨跌", moved.length)}</span></header>
      <div class="grid-half" style="margin:0">
        <div class="movers">${moved.length ? `<div><h4>${$t("涨幅前列")}</h4>${moved.slice(0, 8).map(row).join('')}</div><div><h4>${$t("跌幅前列")}</h4>${moved.slice(-8).reverse().map(row).join('')}</div>` : `<p class="empty" style="grid-column:1/-1">${$t("当天没有可比的日涨跌")}</p>`}</div>
        <div class="dist">${BINS.map(([name], k) => `<div><b>${counts[k]}</b><i style="height:${Math.round((counts[k] / peak) * 120)}px;background:${k < 3 ? COLOR.down : k === 3 ? COLOR.flat : COLOR.up}"></i>${name}</div>`).join('')}</div>
      </div>`;

    const cols = days.slice(-COLS).map((d) => ({ d: d.d, m: new Map(d.rows.map((r) => [r.inst.id, r])) }));
    $('#matrix', el).innerHTML = `<table class="tbl matrix"><thead><tr><th>${$t("模型 / 桶")}</th>${cols.map((x) => `<th>${fmtDay(x.d).slice(5)}</th>`).join('')}</tr></thead><tbody>
      ${top.map((i) => `<tr class="click" data-inst="${esc(i.id)}"><td title="${esc(i.name)} · ${esc(i.qLabel)}">${esc(i.name)}</td>${cols.map((x) => {
        const r = x.m.get(i.id);
        if (!r) return '<td class="mute"></td>';
        if (!r.bar.pub) return `<td class="mute" title="${esc(r.bar.why || $t("留空"))}">·</td>`;
        if (r.chg == null) return `<td class="mute" title="${$t("首个发布日，无比较基准")}">${$t("首日")}</td>`;
        return `<td class="cell" style="background:${heat(r.chg, 14)}" title="${$t("收 {0} · 样本 {1}", fmtPx(r.bar.c), r.bar.n)}">${(r.chg * 100).toFixed(1)}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>`;
  }

  // ---------- 真实报价变动 ----------
  let realKey = null;
  function paintReal() {
    realKey = S.catalogAt;
    const fx = S.fx.rate;
    const name = (id) => esc(S.modelById.get(id)?.name || id);
    const bar = (items) => `<div class="stats-bar" style="margin:10px 14px;border:0;padding:0;background:none">${items.map(([k, v]) => `<span>${k}<b>${v}</b></span>`).join('')}</div>`;
    const tabs = (list, key, cur) => (list.length > 1 ? `<div class="pad" style="padding-bottom:0"><div class="tabs">${list.map((x, k) => `<button type="button" data-${key}="${k}" class="${k === cur ? 'on' : ''}">${fmtIso(x).slice(5)}</button>`).join('')}</div></div>` : '');

    // 第一层：服务商调价（同一服务商、同一端点，两次端点快照之间）
    const H = S.history;
    let p1;
    if (!H.length) p1 = `<p class="empty">${$t("目前只有一份端点快照，还没有第二次可比。重新拍一次快照（npm run snapshot）后，这里显示两次之间的真实调价。")}</p>`;
    else {
      if (prefs.hv == null || prefs.hv >= H.length) prefs.hv = H.length - 1;
      const v = H[prefs.hv];
      const up = v.changes.filter((x) => x.b > x.a).length;
      p1 = `${tabs(H.map((x) => x.to), 'hv', prefs.hv)}
        ${bar([[$t("观测区间"), `${fmtIso(v.from)} → ${fmtIso(v.to)}`], [$t("比较的端点"), fmtInt(v.compared)], [$t("调价"), `${v.totalChanges}`], [$t("其中上调 / 下调"), `<span class="up">${up}</span> / <span class="down">${v.changes.length - up}</span>`], [$t("新增端点"), v.epAdded], [$t("下线端点"), v.epRemoved], [$t("新收录模型"), v.modelsAdded.length], [$t("下线模型"), v.modelsRemoved.length]])}
        ${v.changes.length ? `<div class="table-wrap"><table class="tbl dense"><thead><tr><th>${$t("模型")}</th><th>${$t("服务商")}</th><th>${$t("精度")}</th><th class="num">${$t("原固定篮子价")}</th><th class="num">${$t("现固定篮子价")}</th><th class="num">${$t("变动")}</th></tr></thead><tbody>
          ${v.changes.slice(0, 15).map((x) => `<tr><td>${name(x.id)}</td><td><a href="#/compute/${encodeURIComponent(x.p)}">${esc(x.p)}</a></td><td>${esc(x.q === 'unknown' ? $t("未声明") : x.q.toUpperCase())}</td><td class="num">${fmtPx(x.a * fx)}</td><td class="num">${fmtPx(x.b * fx)}</td><td class="num ${dir(x.b - x.a)}">${fmtPct(x.b / x.a - 1)}</td></tr>`).join('')}
          </tbody></table></div>${v.changes.length > 15 ? `<p class="pad mute small" style="padding-bottom:0">${$t("按变动幅度排序，显示前 15 个，共 {0} 个。", v.totalChanges)}</p>` : ''}` : `<p class="empty">${$t("这个区间内没有服务商调价。")}</p>`}`;
    }

    // 第二层：目录默认标价（实时），原因不唯一
    const obs = market.observations();
    let p2;
    if (obs.length < 2) p2 = `<p class="empty">${$t("实时目录还没有取到{0}。", S.catalogLive ? '' : $t("，稍后自动重试"))}</p>`;
    else {
      const ivs = [];
      for (let k = 1; k < obs.length; k++) ivs.push({ a: obs[k - 1], b: obs[k], ...market.diffBaskets(obs[k - 1].b, obs[k].b) });
      if (prefs.iv == null || prefs.iv >= ivs.length) prefs.iv = ivs.length - 1;
      const v = ivs[prefs.iv];
      p2 = `${tabs(ivs.map((x) => x.b.asOf), 'iv', prefs.iv)}
        ${bar([[$t("观测区间"), `${fmtIso(v.a.asOf)} → ${fmtIso(v.b.asOf)}`], [$t("默认标价不同的模型"), v.changed.length], [$t("新收录"), v.added.length], [$t("下线"), v.removed.length]])}
        ${v.changed.length ? `<div class="table-wrap"><table class="tbl dense"><thead><tr><th>${$t("模型")}</th><th class="num">${$t("原默认标价")}</th><th class="num">${$t("现默认标价")}</th><th class="num">${$t("差异")}</th></tr></thead><tbody>
          ${v.changed.slice(0, 8).map((x) => `<tr><td>${name(x.id)} <span class="mute small mono">${esc(x.id)}</span></td><td class="num">${x.before === 0 ? $t("免费") : fmtPx(x.before * fx)}</td><td class="num">${x.after === 0 ? $t("免费") : fmtPx(x.after * fx)}</td><td class="num ${dir(x.chg)}">${x.chg == null ? $t("免费 ↔ 收费") : fmtPct(x.chg)}</td></tr>`).join('')}
          </tbody></table></div>` : `<p class="empty">${$t("这个区间内默认标价没有变化。")}</p>`}`;
    }

    $('#real', el).innerHTML = `<header><h3>${$t("真实报价变动")}</h3>${REAL}<span class="mute small">${$t("两次真实观测之间的差异，不含任何合成数据")}</span></header>
      <h4 class="sub-h" style="margin:14px 14px 0">${$t("服务商调价")} <span class="mute small">${$t("同一模型、同一服务商、同一端点，前后两次端点快照")}</span></h4>${p1}
      <h4 class="sub-h" style="margin:18px 14px 0">${$t("目录默认标价")} <span class="mute small">${$t("实时目录对比上一次观测")}</span></h4>${p2}
      <p class="pad mute small">${$t("价格单位：元 / 百万Token（固定篮子）。两层的含义不同：上面一层是某家服务商确实改了价；下面一层是目录给每个模型标的默认价，它取自当时默认路由到的那家服务商，所以变了不一定是有人调价，也可能只是默认服务商换了一家。看算力中心的价格波动，以上面一层为准。端点快照每拍一次多一个观测区间，随站点一起发布，所有人看到的一样；默认标价的逐日记录只存在这台设备的浏览器里。")}</p>`;
  }

  el.addEventListener('click', (e) => {
    const d = e.target.closest('[data-day]');
    if (d) { prefs.day = Number(d.dataset.day); paint(nowSec()); return; }
    const v = e.target.closest('[data-iv]');
    if (v) { prefs.iv = Number(v.dataset.iv); paintReal(); return; }
    const h = e.target.closest('[data-hv]');
    if (h) { prefs.hv = Number(h.dataset.hv); paintReal(); return; }
    const i = e.target.closest('[data-inst]');
    if (i) location.hash = `#/trade/${encodeURIComponent(i.dataset.inst)}`;
  });

  paint(nowSec());
  paintReal();
  let n = 0;
  return {
    tick(now) {
      if (realKey !== S.catalogAt) paintReal();
      if (++n % 5 === 0) paint(now);
    },
    destroy() { chart.remove(); },
  };
}
