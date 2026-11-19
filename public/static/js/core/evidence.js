// 溯源存证（G12）：在本机哈希链之上做 Merkle 批次承诺。
// 对外只需要公布批次根；持有某条记录原文的人，凭几条兄弟哈希就能证明它在这一批里，别人仅凭根值推不出原文。
import * as merkle from './merkle.js';
import { sha256 } from './sha256.js';
import { persisted } from './store.js';

export const METHOD = 'merkle-sha256-sim-1';
export const db = persisted('zjt.evidence.v1', () => ({ v: 1, batches: [], seq: 1 }), (v) => Array.isArray(v.batches));
const fail = (error) => ({ ok: false, error });

export const lastAnchored = (batches) => (batches.length ? Math.max(...batches.map((b) => b.to)) : 0);
export const pending = (ledger, batches) => { const from = lastAnchored(batches); return ledger.filter((e) => e.i > from); };
const leaves = (ledger, b) => ledger.filter((e) => e.i >= b.from && e.i <= b.to).map((e) => e.hash);

/** 把尚未入批的记录封成一个批次 */
export function anchor(S, ledger, now) {
  const todo = pending(ledger, S.batches);
  if (!todo.length) return fail('没有尚未入批的记录');
  const prev = S.batches[0]?.seal || 'GENESIS';
  const root = merkle.root(todo.map((e) => e.hash));
  const b = { id: `SIM-BATCH-${String(S.seq++).padStart(4, '0')}`, from: todo[0].i, to: todo.at(-1).i, n: todo.length, root, prev, method: METHOD, t: Math.floor(now) };
  b.seal = sha256(`${prev}|${b.id}|${b.from}|${b.to}|${b.n}|${root}`); // 批次之间也串成链
  S.batches.unshift(b);
  return { ok: true, batch: b };
}

/** 用本机原始记录重算批次根 */
export function verifyBatch(ledger, b) {
  const ls = leaves(ledger, b);
  if (ls.length !== b.n) return { ok: false, why: `本机只保留了该批 ${b.n} 条中的 ${ls.length} 条原始记录，无法重算` };
  return merkle.root(ls) === b.root ? { ok: true } : { ok: false, why: '重算出的批次根与锚定值不符：批内记录被改动过' };
}

/** 第 i 条记录的包含性证明 */
export function prove(S, ledger, i) {
  const e = ledger.find((x) => x.i === i);
  if (!e) return fail('本机没有这条记录');
  const b = S.batches.find((x) => i >= x.from && i <= x.to);
  if (!b) return fail('这条记录还没有入批');
  const ls = leaves(ledger, b);
  if (ls.length !== b.n) return fail('该批次的原始记录已不完整，无法出具证明');
  const path = merkle.proof(ls, ls.indexOf(e.hash));
  return { ok: true, batch: b, leaf: e.hash, path, valid: merkle.verify(e.hash, path, b.root) };
}

/** 可测的溯源指标。只算本机真实能算出来的；签名率等需要供方接入的指标不在这里编数 */
export function metrics(S, ledger, chainOk, contracts = []) {
  const anchored = ledger.filter((e) => e.i <= lastAnchored(S.batches)).length;
  const billed = contracts.filter((c) => c.bill);
  const tied = billed.filter((c) => Math.abs(c.bill.inFee + c.bill.outFee + c.bill.review - c.bill.total) < 0.01);
  return {
    events: ledger.length, chainOk, anchored, anchoredRate: ledger.length ? anchored / ledger.length : null,
    batches: S.batches.length, batchesOk: S.batches.filter((b) => verifyBatch(ledger, b).ok).length,
    billed: billed.length, tiedRate: billed.length ? tied.length / billed.length : null,
  };
}
