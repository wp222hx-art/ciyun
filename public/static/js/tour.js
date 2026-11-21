// 导览：把界面上的关键位置依次圈出来讲一句。按需加载，不自动弹出。
//   新手导览：顶栏和首页，文案在 help/zh-guide.js、help/en-guide.js 的 tour 里
//   本页导览：每个功能页面一套，文案在 help/zh-tours.js、help/en-tours.js 里
// 找不到、或当前状态下看不见的位置自动跳过。
import { EN, tx } from './i18n.js';
import { inline } from './help/format.js';

const H = (await import(EN ? './help/en.js' : './help/zh.js')).default;
const U = H.tourUi;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden'; };

/** 按写法找目标：'#a' 在范围内找；'sec:#a' 取 #a 所在的整块区域 */
export function find(sel, root = document) {
  if (!sel) return null;
  const sec = sel.startsWith('sec:');
  let el = null;
  try { el = root.querySelector(sec ? sel.slice(4) : sel); } catch { return null; }
  return el && sec ? el.closest('section') : el;
}

let open = false;

/** 走一遍。打不开（已有导览在进行，或没有一步能圈出来）返回 false；走完或关闭后返回 true */
async function run(all, { root = document, name, last }) {
  if (open) return false;
  const steps = all.filter((s) => !s.sel || visible(find(s.sel, root)));
  if (!steps.length) return false;
  open = true;
  const block = document.createElement('div'); block.className = 'tour-block';
  const spot = document.createElement('div'); spot.className = 'tour-spot';
  const pop = document.createElement('div'); pop.className = 'tour-pop';
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'true'); pop.setAttribute('aria-label', name);
  document.body.append(block, spot, pop);
  const prevFocus = document.activeElement, y0 = window.scrollY;
  let i = 0, done, left = false;
  const finished = new Promise((r) => { done = r; });
  const target = () => find(steps[i].sel, root);
  // 吸顶导航的下沿：页面内容滚到它下面就被挡住了，高亮区不能伸进去
  const chromeBottom = () => Math.max(0, document.getElementById('chrome')?.getBoundingClientRect().bottom || 0);

  function place() {
    const el = target();
    const vw = window.innerWidth, vh = window.innerHeight, pw = pop.offsetWidth, ph = pop.offsetHeight;
    if (!el || !visible(el)) { // 没有目标：居中说明
      spot.style.cssText = `left:${vw / 2}px;top:${vh / 2}px;width:0;height:0`;
      pop.style.left = `${Math.max(12, (vw - pw) / 2)}px`; pop.style.top = `${Math.max(12, (vh - ph) / 2)}px`;
      return;
    }
    const r = el.getBoundingClientRect(), pad = 6;
    const minY = el.closest('#chrome') ? 4 : chromeBottom() + 2;
    const x = Math.max(4, r.left - pad), y = Math.max(minY, r.top - pad);
    const w = Math.max(0, Math.min(vw - 4, r.right + pad) - x);
    let h = Math.max(0, Math.min(vh - 4, r.bottom + pad) - y);
    const below = y + h + 12, above = y - ph - 12;
    let top;
    if (below + ph <= vh - 8) top = below;
    else if (above >= 8) top = above;
    else { // 目标比屏幕还高：只圈住上半截，把说明放在它下面
      const cap = vh - 8 - ph - 12 - y;
      if (cap >= 90) { h = cap; top = y + h + 12; } else top = Math.max(8, vh - ph - 8);
    }
    spot.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    pop.style.top = `${top}px`;
    pop.style.left = `${Math.min(Math.max(12, x + w / 2 - pw / 2), Math.max(12, vw - pw - 12))}px`;
  }

  /** 把目标滚到看得见的地方：已经完整可见且放得下说明就不动；否则放到吸顶导航下面 */
  function bring(el) {
    if (!el || el.closest('#chrome')) return;
    const r = el.getBoundingClientRect(), vh = window.innerHeight, ph = pop.offsetHeight;
    const top = chromeBottom() + 12, room = vh - top - 12;
    const fits = r.top >= top - 1 && r.bottom <= vh + 1;
    if (fits && (r.bottom + ph + 24 <= vh || r.top - ph - 24 >= 8)) return;
    const want = r.height + ph + 30 <= room ? top + (room - r.height - ph - 30) / 2 : top;
    window.scrollBy(0, r.top - want);
  }

  function show() {
    const s = steps[i], isLast = i === steps.length - 1;
    pop.innerHTML = `<p class="tour-n">${esc(name)} · ${esc(U.of.replace('{0}', i + 1).replace('{1}', steps.length))}</p><h3>${inline(s.t, tx)}</h3><p>${inline(s.d, tx)}</p>
      <div class="tour-acts"><button class="btn sm ghost" type="button" data-t="skip">${esc(isLast ? U.close : U.skip)}</button><span class="sp"></span>
      ${i ? `<button class="btn sm" type="button" data-t="prev">${esc(U.prev)}</button>` : ''}
      ${isLast ? `<a class="btn sm primary" href="${esc(last.href)}" data-t="help">${esc(last.label)}</a>` : `<button class="btn sm primary" type="button" data-t="next">${esc(U.next)}</button>`}</div>`;
    bring(target());
    place();
    requestAnimationFrame(place);
    (pop.querySelector('[data-t="next"], [data-t="help"]') || pop).focus({ preventScroll: true });
  }
  const go = (d) => { i = Math.min(steps.length - 1, Math.max(0, i + d)); show(); };
  // 页面每秒都在刷新行情，区块的位置和大小会变：定时跟一下
  const follow = setInterval(place, 500);
  function end() {
    clearInterval(follow);
    window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);
    document.removeEventListener('keydown', key, true); window.removeEventListener('hashchange', leave);
    block.remove(); spot.remove(); pop.remove();
    // 留在本页：回到开始导览时的位置。跳去别的页面时由路由自己定位
    if (!left) window.scrollTo(0, y0);
    if (prevFocus && prevFocus.focus) try { prevFocus.focus({ preventScroll: true }); } catch { /* 元素已不在页面上 */ }
    open = false;
    done(true);
  }
  function leave() { left = true; end(); }
  function key(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(); } else if (e.key === 'ArrowRight' && i < steps.length - 1) go(1);
    else if (e.key === 'ArrowLeft' && i > 0) go(-1);
    else if (e.key === 'Tab') { // 焦点留在导览卡片里
      const f = [...pop.querySelectorAll('button, a')]; if (!f.length) return;
      const k = f.indexOf(document.activeElement);
      e.preventDefault(); f[(k + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  }
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    if (b.dataset.t === 'next') go(1); else if (b.dataset.t === 'prev') go(-1);
    else if (b.dataset.t === 'help') { // 链接照常跳转；地址没变（已经在目标页）时不会触发 hashchange，这里直接收尾
      if (b.getAttribute('href') === location.hash) { e.preventDefault(); end(); }
    } else end();
  });
  block.addEventListener('click', (e) => e.stopPropagation());
  window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
  document.addEventListener('keydown', key, true);
  show();
  // 用户点了卡片里的链接、或用浏览器后退离开本页：结束导览
  await wait(0); window.addEventListener('hashchange', leave);
  return finished;
}

/** 新手导览：先回到首页，再认一遍顶栏和首页 */
export async function start() {
  if (!/^(#\/?(home)?)?$/.test(location.hash)) { location.hash = '#/home'; await wait(700); }
  return run(H.tour, { name: U.name, last: { href: '#/help', label: U.help } });
}

/** 本页导览。key 见 nav.js 的 tourKey；helpId 是最后一步"看本页完整说明"要打开的帮助主题 */
export function startPage(key, helpId) {
  const steps = H.tours[key];
  if (!steps) return Promise.resolve(false);
  return run(steps, { root: document.querySelector('#view > .page') || document, name: U.pageName, last: { href: `#/help/${helpId}`, label: U.more } });
}
