// 本机存储：读写失败不抛错；内容损坏或版本不符回到空白并留一份备份；存不进去时退回内存，界面如实提示
const mem = new Map();
const subs = new Set();
export const health = { persistent: false, recovered: [], lastError: null };
const ls = () => (typeof localStorage === 'undefined' ? null : localStorage);
try { const k = 'zjt.__probe'; ls().setItem(k, '1'); ls().removeItem(k); health.persistent = true; } catch { health.persistent = false; }
export const onHealth = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const tell = () => { for (const fn of subs) { try { fn(health); } catch { /* 忽略 */ } } };

export function load(key, blank, valid = () => true) {
  let raw = null;
  try { raw = health.persistent ? ls().getItem(key) : mem.get(key) ?? null; } catch (e) { health.lastError = String(e); }
  if (raw == null) return blank();
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object' && !Array.isArray(v) && valid(v)) return { ...blank(), ...v };
  } catch { /* 走下面的恢复 */ }
  try { ls()?.setItem(`${key}.corrupt`, raw.slice(0, 200000)); } catch { /* 忽略 */ }
  health.recovered.push(key);
  return blank();
}

export function save(key, obj) {
  const s = JSON.stringify(obj);
  if (health.persistent) {
    try { ls().setItem(key, s); return true; } catch (e) { health.persistent = false; health.lastError = String(e); mem.set(key, s); tell(); return false; }
  }
  mem.set(key, s);
  return false;
}

/** 一个带版本号的持久化状态：state 可直接改，改完调 commit() */
export function persisted(key, blank, valid) {
  const ok = (v) => v.v === blank().v && (!valid || valid(v));
  const box = { state: load(key, blank, ok) };
  const fns = new Set();
  box.commit = () => { save(key, box.state); for (const fn of fns) { try { fn(); } catch (e) { console.error(e); } } };
  box.reset = () => { box.state = blank(); box.commit(); };
  box.reload = () => { box.state = load(key, blank, ok); for (const fn of fns) fn(); };
  box.onChange = (fn) => { fns.add(fn); return () => fns.delete(fn); };
  box.key = key;
  return box;
}
