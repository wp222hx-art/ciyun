// 切换语言会整页重载。这里在重载前记下当前页面里"被改动过的输入项"，重载后填回去，
// 免得填到一半的表单丢失。
// 只记与页面首次打开时不同的输入项：没动过的默认值可能随语言不同，留给新语言自己渲染。
// 记录放在 sessionStorage（只在本标签页、只用一次、两分钟内有效），不进本机长期存储，也不进存证链。

const KEY = 'zjt.keep.v1';
const MAX_AGE_MS = 120000;
const MAX_FIELDS = 300;
const MAX_LEN = 20000;
const SKIP_TYPES = new Set(['file', 'password', 'hidden', 'button', 'submit', 'reset', 'image']);
const FIELDS = 'input, select, textarea';

const typeOf = (el) => String(el.type || '').toLowerCase();
const isBox = (el) => { const t = typeOf(el); return t === 'checkbox' || t === 'radio'; };

/** 一个输入项的身份：name（复选/单选再带上 value）→ id → data-k/i/f。认不出来的返回空串，不参与保留 */
export function keyOf(el) {
  if (SKIP_TYPES.has(typeOf(el))) return '';
  if (el.name) return isBox(el) ? `n:${el.name}=${el.value}` : `n:${el.name}`;
  if (el.id) return `#${el.id}`;
  const d = el.dataset || {};
  if (d.k) return `k:${d.k}:${d.i ?? ''}:${d.f ?? ''}`;
  return '';
}

export function read(el) {
  return isBox(el) ? !!el.checked : String(el.value ?? '');
}

/** 当前页面里所有认得出的输入项：键 → 元素。同键的按出现顺序编号 */
export function scan(root) {
  const out = new Map(), seen = new Map();
  for (const el of root.querySelectorAll(FIELDS)) {
    const k = keyOf(el);
    if (!k) continue;
    const n = seen.get(k) || 0;
    seen.set(k, n + 1);
    out.set(`${k}@${n}`, el);
  }
  return out;
}

/** 按行号识别的输入项（data-k/i/f）有多少个。行可以增删，行数变了就不能再按行号对回去 */
export function rowCount(keys) {
  let n = 0;
  for (const k of keys) if (k.startsWith('k:')) n++;
  return n;
}

export function values(root) {
  const out = new Map();
  for (const [k, el] of scan(root)) out.set(k, read(el));
  return out;
}

/** 与基线不同的输入项。基线里没有的（后来才出现的输入项）一律算改动过 */
export function changed(base, now) {
  const out = [];
  for (const [k, v] of now) {
    if (base.has(k) && base.get(k) === v) continue;
    if (typeof v === 'string' && v.length > MAX_LEN) continue;
    out.push([k, v]);
    if (out.length >= MAX_FIELDS) break;
  }
  return out;
}

/** 重载前调用。写不进去时返回 false，调用方据此决定是否还要提醒"有未保存的修改" */
export function save(root, base, hash) {
  try {
    const now = values(root);
    const fields = changed(base, now);
    sessionStorage.setItem(KEY, JSON.stringify({ v: 1, at: Date.now(), hash, y: Math.round(window.scrollY || 0), rows: rowCount(now.keys()), fields }));
    return true;
  } catch { return false; }
}

/** 重载后调用，取出即删。地址不同、过期或格式不对都作废 */
export function take(hash, now = Date.now()) {
  let raw = null;
  try { raw = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || o.v !== 1 || o.hash !== hash || !Array.isArray(o.fields) || !(now - o.at >= 0 && now - o.at <= MAX_AGE_MS)) return null;
    const fields = o.fields.filter((f) => Array.isArray(f) && typeof f[0] === 'string' && (typeof f[1] === 'string' || typeof f[1] === 'boolean')).slice(0, MAX_FIELDS);
    return { fields, y: Number(o.y) || 0, rows: Number(o.rows) || 0 };
  } catch { return null; }
}

function write(el, v) {
  if (el.disabled || el.readOnly) return false;
  if (isBox(el)) {
    if (typeof v !== 'boolean' || el.checked === v) return false;
    if (typeOf(el) === 'radio' && !v) return false;
    el.checked = v;
    return true;
  }
  if (typeof v !== 'string' || el.value === v) return false;
  // 下拉框里没有这个选项（选项随其他输入项变化）时先不动，等下一轮
  if (el.tagName === 'SELECT' && !Array.from(el.options).some((o) => o.value === v)) return false;
  el.value = v;
  return el.value === v;
}

/** 把记下的值填回去，并像用户操作一样派发 input / change，让页面自己的逻辑接手。
 *  有些输入项要等别的输入项改了才出现，所以分几轮填；每填一项都重新找元素，因为页面可能已经重绘。
 *  返回 { done: 成功填回的个数, total: 记下的个数 }；两者不等说明有内容没能填回 */
export function restore(root, fields, rows = null) {
  // 行数和切换前不一样（增删过行）：按行号的输入项整组不填，免得填到别的行上
  const total = fields.length;
  if (rows !== null && rowCount(scan(root).keys()) !== rows) fields = fields.filter(([k]) => !k.startsWith('k:'));
  const done = new Set();
  for (let pass = 0; pass < 4; pass++) {
    let moved = 0;
    for (const [k, v] of fields) {
      const el = scan(root).get(k);
      if (!el || !write(el, v)) continue;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      done.add(k);
      moved++;
    }
    if (!moved) break;
  }
  return { done: done.size, total };
}
