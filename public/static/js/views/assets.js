// 资产：研究记分账户、持仓、委托、成交、履约记录、账务勾稽
import * as market from '../core/market.js';
import * as account from '../core/account.js';
import { $, $$, esc, fmtNum, fmtPct, fmtInt, fmtDateTime, dir, toast, nowSec } from '../ui.js';
import { ordersTable, positionsTable, fillsTable, bindActions, instLink } from './shared.js';

const prefs = { tab: 'pos' };
const TABS = [['pos', '持仓'], ['open', '当前委托'], ['hist', '历史委托'], ['fills', '成交记录'], ['deliv', '履约记录']];

function deliveries() {
  const A = account.acct;
  const rows = [
    ...A.deliveries.map((d) => ({ t: d.t, what: instLink(d.instId), kind: '消耗持有额度', qty: `${d.qty} 百万Token（输入 ${d.inTok} / 输出 ${d.outTok}）`, cost: d.cost })),
    ...A.contracts.filter((c) => c.status === 'settled').map((c) => ({ t: c.settledAt, what: `${esc(c.modelName)} · ${esc(c.provider)}`, kind: `采购合同 #${c.id}`, qty: `合格任务 ${fmtInt(c.bill.qualified)} 个`, cost: c.bill.total })),
  ].sort((a, b) => b.t - a.t);
  if (!rows.length) return '<p class="empty">暂无履约记录。在持仓里消耗额度，或在采购台完成合同结算后，这里会留下记录。</p>';
  return `<div class="table-wrap"><table class="tbl dense"><thead><tr><th>时间</th><th>服务</th><th>来源</th><th>交付量</th><th class="num">计入已消耗</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="num">${fmtDateTime(r.t).slice(5)}</td><td>${r.what}</td><td>${r.kind}</td><td>${r.qty}</td><td class="num">${fmtNum(r.cost)}</td></tr>`).join('')}</tbody></table></div>`;
}

export function mount(el) {
  el.innerHTML = `
  <div class="page-head"><h2>资产</h2>
    <p>研究记分账户。期初 ${fmtInt(account.INITIAL)}，不可充值、不可转让、不可兑换，不挂钩任何奖品。数据只保存在这台设备的浏览器里。</p></div>
  <div class="cards" id="cards"></div>
  <section class="panel" style="margin-bottom:12px">
    <header><div class="tabs" id="tabs">${TABS.map(([k, v]) => `<button data-tab="${k}">${v}</button>`).join('')}</div></header>
    <div id="body"></div>
  </section>
  <section class="panel">
    <header><h3>账务勾稽</h3><span class="sp"></span><button class="btn sm danger" id="reset" type="button">重置仿真账户</button></header>
    <div class="pad" id="recon"></div>
  </section>`;

  function paintCards(now) {
    const e = account.equity(now), A = account.acct;
    const pnl = A.realized + e.upnl;
    const card = (h, big, sub, cls = '') => `<div class="card"><h4>${h}</h4><p class="big ${cls}">${big}</p><p class="sub">${sub}</p></div>`;
    $('#cards', el).innerHTML =
      card('总权益', fmtNum(e.total), `现金 ${fmtNum(e.cash)} + 持仓市值 ${fmtNum(e.mv)}`) +
      card('可用研究记分', fmtNum(e.available), `挂单冻结 ${fmtNum(e.frozen)}`) +
      card('交易盈亏', fmtNum(pnl), `已实现 ${fmtNum(A.realized)} · 浮动 ${fmtNum(e.upnl)}`, dir(pnl)) +
      card('已履约消耗', fmtNum(A.consumed), '消耗额度与合同结算，是使用而非亏损') +
      card('累计手续费', fmtNum(A.fees, 4), `费率 ${(account.FEE * 100).toFixed(1)}%〔示例假设〕`);
  }

  function paintBody(now) {
    const A = account.acct;
    const open = A.orders.filter((o) => o.status === 'open');
    $$('#tabs button', el).forEach((b) => b.classList.toggle('on', b.dataset.tab === prefs.tab));
    $('#tabs [data-tab="pos"]', el).textContent = `持仓（${Object.keys(A.positions).length}）`;
    $('#tabs [data-tab="open"]', el).textContent = `当前委托（${open.length}）`;
    // 输入框有焦点时不重绘持仓表，避免打断正在输入的消耗数量
    if (prefs.tab === 'pos' && $('#body', el).contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    $('#body', el).innerHTML = prefs.tab === 'pos' ? positionsTable(now, true)
      : prefs.tab === 'open' ? ordersTable(open)
      : prefs.tab === 'hist' ? ordersTable(A.orders.filter((o) => o.status !== 'open').slice(0, 80))
      : prefs.tab === 'fills' ? fillsTable(A.fills.slice(0, 80))
      : deliveries();
  }

  function paintRecon() {
    const A = account.acct, r = account.reconcile();
    $('#recon', el).innerHTML = `
      <div class="kv"><span>期初研究记分</span><b>${fmtNum(account.INITIAL)}</b></div>
      <div class="kv"><span>＋ 已实现交易盈亏（已扣手续费）</span><b class="${dir(A.realized)}">${fmtNum(A.realized)}</b></div>
      <div class="kv"><span>－ 已履约消耗</span><b>${fmtNum(A.consumed)}</b></div>
      <div class="kv" style="border-top:1px solid var(--line);margin-top:4px;padding-top:6px"><span>＝ 应有余额</span><b>${fmtNum(r.left)}</b></div>
      <div class="kv"><span>现金 ${fmtNum(A.cash)} ＋ 持仓成本 ${fmtNum(r.cost)}</span><b>${fmtNum(r.right)}</b></div>
      <p class="hint ${r.ok ? '' : 'warn'}">${r.ok ? '两侧一致：每一分研究记分都能对上来源和去向。' : '两侧不一致，账户数据可能被外部修改。可以重置仿真账户。'}</p>`;
  }

  $('#tabs', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) { prefs.tab = b.dataset.tab; document.activeElement?.blur?.(); paintBody(nowSec()); }
  });
  bindActions($('#body', el));
  $('#reset', el).addEventListener('click', () => {
    if (!window.confirm('重置后，持仓、委托、成交、合同全部清空，研究记分恢复为期初值。此操作不能撤销，确定重置吗？')) return;
    account.reset();
    toast('仿真账户已重置', 'ok');
  });

  const all = () => { const now = nowSec(); paintCards(now); document.activeElement?.blur?.(); paintBody(now); paintRecon(); };
  const off = account.onChange(all);
  all();

  let n = 0;
  return {
    tick(now) { paintCards(now); if (++n % 3 === 0 && prefs.tab === 'pos') paintBody(now); },
    destroy() { off(); },
  };
}
