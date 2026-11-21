// 入场与审批：三条入口 → 四个审核环节 → 发放编号 → 上架预检 → 存证链
// 流程为拟议设想的仿真，由使用者自己扮演审核方；编号带 SIM 前缀，非真实登记凭证
import * as market from '../core/market.js';
import * as access from '../core/access.js';
import { $, esc, fmtDateTime, fmtPx, toast, nowSec, tag, REAL, confirmDialog } from '../ui.js';
import { factCards } from '../facts.js';
import { $t, tx } from '../i18n.js';

let draft = null;
let verifyMsg = '';
const clone = (o) => JSON.parse(JSON.stringify(o));
const defaults = () => ({ role: 'buyer', region: 'CN', org: '', uscc: '', contact: '', channel: 'online', materials: [], pledge: false, sceneTitle: '', category: '', sceneDesc: '', pii: false, piiAssessed: false, cross: false, crossReady: false, center: '' });
const PLAN = tag('syn', $t("拟议流程"));
const CHANNEL_NOTE = { online: $t("在本页填表提交"), base: $t("对应\"一所、多基地\"：区域服务基地协助准备材料并代为提交"), broker: $t("由数据经纪人辅导合规、推荐入场") };

function demoData(role, S) {
  const base = { ...defaults(), role, org: $t("湾区演示制造有限公司（虚构）"), uscc: '91440101000000000J', contact: 'demo@example.com', materials: access.ROLES[role].materials.map(() => true), pledge: true };
  if (role === 'creator') return { ...base, region: 'MO', org: $t("示例片方甲（虚构）"), uscc: 'SIM-MO-0001', sceneTitle: $t("AI 辅助短片海外许可"), category: 'license', sceneDesc: $t("持有具有人类编剧与剪辑记录的 AI 辅助短片，向合格海外发行方授予限定地域、语言、渠道和期限的许可。") };
  if (role === 'supplier') {
    const c = S.centers.find((x) => x.dcs.length && access.precheck(x).some((r) => r.pass));
    return { ...base, org: $t("湾区演示算力有限公司（虚构）"), sceneTitle: $t("推理服务供给"), category: 'serve', center: c ? c.name : '', sceneDesc: $t("向已入场的企业买方提供可计量、可核验的文本推理服务，按分项用量出账。") };
  }
  if (role === 'broker') return { ...base, org: $t("湾区演示数据经纪有限公司（虚构）"), channel: 'broker', sceneTitle: $t("受托采购撮合"), category: 'match', sceneDesc: $t("受企业委托筛选合规供给、辅导材料准备并协同交付验收，自身不持有额度。") };
  return { ...base, sceneTitle: $t("售后知识助手"), category: 'kb', sceneDesc: $t("用于售后工程师检索产品手册与维修案例，输出带来源的回答，不向第三方转供。") };
}

export function mount(el) {
  const S = market.state;
  el.innerHTML = `
  <div class="page-head"><h2>${$t("入场审批 {0}", PLAN)}</h2>
    <p>${$t("想在中心挂牌、询价或下单，先完成主体登记。全球网络不是匿名责任网络：每个主体都要说清自己是谁、谁是受益所有人、打算拿服务做什么。下面把入场做成一条可以走一遍的流程——选角色和入口、交材料、登记场景、合规会审、发编号，每一步都留痕。")}</p></div>
  <section class="panel" style="margin-bottom:12px">
    <header><h3>${$t("审批流程：四个环节")}</h3>${PLAN}<span class="sp"></span><span class="mute small">${$t("三条入口，同一套审批")}</span></header>
    <div id="pipe"></div>
    <p class="pad mute small">${$t("环节、材料和时限是我们参照公开原则设计的设想：不是广州数据交易所的业务规则，也不是澳门任何主管机关的要求。真实的 KYB／KYC、制裁及 PEP 筛查须由责任主体按适用法律实施，这里没有做。演示里没有真人审核：由你自己点\"通过\"或\"退回\"，检查项不合格时系统不允许通过。")}</p>
  </section>
  <section class="panel" id="main" style="margin-bottom:12px"></section>
  <section class="panel" id="listing" style="margin-bottom:12px" hidden></section>
  <section class="panel" id="roles" style="margin-bottom:12px">
    <header><h3>${$t("四类入场角色")}</h3>${PLAN}</header>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>${$t("角色")}</th><th>${$t("定位")}</th><th>${$t("申请材料")}</th><th>${$t("入场后可以")}</th></tr></thead><tbody>
    ${Object.values(access.ROLES).map((r) => `<tr><td><b>${r.name}</b></td><td>${r.desc}</td><td class="small">${r.materials.join($t("、"))}</td><td>${r.unlock}</td></tr>`).join('')}
    </tbody></table></div>
  </section>
  <section class="panel" style="margin-bottom:12px">
    <header><h3>${$t("设计参照：广东公开确立的数据流通原则")}</h3><span class="mute small">${$t("公开事实 · 每条附来源")}</span></header>
    <div class="facts" style="padding:12px 14px 0;margin-bottom:0">${factCards()}</div>
    <p class="pad mute small">${$t("上面的审批环节借鉴了这些公开原则的思路。澳门词元中心是拟议名称，不是广州数据交易所的澳门分支，没有取得其品牌授权、业务规则或接口；列在这里只说明设计出处。")}</p>
  </section>
  <section class="panel" id="ledger"></section>`;

  const opt = (v, label, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
  const chk = (name, on, label) => `<label class="inline"><input type="checkbox" name="${name}"${on ? ' checked' : ''}> ${label}</label>`;

  function pipeHtml() {
    const a = access.st.app, m = access.st.member;
    return `<div class="pipe">${access.STEPS.map((s, k) => {
      let cls = '', state = $t("待办");
      if (m) { cls = 'done'; state = $t("✓ 已通过"); }
      else if (a?.status === 'reviewing') { if (k < a.step) { cls = 'done'; state = $t("✓ 已通过"); } else if (k === a.step) { cls = 'cur'; state = $t("审核中"); } }
      else if (a?.status === 'returned' && s.name === a.returnStep) { cls = 'back'; state = $t("✗ 已退回"); }
      return `<div class="${cls}"><b>${k + 1}. ${s.name}</b><small>${$t("{0} · 拟议 {1}", s.actor, s.sla)}</small><small>${s.what}</small><small>${state}</small></div>`;
    }).join('')}</div>`;
  }

  function formHtml(f, a) {
    const role = access.ROLES[f.role];
    const cats = access.CATEGORIES.filter((c) => c.roles.includes(f.role));
    return `<header><h3>${$t("入场申请")}</h3>${PLAN}<span class="sp"></span><button class="btn sm" type="button" data-act="fill">${$t("填入演示数据")}</button></header>
    ${a?.status === 'returned' ? `<p class="hint warn" style="margin:12px 14px 0">${$t("上次申请在\"{0}\"被退回：{1}。补正后重新提交，审核从第一环节重新开始。", esc(a.returnStep), esc(a.returnNote))}</p>` : ''}
    <form class="pad" id="apply" novalidate autocomplete="off">
      <h4 class="sub-h">${$t("① 主体与入口")}</h4>
      <div class="form-grid">
        <label class="field"><span>${$t("入场角色")}</span><select class="input" name="role">${Object.entries(access.ROLES).map(([k, r]) => opt(k, r.name, f.role)).join('')}</select></label>
        <label class="field"><span>${$t("入口")}</span><select class="input" name="channel">${Object.entries(access.CHANNELS).map(([k, v]) => opt(k, v, f.channel)).join('')}</select></label>
        <label class="field"><span>${$t("主体名称")}</span><input class="input" name="org" value="${esc(f.org)}" placeholder="${$t("企业全称")}"></label>
        <label class="field"><span>${$t("主体注册地")}</span><select class="input" name="region">${Object.entries(access.REGIONS).map(([k, v]) => opt(k, v, f.region || 'CN')).join('')}</select></label>
        <label class="field"><span>${(f.region || 'CN') === 'CN' ? `${$t("统一社会信用代码")}<em class="mute">${$t("18 位，校验位须正确")}</em>` : `${$t("商业登记编号")}<em class="mute">${$t("演示不校验格式")}</em>`}</span><input class="input mono" name="uscc" value="${esc(f.uscc)}" maxlength="${(f.region || 'CN') === 'CN' ? 18 : 32}"></label>
        <label class="field"><span>${$t("联系邮箱")}</span><input class="input" name="contact" type="email" value="${esc(f.contact)}"></label>
      </div>
      <p class="mute small">${$t("{0}。入口说明：{1}。", role.desc, Object.entries(access.CHANNELS).map(([k, v]) => $t("{0}——{1}", tx(v), CHANNEL_NOTE[k])).join($t("；")))}</p>
      <h4 class="sub-h">${$t("② 申请材料")}<span class="mute small">　${$t("勾选表示已提供（演示不上传文件）")}</span></h4>
      <div class="mat">${role.materials.map((m, i) => chk(`m${i}`, f.materials[i], m)).join('')}</div>
      <h4 class="sub-h">${$t("③ 场景登记")}<span class="mute small">　${$t("无场景不登记")}</span></h4>
      <div class="form-grid">
        <label class="field"><span>${$t("场景名称")}</span><input class="input" name="sceneTitle" value="${esc(f.sceneTitle)}"></label>
        <label class="field"><span>${$t("用途类别")}</span><select class="input" name="category"><option value="">${$t("请选择")}</option>${cats.map((c) => opt(c.id, c.name, f.category)).join('')}</select></label>
        ${f.role === 'supplier' ? `<label class="field"><span>${$t("拟上架的算力中心")}<em class="mute">${$t("来自公开目录")}</em></span><select class="input" name="center"><option value="">${$t("请选择")}</option>${S.centers.map((c) => opt(c.name, $t("{0}（{1} 个服务{2}）", c.name, c.n, c.dcs.length ? '' : ` ${$t("· 未披露机房")}`), f.center)).join('')}</select></label>` : ''}
      </div>
      <label class="field"><span>${$t("场景说明")}<em class="mute">${$t("不少于 20 字")}</em></span><textarea class="input" name="sceneDesc" rows="2">${esc(f.sceneDesc)}</textarea></label>
      <h4 class="sub-h">${$t("④ 合规声明")}</h4>
      <div class="mat">
        ${chk('pii', f.pii, $t("涉及个人信息"))}${f.pii ? chk('piiAssessed', f.piiAssessed, $t("已完成个人信息保护影响评估")) : ''}
        ${chk('cross', f.cross, $t("涉及数据出境"))}${f.cross ? chk('crossReady', f.crossReady, $t("已确认出境合规路径")) : ''}
        ${chk('pledge', f.pledge, $t("承诺材料真实，采购用于实际使用，不转售、不囤积"))}
      </div>
      <div class="btn-row"><button class="btn primary" type="submit">${$t("提交申请")}</button><span class="mute small">${$t("提交后由四个环节逐项检查，不合格会退回补正。")}</span></div>
    </form>`;
  }

  function trailHtml(a) {
    return `<div class="table-wrap"><table class="tbl dense"><thead><tr><th>${$t("时间")}</th><th>${$t("经办")}</th><th>${$t("动作")}</th><th>${$t("说明")}</th></tr></thead><tbody>${[...a.trail].reverse().map((t) => `<tr><td class="num">${fmtDateTime(t.t).slice(5)}</td><td>${esc(t.who)}</td><td>${esc(t.action)}</td><td class="small" style="white-space:normal">${esc(t.note)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function reviewHtml(a) {
    const step = access.STEPS[a.step];
    const cs = access.checks(a.form, step.id);
    const bad = cs.filter((c) => !c.ok).length;
    return `<header><h3>${$t("审批进行中")}</h3>${PLAN}<span class="mute small">${$t("申请号 {0} · {1} · {2}", esc(a.id), esc(a.form.org), access.ROLES[a.form.role].name)}</span></header>
    <div class="pad">
      <p><b>${$t("当前环节：{0}", step.name)}</b>　${$t("经办 {0}　拟议时限 {1}", step.actor, step.sla)}</p>
      <ul class="checks">${cs.map((c) => `<li class="${c.ok ? 'ok' : 'no'}">${esc(c.label)}</li>`).join('')}</ul>
      ${bad ? `<p class="hint warn" style="margin-bottom:10px">${$t("有 {0} 项检查未通过，本环节不能通过，只能退回补正。", bad)}</p>` : ''}
      <div class="btn-row">
        <button class="btn primary" type="button" data-act="pass"${bad ? ' disabled' : ''}>${$t("通过本环节")}</button>
        <input class="input" id="ret-note" placeholder="${bad ? $t("退回理由（留空则引用未通过的检查项）") : $t("退回理由（必填）")}" style="max-width:320px">
        <button class="btn danger" type="button" data-act="return">${$t("退回补正")}</button>
        <button class="btn" type="button" data-act="auto">${$t("一键走完后续环节（演示）")}</button>
        <button class="btn" type="button" data-act="withdraw">${$t("撤回申请")}</button>
      </div>
    </div>${trailHtml(a)}`;
  }

  function certHtml(m) {
    const reg = [...access.st.ledger].reverse().find((e) => e.type === 'access.register' && e.ref === m.no);
    const cat = access.CATEGORIES.find((c) => c.id === m.category);
    const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
    return `<header><h3>${$t("已取得入场资格")}</h3><span class="ev ev-syn">${$t("演示凭证")}</span></header>
    <div class="cert" id="cert">
      <h4>${$t("入场登记凭证")}</h4>
      <div class="dl">
        ${kv($t("入场编号"), esc(m.no))}${kv($t("场景登记号"), esc(m.sceneNo))}${kv($t("主体名称"), esc(m.org))}${kv($t("注册地"), access.REGIONS[m.region || 'CN'])}${kv((m.region || 'CN') === 'CN' ? $t("统一社会信用代码") : $t("商业登记编号"), esc(m.uscc))}
        ${kv($t("入场角色"), access.ROLES[m.role].name)}${kv($t("入口"), access.CHANNELS[m.channel] || '—')}${kv($t("登记场景"), esc(m.sceneTitle))}${kv($t("用途类别"), cat ? cat.name : '—')}
        ${m.center ? kv($t("登记的算力中心"), esc(m.center)) : ''}${kv($t("登记时间"), fmtDateTime(m.approvedAt))}
      </div>
      <p class="hash" style="margin-top:10px">${$t("存证哈希 {0}", reg ? reg.hash : $t("（记录已滚动出本机存证链）"))}</p>
      <p class="mute small" style="margin-top:6px">${$t("编号带 SIM 前缀，是本仿真环境生成的演示编号，不是任何交易所或主管机关签发的登记凭证，不具任何效力。")}</p>
    </div>
    <div class="pad btn-row" style="padding-top:0">
      ${m.role === 'supplier' ? `<span class="mute small">${$t("下方可为登记的算力中心做上架预检。")}</span>` : m.role === 'creator' ? `<a class="btn primary" href="#/listing/new">${$t("去新建挂牌")}</a>` : `<a class="btn primary" href="#/procure">${$t("去采购台签约")}</a>`}
      <a class="btn" href="#/listing">${$t("去挂牌大厅")}</a>
      <a class="btn" href="#/trade">${$t("去交易仿真")}</a>
      <button class="btn danger" type="button" data-act="revoke">${$t("撤销入场资格")}</button>
    </div>`;
  }

  function listingHtml(m) {
    const c = S.centerByName.get(m.center);
    if (!c) return `<header><h3>${$t("上架预检")}</h3></header><p class="empty">${$t("公开目录里已找不到算力中心\"{0}\"。", esc(m.center))}</p>`;
    const rows = access.precheck(c);
    const fresh = rows.filter((r) => r.pass && !access.isListed(r.inst.id, c.name)).length;
    const mark = (x) => (x.ok ? '<span class="down">✓</span>' : `<span class="${x.hard ? 'up' : 'mute'}">✗</span>`);
    return `<header><h3>${$t("上架预检：{0}", esc(c.name))}</h3>${REAL}<span class="mute small">${$t("逐项检查用的是公开目录里的真实数据 · 无合规不上架")}</span><span class="sp"></span>
      <button class="btn sm primary" type="button" data-act="list"${fresh ? '' : ' disabled'}>${$t("登记 {0} 个通过预检的产品", fresh)}</button></header>
    <div class="table-wrap"><table class="tbl dense"><thead><tr><th>${$t("模型 / 桶")}</th><th class="num">${$t("固定篮子报价")}</th><th>${$t("精度已声明")}</th><th>${$t("状态正常")}</th><th>${$t("可用率 ≥95%")}</th><th>${$t("机房已披露")}</th><th>${$t("权重可核验")}</th><th>${$t("结论")}</th><th>${$t("产品登记号")}</th></tr></thead><tbody>
    ${rows.map((r) => {
      const l = access.st.listings.find((x) => x.instId === r.inst.id && x.provider === c.name);
      const why = r.items.find((x) => x.hard && !x.ok);
      return `<tr><td>${esc(r.inst.name)}<span class="chip sm">${esc(r.inst.qLabel)}</span></td><td class="num">${fmtPx(r.quote.basket)}</td>${r.items.map((x) => `<td>${mark(x)}</td>`).join('')}
        <td>${r.pass ? `<span class="down">${$t("通过")}</span>` : `<span class="up">${$t("不通过")}</span> <span class="mute small">${esc(why.label.replace('已', '未').replace('正常', '异常').replace('≥95%', '不足 95%'))}</span>`}</td><td class="mono small">${l ? esc(l.no) : '—'}</td></tr>`;
    }).join('')}</tbody></table></div>
    <p class="pad mute small">${$t("前四项是硬门槛，任何一项不过就不能上架。\"权重可核验\"是提示项：闭源模型只能标\"版本由供应商声明\"。通过预检并登记的产品，在交易页的供应商报价里显示\"已登记\"。{0}", c.dcs.length ? '' : $t("该算力中心没有披露机房所在地，所以全部产品都不通过。"))}</p>`;
  }

  function renderLedger() {
    const L = access.st.ledger;
    const label = (e) => `${access.EVENTS[e.type] || e.type}${e.type === 'access.pass' || e.type === 'access.return' ? ` · ${access.STEPS.find((s) => s.id === e.data.step)?.name || ''}` : ''}`;
    $('#ledger', el).innerHTML = `<header><h3>${$t("存证链")}</h3><span class="mute small">${$t("{0} 条 · 每条的哈希包含上一条的哈希 ·", L.length)} <a href="#/evidence">${$t("批次承诺与包含性证明见溯源存证")}</a></span><span class="sp"></span>
      <button class="btn sm" type="button" data-act="verify">${$t("校验存证链")}</button><button class="btn sm" type="button" data-act="tamper"${L.length < 2 ? ' disabled' : ''}>${$t("模拟篡改后再校验")}</button></header>
    <p class="pad" id="verify-out" style="padding-bottom:0">${verifyMsg || `<span class="mute">${$t("点\"校验存证链\"逐条重算哈希；\"模拟篡改\"会在一份副本里改动一条记录，看能不能被查出来。")}</span>`}</p>
    ${L.length ? `<div class="table-wrap"><table class="tbl dense"><thead><tr><th class="num">#</th><th>${$t("时间")}</th><th>${$t("事件")}</th><th>${$t("经办")}</th><th>${$t("关联编号")}</th><th>${$t("本条哈希")}</th><th>${$t("上一条")}</th></tr></thead><tbody>
      ${[...L].reverse().slice(0, 40).map((e) => `<tr><td class="num">${e.i}</td><td class="num">${fmtDateTime(e.t).slice(5)}</td><td>${esc(label(e))}</td><td>${esc(e.actor)}</td><td class="mono small">${esc(e.ref)}</td><td class="hash" title="${e.hash}">${e.hash.slice(0, 20)}…</td><td class="hash">${e.prev === 'GENESIS' ? $t("起始") : `${e.prev.slice(0, 8)}…`}</td></tr>`).join('')}
      </tbody></table></div>` : `<p class="empty">${$t("还没有记录。提交入场申请后，每一步审核、每一次签约与结算都会写到这里。")}</p>`}
    <p class="pad mute small">${$t("哈希是真算的（SHA-256）。但这条链只存在你这台设备的浏览器里，没有第三方见证，不具备法律存证效力；真实环境里应由获准使用的证据设施承担。")}</p>`;
  }

  function render() {
    const a = access.st.app, m = access.st.member;
    $('#pipe', el).innerHTML = pipeHtml();
    const main = $('#main', el);
    if (m) main.innerHTML = certHtml(m);
    else if (a && a.status === 'reviewing') main.innerHTML = reviewHtml(a);
    else {
      if (!draft) draft = a && a.form ? clone(a.form) : defaults();
      main.innerHTML = formHtml(draft, a);
    }
    const lst = $('#listing', el);
    lst.hidden = !(m && m.role === 'supplier');
    if (!lst.hidden) lst.innerHTML = listingHtml(m);
    renderLedger();
  }

  function collect() {
    const f = $('#apply', el);
    if (!f) return;
    if (!draft) draft = defaults();
    const v = (n) => f.elements[n]?.value ?? '';
    const c = (n) => !!f.elements[n]?.checked;
    const role = v('role');
    const changed = role !== draft.role;
    Object.assign(draft, {
      role, region: v('region') || 'CN', channel: v('channel'), org: v('org'), uscc: v('uscc'), contact: v('contact'), sceneTitle: v('sceneTitle'), sceneDesc: v('sceneDesc'),
      category: v('category'), center: v('center'), pledge: c('pledge'), pii: c('pii'), piiAssessed: c('piiAssessed'), cross: c('cross'), crossReady: c('crossReady'),
      materials: changed ? [] : access.ROLES[role].materials.map((_, i) => c(`m${i}`)),
    });
    if (!access.CATEGORIES.some((x) => x.id === draft.category && x.roles.includes(role))) draft.category = '';
  }

  el.addEventListener('change', (e) => {
    if (!e.target.closest('#apply')) return;
    collect();
    if (['role', 'region', 'pii', 'cross'].includes(e.target.name)) render();
  });

  el.addEventListener('submit', (e) => {
    if (e.target.id !== 'apply') return;
    e.preventDefault();
    collect();
    const form = clone(draft);
    draft = null;
    const r = access.submit(form, nowSec());
    if (!r.ok) { draft = form; toast(r.error, 'error'); return; }
    toast($t("申请已提交，进入形式审查"), 'ok');
  });

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const now = nowSec(), act = b.dataset.act;
    if (act === 'fill') {
      collect();
      draft = demoData(draft.role, S);
      render();
      toast($t("已填入演示数据：虚构主体，占位信用代码，不对应任何真实企业"));
    } else if (act === 'pass') {
      const r = access.review('pass', '', now);
      toast(!r.ok ? r.error : r.approved ? $t("审批通过，已发放入场编号 {0}", access.st.member.no) : $t("本环节已通过，进入下一环节"), r.ok ? 'ok' : 'error');
    } else if (act === 'return') {
      const note = $('#ret-note', el)?.value || '';
      draft = null;
      const r = access.review('return', note, now);
      toast(r.ok ? $t("已退回补正，理由已记入存证链") : r.error, r.ok ? 'ok' : 'error');
    } else if (act === 'auto') {
      const r = access.autoRun(now);
      if (r.approved) toast($t("全部环节通过，已发放入场编号 {0}", access.st.member.no), 'ok');
      else toast($t("已通过 {0} 个环节后停下。{1}", r.passed, r.error), 'error');
    } else if (act === 'withdraw') {
      draft = null;
      const r = access.withdraw(now);
      toast(r.ok ? $t("申请已撤回，可修改后重新提交") : r.error, r.ok ? 'ok' : 'error');
    } else if (act === 'revoke') {
      confirmDialog($t("撤销入场资格"), $t("撤销后需要重新申请并走完审批才能交易、挂牌和上架，已登记的产品也会一并注销。"), { okText: $t("撤销"), danger: true }).then((yes) => {
        if (!yes) return;
        const r = access.revoke(nowSec());
        if (r.ok) draft = null;
        toast(r.ok ? $t("入场资格已撤销") : r.error, r.ok ? 'ok' : 'error');
      });
    } else if (act === 'list') {
      const c = S.centerByName.get(access.st.member?.center);
      const r = c ? access.registerListings(c, now) : { ok: false, error: $t("算力中心不存在") };
      toast(r.ok ? $t("已登记 {0} 个产品，登记记录已写入存证链", r.count) : r.error, r.ok ? 'ok' : 'error');
    } else if (act === 'verify') {
      const v = access.verifyLedger();
      verifyMsg = v.ok ? `<span class="down">${$t("校验通过：{0} 条记录哈希连续，内容没有被改动。", v.n)}</span>` : `<span class="up">${$t("校验失败：第 {0} 条{1}。", v.at, v.why)}</span>`;
      renderLedger();
    } else if (act === 'tamper') {
      const L = clone(access.st.ledger);
      const k = Math.floor(L.length / 2);
      L[k].data = { ...L[k].data, tampered: true };
      const v = access.verifyLedger(L);
      verifyMsg = $t("在一份副本里改动了第 {0} 条记录，重新校验：{1}。真实存证链没有被改动。", L[k].i, v.ok ? `<span class="up">${$t("没有查出来（不应出现）")}</span>` : `<span class="down">${$t("查出第 {0} 条{1}", v.at, v.why)}</span>`);
      renderLedger();
    }
  });

  const off = access.onChange(render);
  render();
  return { destroy() { off(); } };
}
