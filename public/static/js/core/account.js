// 仿真账户与撮合：研究记分账户、限价/市价单、挂单撮合、持仓、模拟履约
// 研究记分不可充值、不可转让、不可兑换（方案 §08）；数据只保存在本浏览器
import * as sim from './sim.js';
import { state as mkt } from './market.js';
import { canTrade } from './access.js';

const KEY = 'zjt.account.v1';
export const INITIAL = 100000;
export const FEE = sim.FEE_RATE;
const r4 = (x) => Math.round(x * 1e4) / 1e4;

function blank() {
  return { v: 1, cash: INITIAL, positions: {}, orders: [], fills: [], deliveries: [], contracts: [], realized: 0, fees: 0, consumed: 0, seq: 1 };
}

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && raw.v === 1 && Number.isFinite(raw.cash)) return { ...blank(), ...raw };
  } catch { /* 存储不可用或内容损坏：使用新账户 */ }
  return blank();
}

export let acct = read();
const subs = new Set();
export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };

function commit() {
  try { localStorage.setItem(KEY, JSON.stringify(acct)); } catch { /* 无痕模式等：仅本次会话有效 */ }
  for (const fn of subs) fn();
}

export function reset() { acct = blank(); commit(); }

const openOrders = () => acct.orders.filter((o) => o.status === 'open');
export const frozenCash = () => r4(openOrders().filter((o) => o.side === 'buy').reduce((s, o) => s + (o.qty - o.filled) * o.price * (1 + FEE), 0));
export const available = () => r4(acct.cash - frozenCash());
export const frozenQty = (id) => openOrders().filter((o) => o.side === 'sell' && o.instId === id).reduce((s, o) => s + o.qty - o.filled, 0);
export const availQty = (id) => (acct.positions[id]?.qty || 0) - frozenQty(id);

export function equity(now) {
  let mv = 0, cost = 0;
  for (const [id, p] of Object.entries(acct.positions)) {
    const inst = mkt.instById.get(id);
    mv += inst ? p.qty * sim.live(inst, now).last : p.cost; // 已下线品种按成本计
    cost += p.cost;
  }
  return { cash: acct.cash, frozen: frozenCash(), available: available(), mv: r4(mv), cost: r4(cost), total: r4(acct.cash + mv), upnl: r4(mv - cost) };
}

function applyFill(order, p, q, now) {
  const amt = r4(p * q);
  const fee = r4(amt * FEE);
  let pnl = null;
  if (order.side === 'buy') {
    const pos = acct.positions[order.instId] || (acct.positions[order.instId] = { qty: 0, cost: 0 });
    acct.cash = r4(acct.cash - amt - fee);
    pos.qty += q;
    pos.cost = r4(pos.cost + amt + fee);
  } else {
    const pos = acct.positions[order.instId];
    const costOut = r4((pos.cost / pos.qty) * q);
    pnl = r4(amt - fee - costOut);
    pos.qty -= q;
    pos.cost = r4(pos.cost - costOut);
    if (pos.qty <= 0) delete acct.positions[order.instId];
    acct.cash = r4(acct.cash + amt - fee);
    acct.realized = r4(acct.realized + pnl);
  }
  acct.fees = r4(acct.fees + fee);
  order.avg = (order.avg * order.filled + amt) / (order.filled + q);
  order.filled += q;
  acct.fills.unshift({ id: acct.seq++, orderId: order.id, instId: order.instId, side: order.side, p, q, amt, fee, pnl, t: now });
  if (acct.fills.length > 300) acct.fills.length = 300;
}

/** 与仿真盘口成交：逐档吃单，直到数量用尽或价格越过限价 */
function crossBook(order, inst, now) {
  const b = sim.book(inst, now);
  const levels = order.side === 'buy' ? b.asks : b.bids;
  const eaten = [];
  for (const lv of levels) {
    const left = order.qty - order.filled;
    if (left <= 0) break;
    if (order.type === 'limit' && (order.side === 'buy' ? lv.p > order.price : lv.p < order.price)) break;
    const q = Math.min(left, lv.q);
    applyFill(order, lv.p, q, now);
    eaten.push({ p: lv.p, q });
  }
  if (eaten.length) sim.eatBook(inst, now, order.side, eaten);
  return eaten.length;
}

const fail = (error) => ({ ok: false, error });

/** 市价买入预估：按当前盘口逐档计算可成交数量与金额 */
export function quoteMarket(inst, side, qty, now) {
  const b = sim.book(inst, now);
  let left = qty, amt = 0, got = 0;
  for (const lv of side === 'buy' ? b.asks : b.bids) {
    if (left <= 0) break;
    const q = Math.min(left, lv.q);
    amt += q * lv.p; got += q; left -= q;
  }
  return { got, amt: r4(amt), avg: got ? amt / got : null, short: left };
}

export function placeOrder({ instId, side, type, price, qty }, now) {
  const inst = mkt.instById.get(instId);
  if (!inst) return fail('品种不存在');
  if (!canTrade()) return fail('尚未取得入场资格：无登记不交易。请先到"入场"完成申请与审批。');
  if (!inst.meets) return fail('该桶独立供应商不足 3 家，只提供报价，不开放仿真撮合');
  qty = Math.floor(Number(qty));
  if (!(qty >= 1)) return fail('数量至少为 1 百万Token');
  if (side !== 'buy' && side !== 'sell') return fail('方向不正确');
  const P = sim.params(inst);
  if (type === 'limit') {
    price = sim.roundTick(Number(price), P.tick);
    if (!(price > 0)) return fail('请输入有效的委托价格');
    const last = sim.live(inst, now).last;
    if (price > last * 1.2 || price < last * 0.8) return fail('委托价格偏离最新价超过 20%，请检查是否输错');
  } else if (type !== 'market') return fail('委托类型不正确');

  if (side === 'sell') {
    const have = availQty(instId);
    if (have < qty) return fail(`可卖数量不足：可用 ${have} 百万Token`);
  } else if (type === 'limit') {
    const need = r4(price * qty * (1 + FEE));
    if (available() < need) return fail(`可用研究记分不足：需要 ${need.toFixed(2)}，可用 ${available().toFixed(2)}`);
  } else {
    const est = quoteMarket(inst, 'buy', qty, now);
    if (!est.got) return fail('盘口暂无可成交卖单');
    const need = r4(est.amt * (1 + FEE));
    if (available() < need) return fail(`可用研究记分不足：预计需要 ${need.toFixed(2)}，可用 ${available().toFixed(2)}`);
  }

  const order = {
    id: acct.seq++, instId, side, type, price: type === 'limit' ? price : null, qty,
    filled: 0, avg: 0, status: 'open', t: now, day: sim.dayIdxOf(now), lastCheck: now, note: '',
  };
  crossBook(order, inst, now);
  if (order.filled >= order.qty) order.status = 'filled';
  else if (type === 'market') {
    // 市价单只与当前可见盘口成交，余量立即撤销（不虚构流动性）
    order.status = order.filled ? 'partial' : 'canceled';
    order.note = '盘口深度不足，余量已撤销';
  }
  acct.orders.unshift(order);
  if (acct.orders.length > 200) acct.orders.length = 200;
  commit();
  return { ok: true, order };
}

export function cancelOrder(id) {
  const o = acct.orders.find((x) => x.id === id);
  if (!o || o.status !== 'open') return fail('该委托已不可撤销');
  o.status = o.filled ? 'partial' : 'canceled';
  o.note = '用户撤单';
  commit();
  return { ok: true };
}

/** 每秒调用：处理挂单（盘口交叉成交、仿真成交价穿越限价、跨日过期） */
export function tick(now) {
  const open = openOrders();
  if (!open.length) return;
  const today = sim.dayIdxOf(now);
  let dirty = false;
  for (const o of open) {
    const inst = mkt.instById.get(o.instId);
    if (!inst || o.day !== today) {
      o.status = o.filled ? 'partial' : 'expired';
      o.note = inst ? '当日有效委托已过期' : '品种已下线';
      dirty = true;
      continue;
    }
    const before = o.filled;
    crossBook(o, inst, now);
    if (o.filled < o.qty) {
      // 仿真成交价穿越限价 → 按委托价成交，数量不超过该笔仿真成交量
      for (const tr of sim.tradesBetween(inst, o.lastCheck, now)) {
        const left = o.qty - o.filled;
        if (left <= 0) break;
        if (o.side === 'buy' ? tr.p < o.price : tr.p > o.price) applyFill(o, o.price, Math.min(left, tr.q), now);
      }
    }
    o.lastCheck = now;
    if (o.filled >= o.qty) o.status = 'filled';
    if (o.filled !== before) dirty = true;
  }
  if (dirty) commit();
}

/** 模拟履约：消耗持有的服务额度，按固定篮子 80/20 记为输入/输出交付量 */
export function consume(instId, qty, now) {
  qty = Math.floor(Number(qty));
  const pos = acct.positions[instId];
  if (!(qty >= 1)) return fail('数量至少为 1 百万Token');
  if (!pos || availQty(instId) < qty) return fail('可用额度不足');
  const cost = r4((pos.cost / pos.qty) * qty);
  pos.qty -= qty;
  pos.cost = r4(pos.cost - cost);
  if (pos.qty <= 0) delete acct.positions[instId];
  acct.consumed = r4(acct.consumed + cost);
  acct.deliveries.unshift({ id: acct.seq++, kind: 'credit', instId, qty, inTok: qty * 0.8, outTok: qty * 0.2, cost, t: now });
  if (acct.deliveries.length > 200) acct.deliveries.length = 200;
  commit();
  return { ok: true, cost };
}

// ---------- 采购合同（采购台使用）----------
export function addContract(c) {
  c.id = acct.seq++;
  acct.contracts.unshift(c);
  if (acct.contracts.length > 50) acct.contracts.length = 50;
  commit();
  return c;
}

/** 履约完成、出账：合同进入"待验收"，此时不扣款（付款与验收分离） */
export function deliverContract(id, bill, now) {
  const c = acct.contracts.find((x) => x.id === id);
  if (!c || c.status !== 'signed') return fail('合同状态不允许出账');
  c.status = 'delivered';
  c.bill = bill;
  c.deliveredAt = now;
  commit();
  return { ok: true };
}

/** 验收并结算：按账单扣减研究记分 */
export function settleContract(id, now) {
  const c = acct.contracts.find((x) => x.id === id);
  if (!c || c.status !== 'delivered') return fail('合同尚未出账或已结算');
  if (available() < c.bill.total) return fail(`可用研究记分不足：账单 ${c.bill.total.toFixed(2)}，可用 ${available().toFixed(2)}`);
  acct.cash = r4(acct.cash - c.bill.total);
  acct.consumed = r4(acct.consumed + c.bill.total);
  c.status = 'settled';
  c.settledAt = now;
  commit();
  return { ok: true };
}

/** 账务勾稽：期初 + 已实现盈亏 − 已履约消耗 应等于 现金 + 持仓成本 */
export function reconcile() {
  const cost = Object.values(acct.positions).reduce((s, p) => s + p.cost, 0);
  const left = r4(INITIAL + acct.realized - acct.consumed);
  const right = r4(acct.cash + cost);
  return { left, right, cost: r4(cost), ok: Math.abs(left - right) < 0.01 };
}
