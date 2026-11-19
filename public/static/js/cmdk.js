// 全局搜索（Ctrl / ⌘ + K 或 /）：页面、模型桶、算力中心、挂牌
import * as market from './core/market.js';
import * as rights from './core/rights.js';
import { PAGES } from './nav.js';
import { esc } from './ui.js';

let dlg = null, list = [], cur = 0;

function search(q) {
  q = q.trim().toLowerCase();
  const out = [];
  const hit = (...xs) => !q || xs.some((x) => String(x || '').toLowerCase().includes(q));
  for (const p of PAGES) if (hit(p.name, p.desc, p.groupName, p.id)) out.push({ kind: '页面', title: p.name, sub: `${p.groupName} · ${p.desc}`, href: `#/${p.id}` });
  if (q) {
    const S = market.state;
    let n = 0;
    for (const i of S.insts) { if (n >= 8) break; if (hit(i.name, i.id, i.brand)) { out.push({ kind: i.meets ? '行情' : '仅报价', title: i.name, sub: `${i.qLabel} · ${i.suppliers} 家服务商 · ${i.id}`, href: `#/trade/${encodeURIComponent(i.id)}` }); n++; } }
    n = 0;
    for (const c of S.centers) { if (n >= 5) break; if (hit(c.name)) { out.push({ kind: '算力中心', title: c.name, sub: `${c.n} 个在售服务`, href: `#/compute/${encodeURIComponent(c.name)}` }); n++; } }
    n = 0;
    for (const c of rights.db.state.listings) { if (n >= 5) break; if (hit(c.title, c.id, c.holder, c.assetId)) { out.push({ kind: '挂牌', title: c.title, sub: `${c.id} · ${rights.STATES[c.status]}`, href: `#/listing/${c.id}` }); n++; } }
  }
  return out.slice(0, 30);
}

function paint() {
  const ul = dlg.querySelector('ul');
  ul.innerHTML = list.length ? list.map((x, i) => `<li role="option" data-i="${i}" class="${i === cur ? 'on' : ''}" aria-selected="${i === cur}"><em>${esc(x.kind)}</em><b>${esc(x.title)}</b><small>${esc(x.sub)}</small></li>`).join('') : '<li class="none">没有匹配的结果。可以搜页面名、模型名、算力中心或挂牌编号。</li>';
  ul.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}

function go(i) {
  const x = list[i];
  if (!x) return;
  close();
  location.hash = x.href;
}
export function close() { if (dlg?.open) dlg.close(); }

export function open() {
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.className = 'cmdk';
    dlg.innerHTML = `<input type="search" placeholder="搜索页面、模型、算力中心、挂牌编号…" aria-label="全局搜索" autocomplete="off" spellcheck="false"><ul role="listbox"></ul><footer><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></footer>`;
    document.body.appendChild(dlg);
    const input = dlg.querySelector('input');
    input.addEventListener('input', () => { list = search(input.value); cur = 0; paint(); });
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); cur = Math.min(list.length - 1, cur + 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(0, cur - 1); paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); go(cur); }
      // 搜索框有内容时浏览器默认只清空输入，这里统一成一次 Esc 就关闭
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) return close(); const li = e.target.closest('li[data-i]'); if (li) go(Number(li.dataset.i)); });
    dlg.addEventListener('pointermove', (e) => { const li = e.target.closest('li[data-i]'); if (li && Number(li.dataset.i) !== cur) { cur = Number(li.dataset.i); for (const x of dlg.querySelectorAll('li')) x.classList.toggle('on', x === li); } });
  }
  if (dlg.open) return;
  const input = dlg.querySelector('input');
  input.value = '';
  list = search(''); cur = 0; paint();
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  input.focus();
}

export function init() {
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); dlg?.open ? close() : open(); } else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); open(); }
  });
  document.getElementById('cmdk-btn')?.addEventListener('click', open);
}
