// 入口：加载数据 → 路由 → 每秒推进仿真时钟。任何一个页面出错都不应拖垮整个站点。
import * as market from './core/market.js';
import * as account from './core/account.js';
import * as access from './core/access.js';
import * as store from './core/store.js';
import * as cmdk from './cmdk.js';
import { GROUPS, pageOf, groupOf, HOME } from './nav.js';
import { $, $$, esc, toast, fmtNum, fmtTime, fmtIso, nowSec, ago } from './ui.js';

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
};

const ui = store.persisted('zjt.ui.v1', () => ({ v: 1, noticeCollapsed: false, lastInGroup: {} }));
let current = null;
let currentName = '';
let token = 0;
let tickFails = 0;
let booted = false;

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
  sub.innerHTML = g.pages.map(([id, label, desc]) => `<a href="#/${id}" class="${id === name ? 'on' : ''}" title="${esc(desc)}"${id === name ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('');
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
    document.title = '页面不存在 · 澳门词元中心（拟议）';
    view.innerHTML = panel('没有这个页面', `地址里的"${esc(raw)}"不对应任何页面。`, '<a class="btn primary" href="#/home">回到总览</a><button class="btn" type="button" data-cmdk>搜索页面</button>');
    return;
  }
  const page = pageOf(name);
  document.title = `${page.name} · 澳门词元中心（拟议）`;
  if (ui.state.lastInGroup[page.group] !== name) { ui.state.lastInGroup[page.group] = name; ui.commit(); }
  const slow = setTimeout(() => { if (my === token && !current) view.innerHTML = '<div class="boot"><div class="spinner" aria-hidden="true"></div><p>正在打开页面…</p></div>'; }, 250);
  try {
    const mod = await loaders[name]();
    if (my !== token) return;
    // 每次进入页面都换一个新容器：旧页面挂在容器上的事件监听随容器一起丢弃。
    // 否则同一页面进入两次，一次点击会被处理两次（例如签出两份合同）。
    const root = document.createElement('div');
    root.className = `page v-${name}`;
    view.replaceChildren(root);
    current = mod.mount(root, args) || {};
    if (currentName !== name || args.length) window.scrollTo(0, 0);
    currentName = name;
  } catch (e) {
    console.error(e);
    if (my !== token) return;
    const offline = navigator.onLine === false;
    view.innerHTML = panel('这个页面没能打开', `${offline ? '当前没有网络，页面脚本加载不下来。' : '页面在加载或渲染时出错，其他页面不受影响。'}<br><span class="mono small">${esc(e.message || e)}</span>`,
      '<button class="btn primary" type="button" data-retry>重试</button><a class="btn" href="#/home">回到总览</a>');
  } finally { clearTimeout(slow); }
}

function paintStatus() {
  const el = $('#data-status');
  const s = market.state;
  el.className = `chip ${s.catalogLive ? 'live' : 'stale'}`;
  el.textContent = s.catalogLive ? `目录实时 · 端点快照 ${ago(s.snapshotAt)}` : `公开目录快照 ${ago(s.snapshotAt)}`;
  el.title = `模型目录：${s.catalogLive ? '实时拉取' : '离线快照'}（${fmtIso(s.catalogAt)}）\n服务商端点快照：${fmtIso(s.snapshotAt)}\n汇率 USD/CNY ${s.fx.rate}（${fmtIso(s.fx.asOf)}）`;
}

function paintMember() {
  const el = $('#member-chip');
  const m = access.st.member, a = access.st.app;
  el.className = `chip ${m ? 'live' : 'stale'}`;
  el.textContent = m ? `已入场 · ${access.ROLES[m.role].short}` : a && a.status === 'reviewing' ? `审核中 · ${access.STEPS[a.step].name}` : a && a.status === 'returned' ? '已退回 · 待补正' : '未入场';
  el.title = m ? `入场编号 ${m.no}\n场景登记号 ${m.sceneNo}（演示编号，非真实登记凭证）` : '尚未取得入场资格：无登记不交易';
}

function paintBalance(now) {
  $('#top-balance b').textContent = fmtNum(account.equity(now).total);
}

function paintHealth() {
  const el = $('#foot-store');
  const ok = store.health.persistent;
  el.textContent = ok ? '本机存储正常' : '本机存储不可用 · 数据只保留到关闭页面';
  el.className = ok ? '' : 'warn';
}
function paintNet() {
  const el = $('#foot-net');
  const on = navigator.onLine !== false;
  el.textContent = on ? '网络正常' : '网络已断开 · 行情仿真继续，实时目录暂停';
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
    if (++tickFails === 3) toast('这个页面的实时刷新出错，已暂停刷新。切换页面或刷新浏览器可以恢复。', 'error');
  }
}

function applyNotice() {
  const n = $('#sim-notice'), b = $('#notice-toggle');
  n.classList.toggle('collapsed', ui.state.noticeCollapsed);
  b.textContent = ui.state.noticeCollapsed ? '展开' : '收起';
  b.setAttribute('aria-expanded', String(!ui.state.noticeCollapsed));
}

function wireShell() {
  cmdk.init();
  applyNotice();
  $('#notice-toggle').addEventListener('click', () => { ui.state.noticeCollapsed = !ui.state.noticeCollapsed; ui.commit(); applyNotice(); });
  $('#data-status').addEventListener('click', () => { location.hash = '#/method'; });
  $('#view').addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) (booted ? route() : boot());
    else if (e.target.closest('[data-cmdk]')) cmdk.open();
  });
  window.addEventListener('hashchange', () => { if (booted) route(); });
  window.addEventListener('online', () => { paintNet(); toast('网络已恢复', 'ok'); });
  window.addEventListener('offline', () => { paintNet(); toast('网络已断开：已加载的行情仿真不受影响，实时目录与实时报价暂停', 'error'); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && booted) loop(); });
  // 多个标签页同时打开时，别的标签页改了账户或入场状态，这里提示刷新而不是静默覆盖
  window.addEventListener('storage', (e) => { if (e.key && e.key.startsWith('zjt.') && !e.key.startsWith('zjt.ui') && !e.key.startsWith('zjt.obs')) $('#foot-store').textContent = '另一个标签页修改了本机数据 · 刷新后同步'; });
  let lastErr = 0;
  const report = (msg) => { console.error(msg); if (Date.now() - lastErr > 8000) { lastErr = Date.now(); toast('页面遇到一个未处理的错误，已记录到控制台。若功能异常请刷新。', 'error'); } };
  window.addEventListener('error', (e) => { if (e.message && !/ResizeObserver/.test(e.message)) report(e.message); });
  window.addEventListener('unhandledrejection', (e) => report(e.reason));
  store.onHealth(paintHealth);
  paintHealth(); paintNet();
  if (store.health.recovered.length) toast(`本机保存的部分数据已损坏或版本过旧，已重置为初始状态（${store.health.recovered.length} 项），损坏的原文留有备份。`, 'error');
}

async function boot(attempt = 1) {
  const view = $('#view');
  view.innerHTML = '<div class="boot"><div class="spinner" aria-hidden="true"></div><p>正在加载公开目录快照…</p></div>';
  try {
    await market.load();
  } catch (e) {
    console.error(e);
    if (attempt < 3) { await new Promise((r) => setTimeout(r, 800 * attempt)); return boot(attempt + 1); }
    view.innerHTML = panel('数据没有加载出来', `公开目录快照读取失败（已自动重试 ${attempt - 1} 次）。${navigator.onLine === false ? '当前没有网络。' : ''}<br><span class="mono small">${esc(e.message || e)}</span>`, '<button class="btn primary" type="button" data-retry>重新加载</button>');
    return;
  }
  booted = true;
  paintStatus();
  account.onChange(() => paintBalance(nowSec()));
  access.onChange(paintMember);
  paintMember();
  await route();
  loop();
  setInterval(loop, 1000);
  setInterval(paintStatus, 60000);

  // 后台实时刷新模型目录；失败则继续使用快照，并如实显示
  const r = await market.refreshCatalog();
  paintStatus();
  if (r.ok && (r.added || r.repriced)) toast(`公开目录已更新：新增 ${r.added} 个模型，${r.repriced} 个报价变动`, 'ok');
  if (r.ok && parseHash().name === 'models') route();
}

wireShell();
boot();
