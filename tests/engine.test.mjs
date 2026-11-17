// 引擎规则单测：node --test tests/
// 逐条对应方案 §06—§08 与增量验收 T-A03 / T-A04 / T-A05
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { basket, buildBuckets, THRESHOLD } from '../public/static/js/core/normalize.js';
import * as sim from '../public/static/js/core/sim.js';
import { state } from '../public/static/js/core/market.js';

const snap = JSON.parse(await readFile(new URL('../public/static/data/snapshot.json', import.meta.url)));
// 复用 market.js 的构建逻辑（绕开浏览器 fetch）
globalThis.fetch = async () => ({ ok: true, json: async () => snap });
const { load, indices } = await import('../public/static/js/core/market.js');
await load();

// 观测日（快照日）北京时间 16:00
const ANCHOR = sim.dayIdxOf(Date.parse(snap.asOf) / 1000);
const NOW = sim.dayStart(ANCHOR) + 16 * 3600;
const TODAY = sim.dayIdxOf(NOW);

test('§06 固定篮子参考价：输入2元、输出6元 → 2.8元', () => {
  assert.equal(basket({ in: 2, out: 6 }), 2.8);
  assert.equal(basket({ in: 0.1, out: 0.1 }), 0.1); // 不带浮点尾差
});

test('§06 分项缺失或为负时不猜价格', () => {
  assert.equal(basket({ in: 2, out: null }), null);
  assert.equal(basket({ in: -1e6, out: -1e6 }), null);
});

test('§06 不同推理精度不合并为同一桶；同一供应商多端点只计一个独立主体', () => {
  const ep = (p, q, i, o) => ({ p, q, usd: { in: i, out: o }, st: 0, up1d: 100 });
  const b = buildBuckets([ep('A', 'fp8', 1, 2), ep('A', 'fp8', 3, 4), ep('B', 'fp8', 2, 2), ep('C', 'fp4', 1, 1)]);
  assert.equal(b.length, 2);
  const fp8 = b.find((x) => x.q === 'fp8');
  assert.equal(fp8.suppliers, 2);
  assert.equal(fp8.quotes.find((x) => x.p === 'A').basketUsd, basket({ in: 1, out: 2 }));
});

test('§06 不合格供应商不作为价格锚', () => {
  const b = buildBuckets([
    { p: 'Down', q: 'fp8', usd: { in: 0.1, out: 0.1 }, st: -5, up1d: 60 },
    { p: 'Ok', q: 'fp8', usd: { in: 1, out: 1 }, st: 0, up1d: 99.9 },
  ])[0];
  assert.equal(b.anchorProvider, 'Ok');
  assert.equal(b.minUsd, 0.1);
});

test('真实数据已接入：模型、可比桶、算力中心数量与快照一致', () => {
  assert.equal(state.models.length, snap.models.length);
  assert.ok(state.insts.length > 300, `品种数 ${state.insts.length}`);
  assert.ok(state.centers.length > 50, `算力中心数 ${state.centers.length}`);
  for (const i of state.insts) {
    assert.ok(i.anchor > 0 && Number.isFinite(i.anchor), i.id);
    assert.ok(i.minCny <= i.anchor && i.anchor <= i.maxCny + 1e-12, i.id);
  }
});

test('§07 无样本的交易日留空，不复制前收', () => {
  let blanks = 0;
  for (const inst of state.insts) {
    for (const b of sim.daily(inst, TODAY).days) {
      if (b.n === 0) { blanks++; assert.equal(b.pub, false); assert.equal(b.c, undefined); assert.equal(b.o, undefined); }
    }
  }
  assert.ok(blanks > 0, '应存在无成交日');
});

test('§07 只有一笔样本时 OHLC 相同', () => {
  let singles = 0;
  for (const inst of state.insts) {
    for (const b of sim.daily(inst, TODAY).days) {
      if (b.n === 1) { singles++; assert.ok(b.o === b.h && b.h === b.l && b.l === b.c, `${inst.id} d=${b.d}`); }
    }
  }
  assert.ok(singles > 0, '应存在单样本日');
});

test('§07 OHLC 自洽：高≥开收≥低，量为正', () => {
  for (const inst of state.insts) {
    for (const b of sim.daily(inst, TODAY).days) {
      if (!b.n) continue;
      assert.ok(b.h >= Math.max(b.o, b.c) && b.l <= Math.min(b.o, b.c), `${inst.id} d=${b.d}`);
      assert.ok(b.l > 0 && b.v > 0, `${inst.id} d=${b.d}`);
    }
  }
});

test('§08 发布门槛：公开的日线必须同时满足 3 家供应、5 个买方、10 笔样本', () => {
  let pub = 0, held = 0;
  for (const inst of state.insts) {
    for (const b of sim.daily(inst, TODAY).days) {
      if (b.pub) {
        pub++;
        assert.ok(b.n >= THRESHOLD.samples && b.sup >= THRESHOLD.suppliers && b.buy >= THRESHOLD.buyers, `${inst.id} d=${b.d}`);
        assert.ok(b.sup <= inst.suppliers);
      } else if (b.n) { held++; assert.ok(b.why); }
    }
  }
  assert.ok(pub > 0 && held > 0, `发布 ${pub} / 抑制 ${held}`);
});

test('§08 供应商不足 3 家的桶永不发布成交日线', () => {
  const thin = state.insts.filter((i) => i.suppliers < THRESHOLD.suppliers);
  assert.ok(thin.length > 0);
  for (const inst of thin) assert.ok(sim.daily(inst, TODAY).days.every((b) => !b.pub), inst.id);
});

test('§05 换代另开序列：序列不早于模型上线日', () => {
  for (const inst of state.insts) {
    const D = sim.daily(inst, TODAY);
    if (inst.listedDay != null && D.days.length) assert.ok(D.days[0].d >= inst.listedDay, inst.id);
  }
});

test('T-A04 可复算：同一输入重算结果完全一致', async () => {
  const inst = state.insts.find((i) => i.meets);
  const a = JSON.stringify(sim.daily(inst, TODAY).days);
  const fresh = await import('../public/static/js/core/sim.js?fresh=1');
  assert.equal(JSON.stringify(fresh.daily(inst, TODAY).days), a);
  const live1 = sim.live(inst, NOW);
  const live2 = fresh.live(inst, NOW);
  assert.equal(live2.last, live1.last);
  assert.equal(live2.v, live1.v);
  assert.equal(live2.bars.length, live1.bars.length);
});

test('盘中推进与一次性计算一致（逐秒推进 = 直接跳到该时刻）', async () => {
  const inst = state.insts.filter((i) => i.meets).sort((a, b) => b.suppliers - a.suppliers)[0];
  const fresh = await import('../public/static/js/core/sim.js?fresh=2');
  for (let t = NOW - 600; t <= NOW; t += 7) fresh.live(inst, t);
  const stepped = fresh.live(inst, NOW);
  const direct = sim.live(inst, NOW);
  assert.equal(stepped.last, direct.last);
  assert.equal(stepped.n, direct.n);
  assert.equal(Number(stepped.amt.toFixed(6)), Number(direct.amt.toFixed(6)));
});

test('报价视图：只有观测日一点是真实值；观测日之后沿用并标陈旧，不虚构变化', () => {
  for (const inst of state.insts.slice(0, 80)) {
    const q = sim.quoteSeries(inst, TODAY);
    const lastPt = q[q.length - 1];
    assert.equal(lastPt.real, true);
    assert.equal(lastPt.min, inst.anchor);
    assert.ok(q.slice(0, -1).every((x) => !x.real));
    const later = sim.quoteSeries(inst, TODAY + 3).slice(-3);
    assert.ok(later.every((x) => x.stale && !x.real && x.min === inst.anchor));
  }
});

test('盘中聚合到收盘 = 该日日线（开高低收、交付量、样本数完全一致）', () => {
  let checked = 0;
  for (const inst of state.insts) {
    const T = sim.daily(inst, TODAY).target;
    const st = sim.live(inst, sim.dayStart(TODAY + 1) - 0.001);
    if (!T.n) { assert.equal(st.n, 0); continue; }
    checked++;
    assert.deepEqual([st.o, st.h, st.l, st.last, st.v, st.n], [T.o, T.h, T.l, T.c, T.v, T.n], inst.id);
  }
  assert.ok(checked > 300);
});

test('历史日分钟线重建后与日线一致', () => {
  for (const inst of state.insts.filter((i) => sim.hasIntraday(i)).slice(0, 40)) {
    const D = sim.daily(inst, TODAY);
    for (const bar of D.days.slice(-5)) {
      if (!bar.n) continue;
      const tr = sim.dayTrades(inst, bar);
      assert.equal(tr.length, bar.n);
      assert.equal(tr[0].p, bar.o); assert.equal(tr[tr.length - 1].p, bar.c);
      assert.equal(Math.max(...tr.map((t) => t.p)), bar.h, `${inst.id} d=${bar.d} 高`);
      assert.equal(Math.min(...tr.map((t) => t.p)), bar.l, `${inst.id} d=${bar.d} 低`);
      assert.equal(tr.reduce((s, t) => s + t.q, 0), bar.v);
      assert.ok(tr.every((t) => t.q >= 1 && sim.dayIdxOf(t.t) === bar.d));
    }
  }
});

test('换日后历史不变：明天看到的今日日线 = 今日收盘结果，更早的日线逐根相同', async () => {
  const fresh = await import('../public/static/js/core/sim.js?fresh=4');
  for (const inst of state.insts.slice(0, 120)) {
    const a = sim.daily(inst, TODAY);
    const b = fresh.daily(inst, TODAY + 1);
    assert.deepEqual(b.days.slice(0, a.days.length), a.days, inst.id);
    assert.deepEqual(b.days[a.days.length], a.target, inst.id);
  }
});

test('仿真成交价围绕真实报价锚，不脱离锚定', () => {
  for (const inst of state.insts) {
    const s = sim.summary(inst, NOW);
    const dev = Math.abs(s.last / inst.anchor - 1);
    assert.ok(dev < 0.35, `${inst.id} 偏离 ${(dev * 100).toFixed(1)}%`);
  }
});

test('盘口：买一 < 最新 < 卖一，档位单调', () => {
  for (const inst of state.insts.slice(0, 120)) {
    const b = sim.book(inst, NOW);
    assert.ok(b.asks.length && b.bids.length, inst.id);
    assert.ok(b.bids[0].p < b.asks[0].p, inst.id);
    for (let i = 1; i < b.asks.length; i++) assert.ok(b.asks[i].p > b.asks[i - 1].p);
    for (let i = 1; i < b.bids.length; i++) assert.ok(b.bids[i].p < b.bids[i - 1].p);
  }
});

test('盘口被吃掉的量在本档位内不可重复成交', () => {
  const inst = state.insts.find((i) => i.meets);
  const before = sim.book(inst, NOW);
  const lvl = before.asks[0];
  sim.eatBook(inst, NOW, 'buy', [{ p: lvl.p, q: lvl.q }]);
  const after = sim.book(inst, NOW);
  assert.ok(!after.asks.some((x) => x.p === lvl.p), '已吃完的档位应消失');
});

test('tradesBetween 与盘中逐笔一致', () => {
  const inst = state.insts.filter((i) => i.meets).sort((a, b) => b.suppliers - a.suppliers)[0];
  const st = sim.live(inst, NOW);
  const base = st.base;
  const all = sim.tradesBetween(inst, base, NOW);
  assert.equal(all.length, st.n);
  const qty = all.reduce((s, t) => s + t.q, 0);
  assert.equal(qty, st.v);
});

test('T-A05 指数：基期=100，同一数据重算一致，成分只含达标桶', () => {
  const ix = indices(NOW);
  assert.ok(ix.all.members > 10, `成分 ${ix.all.members}`);
  assert.equal(Number(ix.all.series[0].v.toFixed(8)), 100);
  for (const p of ix.all.series) assert.ok(p.v > 20 && p.v < 400, `指数点 ${p.v}`);
  const again = sim.buildIndex(state.insts.filter((i) => i.meets && i.main && i.variant === 'std'), TODAY, ix.base);
  assert.deepEqual(again.series, ix.all.series);
});

test('§06 合格任务数为零时有效成本不可计算', () => {
  assert.equal(sim.taskCost({ inCny: 1, outCny: 2, inTok: 1000, outTok: 100, pass: 0, review: 0.01 }), null);
  const c = sim.taskCost({ inCny: 2, outCny: 6, inTok: 1e6, outTok: 1e6, pass: 0.5, review: 0 });
  assert.equal(c, 16);
});

test('性能：全市场首次展开应在可接受时间内', async () => {
  const fresh = await import('../public/static/js/core/sim.js?fresh=3');
  const t0 = performance.now();
  for (const inst of state.insts) fresh.summary(inst, NOW);
  const ms = performance.now() - t0;
  console.log(`  全市场 ${state.insts.length} 个品种首次展开 ${ms.toFixed(0)} ms`);
  assert.ok(ms < 4000);
});

test('盘中状态只取决于查询时刻：先查收盘再查盘中，结果与直接查盘中一致', async () => {
  const a = await import('../public/static/js/core/sim.js?fresh=5');
  const b = await import('../public/static/js/core/sim.js?fresh=6');
  for (const inst of state.insts.filter((i) => i.meets).slice(0, 60)) {
    a.live(inst, sim.dayStart(TODAY + 1) - 0.001);
    const back = a.live(inst, NOW);
    const direct = b.live(inst, NOW);
    assert.deepEqual([back.o, back.h, back.l, back.last, back.v, back.n, back.bars.length],
      [direct.o, direct.h, direct.l, direct.last, direct.v, direct.n, direct.bars.length], inst.id);
  }
});
