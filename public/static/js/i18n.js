// 中英文切换。
// 约定：源码里的文案、业务规则模块（core/）返回的文字、本机保存的数据，一律是中文——这是唯一的"原文"。
// 英文只是展示层：$t() 查词典；core 与已保存数据里的中文在进入页面时由 tx() 翻译。
// 所以切换语言不会改动任何已保存的数据，也不影响规则判断。
// 语言由服务端渲染的 <html lang> 决定（cookie 或 ?lang=），客户端只读不猜，外壳与页面不会各说各话。

const hasDoc = typeof document !== 'undefined';
export const LANG = hasDoc && /^en/i.test(document.documentElement.lang || '') ? 'en' : 'zh';
export const EN = LANG === 'en';

const IDEO = /[\u3400-\u9fff]/;
const IDEO_G = /[\u3400-\u9fff]/g;
const fmt = (s, a) => (a.length ? s.replace(/\{(\d+)\}/g, (m, i) => (Number(i) < a.length ? String(a[Number(i)]) : m)) : s);
const unesc = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[k]));
const escHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 拼接句的拆分顺序：先大后小。规则模块常把"标签：说明""甲、乙"直接拼在一起
const SEPS = [['；', '; '], ['; ', '; '], ['：', ': '], [' · ', ' · '], ['、', ', '], [', ', ', '], ['／', ' / '], ['，', ', '], [' ', ' ']];

/** 用一份词典造出翻译函数。不依赖浏览器，单元测试直接用它 */
export function create(DICT, on = true) {
  const misses = new Set();
  const miss = (s) => { if (s && misses.size < 5000) misses.add(s); };
  const cache = new Map();
  let PATS = null;

  // 带插值的词条反过来当句式用：把一段已经拼好的中文拆回"句式 + 插值"
  function compile() {
    PATS = [];
    for (const k of Object.keys(DICT)) {
      if (!/\{\d+\}/.test(k)) continue;
      const fixed = k.replace(/\{\d+\}/g, '');
      if ((fixed.match(IDEO_G) || []).length < 2) continue; // 固定部分太短的句式容易误伤，不参与反向匹配
      const order = [];
      const src = k.split(/(\{\d+\})/).map((p) => {
        const m = /^\{(\d+)\}$/.exec(p);
        if (m) { order.push(Number(m[1])); return '([\\s\\S]*?)'; }
        return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('');
      PATS.push({ re: new RegExp(`^${src}$`), order, en: DICT[k], w: fixed.length });
    }
    PATS.sort((x, y) => y.w - x.w);
  }
  function byPattern(s) {
    if (!PATS) compile();
    for (const p of PATS) {
      const m = p.re.exec(s);
      if (!m) continue;
      const a = [];
      p.order.forEach((n, i) => { a[n] = tx(m[i + 1]); });
      return fmt(p.en, a);
    }
    return undefined;
  }
  function bySplit(s) {
    for (const [z, e] of SEPS) {
      if (!s.includes(z)) continue;
      const out = s.split(z).map((p) => tx(p));
      if (out.every((p) => !IDEO.test(p))) return out.join(e);
    }
    return undefined;
  }

  /** 把一段中文翻成英文：整句命中 → 带插值的句式 → 按分隔符拆开逐段；都不中就原样返回 */
  function tx(s) {
    if (!on || typeof s !== 'string' || !IDEO.test(s)) return s;
    const hit = cache.get(s);
    if (hit !== undefined) return hit;
    let out = DICT[s];
    if (out === undefined) {
      const k = s.trim();
      if (k !== s) { const r = tx(k); if (r !== k) out = s.replace(k, () => r); }
    }
    if (out === undefined && !s.includes('<')) out = byPattern(s) ?? bySplit(s);
    if (out === undefined) out = s;
    if (cache.size > 4000) cache.clear();
    cache.set(s, out);
    return out;
  }

  /** 插值里如果带着中文（通常来自 core 或已保存的数据），顺手翻掉；带标签的 HTML 片段不动 */
  function arg(x) {
    if (typeof x !== 'string' || !IDEO.test(x) || x.includes('<')) return x;
    if (!x.includes('&')) return tx(x);
    const u = unesc(x), r = tx(u);
    return r === u ? x : u === x ? r : escHtml(r);
  }

  /** 界面文案：键是中文原文，{0} {1} 是插值位置 */
  function t(s, ...a) {
    if (!on) return fmt(s, a);
    const e = DICT[s];
    if (e === undefined) miss(s);
    return fmt(e === undefined ? s : e, a.map(arg));
  }
  return { t, tx, miss, misses };
}

let DICT = {};
/** 词典加载失败时不为空：页面照常以中文显示，由 app.js 提示 */
export let dictError = null;
if (EN) {
  try {
    const [a, b] = await Promise.all([import('./i18n/en-shell.js'), import('./i18n/en.js')]);
    DICT = { ...b.default, ...a.default };
  } catch (e) { dictError = e; console.error(e); }
}
const core = create(DICT, EN);
export const $t = core.t;
export const tx = core.tx;
const miss = core.miss;
if (EN && hasDoc) window.__i18nMiss = core.misses;

/** 兜底：凡是进入页面的中文文本和提示属性都过一遍 tx()。只在英文模式下启用 */
export function watch(root = hasDoc ? document.documentElement : null) {
  if (!EN || !root) return;
  const ATTRS = ['title', 'placeholder', 'aria-label'];
  const text = (n) => {
    const v = n.nodeValue;
    if (!v || !IDEO.test(v)) return;
    const p = n.parentNode && n.parentNode.nodeName;
    if (p === 'TEXTAREA' || p === 'SCRIPT' || p === 'STYLE') return;
    if (n.parentElement && n.parentElement.closest('[translate="no"]')) return; // 语言开关等不翻
    const r = tx(v);
    if (r !== v) n.nodeValue = r;
    if (IDEO.test(r)) miss(r.trim());
  };
  const attrs = (e) => {
    if (e.closest('[translate="no"]')) return;
    for (const a of ATTRS) {
      const v = e.getAttribute(a);
      if (!v || !IDEO.test(v)) continue;
      const r = tx(v);
      if (r !== v) e.setAttribute(a, r);
      if (IDEO.test(r)) miss(r);
    }
  };
  const walk = (n) => {
    if (n.nodeType === 3) return text(n);
    if (n.nodeType !== 1) return;
    attrs(n);
    const w = document.createTreeWalker(n, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let c;
    while ((c = w.nextNode())) (c.nodeType === 3 ? text(c) : attrs(c));
  };
  walk(root);
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === 'characterData') text(m.target);
      else if (m.type === 'attributes') attrs(m.target);
      else for (const n of m.addedNodes) walk(n);
    }
  }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

const PREF = 'zjt.lang';
const readPref = () => { try { return localStorage.getItem(PREF); } catch { return null; } };
const writePref = (v) => { try { localStorage.setItem(PREF, v); } catch { /* 无痕模式等：只靠地址参数 */ } };

/** 切换语言：整页重载，模块级常量随之重新求值。
 *  cookie 在被嵌入的预览框里可能写不进去，所以同时带上 ?lang= 并记在本机，三者任一可用即可 */
export function setLang(lang) {
  const v = lang === 'en' ? 'en' : 'zh';
  writePref(v);
  document.cookie = `lang=${v}; path=/; max-age=31536000; SameSite=Lax`;
  const u = new URL(location.href);
  u.searchParams.set('lang', v);
  location.assign(u.toString());
}

/** 启动时对齐语言偏好。返回 true 表示正在跳转，调用方应停止启动 */
export function syncLang() {
  if (!hasDoc) return false;
  const u = new URL(location.href);
  if (u.searchParams.has('lang')) {
    writePref(LANG);
    // cookie 已生效时把参数从地址栏拿掉；没生效就留着，刷新后仍是这个语言
    if (document.cookie.split('; ').includes(`lang=${LANG}`)) { u.searchParams.delete('lang'); history.replaceState(null, '', u.toString()); }
    return false;
  }
  const pref = readPref();
  if ((pref === 'en' || pref === 'zh') && pref !== LANG) { u.searchParams.set('lang', pref); location.replace(u.toString()); return true; }
  return false;
}
