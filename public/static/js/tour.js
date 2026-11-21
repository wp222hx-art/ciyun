// 新手导览：把界面上几个关键位置依次圈出来讲一句。按需加载，不自动弹出。
// 文案在 help/zh.js、help/en.js 的 tour 里。找不到或当前宽度下被隐藏的位置自动跳过。
import { EN } from './i18n.js';

const H = (await import(EN ? './help/en.js' : './help/zh.js')).default;
const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden'; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 开始导览。走完或关闭后 resolve */
export async function start() {
  const U = H.tourUi;
  if (!/^(#\/?(home)?)?$/.test(location.hash)) { location.hash = '#/home'; await wait(700); }
  const steps = H.tour.filter((s) => !s.sel || visible(document.querySelector(s.sel)));
  if (!steps.length) return;
  const block = document.createElement('div'); block.className = 'tour-block';
  const spot = document.createElement('div'); spot.className = 'tour-spot';
  const pop = document.createElement('div'); pop.className = 'tour-pop';
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'true'); pop.setAttribute('aria-label', U.name);
  document.body.append(block, spot, pop);
  const prevFocus = document.activeElement;
  let i = 0, done;
  const finished = new Promise((r) => { done = r; });

  function place() {
    const s = steps[i], el = s.sel ? document.querySelector(s.sel) : null;
    const vw = window.innerWidth, vh = window.innerHeight, pw = pop.offsetWidth, ph = pop.offsetHeight;
    if (!el || !visible(el)) { // 没有目标：居中说明
      spot.style.cssText = `left:${vw / 2}px;top:${vh / 2}px;width:0;height:0`;
      pop.style.left = `${Math.max(12, (vw - pw) / 2)}px`; pop.style.top = `${Math.max(12, (vh - ph) / 2)}px`;
      return;
    }
    const r = el.getBoundingClientRect(), pad = 6;
    const x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
    const w = Math.min(vw - 4, r.right + pad) - x, h = Math.min(vh - 4, r.bottom + pad) - y;
    spot.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    const below = y + h + 12, above = y - ph - 12;
    const top = below + ph <= vh - 8 ? below : above >= 8 ? above : Math.max(8, vh - ph - 8);
    pop.style.top = `${top}px`;
    pop.style.left = `${Math.min(Math.max(12, x + w / 2 - pw / 2), Math.max(12, vw - pw - 12))}px`;
  }

  function show() {
    const s = steps[i], last = i === steps.length - 1;
    pop.innerHTML = `<p class="tour-n">${esc(U.of.replace('{0}', i + 1).replace('{1}', steps.length))}</p><h3>${esc(s.t)}</h3><p>${esc(s.d)}</p>
      <div class="tour-acts"><button class="btn sm ghost" type="button" data-t="skip">${esc(last ? U.close : U.skip)}</button><span class="sp"></span>
      ${i ? `<button class="btn sm" type="button" data-t="prev">${esc(U.prev)}</button>` : ''}
      ${last ? `<a class="btn sm primary" href="#/help" data-t="help">${esc(U.help)}</a>` : `<button class="btn sm primary" type="button" data-t="next">${esc(U.next)}</button>`}</div>`;
    const el = s.sel ? document.querySelector(s.sel) : null;
    if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    place();
    requestAnimationFrame(place);
    (pop.querySelector('[data-t="next"], [data-t="help"]') || pop).focus({ preventScroll: true });
  }
  const go = (d) => { i = Math.min(steps.length - 1, Math.max(0, i + d)); show(); };
  function end() {
    window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);
    document.removeEventListener('keydown', key, true); window.removeEventListener('hashchange', end);
    block.remove(); spot.remove(); pop.remove();
    if (prevFocus && prevFocus.focus) try { prevFocus.focus({ preventScroll: true }); } catch { /* 元素已不在页面上 */ }
    done();
  }
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
    if (b.dataset.t === 'next') go(1); else if (b.dataset.t === 'prev') go(-1); else end(); // skip / help（链接照常跳转）
  });
  block.addEventListener('click', (e) => e.stopPropagation());
  window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
  document.addEventListener('keydown', key, true);
  show();
  // 用户点了卡片里的链接、或用浏览器后退离开首页：结束导览
  await wait(0); window.addEventListener('hashchange', end);
  return finished;
}
