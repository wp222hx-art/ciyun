// 算力服务权益（G08、G20）：登记 → 预订 → 交付核销 → 受限转让 → 到期。
// 数量账与资金账分开；每一步之后都必须满足：批次容量 = 未售 + Σ(已用 + 可用 + 冻结 + 到期 + 退款)。
import { persisted } from './store.js';

export const UNITS = { gpuh: 'GPU小时', mtok: '百万计费Token', vsec: '视频秒数', task: '合格任务' };
export const COMPUTE_FEE = 0.03; // G21：按净交易规模 3% 取组织费〔示例假设〕
const fail = (error) => ({ ok: false, error });
const has = (s) => String(s ?? '').trim().length > 0;
const pos = (x) => Number.isFinite(Number(x)) && Number(x) > 0;
const nid = (S, kind) => `SIM-${kind}-${String(S.seq++).padStart(4, '0')}`;

export const availOf = (e) => e.qty - e.used - e.frozen - e.out - e.expired - e.refunded;

/** 供方登记一个批次：容量证明 + 服务合同 */
export function register(S, f, now) {
  if (!has(f.supplier)) return fail('请填写供方');
  if (!UNITS[f.unit]) return fail('请选择原生计量单位');
  if (!pos(f.capacity)) return fail('可承诺容量必须大于 0');
  if (!has(f.proof)) return fail('须提交容量证明与服务合同引用：无履约保证的额度不能挂牌');
  if (!(f.expiresAt > now)) return fail('到期时间必须晚于现在');
  const b = { id: nid(S, 'PC'), supplier: f.supplier.trim(), spec: String(f.spec || '').trim(), region: f.region || '', unit: f.unit, capacity: Number(f.capacity), sold: 0,
    transferable: !!f.transferable, minUnit: Number(f.minUnit) || 1, price: Number(f.price) || 0, proof: f.proof.trim(), expiresAt: f.expiresAt, t: Math.floor(now), eligible: f.eligible || null };
  S.batches.unshift(b);
  return { ok: true, batch: b };
}

/** 买方预订：核查可售余量，超卖阻断 */
export function book(S, batchId, holder, qty, now) {
  const b = S.batches.find((x) => x.id === batchId);
  if (!b) return fail('批次不存在');
  if (!has(holder)) return fail('请填写买方');
  if (!pos(qty)) return fail('预订数量必须大于 0');
  if (now >= b.expiresAt) return fail('批次已到期');
  qty = Number(qty);
  if (b.sold + qty > b.capacity + 1e-9) return fail(`超卖阻断：批次容量 ${b.capacity}，已售 ${b.sold}，可售余量 ${b.capacity - b.sold}，本次请求 ${qty}`);
  b.sold += qty;
  const e = { id: nid(S, 'QY'), batchId, holder: holder.trim(), qty, used: 0, frozen: 0, out: 0, expired: 0, refunded: 0, parent: null, receipts: [], t: Math.floor(now) };
  S.ents.unshift(e);
  S.money.unshift({ t: Math.floor(now), kind: '预订', ref: e.id, payer: e.holder, payee: b.supplier, amount: qty * b.price, fee: Math.round(qty * b.price * COMPUTE_FEE * 100) / 100 });
  return { ok: true, ent: e };
}

/** 交付核销。回执编号幂等：同一张回执重复提交不重复计量 */
export function consume(S, entId, qty, receipt, now) {
  const e = S.ents.find((x) => x.id === entId);
  if (!e) return fail('权益不存在');
  if (!has(receipt)) return fail('核销须带供方签名回执编号');
  if (e.receipts.includes(receipt)) return { ok: true, duplicate: true, ent: e };
  if (!pos(qty)) return fail('核销数量必须大于 0');
  const b = S.batches.find((x) => x.id === e.batchId);
  if (now >= b.expiresAt) return fail('权益已到期，不能再核销');
  qty = Number(qty);
  if (qty > availOf(e) + 1e-9) return fail(`可用余量不足：可用 ${availOf(e)}${e.frozen ? `（另有 ${e.frozen} 转让冻结中，不能消费）` : ''}，本次核销 ${qty}`);
  e.used += qty;
  e.receipts.push(receipt);
  return { ok: true, ent: e };
}

/** 发起转让：先冻结，冻结部分不能消费也不能再转 */
export function requestTransfer(S, entId, to, qty, now) {
  const e = S.ents.find((x) => x.id === entId);
  if (!e) return fail('权益不存在');
  const b = S.batches.find((x) => x.id === e.batchId);
  if (!b.transferable) return fail('服务合同不允许转让：转让不是默认权利');
  if (now >= b.expiresAt) return fail('权益已到期');
  if (!has(to)) return fail('请填写受让方');
  if (to.trim() === e.holder) return fail('受让方与转出方是同一主体');
  if (!pos(qty)) return fail('转让数量必须大于 0');
  qty = Number(qty);
  if (qty < b.minUnit) return fail(`低于最低转让单位 ${b.minUnit}`);
  if (qty > availOf(e) + 1e-9) return fail(`未使用余量不足：可用 ${availOf(e)}，申请转让 ${qty}`);
  if (b.eligible && !b.eligible.includes(to.trim())) return fail('受让方不在供方认可的地域或资格范围内');
  e.frozen += qty;
  const t = { id: nid(S, 'ZR'), entId, batchId: b.id, from: e.holder, to: to.trim(), qty, supplier: false, receiver: false, status: 'pending', t: Math.floor(now) };
  S.transfers.unshift(t);
  return { ok: true, transfer: t };
}

/** 供方同意 / 受让方确认；两方都确认后生成后继权益 */
export function confirm(S, transferId, party, now) {
  const t = S.transfers.find((x) => x.id === transferId);
  if (!t || t.status !== 'pending') return fail('没有待确认的转让');
  if (party !== 'supplier' && party !== 'receiver') return fail('确认方只能是供方或受让方');
  t[party] = true;
  if (!(t.supplier && t.receiver)) return { ok: true, done: false };
  const e = S.ents.find((x) => x.id === t.entId);
  e.frozen -= t.qty; e.out += t.qty;
  const n = { id: nid(S, 'QY'), batchId: t.batchId, holder: t.to, qty: t.qty, used: 0, frozen: 0, out: 0, expired: 0, refunded: 0, parent: e.id, receipts: [], t: Math.floor(now) };
  S.ents.unshift(n);
  t.status = 'done'; t.doneAt = Math.floor(now); t.newEnt = n.id;
  return { ok: true, done: true, ent: n };
}

/** 任一方拒绝或转出方撤回：解冻，数量回到原权益 */
export function cancelTransfer(S, transferId, why, now) {
  const t = S.transfers.find((x) => x.id === transferId);
  if (!t || t.status !== 'pending') return fail('没有待确认的转让');
  const e = S.ents.find((x) => x.id === t.entId);
  e.frozen -= t.qty;
  t.status = 'cancelled'; t.why = why || ''; t.doneAt = Math.floor(now);
  return { ok: true };
}

/** 到期：未用余量作废（含冻结中的转让一并撤销） */
export function expire(S, now) {
  let n = 0;
  for (const b of S.batches) {
    if (now < b.expiresAt || b.closed) continue;
    for (const t of S.transfers) if (t.batchId === b.id && t.status === 'pending') cancelTransfer(S, t.id, '批次到期', now);
    for (const e of S.ents) if (e.batchId === b.id) { const a = availOf(e); if (a > 0) { e.expired += a; n++; } }
    b.closed = true;
  }
  return n;
}

/** 数量守恒检查 */
export function invariant(S, batchId) {
  const b = S.batches.find((x) => x.id === batchId);
  const es = S.ents.filter((e) => e.batchId === batchId);
  const sum = (f) => es.reduce((a, e) => a + f(e), 0);
  const used = sum((e) => e.used), avail = sum(availOf), frozen = sum((e) => e.frozen), expired = sum((e) => e.expired), refunded = sum((e) => e.refunded);
  const unsold = b.capacity - b.sold;
  const total = unsold + used + avail + frozen + expired + refunded;
  const each = es.every((e) => availOf(e) >= -1e-9 && e.frozen >= -1e-9);
  const roots = es.filter((e) => !e.parent).reduce((a, e) => a + e.qty, 0);
  return { capacity: b.capacity, unsold, used, avail, frozen, expired, refunded, total, ok: Math.abs(total - b.capacity) < 1e-6 && each && Math.abs(roots - b.sold) < 1e-6 };
}

/** G20 算例：逐步重放，每一步后都做守恒检查 */
export function replayG20(S, now) {
  const steps = [];
  const snap = (label, b) => steps.push({ label, ...invariant(S, b.id), ents: S.ents.filter((e) => e.batchId === b.id).map((e) => ({ holder: e.holder, used: e.used, avail: availOf(e), frozen: e.frozen })).reverse() });
  const { batch: b } = register(S, { supplier: '示例供方（虚构）', spec: '指定 GPU 节点 · 指定期间（G20 算例）', region: '示例地域', unit: 'gpuh', capacity: 1000, transferable: true, minUnit: 10, price: 2, proof: 'SIM-容量证明-G20', expiresAt: now + 90 * 86400 }, now);
  const { ent: a } = book(S, b.id, '企业A（虚构）', 1000, now);
  snap('供方登记 1,000 GPU小时，企业A 预订', b);
  consume(S, a.id, 600, `${a.id}-R1`, now);
  snap('A 使用 600，剩余 400', b);
  const { transfer: t } = requestTransfer(S, a.id, '制作方B（虚构）', 300, now);
  snap('A 申请转 300 给 B：先冻结 300', b);
  confirm(S, t.id, 'supplier', now);
  const r = confirm(S, t.id, 'receiver', now);
  snap('供方同意、B 确认：A 可用 100，B 可用 300', b);
  consume(S, r.ent.id, 220, `${r.ent.id}-R1`, now);
  snap('B 使用 220，剩余 80', b);
  return { batch: b, steps };
}

export const blank = () => ({ v: 1, batches: [], ents: [], transfers: [], money: [], seq: 1 });
export const db = persisted('zjt.entitle.v1', blank, (v) => Array.isArray(v.batches) && Array.isArray(v.ents));
