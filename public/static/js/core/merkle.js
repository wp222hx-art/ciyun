// Merkle 批次承诺（G12）：只把批次根对外锚定，原文留在受控存储；持有原文的人可以证明"这条记录在这一批里"。
// 叶子与中间节点用不同前缀做域分离；落单的节点直接上移，不复制自身。
import { sha256 } from './sha256.js';

export const leafHash = (s) => sha256(`L|${s}`);
const nodeHash = (a, b) => sha256(`N|${a}|${b}`);

export function levels(leaves) {
  if (!leaves.length) return [[]];
  let cur = leaves.map(leafHash);
  const out = [cur];
  while (cur.length > 1) {
    const nxt = [];
    for (let i = 0; i < cur.length; i += 2) nxt.push(i + 1 < cur.length ? nodeHash(cur[i], cur[i + 1]) : cur[i]);
    out.push(nxt);
    cur = nxt;
  }
  return out;
}
export const root = (leaves) => (leaves.length ? levels(leaves).at(-1)[0] : null);

/** 第 index 个叶子的包含性证明：自底向上的兄弟节点 */
export function proof(leaves, index) {
  if (!(index >= 0 && index < leaves.length)) return null;
  const L = levels(leaves), path = [];
  let i = index;
  for (let d = 0; d < L.length - 1; d++) {
    const sib = i ^ 1;
    if (sib < L[d].length) path.push({ side: sib < i ? 'L' : 'R', hash: L[d][sib] });
    i >>= 1;
  }
  return path;
}

export function verify(leaf, path, expectedRoot) {
  if (!path || !expectedRoot) return false;
  let h = leafHash(leaf);
  for (const p of path) h = p.side === 'L' ? nodeHash(p.hash, h) : nodeHash(h, p.hash);
  return h === expectedRoot;
}
