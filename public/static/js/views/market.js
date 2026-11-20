// 行情总览：指数、景气、涨跌榜、品牌热力、全市场列表
import * as sim from '../core/sim.js';
import * as market from '../core/market.js';
import { $, $$, esc, fmtPx, fmtPct, fmtQty, fmtMoney, fmtNum, fmtInt, fmtDay, dir, spark, chips, SYN, REAL, debounce, COLOR } from '../ui.js';
import { makeChart, addLine } from '../chart.js';
import { $t } from '../i18n.js';

const prefs = { tab: 'tradable', q: '', sort: 'amt', desc: true, limit: 50 };
const TABS = [['tradable', $t("达发布门槛")], ['open', $t("开放权重")], ['closed', $t("闭源")], ['quote', $t("仅报价")], ['all', $t("全部")]];
const COLS = [['name', $t("模型 / 可比桶")], ['last', $t("最新参考价")], ['chg', $t("今日涨跌")], ['vol', $t("今日交付量")], ['amt', $t("今日成交额")], ['sup', $t("独立供应商")], ['disp', $t("公开报价区间")]];
const IDX_FMT = { type: 'price', precision: 2, minMove: 0.01 };

export function mount(el) {
  const S = market.state;
  const now0 = Date.now() / 1000;
  const ix = market.indices(now0);
  const kinds = { model: 0, alias: 0, router: 0 };
  for (const m of S.models) kinds[m.kind]++;
  const tradable = S.insts.filter((i) => i.meets);

  el.innerHTML = `
  <div class="stats-bar">
    <span>${$t("已收录模型")}<b>${S.models.length}</b>${$t("（精确版本 {0} · 别名 {1} · 路由 {2}）", kinds.model, kinds.alias, kinds.router)}</span>
    <span>${$t("可比桶")}<b>${S.insts.length}</b></span>
    <span>${$t("达发布门槛")}<b>${tradable.length}</b></span>
    <span>${$t("算力中心")}<b>${S.centers.length}</b></span>
    <span>${$t("公开报价")}<b>${fmtInt(S.insts.reduce((s, i) => s + i.quotes.length, 0))}</b>${$t("条")}</span>
    <span>USD/CNY<b>${S.fx.rate.toFixed(4)}</b></span>
    <span>${REAL} ${$t("以上均来自公开目录")}</span>
  </div>
  <div class="cards" id="idx-cards"></div>
  <div class="grid-2">
    <section class="panel">
      <header><h3>${$t("推理参考价格指数")}</h3>${SYN}<span class="sp"></span><span class="mute small">${$t("基期 {0} = 100 · 等品牌组权重 · 成分 {1} 个桶", fmtDay(ix.base), ix.all.members)}</span></header>
      <div class="chart" id="idx-chart"></div>
    </section>
    <section class="panel">
      <header><h3>${$t("今日涨跌榜")}</h3>${SYN}</header>
      <div class="movers" id="movers"></div>
    </section>
  </div>
  <section class="panel" style="margin-bottom:12px">
    <header><h3>${$t("品牌热力")}</h3>${SYN}<span class="sp"></span><span class="mute small">${$t("品牌内达标桶今日平均涨跌 · 红涨绿跌")}</span></header>
    <div class="heat" id="heat"></div>
  </section>
  <section class="panel">
    <header>
      <div class="tabs" id="tabs">${TABS.map(([k, v]) => `<button data-tab="${k}">${v}</button>`).join('')}</div>
      <span class="sp"></span>
      <input class="input search" id="q" type="search" placeholder="${$t("搜索模型、品牌…")}" value="${esc(prefs.q)}" aria-label="${$t("搜索")}">
    </header>
    <div class="table-wrap"><table class="tbl" id="tbl">
      <thead><tr>${COLS.map(([k, v], i) => `<th class="sortable ${i ? 'num' : ''}" data-sort="${k}">${v}</th>`).join('')}<th>${$t("近30个发布日")}</th><th>${$t("状态")}</th></tr></thead>
      <tbody></tbody>
    </table></div>
    <button class="more" id="more" hidden>${$t("加载更多")}</button>
    <p class="pad mute small">${$t("价格单位：元 / 百万Token（固定篮子：80% 输入 + 20% 输出）。\"公开报价区间\"与\"独立供应商\"为真实值；最新价、涨跌、交付量、成交额为仿真成交。供应商不足 3 家的桶不发布成交统计，只显示公开报价。")}</p>
  </section>`;

  // ---------- 指数 ----------
  const chart = makeChart($('#idx-chart', el));
  const lines = [['all', $t("综合"), COLOR.accent], ['open', $t("开放权重"), COLOR.down], ['closed', $t("闭源"), COLOR.gold], ['cn', $t("国产"), '#c26bff']].map(([k, title, color]) => {
    const s = addLine(chart, color, IDX_FMT, { title, lineWidth: 2, lastValueVisible: true });
    s.setData(ix[k].series.map((p) => ({ time: fmtDay(p.d), value: p.v })));
    return { k, s };
  });
  chart.timeScale().fitContent();

  function paintIndex(now) {
    const today = fmtDay(sim.dayIdxOf(now));
    const card = (title, k, sub) => {
      const cur = ix[k].now(now);
      const prev = ix[k].series.at(-1)?.v;
      const chg = cur != null && prev ? cur / prev - 1 : null;
      return `<div class="card"><h4>${title}</h4><p class="big ${dir(chg)}">${cur == null ? '—' : cur.toFixed(2)}</p><p class="sub"><span class="num ${dir(chg)}">${fmtPct(chg)}</span> ${$t("较上一发布日 · {0}", sub)}</p></div>`;
    };
    const pros = market.prosperity(now);
    $('#idx-cards', el).innerHTML =
      card($t("推理参考价格指数"), 'all', $t("{0} 个桶", ix.all.members)) +
      card($t("开放权重指数"), 'open', $t("{0} 个桶", ix.open.members)) +
      card($t("闭源模型指数"), 'closed', $t("{0} 个桶", ix.closed.members)) +
      card($t("国产模型指数"), 'cn', $t("{0} 个桶", ix.cn.members)) +
      `<div class="card"><h4>${$t("供需景气指标")}</h4><p class="big">${pros == null ? '—' : pros.toFixed(1)}</p><p class="sub">${$t("今日样本数 ÷ 按日内节律的预期 × 100")}</p></div>`;
    for (const { k, s } of lines) { const v = ix[k].now(now); if (v != null) s.update({ time: today, value: v }); }
  }

  function paintMovers(now) {
    const xs = tradable.map((i) => ({ i, s: sim.summary(i, now) })).filter((x) => x.s.n > 0).sort((a, b) => b.s.chg - a.s.chg);
    const row = (x) => `<a href="#/trade/${encodeURIComponent(x.i.id)}"><span>${esc(x.i.name)}</span><span class="num ${dir(x.s.chg)}">${fmtPct(x.s.chg)}</span></a>`;
    $('#movers', el).innerHTML = `<div><h4>${$t("涨幅前列")}</h4>${xs.slice(0, 7).map(row).join('')}</div><div><h4>${$t("跌幅前列")}</h4>${xs.slice(-7).reverse().map(row).join('')}</div>`;

    const brands = new Map();
    for (const x of xs) { const b = brands.get(x.i.brand) || { n: 0, sum: 0 }; b.n++; b.sum += x.s.chg; brands.set(x.i.brand, b); }
    $('#heat', el).innerHTML = [...brands.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 24).map(([name, b]) => {
      const c = b.sum / b.n;
      const a = Math.min(0.85, 0.18 + Math.abs(c) * 22);
      return `<a href="#/market" data-brand="${esc(name)}" style="background:rgba(${c >= 0 ? '246,70,93' : '14,203,129'},${a.toFixed(2)})"><b>${esc(name)}</b><span>${fmtPct(c)}</span></a>`;
    }).join('');
  }

  // ---------- 列表 ----------
  const tbody = $('#tbl tbody', el);
  const last = new Map();

  function filtered(now) {
    const q = prefs.q.trim().toLowerCase();
    let xs = S.insts.filter((i) => {
      if (prefs.tab === 'tradable' && !i.meets) return false;
      if (prefs.tab === 'quote' && i.meets) return false;
      if (prefs.tab === 'open' && !i.open) return false;
      if (prefs.tab === 'closed' && i.open) return false;
      return !q || i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q);
    });
    const val = {
      name: (i) => i.name.toLowerCase(), sup: (i) => i.suppliers, disp: (i) => i.dispersion,
      // 不发布成交统计的桶，排序时用公开报价 / 0
      last: (i) => (i.meets ? sim.summary(i, now).last : i.anchor),
      chg: (i) => (i.meets ? sim.summary(i, now).chg : 0),
      vol: (i) => (i.meets ? sim.summary(i, now).v : 0),
      amt: (i) => (i.meets ? sim.summary(i, now).amt : 0),
    }[prefs.sort];
    const keyed = xs.map((i) => [val(i), i]);
    keyed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) * (prefs.desc ? -1 : 1));
    return keyed.map((k) => k[1]);
  }

  function renderTable() {
    const now = Date.now() / 1000;
    const xs = filtered(now);
    $$('#tabs button', el).forEach((b) => b.classList.toggle('on', b.dataset.tab === prefs.tab));
    $$('#tbl th[data-sort]', el).forEach((th) => {
      const on = th.dataset.sort === prefs.sort;
      th.classList.toggle('sorted', on);
      th.textContent = COLS.find((c) => c[0] === th.dataset.sort)[1] + (on ? (prefs.desc ? ' ↓' : ' ↑') : '');
    });
    const shown = xs.slice(0, prefs.limit);
    tbody.innerHTML = shown.length ? shown.map((i) => `<tr class="click" data-id="${esc(i.id)}">
      <td class="c-name"><b>${esc(i.name)}</b>${chips(i)}<small>${$t("{0} · 锚定 {1}", esc(i.brand), esc(i.anchorProvider))}</small></td>
      <td class="num" data-k="last"></td><td class="num" data-k="chg"></td><td class="num" data-k="vol"></td><td class="num" data-k="amt"></td>
      <td class="num">${i.suppliers}</td>
      <td class="num">${fmtPx(i.minCny)} – ${fmtPx(i.maxCny)}</td>
      <td>${i.meets ? '<canvas class="spark"></canvas>' : `<span class="mute small">${$t("不发布")}</span>`}</td>
      <td>${i.meets ? `<span class="up small">${$t("可仿真撮合")}</span>` : `<span class="mute small">${$t("仅报价")}</span>`}</td></tr>`).join('')
      : `<tr><td colspan="9" class="empty">${$t("没有符合条件的品种")}</td></tr>`;
    const more = $('#more', el);
    more.hidden = xs.length <= prefs.limit;
    more.textContent = $t("加载更多（已显示 {0} / {1}）", shown.length, xs.length);
    last.clear();
    for (const tr of $$('tr[data-id]', tbody)) {
      const inst = S.instById.get(tr.dataset.id);
      const cv = $('canvas', tr);
      if (cv) spark(cv, sim.sparkOf(inst, now));
    }
    paintRows(now);
  }

  function paintRows(now) {
    for (const tr of $$('tr[data-id]', tbody)) {
      const inst = S.instById.get(tr.dataset.id);
      const cell = (k) => tr.querySelector(`[data-k="${k}"]`);
      if (!inst.meets) {
        if (!last.has(inst.id)) {
          cell('last').innerHTML = `${fmtPx(inst.anchor)} <span class="mute small">${$t("报价")}</span>`;
          for (const k of ['chg', 'vol', 'amt']) cell(k).textContent = '—';
          last.set(inst.id, inst.anchor);
        }
        continue;
      }
      const s = sim.summary(inst, now);
      const prev = last.get(inst.id);
      const c = cell('last');
      c.textContent = fmtPx(s.last);
      c.className = `num ${dir(s.chg)}`;
      if (prev != null && prev !== s.last) {
        c.classList.remove('flash-up', 'flash-down');
        void c.offsetWidth;
        c.classList.add(s.last > prev ? 'flash-up' : 'flash-down');
      }
      last.set(inst.id, s.last);
      const g = cell('chg');
      g.textContent = fmtPct(s.chg); g.className = `num ${dir(s.chg)}`;
      cell('vol').textContent = fmtQty(s.v);
      cell('amt').textContent = fmtMoney(s.amt);
    }
  }

  // ---------- 事件 ----------
  $('#tabs', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) { prefs.tab = b.dataset.tab; prefs.limit = 50; renderTable(); }
  });
  $('#tbl thead', el).addEventListener('click', (e) => {
    const th = e.target.closest('[data-sort]');
    if (!th) return;
    if (prefs.sort === th.dataset.sort) prefs.desc = !prefs.desc;
    else { prefs.sort = th.dataset.sort; prefs.desc = th.dataset.sort !== 'name'; }
    renderTable();
  });
  tbody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) location.hash = `#/trade/${encodeURIComponent(tr.dataset.id)}`;
  });
  $('#q', el).addEventListener('input', debounce((e) => { prefs.q = e.target.value; prefs.limit = 50; renderTable(); }));
  $('#more', el).addEventListener('click', () => { prefs.limit += 50; renderTable(); });
  $('#heat', el).addEventListener('click', (e) => {
    const a = e.target.closest('[data-brand]');
    if (!a) return;
    e.preventDefault();
    prefs.q = a.dataset.brand; prefs.tab = 'tradable'; prefs.limit = 50;
    $('#q', el).value = prefs.q;
    renderTable();
    $('#tbl', el).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  paintIndex(now0);
  paintMovers(now0);
  renderTable();

  let n = 0;
  return {
    tick(now) {
      paintRows(now);
      if (++n % 5 === 0) { paintIndex(now); paintMovers(now); }
    },
    destroy() { chart.remove(); },
  };
}
