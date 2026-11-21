// 入口：加载数据 → 路由 → 每秒推进仿真时钟。任何一个页面出错都不应拖垮整个站点。
import * as market from './core/market.js';
import * as account from './core/account.js';
import * as access from './core/access.js';
import * as store from './core/store.js';
import * as cmdk from './cmdk.js';
import { GROUPS, pageOf, groupOf, HOME } from './nav.js';
import { $, $$, esc, toast, fmtNum, fmtTime, fmtIso, nowSec, ago } from './ui.js';
import { $t, tx, EN, LANG, watch, setLang, syncLang, dictError } from './i18n.js';
import * as keep from './formkeep.js';
import { ui } from './uistate.js';

const loaders = {
  home: () => import('./views/home.js'),
  market: () => import('./views/market.js'),
  daily: () => import('./views/daily.js'),
  trade: () => import('./views/trade.js'),
  models: () => import('./views/models.js'),
  compute: () => import('./views/compute.js'),
  assets: () => import('./views/assets.js'),
  listing: () => import('./views/listing.js'),
  procure: () => import('./views/procure.js'),
  entitle: () => import('./views/entitle.js'),
  royalty: () => import('./views/royalty.js'),
  access: () => import('./views/access.js'),
  evidence: () => import('./views/evidence.js'),
  agent: () => import('./views/agent.js'),
  juris: () => import('./views/juris.js'),
  finance: () => import('./views/finance.js'),
  bay: () => import('./views/bay.js'),
  method: () => import('./views/method.js'),
  help: () => import('./views/help.js'),
};

let current = null;
let currentName = '';
let token = 0;
let tickFails = 0;
let booted = false;
// 每个地址首次打开时的输入项取值。切换语言前拿它比对，只带走改动过的输入项
const baselines = new Map();
// 交易页的委托价格和数量不带过去：重载后默认品种可能不同，带过去会把价格填到别的品种上
const NO_KEEP = new Set(['trade']);

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const args = parts.slice(1).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  if (!parts.length) return { name: HOME, args };
  return { name: loaders[parts[0]] ? parts[0] : null, raw: parts[0], args };
}

function panel(title, text, actions) {
  return `<div class="state-panel"><h2>${esc(title)}</h2><p>${text}</p><div class="btn-row">${actions}</div></div>`;
}

function paintNav(name) {
  const g = name ? groupOf(name) : null;
  $$('#main-nav a').forEach((a) => {
    const on = !!g && a.dataset.group === g.id;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    // 记住每个分组上次停留的页面，再点分组名时回到那里
    const grp = GROUPS.find((x) => x.id === a.dataset.group);
    const last = ui.state.lastInGroup[grp.id];
    a.setAttribute('href', `#/${loaders[last] && groupOf(last)?.id === grp.id ? last : grp.pages[0][0]}`);
  });
  const sub = $('#sub-nav');
  if (!g || g.pages.length < 2) { sub.hidden = true; sub.innerHTML = ''; return; }
  sub.hidden = false;
  // 右端固定一个"本页帮助"：直接打开当前页面的使用说明
  sub.innerHTML = g.pages.map(([id, label, desc]) => `<a href="#/${id}" class="${id === name ? 'on' : ''}" title="${esc(desc)}"${id === name ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('')
    + `<span class="sp"></span><a class="sub-help" href="#/help/${name}" title="${$t("打开这一页的使用说明")}"><i aria-hidden="true">?</i><span>${$t("本页帮助")}</span></a>`;
  sub.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

async function route() {
  const { name, raw, args } = parseHash();
  const my = ++token;
  try { current?.destroy?.(); } catch (e) { console.error(e); }
  current = null;
  tickFails = 0;
  const view = $('#view');
  paintNav(name);
  if (!name) {
    currentName = '';
    document.title = `${$t("页面不存在")} · ${$t("澳门词元中心（拟议）")}`;
    view.innerHTML = panel($t("没有这个页面"), $t("地址里的\"{0}\"不对应任何页面。", esc(raw)), `<a class="btn primary" href="#/home">${$t("回到总览")}</a><button class="btn" type="button" data-cmdk>${$t("搜索页面")}</button>`);
    return;
  }
  const page = pageOf(name);
  document.title = `${tx(page.name)} · ${$t("澳门词元中心（拟议）")}`;
  if (ui.state.lastInGroup[page.group] !== name) { ui.state.lastInGroup[page.group] = name; ui.commit(); }
  const slow = setTimeout(() => { if (my === token && !current) view.innerHTML = `<div class="boot"><div class="spinner" aria-hidden="true"></div><p>${$t("正在打开页面…")}</p></div>`; }, 250);
  try {
    const mod = await loaders[name]();
    if (my !== token) return;
    // 每次进入页面都换一个新容器：旧页面挂在容器上的事件监听随容器一起丢弃。
    // 否则同一页面进入两次，一次点击会被处理两次（例如签出两份合同）。
    const root = document.createElement('div');
    root.className = `page v-${name}`;
    view.replaceChildren(root);
    current = mod.mount(root, args) || {};
    if (!baselines.has(location.hash)) { if (baselines.size > 200) baselines.clear(); baselines.set(location.hash, keep.values(root)); }
    if (currentName !== name || args.length) window.scrollTo(0, 0);
    currentName = name;
  } catch (e) {
    console.error(e);
    if (my !== token) return;
    const offline = navigator.onLine === false;
    view.innerHTML = panel($t("这个页面没能打开"), `${offline ? $t("当前没有网络，页面脚本加载不下来。") : $t("页面在加载或渲染时出错，其他页面不受影响。")}<br><span class="mono small">${esc(e.message || e)}</span>`,
      `<button class="btn primary" type="button" data-retry>${$t("重试")}</button><a class="btn" href="#/home">${$t("回到总览")}</a>`);
  } finally { clearTimeout(slow); }
}

function paintStatus() {
  const el = $('#data-status');
  const s = market.state;
  el.className = `chip ${s.catalogLive ? 'live' : 'stale'}`;
  el.textContent = s.catalogLive ? $t("目录实时 · 端点快照 {0}", ago(s.snapshotAt)) : $t("公开目录快照 {0}", ago(s.snapshotAt));
  el.title = $t("模型目录：{0}（{1}）\n服务商端点快照：{2}\n汇率 USD/CNY {3}（{4}）", s.catalogLive ? $t("实时拉取") : $t("离线快照"), fmtIso(s.catalogAt), fmtIso(s.snapshotAt), s.fx.rate, fmtIso(s.fx.asOf));
}

function paintMember() {
  const el = $('#member-chip');
  const m = access.st.member, a = access.st.app;
  el.className = `chip ${m ? 'live' : 'stale'}`;
  el.textContent = m ? $t("已入场 · {0}", access.ROLES[m.role].short) : a && a.status === 'reviewing' ? $t("审核中 · {0}", access.STEPS[a.step].name) : a && a.status === 'returned' ? $t("已退回 · 待补正") : $t("未入场");
  el.title = m ? $t("入场编号 {0}\n场景登记号 {1}（演示编号，非真实登记凭证）", m.no, m.sceneNo) : $t("尚未取得入场资格：无登记不交易");
}

function paintBalance(now) {
  $('#top-balance b').textContent = fmtNum(account.equity(now).total);
}

function paintHealth() {
  const el = $('#foot-store');
  const ok = store.health.persistent;
  el.textContent = ok ? $t("本机存储正常") : $t("本机存储不可用 · 数据只保留到关闭页面");
  el.className = ok ? '' : 'warn';
}
function paintNet() {
  const el = $('#foot-net');
  const on = navigator.onLine !== false;
  el.textContent = on ? $t("网络正常") : $t("网络已断开 · 行情仿真继续，实时目录暂停");
  el.className = on ? '' : 'warn';
}

function loop() {
  if (document.hidden) return; // 页面在后台时不空转；回到前台时账户会按时间补算挂单
  const now = nowSec();
  $('#clock').textContent = fmtTime(now);
  try { account.tick(now); paintBalance(now); } catch (e) { console.error(e); }
  if (!current?.tick || tickFails >= 3) return;
  try { current.tick(now); tickFails = 0; } catch (e) {
    console.error(e);
    if (++tickFails === 3) toast($t("这个页面的实时刷新出错，已暂停刷新。切换页面或刷新浏览器可以恢复。"), 'error');
  }
}

function applyNotice() {
  const n = $('#sim-notice'), b = $('#notice-toggle');
  n.classList.toggle('collapsed', ui.state.noticeCollapsed);
  b.textContent = ui.state.noticeCollapsed ? $t("展开") : $t("收起");
  b.setAttribute('aria-expanded', String(!ui.state.noticeCollapsed));
}

/** 新手引导：按需加载。走完或中途关闭都记为"看过"，首页的欢迎条不再出现 */
let touring = false;
async function startTour() {
  if (touring) return;
  touring = true;
  try {
    const tour = await import('./tour.js');
    await tour.start();
  } catch (e) { console.error(e); toast($t("导览没能打开，请刷新后再试"), 'error'); }
  touring = false;
  $('#welcome')?.remove();
  if (!ui.state.tourSeen || !ui.state.welcomeOff) { ui.state.tourSeen = true; ui.state.welcomeOff = true; ui.commit(); }
}

function wireShell() {
  watch(); // 英文界面：core 与已保存数据里的中文在进入页面时翻译
  cmdk.init();
  $('#lang-switch')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]');
    if (!b || b.dataset.lang === LANG) return;
    // 切换语言会整页重载：先记下本页改动过的输入项，重载后填回去。
    // 记下了才撤掉页面自己的"有未保存的修改"离开提醒；没记下就让它照常提醒
    const root = $('#view > .page'), base = baselines.get(location.hash);
    if (root && base && !NO_KEEP.has(currentName) && keep.save(root, base, location.hash)) {
      try { current?.destroy?.(); } catch (err) { console.error(err); }
      current = null;
    }
    setLang(b.dataset.lang);
  });
  if (EN && dictError) toast('English text failed to load, so the site is shown in Chinese. Reload to try again.', 'error');
  applyNotice();
  $('#notice-toggle').addEventListener('click', () => { ui.state.noticeCollapsed = !ui.state.noticeCollapsed; ui.commit(); applyNotice(); });
  $('#data-status').addEventListener('click', () => { location.hash = '#/method'; });
  $('#view').addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) (booted ? route() : boot());
    else if (e.target.closest('[data-cmdk]')) cmdk.open();
    else if (e.target.closest('[data-tour]')) startTour();
  });
  window.addEventListener('hashchange', () => { if (booted) route(); });
  window.addEventListener('online', () => { paintNet(); toast($t("网络已恢复"), 'ok'); });
  window.addEventListener('offline', () => { paintNet(); toast($t("网络已断开：已加载的行情仿真不受影响，实时目录与实时报价暂停"), 'error'); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && booted) loop(); });
  // 多个标签页同时打开时，别的标签页改了账户或入场状态，这里提示刷新而不是静默覆盖
  window.addEventListener('storage', (e) => { if (e.key && e.key.startsWith('zjt.') && !e.key.startsWith('zjt.ui') && !e.key.startsWith('zjt.obs')) $('#foot-store').textContent = $t("另一个标签页修改了本机数据 · 刷新后同步"); });
  let lastErr = 0;
  const report = (msg) => { console.error(msg); if (Date.now() - lastErr > 8000) { lastErr = Date.now(); toast($t("页面遇到一个未处理的错误，已记录到控制台。若功能异常请刷新。"), 'error'); } };
  window.addEventListener('error', (e) => { if (e.message && !/ResizeObserver/.test(e.message)) report(e.message); });
  window.addEventListener('unhandledrejection', (e) => report(e.reason));
  store.onHealth(paintHealth);
  paintHealth(); paintNet();
  if (store.health.recovered.length) toast($t("本机保存的部分数据已损坏或版本过旧，已重置为初始状态（{0} 项），损坏的原文留有备份。", store.health.recovered.length), 'error');
}

/** 切换语言重载后，把切换前填到一半的内容填回去（只在启动时做一次） */
function restoreKept() {
  const kept = keep.take(location.hash);
  if (!kept) return;
  try {
    const root = $('#view > .page');
    const r = root ? keep.restore(root, kept.fields, kept.rows) : { done: 0, total: kept.fields.length };
    if (kept.y) window.scrollTo(0, kept.y);
    // 全部填回才说"已保留"；有没填回的要照实说，不能让人以为都在
    if (r.done < r.total) toast($t("切换语言后有 {0} 项填写内容没能恢复，请检查后再提交", r.total - r.done), 'error');
    else if (r.done) toast($t("切换语言前填写的内容已保留"));
  } catch (e) { console.error(e); }
}

async function boot(attempt = 1) {
  const view = $('#view');
  view.innerHTML = `<div class="boot"><div class="spinner" aria-hidden="true"></div><p>${$t("正在加载公开目录快照…")}</p></div>`;
  try {
    await market.load();
  } catch (e) {
    console.error(e);
    if (attempt < 3) { await new Promise((r) => setTimeout(r, 800 * attempt)); return boot(attempt + 1); }
    view.innerHTML = panel($t("数据没有加载出来"), `${$t("公开目录快照读取失败（已自动重试 {0} 次）。{1}", attempt - 1, navigator.onLine === false ? $t("当前没有网络。") : '')}<br><span class="mono small">${esc(e.message || e)}</span>`, `<button class="btn primary" type="button" data-retry>${$t("重新加载")}</button>`);
    return;
  }
  booted = true;
  paintStatus();
  account.onChange(() => paintBalance(nowSec()));
  access.onChange(paintMember);
  paintMember();
  await route();
  restoreKept();
  loop();
  setInterval(loop, 1000);
  setInterval(paintStatus, 60000);

  // 后台实时刷新模型目录；失败则继续使用快照，并如实显示
  const r = await market.refreshCatalog();
  paintStatus();
  if (r.ok && (r.added || r.repriced)) toast($t("公开目录已更新：新增 {0} 个模型，{1} 个报价变动", r.added, r.repriced), 'ok');
  if (r.ok && parseHash().name === 'models') route();
}

// 本机记着另一种语言而地址和 cookie 都没带上时，先跳到对应语言再启动
if (!syncLang()) { wireShell(); boot(); }
