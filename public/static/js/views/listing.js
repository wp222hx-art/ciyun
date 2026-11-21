// 挂牌大厅：挂牌卡（G04）→ 三道审核与状态机（G09）→ 询价、锁定合同快照、外部到账、交付验收（G10）
// 预置挂牌为〔示例规格，不是真实商品〕；演示里由使用者一人分饰挂牌方、审核方与买方。
import * as rights from '../core/rights.js';
import * as access from '../core/access.js';
import { $, esc, toast, dialog, confirmDialog, nowSec, fmtUsd, fmtDateTime, tag, EXAMPLE, PROPOSED, stepper, emptyState, kv, opt, checks, picked, copyText, debounce } from '../ui.js';
import { $t, tx } from '../i18n.js';

const db = rights.db;
const prefs = { tab: 'listed', cat: '', q: '' };
const today = () => rights.dayStr(nowSec());
const BADGE = { draft: 'off', need_info: 'warn', verifying: 'info', admitted: 'info', listed: 'ok', suspended: 'bad', closed: 'off' };
const OBADGE = { rfq: 'info', quoted: 'info', locked: 'warn', signed: 'ok', paid: 'ok', delivered: 'ok', accepted: 'ok', disputed: 'bad', cancelled: 'off' };
const badge = (c) => `<span class="badge ${BADGE[c.status]}">${rights.STATES[c.status]}</span>`;
const obadge = (o) => `<span class="badge ${OBADGE[o.status]}">${rights.ORDER_STATES[o.status]}</span>`;
const names = (map, ids) => (ids || []).map((k) => esc(map[k]?.name || map[k] || k)).join($t("、")) || '—';
const log = (type, actor, ref, data) => access.log(type, actor, ref, data, nowSec());
const gate = () => { if (access.canTrade()) return true; toast($t("尚未取得入场资格：先到\"可信治理 › 入场审批\"完成登记，再提交挂牌或询价"), 'error'); return false; };
const TABS = { listed: [$t("挂牌中"), ['listed']], work: [$t("草稿与审核中"), ['draft', 'need_info', 'verifying', 'admitted', 'suspended']], closed: [$t("已关闭"), ['closed']], all: [$t("全部"), null] };
const scopeText = (s) => $t("{0} · {1} · {2} · {3} 至 {4}{5}", names(rights.TERRITORIES, s.territory), names(rights.LANGS, s.language), names(rights.CHANNELS, s.channel), esc(s.from), esc(s.to), s.exclusive ? ` ${$t("· 独占")}` : ` ${$t("· 非独占")}`);

export function mount(el, args) {
  if (args[0] === 'new') return mountForm(el, null);
  if (args[0] && args[1] === 'edit') return mountForm(el, args[0]);
  if (args[0]) return mountDetail(el, args[0]);
  return mountHall(el);
}

// ---------------------------------------------------------------- 大厅
function mountHall(el) {
  el.innerHTML = `
  <div class="page-head"><h2>${$t("挂牌大厅")} ${EXAMPLE}</h2>
    <p>${$t("版权许可与 AI 服务不是同质商品，不拿撮合盘硬配。这里走的是协议挂牌：一张写清权利边界的挂牌卡，过三道审核，买方询价、双方锁定合同快照后签约，外部到账确认了才交付。必填未齐、授权过期或排他范围相交，系统直接阻断发布。")}</p></div>
  <div class="stats-bar" id="stats"></div>
  <section class="panel mb"><header>
    <div class="tabs" id="tabs" role="tablist"></div><span class="sp"></span>
    <select class="input" id="cat" style="width:auto;max-width:min(100%, 280px)" aria-label="${$t("按类别筛选")}"><option value="">${$t("全部类别")}</option>${Object.entries(rights.CATEGORIES).map(([k, v]) => opt(k, v.name, prefs.cat)).join('')}</select>
    <input class="input search" id="q" type="search" placeholder="${$t("搜索名称、编号、权利人")}" value="${esc(prefs.q)}" aria-label="${$t("搜索挂牌")}">
    <a class="btn primary sm" href="#/listing/new">${$t("＋ 新建挂牌")}</a>
  </header></section>
  <div class="lst-grid" id="grid"></div>
  <section class="panel mb" id="orders"></section>
  <div class="split">
    <section class="panel">
      <header><h3>${$t("审核状态机")}</h3>${PROPOSED}</header>
      ${stepper([$t("草稿"), $t("资料待补"), $t("核验／法律分类"), $t("准入通过"), $t("挂牌"), $t("锁定报价／订单"), $t("成交及交付"), $t("验收／争议"), $t("结清／到期／撤牌")], -1)}
      <div class="pad" style="padding-top:0">
        <p class="mute small">${$t("三道审核：{0}。驳回要写理由；突发权利争议可暂停新授权、保全现有记录，但不擅自判定版权归属。", rights.REVIEWS.map((r) => `<b style="color:var(--text)">${r.name}</b>${$t("（{0}）", r.what)}`).join($t("；")))}</p>
        <p class="mute small" style="margin-top:8px"><b style="color:var(--text)">${$t("禁止挂牌及宣传：")}</b>${$t("来源不明或超范围版权、未授权肖像／声音／训练数据、虚假算力、无履约保证的额度、隐瞒 AI 生成、未经许可金融发行或募资。名称与说明里出现 {0} 等措辞会被拦下。", rights.BANNED_WORDS.map((w) => `"${tx(w)}"`).join($t("、")))}</p>
        <p class="mute small" style="margin-top:8px">${$t("挂牌只是通过本平台约定审核的商业展示，不等于证券上市、政府确权或官方价格认证。")}</p>
      </div>
    </section>
    <section class="panel">
      <header><h3>${$t("六类挂牌对象")}</h3><span class="mute small">${$t("方案 V4.0 G04")}</span></header>
      <div class="table-wrap"><table class="tbl dense"><thead><tr><th>${$t("对象")}</th><th>${$t("首期或后续定位")}</th><th>${$t("本站")}</th></tr></thead><tbody>
      ${Object.values(rights.OBJECTS).map((o) => `<tr><td class="wrap">${o.name}</td><td class="wrap mute">${o.stage}</td><td>${o.gate === 'closed' ? `<span class="badge off">${$t("关闭")}</span>` : o.gate === 'isolated' ? `<span class="badge warn">${$t("隔离评审")}</span>` : `<span class="badge ok">${$t("可挂牌")}</span>`}</td></tr>`).join('')}
      </tbody></table></div>
    </section>
  </div>
  <section class="panel"><details class="fold"><summary>${$t("十类海外 AIGC 版权交易对象与关键核查（方案 V4.0 G05）")}</summary>
    <div class="table-wrap"><table class="tbl dense"><thead><tr><th>${$t("类别")}</th><th>${$t("关键核查")}</th></tr></thead><tbody>
    ${Object.values(rights.CATEGORIES).map((c) => `<tr><td>${c.name}</td><td class="wrap mute">${c.check}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="pad mute small">${$t("四种主要收入结构：{0}。以上覆盖主要类别，不声称穷尽所有法域、平台规则或新型权利；AIGC 权利不能一证通全球。", Object.values(rights.STRUCTURES).join($t("、")))}</p>
  </details></section>`;

  function paint() {
    const S = db.state, st = rights.stats(S), day = today();
    $('#stats', el).innerHTML = `${$t("挂牌中")}<b>${st.listed}</b>${$t("审核与草稿")}<b>${st.reviewing + S.listings.filter((c) => c.status === 'draft').length}</b>${$t("已成立许可")}<b>${st.licences}</b> ${$t("笔　合同对价")}<b>${fmtUsd(st.contractValue, 0)}</b>${$t("已确认到账")}<b>${fmtUsd(st.received, 0)}</b>${$t("中心服务费（验收后确认）")}<b>${fmtUsd(st.centreFee)}</b>
      <span class="mute">　${$t("三个口径分列：成交不等于到账，对价不等于平台收入")}</span>`;
    $('#tabs', el).innerHTML = Object.entries(TABS).map(([k, [label, sts]]) => `<button type="button" role="tab" data-tab="${k}" class="${k === prefs.tab ? 'on' : ''}" aria-selected="${k === prefs.tab}">${label} ${S.listings.filter((c) => !sts || sts.includes(c.status)).length}</button>`).join('');
    const q = prefs.q.trim().toLowerCase();
    const rows = S.listings.filter((c) => (!TABS[prefs.tab][1] || TABS[prefs.tab][1].includes(c.status)) && (!prefs.cat || c.category === prefs.cat)
      && (!q || [c.title, c.id, c.holder, c.assetId].some((x) => String(x).toLowerCase().includes(q) || tx(String(x)).toLowerCase().includes(q))));
    $('#grid', el).innerHTML = rows.length ? rows.map((c) => {
      const why = ['draft', 'need_info', 'verifying', 'admitted'].includes(c.status) ? rights.blockers(S, c, day)[0] : '';
      return `<a class="lst-card" href="#/listing/${c.id}">
        <header><h3>${esc(c.title || $t("未命名挂牌"))}</h3>${badge(c)}</header>
        <p class="meta mono">${c.id} · v${c.version} · ${esc(c.assetId || $t("未填标的编号"))}</p>
        <div class="tags"><span>${esc(rights.CATEGORIES[c.category]?.name.split('、')[0] || '—')}</span><span>${names(rights.TERRITORIES, c.territory)}</span><span>${names(rights.CHANNELS, c.channel)}</span><span>${c.exclusive ? $t("独占") : $t("非独占")}</span><span>${esc(rights.AI_MODES[c.ai] || $t("AI 参与未披露"))}</span></div>
        <p class="meta">${$t("权利人：{0}", esc(c.holder || '—'))}</p>
        ${why ? `<p class="why">⚠ ${esc(why)}</p>` : ''}
        <footer><span class="price">${c.price ? fmtUsd(c.price, 0) : '—'}</span><span class="mute small">${esc(rights.STRUCTURES[c.structure] || '')}</span></footer></a>`;
    }).join('') : `<div class="panel" style="grid-column:1/-1">${emptyState(q || prefs.cat ? $t("没有符合筛选条件的挂牌。") : $t("这个分组下还没有挂牌。"), `<a class="btn primary" href="#/listing/new">${$t("新建一个挂牌")}</a>`)}</div>`;
    $('#orders', el).innerHTML = `<header><h3>${$t("全部订单")}</h3><span class="mute small">${$t("{0} 笔 · 报价、成交、到账、交付分别记时", S.orders.length)}</span></header>${S.orders.length ? `<div class="table-wrap"><table class="tbl dense"><thead><tr><th>${$t("订单号")}</th><th>${$t("标的")}</th><th>${$t("买方")}</th><th>${$t("许可范围")}</th><th class="num">${$t("价格")}</th><th>${$t("状态")}</th><th></th></tr></thead><tbody>
      ${S.orders.map((o) => `<tr><td class="mono">${o.id}</td><td>${esc(o.title)}</td><td>${esc(o.buyer)}</td><td class="wrap small mute">${scopeText(o.scope)}</td><td class="num">${o.price ? fmtUsd(o.price, 0) : $t("待报价")}</td><td>${obadge(o)}</td><td><a class="btn sm" href="#/listing/${o.listingId}">${$t("办理")}</a></td></tr>`).join('')}
      </tbody></table></div>` : emptyState($t("还没有订单。打开一个\"挂牌中\"的商品，在详情页发出询价。未成交就显示无成交，不用仿真数据填充。"))}`;
  }

  el.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { prefs.tab = b.dataset.tab; paint(); } });
  $('#cat', el).addEventListener('change', (e) => { prefs.cat = e.target.value; paint(); });
  $('#q', el).addEventListener('input', debounce((e) => { prefs.q = e.target.value; paint(); }));
  const off = db.onChange(paint);
  paint();
  return { destroy: off };
}

// ---------------------------------------------------------------- 详情
function mountDetail(el, id) {
  let attackMsg = '';

  function orderActions(o) {
    const b = (act, label, cls = '') => `<button class="btn sm ${cls}" type="button" data-oact="${act}" data-oid="${o.id}">${label}</button>`;
    switch (o.status) {
      case 'rfq': return b('quote', $t("供方报价"), 'primary') + b('cancel', $t("取消"));
      case 'quoted': return b('lock', $t("锁定合同快照"), 'primary') + b('quote', $t("改报价")) + b('cancel', $t("取消"));
      case 'locked': return b('sign', $t("电子签约"), 'primary') + b('tamper', $t("试试静默改价")) + b('cancel', $t("取消"));
      case 'signed': return b('pay', $t("确认外部到账"), 'primary') + b('dispute', $t("发起争议"));
      case 'paid': return b('deliver', $t("签发凭证并交付"), 'primary') + b('dispute', $t("发起争议"));
      case 'delivered': return b('accept', $t("验收"), 'primary') + b('dispute', $t("发起争议"));
      case 'disputed': return b('resolve', $t("争议已解决"), 'primary');
      default: return '';
    }
  }

  function paint() {
    const S = db.state, c = S.listings.find((x) => x.id === id), day = today();
    if (!c) { el.innerHTML = `<div class="state-panel"><h2>${$t("没有这个挂牌")}</h2><p>${$t("编号 {0} 不存在，可能已被重置。", esc(id))}</p><div class="btn-row"><a class="btn primary" href="#/listing">${$t("回到挂牌大厅")}</a></div></div>`; return; }
    const why = rights.blockers(S, c, day);
    const rev = rights.review(S, c, day);
    const flowIdx = c.status === 'suspended' ? 4 : rights.FLOW.indexOf(c.status);
    const orders = S.orders.filter((o) => o.listingId === c.id);
    const m = access.st.member;
    const act = (a, label, cls = '') => `<button class="btn ${cls}" type="button" data-act="${a}">${label}</button>`;
    let actions = '';
    if (['draft', 'need_info'].includes(c.status)) actions = `<a class="btn" href="#/listing/${c.id}/edit">${$t("编辑挂牌卡")}</a>${act('submit', $t("提交审核"), 'primary')}`;
    else if (c.status === 'verifying') actions = `${act('pass', $t("通过\"{0}\"", rights.REVIEWS[c.step].name), 'primary')}${act('auto', $t("一键走完三道审核（演示）"))}${act('back', $t("退回补正"), 'danger')}`;
    else if (c.status === 'admitted') actions = `${act('publish', $t("发布挂牌"), 'primary')}<a class="btn" href="#/listing/${c.id}/edit">${$t("改版")}</a>`;
    else if (c.status === 'listed') actions = `<a class="btn" href="#/listing/${c.id}/edit">${$t("改版（重新审核）")}</a>${act('suspend', $t("暂停新授权"), 'danger')}${act('delist', $t("撤牌"))}`;
    else if (c.status === 'suspended') actions = `${act('resume', $t("恢复挂牌"), 'primary')}${act('delist', $t("撤牌"))}`;

    el.innerHTML = `
    <div class="page-head"><p class="small"><a href="#/listing">${$t("← 挂牌大厅")}</a></p>
      <h2>${esc(c.title || $t("未命名挂牌"))} ${badge(c)} <span class="chip sm mono">v${c.version}</span>${c.seed ? EXAMPLE : ''}</h2>
      <p>${esc(c.desc || $t("挂牌方未填写说明。"))}</p></div>
    <section class="panel mb">${stepper(rights.FLOW.map((k) => rights.STATES[k]), flowIdx, { bad: c.status === 'suspended' ? 4 : -1 })}
      <div class="sticky-actions" style="position:static;border-radius:0 0 var(--r) var(--r)">${actions || `<span class="mute">${$t("该挂牌已结清、到期或撤牌，不再接受新授权；存量许可按合同继续有效。")}</span>`}
        <span class="sp" style="flex:1"></span><span class="mute small">${c.status === 'verifying' ? $t("演示里没有真人审核，由你扮演审核方；检查项不合格时系统不允许通过。") : ''}</span></div>
    </section>
    ${why.length && c.status !== 'closed' ? `<div class="callout ${['listed', 'suspended'].includes(c.status) ? 'bad' : 'warn'}"><b>${$t("{0}（{1} 项）", c.status === 'listed' ? $t("当前存在问题") : $t("现在还不能发布"), why.length)}</b><ul style="margin:6px 0 0;padding-left:18px">${why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}

    <div class="split wide-l">
      <section class="panel">
        <header><h3>${$t("挂牌卡")}</h3><span class="mute small">${$t("字段名对应方案 V4.0 G04 的挂牌数据模板")}</span></header>
        <div class="spec">
          ${kv(`${$t("标的编号")} <code>asset_id</code>`, `${esc(c.assetId || '—')} · v${c.version}`)}
          ${kv(`${$t("权利类型")} <code>right_type</code>`, `${esc(rights.OBJECTS[c.object]?.name || '—')}`)}
          ${kv($t("内容类别"), esc(rights.CATEGORIES[c.category]?.name || '—'))}
          ${kv($t("收入结构"), esc(rights.STRUCTURES[c.structure] || '—'))}
          ${kv(`${$t("权利人")} <code>holder</code>`, esc(c.holder || '—'))}
          ${kv($t("受益所有人"), esc(c.owner || '—'))}
          ${kv(`${$t("授权代理")} <code>authorised_agent</code>`, esc(c.agent || $t("权利人自行签约")))}
          ${kv(`${$t("地域")} <code>territory</code>`, names(rights.TERRITORIES, c.territory))}
          ${kv(`${$t("语言")} <code>language</code>`, names(rights.LANGS, c.language))}
          ${kv(`${$t("渠道")} <code>channel</code>`, names(rights.CHANNELS, c.channel))}
          ${kv(`${$t("期限")} <code>term</code>`, $t("{0} 至 {1}", esc(c.from || '—'), esc(c.to || '—')))}
          ${kv(`${$t("排他")} <code>exclusive</code>`, c.exclusive ? $t("独占") : $t("非独占"))}
          ${kv(`${$t("再许可")} <code>sublicense</code>`, c.sublicense ? $t("允许") : $t("不允许"))}
          ${kv(`${$t("可转让")} <code>transferable</code>`, c.transferable ? $t("允许 · 供方同意引用 {0}", esc(c.consentRef || $t("缺"))) : $t("不允许"))}
          ${kv($t("AI 参与"), esc(rights.AI_MODES[c.ai] || $t("未披露")))}
          ${kv($t("人类创作记录"), esc(c.human || $t("未提供")))}
          ${kv(`${$t("来源清单")} <code>source_manifest</code>`, esc(c.manifest || '—'))}
          ${kv($t("第三方权利"), c.thirdParty ? $t("已核清") : `<span class="up">${$t("未核清")}</span>`)}
          ${kv(`${$t("交付标准")} <code>delivery_criteria</code>`, esc(c.delivery || '—'))}
          ${kv(`${$t("价格快照")} <code>price_snapshot</code>`, c.price ? $t("{0} · 美元 · 未含税", fmtUsd(c.price)) : '—')}
          ${kv(`${$t("收付路径")} <code>payment_terms</code>`, c.payment === 'bank' ? $t("银行认可的法币路径") : `<span class="up">${$t("稳定币或境外钱包")}</span>`)}
          ${kv(`${$t("争议解决")} <code>dispute_forum</code>`, esc(c.forum || '—'))}
          ${kv(`${$t("适用法律")} <code>applicable_law</code>`, esc(c.law || '—'))}
          ${kv(`${$t("证据引用")} <code>evidence_refs</code>`, (c.evidence || []).map(esc).join($t("、")) || '—')}
          ${kv($t("授权有效期"), esc(c.authUntil || '—'))}
        </div>
        <p class="pad mute small" style="padding-top:0">${$t("\"授权链完整\"是核查结论，不是网站勾选项。C2PA 等签名记录的是创作与编辑历史，不是版权证书。本卡为示例规格，不对应任何真实作品或权利人。")}</p>
      </section>
      <section class="panel">
        <header><h3>${$t("三道审核")}</h3>${PROPOSED}</header>
        <div class="review-cols" style="grid-template-columns:1fr">
        ${rights.REVIEWS.map((r, i) => {
          const done = ['admitted', 'listed', 'suspended', 'closed'].includes(c.status) || (c.status === 'verifying' && c.step > i);
          const cur = c.status === 'verifying' && c.step === i;
          return `<div class="review-col ${done ? 'done' : cur ? 'cur' : ''}"><h4>${i + 1}. ${r.name} ${done ? `<span class="down small">${$t("✓ 已通过")}</span>` : cur ? `<span class="small" style="color:var(--accent)">${$t("审核中")}</span>` : ''}</h4><small>${r.what}</small>
            <ul class="checks">${rev[i].map((x) => `<li class="${x.ok ? 'ok' : 'no'}">${esc(x.label)}${!x.ok && x.note ? `<small>${esc(x.note)}</small>` : ''}</li>`).join('')}</ul></div>`;
        }).join('')}
        </div>
      </section>
    </div>

    ${c.status === 'listed' ? `<section class="panel mb">
      <header><h3>${$t("向供方询价")}</h3><span class="mute small">${$t("请求范围必须落在挂牌卡之内；与已成立的许可相交会被拦下")}</span></header>
      <form id="rfq" class="pad" novalidate autocomplete="off">
        <div class="form-grid">
          <label class="field"><span>${$t("买方主体")}</span><input class="input" name="buyer" value="${esc(m && m.org !== c.holder ? m.org : $t("示例发行方（虚构）"))}"></label>
          <label class="field"><span>${$t("许可起始日")}</span><input class="input mono" type="date" name="from" value="${esc(c.from)}" min="${esc(c.from)}" max="${esc(c.to)}"></label>
          <label class="field"><span>${$t("许可到期日")}</span><input class="input mono" type="date" name="to" value="${esc(c.to)}" min="${esc(c.from)}" max="${esc(c.to)}"></label>
          <label class="field"><span>${$t("意向价")}<em class="mute">${$t("美元，可不填")}</em></span><input class="input mono" type="number" name="offer" min="0" step="1" placeholder="${c.price}"></label>
        </div>
        <div class="field-row"><span>${$t("地域")}</span>${checks('territory', Object.fromEntries(c.territory.map((k) => [k, rights.TERRITORIES[k] || k])), c.territory.slice(0, 1))}</div>
        <div class="field-row"><span>${$t("语言")}</span>${checks('language', Object.fromEntries(c.language.map((k) => [k, rights.LANGS[k] || k])), c.language.slice(0, 1))}</div>
        <div class="field-row"><span>${$t("渠道")}</span>${checks('channel', Object.fromEntries(c.channel.map((k) => [k, rights.CHANNELS[k] || k])), c.channel.slice(0, 1))}</div>
        <div class="btn-row">${c.exclusive ? `<label class="inline"><input type="checkbox" name="exclusive"> ${$t("请求独占")}</label>` : `<span class="mute small">${$t("该挂牌只提供非独占许可")}</span>`}
          <button class="btn primary" type="submit">${$t("发出询价")}</button></div>
      </form></section>` : ''}

    <section class="panel mb" id="l-orders">
      <header><h3>${$t("本挂牌的订单")}</h3><span class="mute small">${$t("{0} 笔", orders.length)}</span></header>
      ${orders.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>${$t("订单号")}</th><th>${$t("买方")}</th><th>${$t("许可范围")}</th><th class="num">${$t("价格")}</th><th>${$t("状态")}</th><th>${$t("办理")}</th></tr></thead><tbody>
      ${orders.map((o) => `<tr><td class="mono">${o.id}</td><td>${esc(o.buyer)}</td><td class="wrap small mute">${scopeText(o.scope)}</td>
        <td class="num">${o.price ? fmtUsd(o.price, 0) : `<span class="mute">${$t("待报价{0}", o.offer ? $t("（意向 {0}）", fmtUsd(o.offer, 0)) : '')}</span>`}</td>
        <td>${obadge(o)}${o.status === 'disputed' ? `<div class="small mute wrap">${esc(o.disputeNote)}</div>` : ''}</td>
        <td><div class="acts">${orderActions(o)}</div>
          ${o.snapHash ? `<div class="hash copy" data-copy="${o.snapHash}" title="${$t("点击复制合同快照哈希")}">${$t("快照 {0}… · v{1}", o.snapHash.slice(0, 16), o.snapshot.version)}</div>` : ''}
          ${o.payRef ? `<div class="small mute">${$t("到账凭证 {0}", esc(o.payRef))}</div>` : ''}
          ${o.licence ? `<div class="small"><span class="mono">${o.licence.no}</span> <span class="hash copy" data-copy="${o.licence.hash}" title="${$t("点击复制许可凭证哈希")}">${o.licence.hash.slice(0, 12)}…</span></div>` : ''}
          ${o.fee != null ? `<div class="small mute">${$t("中心服务费 {0}（对价的 {1}%）", fmtUsd(o.fee), (rights.LICENCE_FEE * 100).toFixed(0))}</div>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : emptyState(c.status === 'listed' ? $t("还没有人询价。在上面发出第一笔询价。") : $t("这个挂牌还没有订单。只有\"挂牌中\"的商品可以询价。"))}
      ${attackMsg ? `<p class="pad" style="padding-top:0">${attackMsg}</p>` : ''}
      <p class="pad mute small" style="padding-top:0">${$t("流程：询价 → 供方报价 → 锁定规格与合同快照 → 电子签约 → 外部合法支付确认 → 签发凭证并交付 → 验收。中心不代收代管买卖双方的款项，只登记对方银行的到账凭证引用；费率 {0}% 为方案 G21 的示例假设。许可凭证编号带 SIM 前缀，不是真实许可证。", (rights.LICENCE_FEE * 100).toFixed(0))}</p>
    </section>

    <section class="panel" id="l-hist">
      <header><h3>${$t("办理记录")}</h3><span class="mute small">${$t("{0} 条 · 同步写入", c.history.length)}<a href="#/evidence">${$t("溯源存证")}</a></span></header>
      <div class="table-wrap"><table class="tbl dense"><thead><tr><th>${$t("时间")}</th><th>${$t("经办")}</th><th>${$t("动作")}</th><th>${$t("说明")}</th></tr></thead><tbody>
      ${[...c.history].reverse().map((h) => `<tr><td class="num">${fmtDateTime(h.t).slice(5, 16)}</td><td>${esc(h.who)}</td><td>${esc(h.action)}</td><td class="wrap small mute">${esc(h.note)}</td></tr>`).join('')}
      </tbody></table></div>
    </section>`;
  }

  /** 挂牌状态操作 */
  async function onAct(a) {
    const S = db.state, c = S.listings.find((x) => x.id === id), now = nowSec(), day = today();
    if (!c) return;
    const done = (r, msg, ev) => { db.commit(); if (!r.ok) { toast(r.error, 'error'); return false; } if (ev) log(ev[0], ev[1], c.id, ev[2] || {}); toast(msg, 'ok'); return true; };
    if (a === 'submit') { if (!gate()) return; done(rights.submit(S, id, now), $t("已提交，进入主体及地域审核"), ['right.submit', '挂牌方', { asset: c.assetId, version: c.version }]); }
    else if (a === 'pass') { const stage = rights.REVIEWS[c.step].name; const r = rights.pass(S, id, day, now); done(r, r.admitted ? $t("三道审核全部通过，已准入") : $t("\"{0}\"已通过", stage), ['right.pass', stage, { step: stage, admitted: !!r.admitted }]); }
    else if (a === 'auto') {
      let n = 0, r;
      while (c.status === 'verifying') { const stage = rights.REVIEWS[c.step].name; r = rights.pass(S, id, day, now); if (!r.ok) break; n++; log('right.pass', stage, c.id, { step: stage, admitted: !!r.admitted }); }
      db.commit();
      toast(c.status === 'admitted' ? $t("三道审核全部通过，已准入") : $t("通过 {0} 道审核后停下。{1}", n, r.error), c.status === 'admitted' ? 'ok' : 'error');
    } else if (a === 'back') {
      const bad = rights.review(S, c, day)[c.step].filter((x) => !x.ok);
      const reason = await dialog({ title: $t("退回补正：{0}", rights.REVIEWS[c.step].name), body: bad.length ? `${$t("未通过的检查项会自动写入理由：")}<br>${bad.map((x) => esc(x.note || x.label)).join($t("；"))}` : $t("当前检查项全部合格，退回必须写明理由。"), input: { label: $t("补充理由"), required: !bad.length, requiredText: $t("驳回必须写明理由") }, okText: $t("退回"), danger: true });
      if (reason === null) return;
      const stage = rights.REVIEWS[c.step].name;
      done(rights.sendBack(S, id, reason, day, now), $t("已退回补正，理由已记入办理记录"), ['right.return', stage, { step: stage }]);
    } else if (a === 'publish') { done(rights.publish(S, id, day, now), $t("已挂牌，买方可以询价"), ['right.publish', '系统', { version: c.version }]); }
    else if (a === 'suspend') {
      const reason = await dialog({ title: $t("暂停新授权"), body: $t("暂停后不能再发出新询价，已成立的许可和现有记录保全，不擅自判定版权归属。"), input: { label: $t("暂停理由"), required: true, requiredText: $t("暂停必须写明理由"), placeholder: $t("例如：收到第三方权利通知") }, okText: $t("暂停"), danger: true });
      if (reason === null) return;
      done(rights.suspend(S, id, reason, now), $t("已暂停新授权"), ['right.suspend', '权利审核', { reason }]);
    } else if (a === 'resume') { done(rights.resume(S, id, day, now), $t("已恢复挂牌"), ['right.resume', '权利审核']); }
    else if (a === 'delist') {
      if (!await confirmDialog($t("撤牌"), $t("撤牌后不再接受新授权，存量许可按合同继续有效。此操作不能撤销。"), { okText: $t("撤牌"), danger: true })) return;
      done(rights.delist(S, id, now), $t("已撤牌"), ['right.delist', '挂牌方']);
    }
  }

  /** 订单操作 */
  async function onOrder(a, oid) {
    const S = db.state, o = S.orders.find((x) => x.id === oid), c = S.listings.find((x) => x.id === id), now = nowSec();
    if (!o) return;
    const done = (r, msg, ev, data = {}) => { db.commit(); if (!r.ok) { toast(r.error, 'error'); return false; } log(ev, data.actor || '系统', o.id, { listing: o.listingId, ...data }); toast(msg, 'ok'); return true; };
    if (a === 'quote') {
      const v = await dialog({ title: $t("供方报价"), body: `${$t("买方：{0}", esc(o.buyer))}<br>${$t("范围：{0}", scopeText(o.scope))}`, input: { label: $t("报价（美元）"), line: true, value: String(o.price || o.offer || c.price), required: true }, okText: $t("报价") });
      if (v === null) return;
      done(rights.quote(S, oid, Number(v), now), $t("已报价 {0}", fmtUsd(Number(v), 0)), 'order.quote', { actor: '供方', price: Number(v) });
    } else if (a === 'lock') { const r = rights.lock(S, oid, today(), now); done(r, $t("合同快照已锁定：权利范围、价格、费率和挂牌版本一起冻结"), 'order.lock', { hash: r.hash }); }
    else if (a === 'sign') { done(rights.sign(S, oid, now), $t("已签约：商业成交成立。交付、验收、到账分别记时"), 'order.sign', { actor: '买卖双方', price: o.price, hash: o.snapHash }); }
    else if (a === 'tamper') {
      // 在一份副本里把价格砍半再去签约，真实订单不动
      const S2 = JSON.parse(JSON.stringify(S));
      const o2 = S2.orders.find((x) => x.id === oid);
      o2.price = Math.round(o2.price / 2);
      const r = rights.sign(S2, oid, now);
      attackMsg = $t("在一份副本里把 {0} 的价格从 {1} 静默改成 {2} 后去签约：{3}。真实订单没有被改动。", o.id, fmtUsd(o.price, 0), fmtUsd(o2.price, 0), r.ok ? `<span class="up">${$t("签约成功（不应出现）")}</span>` : `<span class="down">${$t("被拦下——{0}", esc(r.error))}</span>`);
      paint();
    } else if (a === 'pay') {
      const v = await dialog({ title: $t("确认外部到账"), body: $t("中心不代收代管款项。这里只登记买方银行或合法支付服务方出具的到账凭证引用；未到账不能进入交付。"), input: { label: $t("外部到账凭证引用"), line: true, value: `SIM-BANK-${o.id.slice(-4)}`, required: true, requiredText: $t("须填写外部到账凭证引用") }, okText: $t("确认到账") });
      if (v === null) return;
      done(rights.confirmPayment(S, oid, v, now), $t("已登记外部到账凭证"), 'order.pay', { actor: '财务核对', ref: v });
    } else if (a === 'deliver') { const r = rights.deliver(S, oid, now); done(r, r.ok ? $t("已签发许可凭证 {0} 并交付", r.licence.no) : '', 'order.deliver', { actor: '供方', licence: r.licence?.no, hash: r.licence?.hash }); }
    else if (a === 'accept') { const r = rights.accept(S, oid, now); done(r, r.ok ? $t("已验收。中心确认服务费 {0}，不把 {1} 对价当自有收入", fmtUsd(r.fee), fmtUsd(o.price, 0)) : '', 'order.accept', { actor: '买方', fee: r.fee }); }
    else if (a === 'dispute') {
      const v = await dialog({ title: $t("发起争议"), body: $t("争议期间订单冻结在当前环节，记录保全。"), input: { label: $t("争议理由"), required: true, requiredText: $t("争议必须写明理由") }, okText: $t("发起争议"), danger: true });
      if (v === null) return;
      done(rights.dispute(S, oid, v, now), $t("已登记争议"), 'order.dispute', { actor: '买方', reason: v });
    } else if (a === 'resolve') { done(rights.resolve(S, oid, now), $t("争议已解决，订单回到原环节"), 'order.resolve', { actor: '申诉复核' }); }
    else if (a === 'cancel') {
      if (!await confirmDialog($t("取消订单"), $t("只有签约前的订单可以直接取消。"), { okText: $t("取消订单"), cancelText: $t("不取消"), danger: true })) return;
      done(rights.cancel(S, oid, now), $t("订单已取消"), 'order.cancel', { actor: '买方' });
    }
  }

  el.addEventListener('click', (e) => {
    const cp = e.target.closest('[data-copy]'); if (cp) return void copyText(cp.dataset.copy, $t("哈希"));
    const b = e.target.closest('[data-act]'); if (b) return void onAct(b.dataset.act);
    const o = e.target.closest('[data-oact]'); if (o) onOrder(o.dataset.oact, o.dataset.oid);
  });
  el.addEventListener('submit', (e) => {
    if (e.target.id !== 'rfq') return;
    e.preventDefault();
    if (!gate()) return;
    const f = e.target, v = (n) => f.elements[n]?.value ?? '';
    const r = rights.rfq(db.state, id, { buyer: v('buyer'), from: v('from'), to: v('to'), offer: v('offer'), exclusive: !!f.elements.exclusive?.checked, territory: picked(f, 'territory'), language: picked(f, 'language'), channel: picked(f, 'channel') }, nowSec());
    if (!r.ok) return toast(r.error, 'error');
    db.commit();
    log('order.rfq', '买方', r.order.id, { listing: id, buyer: r.order.buyer });
    toast($t("询价已发出：{0}。下一步由供方报价", r.order.id), 'ok');
  });
  const off = db.onChange(paint);
  paint();
  return { destroy: off };
}

// ---------------------------------------------------------------- 新建 / 编辑
function mountForm(el, id) {
  const S = db.state;
  const src = id ? S.listings.find((x) => x.id === id) : null;
  if (id && !src) { el.innerHTML = `<div class="state-panel"><h2>${$t("没有这个挂牌")}</h2><p>${$t("编号 {0} 不存在。", esc(id))}</p><div class="btn-row"><a class="btn primary" href="#/listing">${$t("回到挂牌大厅")}</a></div></div>`; return {}; }
  if (src && ['verifying', 'closed'].includes(src.status)) { el.innerHTML = `<div class="state-panel"><h2>${$t("现在不能修改")}</h2><p>${src.status === 'verifying' ? $t("审核进行中，退回或通过后再修改。") : $t("已撤牌或到期的挂牌不能修改。")}</p><div class="btn-row"><a class="btn primary" href="#/listing/${id}">${$t("回到挂牌详情")}</a></div></div>`; return {}; }
  let f = src ? JSON.parse(JSON.stringify(src)) : rights.emptyCard();
  const live = src && ['admitted', 'listed', 'suspended'].includes(src.status);
  let dirty = false;

  const txt = (name, label, hint = '', extra = '') => `<label class="field"><span>${label}${hint ? `<em class="mute">${hint}</em>` : ''}</span><input class="input" name="${name}" value="${esc(f[name] ?? '')}" ${extra}></label>`;
  const sel = (name, label, map) => `<label class="field"><span>${label}</span><select class="input" name="${name}">${name === 'ai' ? `<option value="">${$t("请选择（必须披露）")}</option>` : ''}${Object.entries(map).map(([k, v]) => opt(k, v.name || v, f[name])).join('')}</select></label>`;
  const box = (name, label) => `<label class="inline"><input type="checkbox" name="${name}"${f[name] ? ' checked' : ''}> ${label}</label>`;

  function html() {
    return `
    <div class="page-head"><p class="small"><a href="${id ? `#/listing/${id}` : '#/listing'}">← ${id ? $t("挂牌详情") : $t("挂牌大厅")}</a></p>
      <h2>${id ? `${$t("编辑挂牌卡")} <span class="chip sm mono">${id} · v${src.version}</span>` : $t("新建挂牌")} ${PROPOSED}</h2>
      <p>${$t("一张挂牌卡至少要写清：谁有权签、卖的是哪一段权利、AI 怎么参与、怎么交付、怎么收付、出了争议找谁。右侧的检查随填随算。")}${live ? `<b class="up">${$t("这个挂牌已准入或已挂牌：保存后版本号加一，并回到三道审核。")}</b>` : ''}</p></div>
    <div class="split wide-l">
    <form class="panel" id="card" novalidate autocomplete="off">
      <div class="form-sec"><h4>${$t("① 标的与类别")}</h4>
        <div class="form-grid">${txt('assetId', $t("标的编号"), 'asset_id', 'placeholder="SIM-AST-…"')}${txt('title', $t("标的名称"))}${sel('category', $t("内容类别"), rights.CATEGORIES)}${sel('object', $t("挂牌对象"), rights.OBJECTS)}${sel('structure', $t("收入结构"), rights.STRUCTURES)}</div>
        <label class="field"><span>${$t("说明")}</span><textarea class="input" name="desc" rows="2">${esc(f.desc)}</textarea></label></div>
      <div class="form-sec"><h4>${$t("② 主体")}<small>${$t("签约权与受益所有人")}</small></h4>
        <div class="form-grid">${txt('holder', $t("权利人"), 'holder')}${txt('owner', $t("受益所有人"))}${txt('agent', $t("授权代理"), $t("可空"))}${txt('authUntil', $t("授权有效期至"), '', 'type="date"')}</div></div>
      <div class="form-sec"><h4>${$t("③ 许可范围")}<small>${$t("地域 × 语言 × 渠道 × 期限")}</small></h4>
        <div class="field-row"><span>${$t("地域 territory")}</span>${checks('territory', rights.TERRITORIES, f.territory)}</div>
        <div class="field-row"><span>${$t("语言 language")}</span>${checks('language', rights.LANGS, f.language)}</div>
        <div class="field-row"><span>${$t("渠道 channel")}</span>${checks('channel', rights.CHANNELS, f.channel)}</div>
        <div class="form-grid">${txt('from', $t("许可起始日"), '', 'type="date"')}${txt('to', $t("许可到期日"), '', 'type="date"')}</div>
        <div class="mat">${box('exclusive', $t("独占（排他）"))}${box('sublicense', $t("允许再许可"))}${box('transferable', $t("允许转让"))}</div>
        ${f.transferable ? txt('consentRef', $t("供方同意引用"), $t("可转让时必填")) : ''}</div>
      <div class="form-sec"><h4>${$t("④ AI 披露与来源")}</h4>
        <div class="form-grid">${sel('ai', $t("AI 参与方式"), rights.AI_MODES)}${txt('human', $t("人类创作记录"), $t("编剧、剪辑、修改等"))}${txt('manifest', $t("模型及素材来源清单"), 'source_manifest')}</div>
        <div class="mat">${box('thirdParty', $t("音乐、肖像、声音及素材等第三方权利已核清"))}</div></div>
      <div class="form-sec"><h4>${$t("⑤ 交付、价格与收付")}</h4>
        <div class="form-grid">${txt('delivery', $t("交付与验收标准"), 'delivery_criteria')}${txt('price', $t("价格快照"), $t("美元，未含税"), 'type="number" min="0" step="1"')}
          <label class="field"><span>${$t("收付路径")}</span><select class="input" name="payment">${opt('bank', $t("银行认可的法币路径"), f.payment)}${opt('stable', $t("稳定币或境外钱包"), f.payment)}</select></label></div></div>
      <div class="form-sec"><h4>${$t("⑥ 争议、法律与证据")}</h4>
        <div class="form-grid">${txt('forum', $t("争议解决"), 'dispute_forum')}${txt('law', $t("适用法律"), 'applicable_law')}
          <label class="field"><span>${$t("证据引用")}<em class="mute">${$t("evidence_refs，逗号分隔")}</em></span><input class="input" name="evidence" value="${esc((f.evidence || []).join($t("，")))}"></label></div></div>
      <div class="sticky-actions">
        <button class="btn primary" type="submit">${live ? $t("保存并重新送审") : $t("保存草稿")}</button>
        <button class="btn" type="button" data-fill>${$t("填入示例")}</button>
        <a class="btn ghost" href="${id ? `#/listing/${id}` : '#/listing'}">${$t("取消")}</a>
        <span class="mute small" id="left"></span>
      </div>
    </form>
    <section class="panel" id="side" style="position:sticky;top:112px"></section>
    </div>`;
  }

  function collect() {
    const form = $('#card', el);
    if (!form) return f;
    const v = (n) => form.elements[n]?.value ?? f[n] ?? '';
    const c = (n) => !!form.elements[n]?.checked;
    f = { ...f, assetId: v('assetId').trim(), title: v('title').trim(), desc: v('desc').trim(), category: v('category'), object: v('object'), structure: v('structure'),
      holder: v('holder').trim(), owner: v('owner').trim(), agent: v('agent').trim(), authUntil: v('authUntil'), from: v('from'), to: v('to'),
      territory: picked(form, 'territory'), language: picked(form, 'language'), channel: picked(form, 'channel'),
      exclusive: c('exclusive'), sublicense: c('sublicense'), transferable: c('transferable'), consentRef: form.elements.consentRef ? v('consentRef').trim() : f.consentRef,
      ai: v('ai'), human: v('human').trim(), manifest: v('manifest').trim(), thirdParty: c('thirdParty'), delivery: v('delivery').trim(), price: v('price') === '' ? '' : Number(v('price')), payment: v('payment'),
      forum: v('forum').trim(), law: v('law').trim(), evidence: v('evidence').split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean) };
    return f;
  }

  function paintSide() {
    const probe = { ...f, id: id || '__new__' };
    const miss = rights.missing(probe);
    const why = rights.blockers(db.state, probe, today()).filter((w) => !w.startsWith('必填未齐'));
    $('#left', el).textContent = miss.length ? $t("还差 {0} 项必填", miss.length) : why.length ? $t("必填已齐，另有 {0} 项审核会拦", why.length) : $t("必填已齐，检查全部通过");
    $('#side', el).innerHTML = `<header><h3>${$t("发布前检查")}</h3><span class="badge ${miss.length || why.length ? 'warn' : 'ok'}">${miss.length || why.length ? $t("{0} 项待处理", miss.length + why.length) : $t("可以送审")}</span></header>
      <div class="pad">
        <p class="small mute" style="margin-bottom:6px">${$t("必填项（缺任一项不能提交审核）")}</p>
        <ul class="checks">${miss.length ? miss.map((m) => `<li class="no">${esc(m)}</li>`).join('') : `<li class="ok">${$t("必填项已齐")}</li>`}</ul>
        <p class="small mute" style="margin:10px 0 6px">${$t("审核会拦下的问题")}</p>
        <ul class="checks">${why.length ? why.map((m) => `<li class="no">${esc(m)}</li>`).join('') : `<li class="ok">${$t("没有发现会被拦下的问题")}</li>`}</ul>
        <p class="hint">${$t("关键核查（{0}类）：{1}。", esc(rights.CATEGORIES[f.category]?.name.split('、')[0] || ''), esc(rights.CATEGORIES[f.category]?.check || ''))}</p>
      </div>`;
  }

  function render() { el.innerHTML = html(); paintSide(); }

  const onInput = debounce(() => { collect(); paintSide(); }, 120);
  el.addEventListener('input', () => { dirty = true; onInput(); });
  el.addEventListener('change', (e) => { dirty = true; collect(); if (e.target.name === 'transferable') render(); else paintSide(); });
  el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-fill]')) return;
    const n = String(db.state.seq).padStart(4, '0');
    f = { ...f, assetId: `SIM-AST-9${n}`, title: $t("《南湾灯火》AI辅助微短剧 第{0}版（虚构）", db.state.seq), desc: $t("6 集微短剧，每集 3 分钟，含葡语与英语字幕。"), category: 'film', object: 'content', structure: 'oneoff',
      holder: $t("示例片方己（虚构）"), owner: $t("同权利人"), agent: '', territory: ['PT', 'BR'], language: ['pt', 'en'], channel: ['stream', 'short'], from: '2026-12-01', to: '2027-11-30', exclusive: false, sublicense: false, transferable: false, consentRef: '',
      ai: 'assist', human: $t("人类编剧、分镜与剪辑修改记录（示例）"), manifest: $t("视频与配音模型声明、音乐授权清单（示例）"), thirdParty: true, delivery: $t("加密母版、字幕、许可书、证据清单"), price: 2400, payment: 'bank',
      forum: $t("澳门仲裁（示例）"), law: $t("澳门特别行政区法律（示例）"), evidence: [$t("SIM-EV-剧本存档"), $t("SIM-EV-剪辑工程")], authUntil: '2028-12-31' };
    dirty = true;
    render();
    toast($t("已填入示例：虚构作品与虚构主体，不对应任何真实权利"));
  });
  el.addEventListener('submit', async (e) => {
    if (e.target.id !== 'card') return;
    e.preventDefault();
    collect();
    const now = nowSec();
    const { id: _i, version: _v, status: _s, step: _p, history: _h, createdAt: _c, listedAt: _l, seed: _d, ...patch } = f;
    if (!id) {
      const r = rights.create(db.state, patch, now);
      dirty = false;
      db.commit();
      toast($t("草稿已保存：{0}", r.listing.id), 'ok');
      location.hash = `#/listing/${r.listing.id}`;
      return;
    }
    if (live && !await confirmDialog($t("保存并重新送审"), $t("这个挂牌已准入或已挂牌。保存后版本号变为 v{0}，回到三道审核；基于旧版本的询价需要重新发起。", src.version + 1), { okText: $t("保存并送审") })) return;
    const r = rights.update(db.state, id, patch, now);
    if (!r.ok) return toast(r.error, 'error');
    dirty = false;
    db.commit();
    if (r.bumped) log('right.revise', '挂牌方', id, { version: r.listing.version });
    toast(r.bumped ? $t("已改版为 v{0}，重新进入审核", r.listing.version) : $t("已保存"), 'ok');
    location.hash = `#/listing/${id}`;
  });
  // 离开页面前提醒未保存的修改
  const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', warn);
  render();
  return { destroy() { window.removeEventListener('beforeunload', warn); } };
}
