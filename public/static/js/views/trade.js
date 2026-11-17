// 交易终端：K线三视图、盘口、逐笔、下单、供应商公开报价、委托与持仓
import * as sim from '../core/sim.js';
import * as market from '../core/market.js';
import * as account from '../core/account.js';
import { THRESHOLD } from '../core/normalize.js';
import { $, $$, esc, fmtPx, fmtPct, fmtQty, fmtMoney, fmtNum, fmtCtx, fmtTime, fmtDay, fmtIso, ago, dir, chips, toast, nowSec, SYN, REAL, COLOR, debounce } from '../ui.js';
import { makeChart, addCandles, addLine, sma, MA_SET, priceFormat } from '../chart.js';
import { ordersTable, positionsTable, fillsTable, bindActions } from './shared.js';

const prefs = { id: null, view: 'trade', tf: 'D', task: 'kb', side: 'buy', type: 'limit', tab: 'open' };
const VIEWS = [['trade', '成交K线'], ['quote', '报价视图'], ['cost', '任务成本']];
const TFS = [['1', '1分', 1, 1], ['5', '5分', 5, 2], ['15', '15分', 15, 4], ['60', '1时', 60, 10], ['D', '日线'], ['W', '周线']];
const TABS = [['open', '当前委托'], ['pos', '持仓'], ['hist', '历史委托'], ['fills', '成交记录']];
const DAYSEC = 86400;

function defaultInst() {
  const xs = market.state.insts.filter((i) => i.meets && i.variant === 'std');
  xs.sort((a, b) => b.suppliers - a.suppliers);
  return xs[0] || market.state.insts[0];
}

export function mount(el, args) {
  const S = market.state;
  const inst = S.instById.get(args[0] || prefs.id) || (args[0] ? null : defaultInst());
  if (!inst) {
    el.innerHTML = `<p class="empty">没有找到这个品种，可能已从公开目录下线。<a href="#/market">返回行情</a></p>`;
    return {};
  }
  prefs.id = inst.id;
  const P = sim.params(inst);
  const fmt = priceFormat(P.tick, P.dec);
  const px = (v) => fmtPx(v, P.dec);
  const intradayOk = sim.hasIntraday(inst);
  if (!inst.meets && prefs.view === 'trade') prefs.view = 'quote';
  if (!intradayOk && prefs.tf !== 'D' && prefs.tf !== 'W') prefs.tf = 'D';

  el.innerHTML = `
  <div class="inst-head">
    <button class="inst-pick" id="pick" type="button" aria-haspopup="listbox"><b>${esc(inst.name)}</b>${chips(inst)}<span class="mute">▾</span></button>
    <div><span class="inst-last" id="h-last">—</span> <span class="num" id="h-chg"></span></div>
    <div class="inst-stats" id="h-stats"></div>
    <div class="picker" id="picker" hidden>
      <input class="input" type="search" placeholder="搜索模型、品牌…" aria-label="搜索品种">
      <ul role="listbox"></ul>
    </div>
  </div>
  <div class="terminal">
    <section class="panel col-chart">
      <div class="chart-tools">
        <div class="tabs" id="views">${VIEWS.map(([k, v]) => `<button data-view="${k}">${v}</button>`).join('')}</div>
        <div class="tabs" id="tfs">${TFS.map(([k, v]) => `<button data-tf="${k}">${v}</button>`).join('')}</div>
        <select class="input" id="task" style="width:auto" aria-label="基准任务">${market.TASKS.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
        <span id="view-tag"></span>
      </div>
      <div class="chart-box"><div class="legend" id="legend"></div><div class="chart" id="chart"></div><div class="chart-note" id="note" hidden></div></div>
      <div class="card-strip" id="strip"></div>
    </section>
    <section class="panel col-book">
      <header><h3>盘口</h3>${SYN}<span class="sp"></span><span class="mute small">元 / 百万Token</span></header>
      <div class="book" id="book"></div>
      <header style="border-top:1px solid var(--line)"><h3>逐笔样本</h3>${SYN}</header>
      <div class="tape" id="tape"></div>
    </section>
    <section class="panel col-order order-form">
      <div class="side-tabs"><button class="buy" data-side="buy" type="button">买入</button><button class="sell" data-side="sell" type="button">卖出</button></div>
      <form class="pad" id="oform" autocomplete="off" novalidate>
        <div class="tabs" id="otype" style="margin-bottom:10px"><button type="button" data-type="limit">限价</button><button type="button" data-type="market">市价</button></div>
        <label class="field"><span>委托价格<em class="mute">元 / 百万Token</em></span><input class="input mono" id="o-price" type="number" inputmode="decimal" step="${P.tick}" min="0"></label>
        <label class="field"><span>数量<em class="mute">百万Token</em></span><input class="input mono" id="o-qty" type="number" inputmode="numeric" step="1" min="1" value="10"></label>
        <div class="pct">${[25, 50, 75, 100].map((p) => `<button type="button" data-pct="${p}">${p}%</button>`).join('')}</div>
        <div class="kv"><span id="o-avail-l">可用研究记分</span><b id="o-avail">—</b></div>
        <div class="kv"><span>预计金额</span><b id="o-amt">—</b></div>
        <div class="kv"><span>手续费（${(account.FEE * 100).toFixed(1)}%）</span><b id="o-fee">—</b></div>
        <button class="btn block" id="o-submit" type="submit" style="margin-top:10px">买入</button>
        <p class="hint" id="o-hint"></p>
      </form>
    </section>
  </div>
  <section class="panel" style="margin-bottom:12px">
    <header><h3>供应商公开报价</h3>${REAL}<span class="mute small" id="q-asof"></span><span class="sp"></span><button class="btn sm" id="q-refresh" type="button">拉取实时报价</button></header>
    <div class="table-wrap" id="quotes"></div>
  </section>
  <section class="panel">
    <header><div class="tabs" id="btabs">${TABS.map(([k, v]) => `<button data-btab="${k}">${v}</button>`).join('')}</div></header>
    <div id="bottom"></div>
  </section>`;

  // ---------- 行情头 ----------
  let lastPx = null;
  function paintHead(now) {
    const hl = $('#h-last', el), hc = $('#h-chg', el);
    if (!inst.meets) {
      hl.textContent = px(inst.anchor); hl.className = 'inst-last';
      hc.innerHTML = '<span class="mute small">最低合格公开报价（非成交）</span>';
      $('#h-stats', el).innerHTML = [['报价区间', `${px(inst.minCny)} – ${px(inst.maxCny)}`], ['独立供应商', inst.suppliers], ['发布门槛', '未达 3 家']].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
      return;
    }
    const s = sim.summary(inst, now);
    hl.textContent = px(s.last);
    hl.className = `inst-last ${dir(s.chg)}`;
    if (lastPx != null && lastPx !== s.last) { hl.classList.remove('flash-up', 'flash-down'); void hl.offsetWidth; hl.classList.add(s.last > lastPx ? 'flash-up' : 'flash-down'); }
    lastPx = s.last;
    hc.textContent = `${s.last - s.prev >= 0 ? '+' : ''}${(s.last - s.prev).toFixed(P.dec)}  ${fmtPct(s.chg)}`;
    hc.className = `num ${dir(s.chg)}`;
    $('#h-stats', el).innerHTML = [
      ['今开', px(s.o)], ['最高', px(s.h)], ['最低', px(s.l)], ['昨收', px(s.prev)],
      ['交付量', `${fmtQty(s.v)} 百万Token`], ['成交额', fmtMoney(s.amt)], ['今日样本', `${s.n} 笔`], ['独立供应商', inst.suppliers],
      ['公开报价区间', `${px(inst.minCny)} – ${px(inst.maxCny)}`],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  }

  // ---------- 图表 ----------
  let chart = null, series = {}, meta = new Map(), lastTime = null, legendFn = () => '';
  const legend = $('#legend', el), note = $('#note', el);

  const toCandle = (r) => (r.b.pub ? { time: r.time, open: r.b.o, high: r.b.h, low: r.b.l, close: r.b.c } : { time: r.time });
  const toVol = (r) => (r.b.pub ? { time: r.time, value: r.b.v, color: r.b.c >= r.b.o ? 'rgba(246,70,93,.5)' : 'rgba(14,203,129,.5)' } : { time: r.time });
  const tfDef = () => TFS.find((t) => t[0] === prefs.tf);
  const isIntra = () => prefs.tf !== 'D' && prefs.tf !== 'W';

  function tradeRows(now) {
    const today = sim.dayIdxOf(now);
    const D = sim.daily(inst, today);
    const tc = sim.todayCandle(inst, now);
    if (prefs.tf === 'D') return D.days.map((b) => ({ time: b.d * DAYSEC, b })).concat({ time: today * DAYSEC, b: tc });
    if (prefs.tf === 'W') return sim.weekly(tc.pub ? D.days.concat(tc) : D.days).map((b) => ({ time: b.d * DAYSEC, b }));
    const [, , size, back] = tfDef();
    return sim.groupMinutes(sim.minuteBars(inst, now, back), size).map((b) => ({ time: b.t + sim.TZ, b: { ...b, pub: true } }));
  }
  function tradeTail(now) {
    const today = sim.dayIdxOf(now);
    if (prefs.tf === 'D') return [{ time: today * DAYSEC, b: sim.todayCandle(inst, now) }];
    if (prefs.tf === 'W') {
      const tc = sim.todayCandle(inst, now);
      const tail = sim.daily(inst, today).days.slice(-7);
      return sim.weekly(tc.pub ? tail.concat(tc) : tail).slice(-1).map((b) => ({ time: b.d * DAYSEC, b }));
    }
    const [, , size] = tfDef();
    return sim.groupMinutes(sim.live(inst, now).bars, size).slice(-2).map((b) => ({ time: b.t + sim.TZ, b: { ...b, pub: true } }));
  }

  function tradeLegend(time) {
    const b = meta.get(time);
    if (!b) return '';
    const when = isIntra() ? `${fmtDay(Math.floor(time / DAYSEC))} ${new Date(time * 1000).toISOString().slice(11, 16)}` : fmtDay(Math.floor(time / DAYSEC));
    if (!b.pub) return `<b>${when}</b><i class="mute">留空：${esc(b.why || '无成交样本')}${b.live ? '（盘中，达标后发布）' : ''}</i>`;
    const c = dir(b.c - b.o);
    const who = b.sup ? `<i>供应 <b>${b.sup}</b></i><i>买方 <b>${b.buy}</b></i>` : '';
    return `<b>${when}</b><i>开 <b class="${c}">${px(b.o)}</b></i><i>高 <b class="${c}">${px(b.h)}</b></i><i>低 <b class="${c}">${px(b.l)}</b></i><i>收 <b class="${c}">${px(b.c)}</b></i><i>交付量 <b>${fmtQty(b.v)}</b></i><i>样本 <b>${b.n}</b></i>${who}${b.n === 1 ? '<i class="ev ev-syn">单样本</i>' : ''}`;
  }

  function buildChart() {
    const now = nowSec();
    if (chart) { chart.remove(); chart = null; }
    series = {}; meta = new Map(); lastTime = null;
    note.hidden = true; legend.innerHTML = '';
    $$('#views button', el).forEach((b) => { b.classList.toggle('on', b.dataset.view === prefs.view); });
    $$('#tfs button', el).forEach((b) => {
      const intra = b.dataset.tf !== 'D' && b.dataset.tf !== 'W';
      b.classList.toggle('on', b.dataset.tf === prefs.tf);
      b.disabled = intra && !intradayOk;
      b.title = b.disabled ? `日均样本不足 ${sim.INTRADAY_MIN} 笔，不提供日内粒度` : '';
    });
    $('#tfs', el).hidden = prefs.view !== 'trade';
    $('#task', el).hidden = prefs.view !== 'cost';
    $('#task', el).value = prefs.task;
    $('#view-tag', el).innerHTML = prefs.view === 'trade' ? `${SYN}<span class="mute small"> 仿真成交 · 不是真实行情</span>`
      : prefs.view === 'quote' ? `${REAL}<span class="mute small"> 观测日一点为真实报价，之前为合成回溯</span>`
      : `${SYN}<span class="mute small"> 合格率为合成演示值，未做真实评测</span>`;

    if (prefs.view === 'trade' && !inst.meets) {
      note.hidden = false;
      note.innerHTML = `<div>该桶只有 <b>${inst.suppliers}</b> 家独立供应商，未达到 ${THRESHOLD.suppliers} 家的发布门槛，不发布成交K线。<br>可切换到"报价视图"查看公开报价。</div>`;
      paintStrip(now);
      return;
    }
    const box = $('#chart', el);
    const today = sim.dayIdxOf(now);

    if (prefs.view === 'trade') {
      chart = makeChart(box, { intraday: isIntra() });
      Object.assign(series, addCandles(chart, fmt));
      series.mas = MA_SET.map(([n, color]) => ({ n, s: addLine(chart, color, fmt) }));
      const rows = tradeRows(now);
      for (const r of rows) meta.set(r.time, r.b);
      series.candle.setData(rows.map(toCandle));
      series.vol.setData(rows.map(toVol));
      for (const m of series.mas) m.s.setData(sma(rows, m.n));
      lastTime = rows.length ? rows[rows.length - 1].time : null;
      legendFn = tradeLegend;
      if (!rows.some((r) => r.b.pub)) { note.hidden = false; note.textContent = '该统计窗内暂无达到发布门槛的样本。'; }
      if (rows.length > 150) chart.timeScale().setVisibleLogicalRange({ from: rows.length - 120, to: rows.length + 3 });
      else chart.timeScale().fitContent();
    } else {
      chart = makeChart(box);
      const q = sim.quoteSeries(inst, today);
      if (prefs.view === 'quote') {
        series.min = addLine(chart, COLOR.accent, fmt, { title: '最低合格报价', lineWidth: 2, lastValueVisible: true, crosshairMarkerVisible: true });
        series.med = addLine(chart, COLOR.gold, fmt, { title: '报价中位', lastValueVisible: true });
        series.min.setData(q.map((p) => ({ time: p.d * DAYSEC, value: p.min })));
        series.med.setData(q.map((p) => ({ time: p.d * DAYSEC, value: p.med })));
        series.min.setMarkers([{ time: inst.anchorDay * DAYSEC, position: 'aboveBar', color: COLOR.down, shape: 'circle', text: '真实观测' }]);
        for (const p of q) meta.set(p.d * DAYSEC, p);
        legendFn = (t) => {
          const p = meta.get(t);
          if (!p) return '';
          const kind = p.real ? '<i class="ev ev-real">真实观测</i>' : p.stale ? '<i class="ev ev-todo">沿用观测值 · 陈旧</i>' : '<i class="ev ev-syn">合成回溯</i>';
          return `<b>${fmtDay(p.d)}</b><i>最低合格报价 <b>${px(p.min)}</b></i><i>报价中位 <b>${px(p.med)}</b></i>${kind}<i class="mute">报价，非成交，无成交量</i>`;
        };
      } else {
        const task = market.TASKS.find((t) => t.id === prefs.task);
        const pass = market.passRate(inst, task);
        const cfmt = { type: 'price', precision: 4, minMove: 0.0001 };
        series.cost = addLine(chart, COLOR.gold, cfmt, { title: '单合格任务有效成本', lineWidth: 2, lastValueVisible: true, crosshairMarkerVisible: true });
        const pts = q.map((p) => {
          const k = p.min / inst.anchor;
          return { d: p.d, v: sim.taskCost({ inCny: inst.inCny * k, outCny: inst.outCny * k, inTok: task.inTok, outTok: task.outTok, pass, review: task.review }) };
        });
        series.cost.setData(pts.map((p) => ({ time: p.d * DAYSEC, value: p.v })));
        for (const p of pts) meta.set(p.d * DAYSEC, p);
        legendFn = (t) => {
          const p = meta.get(t);
          if (!p) return '';
          return `<b>${fmtDay(p.d)}</b><i>${esc(task.name)} <b>${p.v.toFixed(4)}</b> 元/合格任务</i><i>合格率 <b>${(pass * 100).toFixed(1)}%</b></i><i>单任务 <b>${task.inTok}</b> 入 / <b>${task.outTok}</b> 出</i><i>复核 <b>${task.review}</b> 元/次</i>`;
        };
      }
      lastTime = q.length ? q[q.length - 1].d * DAYSEC : null;
      chart.timeScale().fitContent();
    }
    chart.subscribeCrosshairMove((p) => { legend.innerHTML = legendFn(typeof p.time === 'number' ? p.time : lastTime); });
    legend.innerHTML = legendFn(lastTime);
    paintStrip(now);
  }

  function tickChart(now) {
    if (!chart || prefs.view !== 'trade') return;
    for (const r of tradeTail(now)) {
      if (lastTime != null && r.time < lastTime) continue;
      meta.set(r.time, r.b);
      series.candle.update(toCandle(r));
      series.vol.update(toVol(r));
      lastTime = r.time;
    }
    if (!note.hidden && [...meta.values()].some((b) => b.pub)) note.hidden = true;
  }

  /** 行情卡（§07 必备字段） */
  function paintStrip(now) {
    const tf = tfDef();
    const win = prefs.view !== 'trade' ? '日' : prefs.tf === 'D' ? '日' : prefs.tf === 'W' ? '周' : `${tf[2]} 分钟`;
    const type = prefs.view === 'trade' ? '仿真成交（合成）' : prefs.view === 'quote' ? '公开报价（非成交）' : '任务有效成本（基准篮子）';
    const st = inst.meets ? sim.live(inst, now) : null;
    const quality = prefs.view === 'quote' ? '观测日真实 · 历史合成' : !inst.meets ? '未达发布门槛' : '合成 · 达发布门槛才显示';
    $('#strip', el).innerHTML = [
      ['桶ID', esc(inst.id)], ['价格类型', type],
      ['单位', prefs.view === 'cost' ? '元 / 合格任务' : '元 / 百万Token（80% 输入 + 20% 输出）'],
      ['量单位', prefs.view === 'trade' ? '百万Token（交付量）' : '无成交量'],
      ['今日样本', st ? `${st.n} 笔` : '—'], ['独立供应商', `${inst.suppliers} 家`],
      ['统计窗', `${win}（北京时间）`], ['报价观测', `${fmtIso(S.snapshotAt)}（${ago(S.snapshotAt)}）`],
      ['覆盖范围', '已接入样本：OpenRouter 公开目录'], ['方法版本', 'sim-v1'], ['质量标记', quality],
    ].map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join('');
  }

  // ---------- 盘口与逐笔 ----------
  function paintBook(now) {
    const bookEl = $('#book', el), tapeEl = $('#tape', el);
    if (!inst.meets) {
      bookEl.innerHTML = '<p class="empty">未达发布门槛，不提供仿真盘口</p>';
      tapeEl.innerHTML = '';
      return;
    }
    const b = sim.book(inst, now, 9);
    const s = sim.summary(inst, now);
    const max = Math.max(1, ...b.asks.map((x) => x.q), ...b.bids.map((x) => x.q));
    const row = (x, side) => `<div class="book-row ${side}" data-px="${x.p}"><i style="width:${Math.round((x.q / max) * 100)}%"></i><span class="${side === 'ask' ? 'up' : 'down'}">${px(x.p)}</span><span>${fmtQty(x.q)}</span><span>${fmtMoney(x.p * x.q)}</span></div>`;
    bookEl.innerHTML = `<div class="book-head"><span>价格</span><span>数量</span><span>金额</span></div>
      ${[...b.asks].reverse().map((x) => row(x, 'ask')).join('')}
      <div class="book-mid"><b class="${dir(s.chg)}">${px(s.last)}</b><span class="${dir(s.chg)}">${fmtPct(s.chg)}</span></div>
      ${b.bids.map((x) => row(x, 'bid')).join('')}`;
    const st = sim.live(inst, now);
    tapeEl.innerHTML = st.tape.length ? st.tape.slice(-40).reverse().map((t) => `<div><span class="mute">${fmtTime(t.t)}</span><span class="${t.side === 'buy' ? 'up' : 'down'}">${px(t.p)}</span><span>${fmtQty(t.q)}</span></div>`).join('')
      : '<p class="empty">今日暂无成交样本</p>';
  }

  // ---------- 下单 ----------
  const priceIn = $('#o-price', el), qtyIn = $('#o-qty', el), submit = $('#o-submit', el);
  priceIn.value = inst.meets ? sim.live(inst, nowSec()).last : inst.anchor;

  function paintForm(now) {
    $$('.side-tabs button', el).forEach((b) => b.classList.toggle('on', b.dataset.side === prefs.side));
    $$('#otype button', el).forEach((b) => b.classList.toggle('on', b.dataset.type === prefs.type));
    const buy = prefs.side === 'buy';
    submit.className = `btn block ${buy ? 'buy' : 'sell'}`;
    submit.textContent = `${buy ? '买入' : '卖出'} ${inst.name}`;
    priceIn.disabled = prefs.type === 'market' || !inst.meets;
    qtyIn.disabled = !inst.meets;
    submit.disabled = !inst.meets;
    $('#o-avail-l', el).textContent = buy ? '可用研究记分' : '可卖数量';
    $('#o-avail', el).textContent = buy ? fmtNum(account.available()) : `${account.availQty(inst.id)} 百万Token`;
    const hint = $('#o-hint', el);
    if (!inst.meets) {
      hint.className = 'hint warn';
      hint.textContent = `该桶独立供应商 ${inst.suppliers} 家，未达 3 家的发布门槛：只提供公开报价，不开放仿真撮合。`;
      $('#o-amt', el).textContent = '—'; $('#o-fee', el).textContent = '—';
      return;
    }
    const qty = Math.floor(Number(qtyIn.value));
    let amt = null, extra = '';
    if (qty >= 1) {
      if (prefs.type === 'limit') { const p = Number(priceIn.value); if (p > 0) amt = p * qty; }
      else {
        const est = account.quoteMarket(inst, prefs.side, qty, now);
        if (est.got) { amt = est.amt; extra = `均价约 ${px(est.avg)}${est.short ? `，盘口仅能成交 ${est.got}` : ''}`; }
      }
    }
    $('#o-amt', el).textContent = amt == null ? '—' : `${fmtNum(amt)}${extra ? `（${extra}）` : ''}`;
    $('#o-fee', el).textContent = amt == null ? '—' : fmtNum(amt * account.FEE, 4);
    hint.className = 'hint';
    hint.textContent = prefs.type === 'limit'
      ? '限价单：与盘口可成交部分立即成交，余量挂单；当日有效，跨日自动过期。'
      : '市价单：只与当前可见盘口成交，余量立即撤销，不虚构流动性。';
  }

  el.querySelector('.side-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-side]');
    if (b) { prefs.side = b.dataset.side; paintForm(nowSec()); }
  });
  $('#otype', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (b) { prefs.type = b.dataset.type; paintForm(nowSec()); }
  });
  el.querySelector('.pct').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pct]');
    if (!b || !inst.meets) return;
    const pct = Number(b.dataset.pct) / 100;
    const now = nowSec();
    if (prefs.side === 'sell') qtyIn.value = Math.max(0, Math.floor(account.availQty(inst.id) * pct));
    else {
      const p = prefs.type === 'limit' ? Number(priceIn.value) : (sim.book(inst, now).asks[0]?.p ?? sim.live(inst, now).last);
      qtyIn.value = p > 0 ? Math.max(0, Math.floor((account.available() * pct) / (p * (1 + account.FEE)))) : 0;
    }
    paintForm(now);
  });
  for (const input of [priceIn, qtyIn]) input.addEventListener('input', () => paintForm(nowSec()));
  $('#book', el).addEventListener('click', (e) => {
    const r = e.target.closest('[data-px]');
    if (!r) return;
    prefs.type = 'limit';
    priceIn.value = r.dataset.px;
    paintForm(nowSec());
  });
  $('#oform', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const now = nowSec();
    const r = account.placeOrder({ instId: inst.id, side: prefs.side, type: prefs.type, price: priceIn.value, qty: qtyIn.value }, now);
    if (!r.ok) { toast(r.error, 'error'); return; }
    const o = r.order, verb = o.side === 'buy' ? '买入' : '卖出';
    if (o.status === 'filled') toast(`${verb}成交 ${o.filled} 百万Token，均价 ${px(o.avg)}`, 'ok');
    else if (o.status === 'open') toast(o.filled ? `${verb}已成交 ${o.filled} / ${o.qty}，余量挂单中` : `${verb}委托已挂单：${px(o.price)} × ${o.qty}`, 'ok');
    else if (o.filled) toast(`${verb}成交 ${o.filled} / ${o.qty}，均价 ${px(o.avg)}；${o.note}`, 'ok');
    else toast(`未成交：${o.note || '盘口暂无对手单'}`, 'error');
    paintBook(now);
  });

  // ---------- 供应商公开报价 ----------
  function paintQuotes(quotes, asOf, liveMode) {
    const min = Math.min(...quotes.map((x) => x.basket));
    const snap = new Map(inst.quotes.map((x) => [x.p, x.basket]));
    $('#q-asof', el).textContent = `${liveMode ? '实时拉取' : '快照'} ${fmtIso(asOf)}（${ago(asOf)}） · ${esc(inst.qLabel)} 桶 · ${quotes.length} 家独立供应商`;
    $('#quotes', el).innerHTML = `<table class="tbl dense"><thead><tr><th>供应商</th><th>总部 / 机房</th><th>精度</th><th class="num">上下文</th><th class="num">输入</th><th class="num">输出</th><th class="num">缓存读</th><th class="num">固定篮子参考价</th><th class="num">较最低</th><th class="num">近1日可用率</th><th>状态</th></tr></thead><tbody>${quotes.map((x) => {
      const c = S.providerByName.get(x.p);
      const where = c ? `${market.flagOf(c.hq)} ${esc(market.regionName(c.hq))}${c.dcs.length ? ` / ${c.dcs.map(esc).join('·')}` : ''}` : '<span class="mute">未披露</span>';
      const was = snap.get(x.p);
      const moved = liveMode && was != null && Math.abs(x.basket / was - 1) > 1e-9 ? `<span class="${dir(x.basket - was)} small"> ${fmtPct(x.basket / was - 1)} 较快照</span>` : liveMode && was == null ? '<span class="ev ev-real">新增</span>' : '';
      return `<tr><td><a href="#/compute/${encodeURIComponent(x.p)}">${esc(x.p)}</a>${x.p === inst.anchorProvider ? '<span class="chip sm">价格锚</span>' : ''}</td><td>${where}</td><td>${esc(x.q === 'unknown' ? '未声明' : x.q.toUpperCase())}</td>
        <td class="num">${fmtCtx(x.ctx)}</td><td class="num">${fmtPx(x.cny.in)}</td><td class="num">${fmtPx(x.cny.out)}</td><td class="num">${x.cny.cr == null ? '—' : fmtPx(x.cny.cr)}</td>
        <td class="num"><b>${fmtPx(x.basket)}</b>${moved}</td><td class="num">${x.basket === min ? '最低' : fmtPct(x.basket / min - 1, 1)}</td>
        <td class="num">${x.up1d == null ? '—' : `${x.up1d.toFixed(1)}%`}</td><td>${x.ok ? '<span class="down small">合格</span>' : `<span class="up small">${x.st !== 0 ? '降级' : '可用率不足'}</span>`}</td></tr>`;
    }).join('')}</tbody></table>
    <p class="pad mute small">费率单位：元 / 百万Token，按 USD/CNY ${S.fx.rate.toFixed(4)} 换算，原始币种为美元、未含税。价格锚 = 合格供应商（状态正常且近1日可用率 ≥95%）中的最低报价。同一供应商多个端点只取其最低报价。版本由供应商声明，本平台未独立核验权重。</p>`;
  }
  paintQuotes(inst.quotes, S.snapshotAt, false);
  $('#q-refresh', el).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = '拉取中…';
    try {
      const r = await market.fetchLiveQuotes(inst.modelId);
      const bucket = r.buckets.find((b) => b.q === inst.q);
      if (!bucket) toast(`实时目录中已没有 ${inst.qLabel} 精度的端点，继续显示快照`, 'error');
      else { paintQuotes(bucket.quotes, r.asOf, true); toast(`已拉取 ${bucket.quotes.length} 家供应商的实时公开报价`, 'ok'); }
    } catch (err) {
      toast(`实时报价拉取失败（${err.message || err}），继续显示快照`, 'error');
    }
    btn.disabled = false; btn.textContent = '拉取实时报价';
  });

  // ---------- 委托与持仓 ----------
  function paintBottom(now) {
    $$('#btabs button', el).forEach((b) => b.classList.toggle('on', b.dataset.btab === prefs.tab));
    const A = account.acct;
    const open = A.orders.filter((o) => o.status === 'open');
    $('#btabs [data-btab="open"]', el).textContent = `当前委托（${open.length}）`;
    $('#btabs [data-btab="pos"]', el).textContent = `持仓（${Object.keys(A.positions).length}）`;
    $('#bottom', el).innerHTML = prefs.tab === 'open' ? ordersTable(open)
      : prefs.tab === 'pos' ? positionsTable(now)
      : prefs.tab === 'hist' ? ordersTable(A.orders.filter((o) => o.status !== 'open').slice(0, 50))
      : fillsTable(A.fills.slice(0, 50));
  }
  $('#btabs', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-btab]');
    if (b) { prefs.tab = b.dataset.btab; paintBottom(nowSec()); }
  });
  bindActions($('#bottom', el));
  const off = account.onChange(() => { const now = nowSec(); paintBottom(now); paintForm(now); });

  // ---------- 品种选择 ----------
  const picker = $('#picker', el);
  function paintPicker(q) {
    q = q.trim().toLowerCase();
    const now = nowSec();
    const xs = S.insts.filter((i) => !q || i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q))
      .sort((a, b) => Number(b.meets) - Number(a.meets) || b.suppliers - a.suppliers).slice(0, 60);
    $('ul', picker).innerHTML = xs.length ? xs.map((i) => {
      const s = i.meets ? sim.summary(i, now) : null;
      return `<li role="option" data-id="${esc(i.id)}"><span>${esc(i.name)}${chips(i)}</span><span class="num ${s ? dir(s.chg) : 'mute'}">${s ? `${fmtPx(s.last)}  ${fmtPct(s.chg)}` : `${fmtPx(i.anchor)} 报价`}</span></li>`;
    }).join('') : '<li class="mute">没有匹配的品种</li>';
  }
  $('#pick', el).addEventListener('click', (e) => {
    e.stopPropagation();
    picker.hidden = !picker.hidden;
    if (!picker.hidden) { paintPicker(''); const i = $('input', picker); i.value = ''; i.focus(); }
  });
  $('input', picker).addEventListener('input', debounce((e) => paintPicker(e.target.value), 120));
  picker.addEventListener('click', (e) => {
    e.stopPropagation();
    const li = e.target.closest('li[data-id]');
    if (li) location.hash = `#/trade/${encodeURIComponent(li.dataset.id)}`;
  });
  const closePicker = () => { picker.hidden = true; };
  document.addEventListener('click', closePicker);

  // ---------- 图表工具栏 ----------
  $('#views', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b) { prefs.view = b.dataset.view; buildChart(); }
  });
  $('#tfs', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-tf]');
    if (b && !b.disabled) { prefs.tf = b.dataset.tf; buildChart(); }
  });
  $('#task', el).addEventListener('change', (e) => { prefs.task = e.target.value; buildChart(); });

  const now0 = nowSec();
  paintHead(now0); buildChart(); paintBook(now0); paintForm(now0); paintBottom(now0);

  let n = 0;
  return {
    tick(now) {
      paintHead(now); paintBook(now); tickChart(now);
      if (prefs.type === 'market') paintForm(now);
      if (++n % 5 === 0) {
        if (prefs.tab === 'pos') paintBottom(now);
        paintStrip(now);
        if (chart && prefs.view === 'trade' && !isIntra()) {
          const rows = tradeRows(now);
          for (const m of series.mas) m.s.setData(sma(rows, m.n));
        }
      }
    },
    destroy() { off(); document.removeEventListener('click', closePicker); if (chart) chart.remove(); },
  };
}
