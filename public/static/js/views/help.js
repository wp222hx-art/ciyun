// 帮助中心：产品手册（每个模块是什么、怎么用、会被什么拦下）、分角色上手、常见问题、名词解释。
// 内容按语言各写一份（help/zh.js、help/en.js），不走词典；界面上的按钮名用 {{中文原文}} 引用，
// 渲染时换成当前语言的叫法，所以手册里的按钮名永远和界面一致。截图由 scripts/help-shots.mjs 从真实界面截取。
import { $, esc, debounce } from '../ui.js';
import { $t, tx, EN, LANG } from '../i18n.js';
import { GROUPS, pageOf } from '../nav.js';
import { inline, plain, textsOf } from '../help/format.js';
import SHOTS from '../help/shots.js';
import * as access from '../core/access.js';

const H = (await import(EN ? '../help/en.js' : '../help/zh.js')).default;
const T = new Map(H.topics.map((t) => [t.id, t]));
const GUIDE = ['start', 'role-buyer', 'role-supplier', 'role-broker', 'role-creator'];
const REF = ['faq', 'glossary'];
const I = (s) => inline(s, tx);
const titleOf = (t) => (t.title ? plain(t.title, tx) : tx(pageOf(t.id)?.name || t.id));
const sections = () => [
  { name: $t("入门"), ids: GUIDE },
  ...GROUPS.filter((g) => g.id !== 'help').map((g) => ({ name: tx(g.name), ids: g.pages.map((p) => p[0]) })),
  { name: $t("参考"), ids: REF },
].map((s) => ({ ...s, ids: s.ids.filter((id) => T.has(id)) })).filter((s) => s.ids.length);

function fig(s) {
  const m = (SHOTS[LANG] || {})[s.name];
  if (!m) return ''; // 截图还没生成：不放坏图
  const src = `/static/help/${LANG}/${s.name}.webp?v=${SHOTS.v || 1}`;
  const marks = (s.marks || []).slice(0, m.n);
  return `<figure class="shot"><a href="${src}" target="_blank" rel="noopener" title="${$t("点击看大图")}"><img src="${src}" width="${m.w}" height="${m.h}" loading="lazy" decoding="async" alt="${esc(plain(s.cap || '', tx))}"></a>
    ${s.cap ? `<figcaption>${I(s.cap)}</figcaption>` : ''}${marks.length ? `<ol class="marks">${marks.map((x) => `<li>${I(x)}</li>`).join('')}</ol>` : ''}</figure>`;
}
const list = (title, items, cls = '') => (items && items.length ? `<h3>${title}</h3><ul class="${cls}">${items.map((x) => `<li>${I(x)}</li>`).join('')}</ul>` : '');

function topicHtml(t, { heading = 'h2' } = {}) {
  const page = pageOf(t.id);
  return `<header class="help-head"><${heading}>${esc(titleOf(t))}</${heading}>${page ? `<a class="btn sm primary" href="#/${t.id}">${$t("打开这个页面")} →</a>` : ''}</header>
    ${t.lead ? `<p class="lead">${I(t.lead)}</p>` : ''}
    ${t.what ? `<h3>${$t("这一页是干什么的")}</h3><p>${I(t.what)}</p>` : ''}
    ${list($t("谁会用到"), t.who)}
    ${list($t("入场后可以做"), t.can, 'yes')}${list($t("不能做或会被拦下"), t.cannot, 'no')}
    ${t.shots && t.shots.some((s) => (SHOTS[LANG] || {})[s.name]) ? `<h3>${$t("界面一览")}</h3>${t.shots.map(fig).join('')}` : ''}
    ${t.steps && t.steps.length ? `<h3>${t.stepsTitle ? I(t.stepsTitle) : $t("怎么用：一步一步")}</h3><ol class="steps">${t.steps.map((s) => `<li><b>${I(s.t)}</b>${s.d ? `<p>${I(s.d)}</p>` : ''}${s.shot ? fig(s.shot) : ''}</li>`).join('')}</ol>` : ''}
    ${list($t("规则与拦截"), t.rules, 'rules')}${list($t("小提示"), t.tips, 'tips')}
    ${t.qa ? `<div class="qa">${t.qa.map((q) => `<details><summary>${I(q.q)}</summary><p>${I(q.a)}</p></details>`).join('')}</div>` : ''}
    ${t.terms ? `<dl class="terms">${t.terms.map((x) => `<dt>${I(x.t)}</dt><dd>${I(x.d)}</dd>`).join('')}</dl>` : ''}`;
}

function indexHtml() {
  const m = access.st.member;
  const card = (id, sub) => { const t = T.get(id); return t ? `<a class="help-card" href="#/help/${id}"><b>${esc(titleOf(t))}</b><span>${esc(sub || plain(t.lead || '', tx))}</span></a>` : ''; };
  return `<div class="page-head"><h2>${$t("帮助中心")}</h2><p>${$t("这里是平台的使用手册：每个模块是干什么的、怎么一步步用、会被哪些规则拦下，以及不同角色各自从哪里开始。截图取自本站真实界面。")}</p></div>
  <div class="help-search"><input class="input search" id="hq" type="search" placeholder="${$t("搜索帮助：例如 入场、挂牌、转让、分账")}" aria-label="${$t("搜索帮助")}" autocomplete="off"></div>
  <div id="hres" hidden></div>
  <div id="hbody">
  <div class="help-grid three">
    <button class="help-card act" type="button" data-tour><b>${$t("新手导览")}</b><span>${$t("约 1 分钟，带你认一遍界面")}</span></button>
    <a class="help-card act" href="#/help/start"><b>${$t("十分钟快速上手")}</b><span>${$t("按顺序走一遍主流程")}</span></a>
    <a class="help-card act" href="#/help/print"><b>${$t("打印或存为 PDF")}</b><span>${$t("整本手册排在一页上")}</span></a>
  </div>
  <h3 class="help-sec">${$t("按角色开始")}</h3>
  <div class="help-grid">${Object.entries(access.ROLES).map(([k, r]) => `<a class="help-card${m && m.role === k ? ' cur' : ''}" href="#/help/role-${k}"><b>${esc(tx(r.name))}${m && m.role === k ? `<em>${$t("你当前的角色")}</em>` : ''}</b><span>${esc(tx(r.desc))}</span></a>`).join('')}</div>
  <h3 class="help-sec">${$t("按模块查")}</h3>
  ${GROUPS.filter((g) => g.id !== 'help').map((g) => `<p class="help-group">${esc(tx(g.name))}</p><div class="help-grid">${g.pages.map(([id, , desc]) => card(id, tx(desc))).join('')}</div>`).join('')}
  <h3 class="help-sec">${$t("参考")}</h3>
  <div class="help-grid">${REF.map((id) => card(id)).join('')}</div>
  <p class="mute small help-foot">${$t("截图取自本站真实界面，界面数字会随公开目录和仿真时间变化，以你看到的为准。")}</p>
  </div>`;
}

function search(q) {
  q = q.trim().toLowerCase();
  if (!q) return null;
  const out = [];
  for (const t of H.topics) {
    const texts = [titleOf(t), ...textsOf(t).map((x) => plain(x, tx))];
    const hit = texts.find((x) => x.toLowerCase().includes(q));
    if (hit) out.push({ t, hit });
  }
  return out;
}

export function mount(el, args) {
  const id = args[0];
  if (!id) {
    el.innerHTML = indexHtml();
    const paint = () => {
      const r = search($('#hq', el).value), res = $('#hres', el);
      $('#hbody', el).hidden = !!r; res.hidden = !r;
      if (!r) return;
      res.innerHTML = r.length ? `<p class="mute small">${$t("找到 {0} 个主题", r.length)}</p><div class="help-grid">${r.map(({ t, hit }) => `<a class="help-card" href="#/help/${t.id}"><b>${esc(titleOf(t))}</b><span>${esc(hit.length > 90 ? `${hit.slice(0, 90)}…` : hit)}</span></a>`).join('')}</div>`
        : `<p class="empty">${$t("没有找到相关内容，换个词试试。")}</p>`;
    };
    $('#hq', el).addEventListener('input', debounce(paint, 120));
    return {};
  }
  if (id === 'print') {
    el.classList.add('help-print');
    el.innerHTML = `<div class="page-head"><h2>${$t("澳门词元中心（拟议）")} · ${$t("使用手册")}</h2><p>${$t("截图取自本站真实界面，界面数字会随公开目录和仿真时间变化，以你看到的为准。")}</p>
      <p class="mute small">${esc(document.querySelector('#foot span')?.textContent || '')}</p>
      <div class="btn-row no-print"><button class="btn primary" type="button" id="do-print">${$t("打印 / 存为 PDF")}</button><a class="btn" href="#/help">← ${$t("回到帮助中心")}</a></div></div>
      <nav class="print-toc">${sections().map((s) => `<p><b>${esc(s.name)}</b>${s.ids.map((x) => `<a href="#/help/${x}">${esc(titleOf(T.get(x)))}</a>`).join('')}</p>`).join('')}</nav>
      ${sections().map((s) => s.ids.map((x) => `<article class="help-doc" id="doc-${x}">${topicHtml(T.get(x)).replaceAll('loading="lazy"', 'loading="eager"').replaceAll('<details>', '<details open>')}</article>`).join('')).join('')}`;
    $('#do-print', el).addEventListener('click', () => window.print());
    return {};
  }
  const t = T.get(id);
  if (!t) {
    el.innerHTML = `<div class="state-panel"><h2>${$t("没有这个帮助主题")}</h2><p>${$t("地址里的\"{0}\"不对应任何帮助主题。", esc(id))}</p><div class="btn-row"><a class="btn primary" href="#/help">${$t("回到帮助中心")}</a></div></div>`;
    return {};
  }
  const secs = sections(), order = secs.flatMap((s) => s.ids), k = order.indexOf(id);
  const nb = (x, label, cls) => (x ? `<a class="${cls}" href="#/help/${x}"><small>${label}</small><b>${esc(titleOf(T.get(x)))}</b></a>` : '<span></span>');
  el.innerHTML = `<div class="help-layout">
    <aside class="help-toc" aria-label="${$t("全部主题")}"><a class="back" href="#/help">← ${$t("帮助中心")}</a>
      ${secs.map((s) => `<p>${esc(s.name)}</p>${s.ids.map((x) => `<a href="#/help/${x}"${x === id ? ' class="on" aria-current="page"' : ''}>${esc(titleOf(T.get(x)))}</a>`).join('')}`).join('')}</aside>
    <article class="help-doc"><p class="help-back"><a href="#/help">← ${$t("全部主题")}</a></p>${topicHtml(t)}
      <nav class="help-nav">${nb(order[k - 1], $t("上一篇"), 'prev')}${nb(order[k + 1], $t("下一篇"), 'next')}</nav></article></div>`;
  $('.help-toc .on', el)?.scrollIntoView({ block: 'nearest' });
  return {};
}
