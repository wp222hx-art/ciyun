// 算力中心：推理服务商的真实公开报价画像、跨中心价差、报价走势（合成回溯）与供给成本算例
import * as sim from '../core/sim.js';
import * as market from '../core/market.js';
import { $, $$, esc, fmtPx, fmtPct, fmtNum, fmtDay, fmtIso, ago, dir, debounce, nowSec, REAL, SYN, tag, COLOR } from '../ui.js';
import { makeChart, addLine } from '../chart.js';
import { $t } from '../i18n.js';

const prefs = { q: '', sort: 'n', desc: true };
const COLS = [['name', $t("算力中心"), 0], ['n', $t("服务桶数"), 1], ['brands', $t("覆盖品牌"), 1], ['cheapest', $t("报最低价的桶"), 1], ['premium', $t("报价溢价中位"), 1], ['uptime', $t("平均可用率"), 1], ['degraded', $t("降级端点"), 1]];
const IDX_FMT = { type: 'price', precision: 2, minMove: 0.01 };
const BACK = 90;

const where = (c) => `${c.hq ? `${market.flagOf(c.hq)} ${esc(market.regionName(c.hq))}` : `<span class="mute">${$t("总部未披露")}</span>`}${c.dcs.length ? ` ${$t("· 机房")} ${c.dcs.map((d) => esc(market.regionName(d))).join($t("、"))}` : ''}`;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const k = s.length >> 1; return s.length ? (s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2) : null; };

/** 报价指数（合成回溯）：该中心所服务的桶，最低合格报价相对 90 天前的等权平均 */
function quoteIndex(insts, today) {
  const paths = insts.slice(0, 60).map((i) => sim.quoteSeries(i, today)).map((q) => new Map(q.map((p) => [p.d, p.min])));
  const base = today - BACK;
  const out = [];
  for (let d = base; d <= today; d++) {
    let s = 0, k = 0;
    for (const m of paths) { const v = m.get(d), b = m.get(base); if (v != null && b != null) { s += v / b; k++; } }
    if (k) out.push({ time: fmtDay(d), value: (100 * s) / k });
  }
  return out;
}

export function mount(el, args) {
  return args[0] ? mountDetail(el, args[0]) : mountList(el);
}

function mountList(el) {
  const S = market.state;
  const today = sim.dayIdxOf(nowSec());
  const regions = new Set();
  for (const c of S.centers) { if (c.hq) regions.add(c.hq); for (const d of c.dcs) regions.add(d); }
  const contested = S.insts.filter((i) => i.suppliers >= 3);
  const spread = [...contested].sort((a, b) => b.dispersion - a.dispersion).slice(0, 12);

  el.innerHTML = `
  <div class="page-head"><h2>${$t("算力中心")}</h2>
    <p>${$t("每一家向公开目录供货的推理服务商。同一个模型在不同算力中心的报价差多少、谁便宜、谁稳，都用真实公开报价算出来；历史走势没有真实数据，用合成回溯并明确标注。")}</p></div>
  <div class="cards">
    <div class="card"><h4>${$t("算力中心")}</h4><p class="big">${S.centers.length}</p><p class="sub">${$t("其中 {0} 家披露了机房所在地", S.centers.filter((c) => c.dcs.length).length)}</p></div>
    <div class="card"><h4>${$t("覆盖国家 / 地区")}</h4><p class="big">${regions.size}</p><p class="sub">${$t("按总部与机房所在地去重")}</p></div>
    <div class="card"><h4>${$t("同模型跨中心价差中位")}</h4><p class="big">${fmtPct(median(contested.map((i) => i.dispersion)), 0).replace('+', '')}</p><p class="sub">${$t("{0} 个有 3 家以上供应的桶，最高价 ÷ 最低价 − 1", contested.length)}</p></div>
    <div class="card"><h4>${$t("报价快照")}</h4><p class="big" style="font-size:18px">${fmtIso(S.snapshotAt)}</p><p class="sub">${ago(S.snapshotAt)} · ${REAL}</p></div>
  </div>
  <div class="grid-half">
    <section class="panel">
      <header><h3>${$t("同一模型，跨算力中心价差最大的桶")}</h3>${REAL}</header>
      <div class="table-wrap"><table class="tbl dense"><thead><tr><th>${$t("模型 / 桶")}</th><th class="num">${$t("供应商")}</th><th class="num">${$t("最低")}</th><th>${$t("报价分布")}</th><th class="num">${$t("最高")}</th><th class="num">${$t("价差")}</th></tr></thead><tbody>
      ${spread.map((i) => `<tr class="click" data-inst="${esc(i.id)}"><td>${esc(i.name)}<span class="chip sm">${esc(i.qLabel)}</span></td><td class="num">${i.suppliers}</td><td class="num">${fmtPx(i.minCny)}</td>
        <td><div class="range"><i style="left:0;right:0"></i><u style="left:${(((i.medCny - i.minCny) / (i.maxCny - i.minCny)) * 100).toFixed(1)}%" title="${$t("报价中位 {0}", fmtPx(i.medCny))}"></u></div></td>
        <td class="num">${fmtPx(i.maxCny)}</td><td class="num up">${fmtPct(i.dispersion, 0)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="pad mute small">${$t("白色刻度为报价中位。价差大不等于有套利空间：精度、上下文档位、可用率、地域都不同，最低价节点不适合所有企业。")}</p>
    </section>
    <section class="panel">
      <header><h3>${$t("全市场报价指数")}</h3>${SYN}<span class="sp"></span><span class="mute small">${$t("{0} 天前 = 100 · 仅最右一点基于真实报价", BACK)}</span></header>
      <div class="chart" id="q-chart" style="height:236px"></div>
      <p class="pad mute small">${$t("公开目录只提供当前报价，没有历史。这条线把今天的真实报价向前合成回溯，用来演示\"算力中心报价波动\"长什么样；接入供应商授权的历史价目表后才是真实走势。")}</p>
    </section>
  </div>
  <section class="panel" style="margin-bottom:12px">
    <header><h3>${$t("算力中心列表")}</h3>${REAL}<span class="sp"></span><input class="input search" id="q" type="search" placeholder="${$t("搜索算力中心…")}" value="${esc(prefs.q)}" aria-label="${$t("搜索")}"></header>
    <div class="table-wrap"><table class="tbl" id="tbl"><thead><tr>${COLS.map(([k, v, n]) => `<th class="sortable ${n ? 'num' : ''}" data-sort="${k}">${v}</th>`).join('')}<th>${$t("总部 / 机房")}</th><th>${$t("主要精度")}</th></tr></thead><tbody></tbody></table></div>
    <p class="pad mute small">${$t("报价溢价中位：在有竞争的桶里，该中心报价相对该桶最低报价高出多少（中位数）。负载、利用率、真实成交量属于私有数据，公开目录没有，这里不展示也不估算。")}</p>
  </section>
  <section class="panel">
    <header><h3>${$t("供给成本算例")}</h3>${tag('syn', $t("示例假设"))}<span class="sp"></span><span class="mute small">${$t("单位资源成本 =（硬件租赁 + 电力机房网络运维）÷ 有效可计费产出")}</span></header>
    <div class="pad">
      <div class="form-grid" id="cost-form">
        <label class="field"><span>${$t("GPU 租赁单价")}<em class="mute">${$t("元 / 卡时")}</em></span><input class="input mono" data-k="rent" type="number" min="0" step="0.5" value="14"></label>
        <label class="field"><span>${$t("单卡吞吐")}<em class="mute">${$t("Token / 秒")}</em></span><input class="input mono" data-k="tps" type="number" min="1" step="100" value="2500"></label>
        <label class="field"><span>${$t("有效利用率")}<em class="mute">%</em></span><input class="input mono" data-k="util" type="number" min="1" max="100" step="1" value="45"></label>
        <label class="field"><span>${$t("电力机房网络运维加成")}<em class="mute">%</em></span><input class="input mono" data-k="over" type="number" min="0" step="5" value="30"></label>
      </div>
      <p id="cost-out" class="hint"></p>
    </div>
  </section>`;

  const chart = makeChart($('#q-chart', el));
  const line = addLine(chart, COLOR.accent, IDX_FMT, { lineWidth: 2, lastValueVisible: true, crosshairMarkerVisible: true });
  line.setData(quoteIndex(contested.filter((i) => i.main), today));
  chart.timeScale().fitContent();

  const tbody = $('#tbl tbody', el);
  function render() {
    const q = prefs.q.trim().toLowerCase();
    const val = { name: (c) => c.name.toLowerCase(), n: (c) => c.n, brands: (c) => c.brands.length, cheapest: (c) => c.cheapest, premium: (c) => c.premium ?? Infinity, uptime: (c) => c.uptime ?? -1, degraded: (c) => c.degraded }[prefs.sort];
    const xs = S.centers.filter((c) => !q || c.name.toLowerCase().includes(q)).map((c) => [val(c), c]);
    xs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) * (prefs.desc ? -1 : 1));
    $$('#tbl th[data-sort]', el).forEach((th) => {
      const on = th.dataset.sort === prefs.sort;
      th.classList.toggle('sorted', on);
      th.textContent = COLS.find((c) => c[0] === th.dataset.sort)[1] + (on ? (prefs.desc ? ' ↓' : ' ↑') : '');
    });
    tbody.innerHTML = xs.length ? xs.map(([, c]) => `<tr class="click" data-center="${esc(c.name)}">
      <td class="c-name"><b>${esc(c.name)}</b></td><td class="num">${c.n}</td><td class="num">${c.brands.length}</td><td class="num">${c.cheapest || '—'}</td>
      <td class="num ${c.premium == null ? '' : c.premium > 0.5 ? 'up' : ''}">${c.premium == null ? '—' : fmtPct(c.premium, 0)}</td>
      <td class="num">${c.uptime == null ? '—' : `${c.uptime.toFixed(1)}%`}</td><td class="num ${c.degraded ? 'up' : ''}">${c.degraded || '—'}</td>
      <td>${where(c)}</td><td class="small">${c.precisions.slice(0, 3).map(([p, k]) => `${esc(p === 'unknown' ? $t("未声明") : p.toUpperCase())}×${k}`).join(' ')}</td></tr>`).join('')
      : `<tr><td colspan="9" class="empty">${$t("没有匹配的算力中心")}</td></tr>`;
  }

  function cost() {
    const v = Object.fromEntries($$('#cost-form input', el).map((i) => [i.dataset.k, Number(i.value)]));
    const out = $('#cost-out', el);
    if (!(v.rent >= 0 && v.tps > 0 && v.util > 0 && v.util <= 100 && v.over >= 0)) { out.textContent = $t("请输入有效的参数（利用率 1–100%）。"); return; }
    const perM = (v.rent * (1 + v.over / 100)) / ((v.tps * 3600 * (v.util / 100)) / 1e6);
    const med = median(contested.map((i) => i.medCny));
    out.innerHTML = `${$t("估算单位供给成本")} <b class="num" style="color:var(--text);font-size:15px">${fmtPx(perM)}</b> ${$t("元 / 百万Token。全市场有竞争的桶，公开报价中位的中位数是")} <b class="num" style="color:var(--text)">${fmtPx(med)}</b>${$t("（真实值，不同模型混合，只作量级参照）。利用率每降一半，单位成本翻一倍——这是算力中心报价差异的主要来源之一。供应商未披露真实成本时，这只是估算，不能当审计成本。")}`;
  }

  $('#tbl thead', el).addEventListener('click', (e) => {
    const th = e.target.closest('[data-sort]');
    if (!th) return;
    if (prefs.sort === th.dataset.sort) prefs.desc = !prefs.desc;
    else { prefs.sort = th.dataset.sort; prefs.desc = th.dataset.sort !== 'name'; }
    render();
  });
  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-center]');
    if (c) { location.hash = `#/compute/${encodeURIComponent(c.dataset.center)}`; return; }
    const i = e.target.closest('[data-inst]');
    if (i) location.hash = `#/trade/${encodeURIComponent(i.dataset.inst)}`;
  });
  $('#q', el).addEventListener('input', debounce((e) => { prefs.q = e.target.value; render(); }));
  $('#cost-form', el).addEventListener('input', cost);

  render(); cost();
  return { destroy() { chart.remove(); } };
}

function mountDetail(el, name) {
  const S = market.state;
  const c = S.centerByName.get(name);
  if (!c) { el.innerHTML = `<p class="empty">${$t("没有找到算力中心\"{0}\"。", esc(name))}<a href="#/compute">${$t("返回列表")}</a></p>`; return {}; }
  const today = sim.dayIdxOf(nowSec());
  const rows = [...c.rows].sort((a, b) => a.rank - b.rank || b.inst.suppliers - a.inst.suppliers);
  const real = S.history.flatMap((v) => v.changes.filter((x) => x.p === c.name).map((x) => ({ ...x, from: v.from, to: v.to })));
  const span = S.history.length ? `${fmtIso(S.history[0].from)} → ${fmtIso(S.history.at(-1).to)}` : '';
  const realHtml = !S.history.length ? '' : `<section class="panel" style="margin-bottom:12px">
    <header><h3>${$t("该中心的真实调价")}</h3>${REAL}<span class="mute small">${$t("同一端点前后两次快照 · {0}", span)}</span></header>
    ${real.length ? `<div class="table-wrap"><table class="tbl dense"><thead><tr><th>${$t("模型")}</th><th>${$t("精度")}</th><th class="num">${$t("原固定篮子价")}</th><th class="num">${$t("现固定篮子价")}</th><th class="num">${$t("变动")}</th><th>${$t("观测区间")}</th></tr></thead><tbody>
    ${real.slice(0, 30).map((x) => `<tr><td>${esc(S.modelById.get(x.id)?.name || x.id)}</td><td>${esc(x.q === 'unknown' ? $t("未声明") : x.q.toUpperCase())}</td><td class="num">${fmtPx(x.a * S.fx.rate)}</td><td class="num">${fmtPx(x.b * S.fx.rate)}</td><td class="num ${dir(x.b - x.a)}">${fmtPct(x.b / x.a - 1)}</td><td class="small">${fmtIso(x.from).slice(5)} → ${fmtIso(x.to).slice(5)}</td></tr>`).join('')}
    </tbody></table></div>` : `<p class="empty">${$t("这段时间内，该中心没有调价。")}</p>`}
  </section>`;

  el.innerHTML = `
  <div class="page-head"><p><a href="#/compute">${$t("← 算力中心")}</a></p><h2 style="margin-top:6px">${esc(c.name)}</h2><p>${where(c)}${c.listed ? '' : ` ${$t("· 未出现在服务商名录中")}`}</p></div>
  <div class="cards">
    <div class="card"><h4>${$t("服务桶数")}</h4><p class="big">${c.n}</p><p class="sub">${$t("覆盖 {0} 个品牌", c.brands.length)}</p></div>
    <div class="card"><h4>${$t("报最低价的桶")}</h4><p class="big">${c.cheapest}</p><p class="sub">${$t("在 {0} 个有竞争的桶中", c.contested)}</p></div>
    <div class="card"><h4>${$t("报价溢价中位")}</h4><p class="big">${c.premium == null ? '—' : fmtPct(c.premium, 0)}</p><p class="sub">${$t("相对各桶最低报价")}</p></div>
    <div class="card"><h4>${$t("平均近1日可用率")}</h4><p class="big">${c.uptime == null ? '—' : `${c.uptime.toFixed(1)}%`}</p><p class="sub">${c.degraded ? $t("{0} 个端点处于降级状态", c.degraded) : $t("无降级端点")}</p></div>
  </div>
  ${realHtml}
  <section class="panel" style="margin-bottom:12px">
    <header><h3>${$t("该中心所服务桶的报价指数")}</h3>${SYN}<span class="sp"></span><span class="mute small">${$t("{0} 天前 = 100 · 仅最右一点基于真实报价", BACK)}</span></header>
    <div class="chart" id="c-chart" style="height:220px"></div>
  </section>
  <section class="panel">
    <header><h3>${$t("在售服务与公开报价")}</h3>${REAL}<span class="mute small">${$t("快照 {0}", fmtIso(S.snapshotAt))}</span></header>
    <div class="table-wrap"><table class="tbl dense"><thead><tr><th>${$t("模型 / 桶")}</th><th class="num">${$t("输入")}</th><th class="num">${$t("输出")}</th><th class="num">${$t("固定篮子参考价")}</th><th class="num">${$t("桶内排名")}</th><th class="num">${$t("较桶内最低")}</th><th class="num">${$t("近1日可用率")}</th><th>${$t("状态")}</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="click" data-inst="${esc(r.inst.id)}"><td>${esc(r.inst.name)}<span class="chip sm">${esc(r.inst.qLabel)}</span></td>
      <td class="num">${fmtPx(r.quote.cny.in)}</td><td class="num">${fmtPx(r.quote.cny.out)}</td><td class="num"><b>${fmtPx(r.quote.basket)}</b></td>
      <td class="num">${r.rank} / ${r.inst.suppliers}</td><td class="num ${dir(r.premium)}">${r.inst.suppliers === 1 ? $t("独家") : r.premium === 0 ? $t("最低") : fmtPct(r.premium, 0)}</td>
      <td class="num">${r.quote.up1d == null ? '—' : `${r.quote.up1d.toFixed(1)}%`}</td><td>${r.quote.ok ? `<span class="down small">${$t("合格")}</span>` : `<span class="up small">${r.quote.st !== 0 ? $t("降级") : $t("可用率不足")}</span>`}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="pad mute small">${$t("费率单位：元 / 百万Token。点击任意一行进入该桶的交易终端。")}</p>
  </section>`;

  const chart = makeChart($('#c-chart', el));
  const line = addLine(chart, COLOR.gold, IDX_FMT, { lineWidth: 2, lastValueVisible: true, crosshairMarkerVisible: true });
  line.setData(quoteIndex([...new Set(c.rows.map((r) => r.inst))], today));
  chart.timeScale().fitContent();
  el.addEventListener('click', (e) => {
    const i = e.target.closest('[data-inst]');
    if (i) location.hash = `#/trade/${encodeURIComponent(i.dataset.inst)}`;
  });
  return { destroy() { chart.remove(); } };
}
