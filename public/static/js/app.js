// 入口：加载数据 → 路由 → 每秒推进仿真时钟
import * as market from './core/market.js';
import * as account from './core/account.js';
import * as access from './core/access.js';
import { $, $$, esc, toast, fmtNum, fmtTime, fmtIso, nowSec, ago } from './ui.js';

const loaders = {
  access: () => import('./views/access.js'),
  daily: () => import('./views/daily.js'),
  bay: () => import('./views/bay.js'),
  market: () => import('./views/market.js'),
  trade: () => import('./views/trade.js'),
  models: () => import('./views/models.js'),
  compute: () => import('./views/compute.js'),
  procure: () => import('./views/procure.js'),
  assets: () => import('./views/assets.js'),
  method: () => import('./views/method.js'),
};

let current = null;
let token = 0;

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const args = parts.slice(1).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  return { name: loaders[parts[0]] ? parts[0] : 'market', args };
}

async function route() {
  const { name, args } = parseHash();
  const my = ++token;
  try { current?.destroy?.(); } catch (e) { console.error(e); }
  current = null;
  $$('#main-nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === name));
  const view = $('#view');
  try {
    const mod = await loaders[name]();
    if (my !== token) return;
    // 每次进入页面都换一个新容器：旧页面挂在容器上的事件监听随容器一起丢弃。
    // 否则同一页面进入两次，一次点击会被处理两次（例如签出两份合同）。
    const root = document.createElement('div');
    root.className = `v-${name}`;
    view.replaceChildren(root);
    current = mod.mount(root, args) || {};
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<p class="empty">页面加载失败：${esc(e.message || e)}</p>`;
  }
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

function loop() {
  const now = nowSec();
  $('#clock').textContent = fmtTime(now);
  try {
    account.tick(now);
    current?.tick?.(now);
    paintBalance(now);
  } catch (e) { console.error(e); }
}

async function boot() {
  try {
    await market.load();
  } catch (e) {
    $('#view').innerHTML = `<p class="empty">数据加载失败：${esc(e.message || e)}。请刷新重试。</p>`;
    return;
  }
  paintStatus();
  $('#data-status').addEventListener('click', () => { location.hash = '#/method'; });
  account.onChange(() => paintBalance(nowSec()));
  access.onChange(paintMember);
  paintMember();
  window.addEventListener('hashchange', route);
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

boot();
