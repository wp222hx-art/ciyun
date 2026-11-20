// 版税分账：真实渠道收入 → 有凭证的扣项 → 可分配收入 → 中心费用 → 按合同比例分配（方案 V4.0 G14、G19）
import * as wf from '../core/waterfall.js';
import * as access from '../core/access.js';
import { $, esc, toast, nowSec, fmtUsd, EXAMPLE, tag, debounce } from '../ui.js';
import { $t, tx } from '../i18n.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const fresh = () => {
  const g = clone(wf.G19);
  for (const d of g.deductions) { d.label = tx(d.label); d.evidence = tx(d.evidence); }
  for (const x of g.splits) x.name = tx(x.name);
  return { ...g, feePct: wf.G19.feeRate * 100, received: true };
};
let form = fresh();
const COLORS = ['#0ecb81', '#b07cff', '#3d8bff', '#f0b90b', '#ff8a4c', '#2cc7d6'];

export function mount(el) {
  el.innerHTML = `
  <div class="page-head"><h2>${$t("版税分账")} ${EXAMPLE}</h2>
    <p>${$t("一笔海外发行收入到账之后，钱怎么一层层分下去。顺序是固定的：先扣合同明确且有凭证的渠道退款和费用，得到可分配收入；中心只在这个基数上收一次服务费；剩下的按合同比例分给权利人和合作方。每一分钱都对得上，各项相加严格等于毛收入。")}</p></div>
  <div class="split wide-r">
    <section class="panel">
      <header><h3>${$t("合同参数")}</h3><span class="mute small">${$t("默认值是方案 V4.0 G19 的算例，单位美元")}</span><span class="sp"></span><button class="btn sm" type="button" data-act="reset">${$t("恢复算例")}</button></header>
      <form id="f" class="pad" novalidate autocomplete="off">
        <div class="form-grid">
          <label class="field"><span>${$t("渠道毛收入")}</span><input class="input mono" type="number" name="gross" min="0" step="0.01"></label>
          <label class="field"><span>${$t("中心服务费率")}<em class="mute">${$t("% · 只作用于可分配收入")}</em></span><input class="input mono" type="number" name="feePct" min="0" max="99" step="0.5"></label>
        </div>
        <h4 class="sub-h">${$t("扣项")}<span class="mute small">　${$t("没有凭证引用的扣项不进瀑布")}</span></h4>
        <div class="rows-edit d3" id="ded"></div>
        <button class="btn sm" type="button" data-act="add-ded">${$t("＋ 加一条扣项")}</button>
        <h4 class="sub-h">${$t("分配对象")}<span class="mute small">　${$t("比例之和必须等于 100%")}</span></h4>
        <div class="rows-edit d2" id="spl"></div>
        <button class="btn sm" type="button" data-act="add-spl">${$t("＋ 加一方")}</button>
        <div class="btn-row" style="margin-top:14px"><label class="inline"><input type="checkbox" name="received"> ${$t("渠道款项已到账（有外部到账凭证）")}</label></div>
      </form>
    </section>
    <div>
      <section class="panel mb"><header><h3>${$t("分账瀑布")}</h3><span id="bal"></span></header><div id="out"></div></section>
      <section class="panel"><header><h3>${$t("中心到底赚多少")}</h3></header><div class="pad" id="rev"></div></section>
    </div>
  </div>
  <section class="panel"><div class="pad mute small">
    <b style="color:var(--text)">${$t("不能自动化的部分：")}</b>${$t("版权归属争议、侵权通知、未决退单、银行审查及税务扣缴须有人工和专业流程。自动分账只处理已确认、可用且允许支付的收入；渠道未回款、争议和扣款不会被算成已实现收益。本例不计税、汇差和最低保证，真实合同要明确税由谁承担、在哪一步扣。 面向公众出售分红份额、承诺被动回报或资金池统一经营属于金融产品审查范围，本环境不提供。")}</div></section>`;

  const f = $('#f', el);
  function paintInputs() {
    f.elements.gross.value = form.gross;
    f.elements.feePct.value = form.feePct;
    f.elements.received.checked = form.received;
    $('#ded', el).innerHTML = form.deductions.map((d, i) => `<div><input class="input" data-k="deductions" data-i="${i}" data-f="label" value="${esc(d.label)}" placeholder="${$t("扣项名称")}" aria-label="${$t("扣项名称")}">
      <input class="input mono" type="number" min="0" step="0.01" data-k="deductions" data-i="${i}" data-f="amount" value="${d.amount}" aria-label="${$t("扣项金额")}">
      <input class="input" data-k="deductions" data-i="${i}" data-f="evidence" value="${esc(d.evidence)}" placeholder="${$t("凭证引用（必填才可扣）")}" aria-label="${$t("凭证引用")}">
      <button class="icon-btn" type="button" data-act="del" data-k="deductions" data-i="${i}" aria-label="${$t("删除扣项")}">×</button></div>`).join('') || `<p class="mute small">${$t("没有扣项。")}</p>`;
    $('#spl', el).innerHTML = form.splits.map((s, i) => `<div><input class="input" data-k="splits" data-i="${i}" data-f="name" value="${esc(s.name)}" placeholder="${$t("分配对象")}" aria-label="${$t("分配对象")}">
      <input class="input mono" type="number" min="0" max="100" step="0.5" data-k="splits" data-i="${i}" data-f="pct" value="${s.pct}" aria-label="${$t("比例")}">
      <button class="icon-btn" type="button" data-act="del" data-k="splits" data-i="${i}" aria-label="${$t("删除分配对象")}">×</button></div>`).join('');
  }

  function paintOut() {
    const r = wf.allocate({ gross: form.gross, deductions: form.deductions, feeRate: form.feePct / 100, splits: form.splits, received: form.received });
    const out = $('#out', el), bal = $('#bal', el), rev = $('#rev', el);
    if (!r.ok) {
      bal.innerHTML = `<span class="badge bad">${$t("参数无效")}</span>`;
      out.innerHTML = `<div class="callout bad" style="margin:14px">${esc(r.error)}</div>`;
      rev.innerHTML = `<p class="mute">${$t("参数修正后显示。")}</p>`;
      return null;
    }
    const G = r.gross, pct = (x) => `${(x / G) * 100}%`;
    let x = 0;
    const row = (label, amt, color, cls = '') => { const html = `<div class="wf-row ${cls}"><span class="lab" title="${esc(label)}">${esc(label)}</span><div class="track"><i style="left:${pct(x)};width:${pct(amt)};background:${color}"></i></div><span class="amt">${fmtUsd(amt)}</span></div>`; x += amt; return html; };
    const full = (label, amt, color) => `<div class="wf-row"><span class="lab">${esc(label)}</span><div class="track"><i style="left:0;width:${pct(amt)};background:${color}"></i></div><span class="amt">${fmtUsd(amt)}</span></div>`;
    bal.innerHTML = r.balanced ? `<span class="badge ok">${$t("各项相加 = 毛收入")}</span>` : `<span class="badge bad">${$t("不平")}</span>`;
    out.innerHTML = `<div class="wf">
      ${full($t("渠道毛收入"), G, '#5b6573')}
      ${r.deductions.map((d) => row(`− ${d.label}`, d.amount, '#f6465d')).join('')}
      ${full($t("＝ 可分配收入"), r.base, '#3a4656')}
      ${row($t("− 中心服务费 {0}%", form.feePct), r.fee, '#3d8bff')}
      ${r.shares.map((s, i) => row(`→ ${s.name} ${s.pct}%`, s.amount, COLORS[i % COLORS.length])).join('')}
      <div class="wf-row total"><span class="lab">${$t("合计")}</span><span class="mono small mute">${[...r.deductions.map((d) => fmtUsd(d.amount, 0)), fmtUsd(r.fee, 0), ...r.shares.map((s) => fmtUsd(s.amount, 0))].join(` ${$t("＋")} `)}</span><span class="amt">${fmtUsd(G)}</span></div>
    </div>
    ${r.rejected.length ? `<div class="callout warn" style="margin:0 14px 14px"><b>${$t("{0} 条扣项没有凭证引用，未计入：", r.rejected.length)}</b>${r.rejected.map((d) => `${esc(d.label)} ${fmtUsd(d.amount)}`).join($t("、"))}${$t("。合同明确且有凭证才可扣。")}</div>` : ''}
    ${r.received ? '' : `<div class="callout warn" style="margin:0 14px 14px"><b>${$t("款项尚未到账：")}</b>${$t("上面是按合同测算的应分金额，目前可支付金额为 {0}。未到账不显示已分配。", fmtUsd(0))}</div>`}`;
    rev.innerHTML = `<div class="kv"><span>${$t("渠道毛收入（不是中心收入）")}</span><b>${fmtUsd(G)}</b></div>
      <div class="kv"><span>${$t("可分配收入（不是中心收入）")}</span><b>${fmtUsd(r.base)}</b></div>
      <div class="kv"><span>${$t("各方应分合计（不是中心收入）")}</span><b>${fmtUsd(r.rest)}</b></div>
      <div class="kv" style="border-top:1px solid var(--line);margin-top:4px;padding-top:6px"><span>${$t("中心确认的服务收入")}</span><b style="color:var(--accent)">${fmtUsd(r.centreRevenue)}${r.received ? '' : $t("（到账后确认）")}</b></div>
      <p class="hint">${$t("代理模式下，中心只确认自己的服务费，不把毛收入或可分配收入当自有收入，合作方拿走的部分也不是中心收入。费用只扣一次，不在毛收入和净收入两头重复扣。")}</p>
      <div class="btn-row" style="margin-top:10px"><button class="btn primary" type="button" data-act="save">${$t("把本次测算写入存证链")}</button><a class="btn" href="#/evidence">${$t("去溯源存证")}</a></div>`;
    return r;
  }

  const refresh = debounce(paintOut, 80);
  el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.k) { const v = t.type === 'number' ? Number(t.value) : t.value; form[t.dataset.k][Number(t.dataset.i)][t.dataset.f] = v; } else if (t.name === 'gross') form.gross = Number(t.value); else if (t.name === 'feePct') form.feePct = Number(t.value);
    else if (t.name === 'received') form.received = t.checked;
    refresh();
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'reset') { form = fresh(); paintInputs(); paintOut(); toast($t("已恢复为方案 G19 算例")); } else if (a === 'add-ded') { form.deductions.push({ label: '', amount: 0, evidence: '' }); paintInputs(); paintOut(); } else if (a === 'add-spl') { form.splits.push({ name: '', pct: 0 }); paintInputs(); paintOut(); } else if (a === 'del') { form[b.dataset.k].splice(Number(b.dataset.i), 1); paintInputs(); paintOut(); } else if (a === 'save') {
      const r = paintOut();
      if (!r) return toast($t("参数无效，不能写入"), 'error');
      access.log('royalty.allocate', '分配测算', `SIM-FZ-${Math.floor(nowSec())}`, { gross: r.gross, deducted: r.deducted, base: r.base, fee: r.fee, shares: r.shares.map((s) => [s.name, s.amount]), received: r.received, digest: access.digest(r) }, nowSec());
      toast($t("已写入存证链：记录的是测算结果与摘要，不是付款"), 'ok');
    }
  });
  paintInputs(); paintOut();
  return {};
}
