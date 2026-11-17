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

// ---------- 入场审批、存证链、每日波动 ----------
const { sha256 } = await import('../public/static/js/core/sha256.js');
const access = await import('../public/static/js/core/access.js');
const { instDays, marketDays } = await import('../public/static/js/core/daily.js');
const { diffBaskets } = await import('../public/static/js/core/market.js');
const { createHash } = await import('node:crypto');

test('SHA-256 与标准向量及 Node 内置实现一致', () => {
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  for (const s of ['无场景不登记、无登记不交易、无合规不上架', 'x'.repeat(55), 'x'.repeat(56), 'y'.repeat(64), 'z'.repeat(1000) + '词元']) {
    assert.equal(sha256(s), createHash('sha256').update(s).digest('hex'));
  }
});

test('统一社会信用代码校验位', () => {
  assert.equal(access.usccValid('91350100M000100Y43'), true);   // 国标示例
  assert.equal(access.usccValid('91350100M000100Y44'), false);
  assert.equal(access.usccValid('91440101000000000J'), true);   // 演示占位码
  assert.equal(access.usccValid('9144010100000000'), false);
  assert.equal(access.usccValid('91440101I00000000J'), false);  // 含非法字符 I
});

const FORM = { role: 'buyer', org: '湾区演示制造有限公司（虚构）', uscc: '91440101000000000J', contact: 'demo@example.com', channel: 'online',
  materials: [true, true, true, true], pledge: true, sceneTitle: '售后知识助手', category: 'kb',
  sceneDesc: '用于售后工程师检索产品手册与维修案例，输出带来源的回答。', pii: false, cross: false };

test('入场审批：未入场不能交易；四个环节全部通过后发放编号', () => {
  const T = 1794900000;
  access.revoke(T);
  assert.equal(access.canTrade(), false);
  assert.equal(access.submit(FORM, T).ok, true);
  assert.equal(access.submit(FORM, T).ok, false); // 审核中不能重复提交
  const r = access.autoRun(T);
  assert.equal(r.approved, true);
  assert.equal(r.passed, access.STEPS.length);
  assert.equal(access.canTrade(), true);
  assert.match(access.st.member.no, /^SIM-RC-\d{8}-\d{4}$/);
  assert.match(access.st.member.sceneNo, /^SIM-CJ-/);
});

test('合规会审：额度转售、未做个人信息评估都过不了，只能退回补正', () => {
  const T = 1794900100;
  access.revoke(T);
  access.submit({ ...FORM, category: 'resale' }, T);
  let r = access.autoRun(T);
  assert.equal(r.ok, false);
  assert.equal(r.stoppedAt, '合规会审');
  assert.equal(r.passed, 2);
  assert.equal(access.canTrade(), false);
  assert.equal(access.review('return', '', T).returned, true);
  assert.equal(access.st.app.status, 'returned');
  assert.match(access.st.app.returnNote, /额度转售/);
  access.submit({ ...FORM, pii: true, piiAssessed: false }, T); // 补正后从头再审
  r = access.autoRun(T);
  assert.equal(r.stoppedAt, '合规会审');
  access.review('return', '请补充个人信息保护影响评估', T);
  access.submit({ ...FORM, pii: true, piiAssessed: true }, T);
  assert.equal(access.autoRun(T).approved, true);
});

test('形式审查：信用代码错误、材料不齐不能通过；无理由不能退回', () => {
  const T = 1794900200;
  access.revoke(T);
  access.submit({ ...FORM, uscc: '91440101000000000K', materials: [true, false, true, true] }, T);
  const r = access.review('pass', '', T);
  assert.equal(r.ok, false);
  assert.equal(access.checks(access.st.app.form, 'formal').filter((c) => !c.ok).length, 2);
  access.withdraw(T);
  access.submit(FORM, T);
  assert.equal(access.review('return', '   ', T).ok, false); // 检查全过又不写理由
});

test('存证链：可校验；改动任何一条都会被发现', () => {
  const v = access.verifyLedger();
  assert.equal(v.ok, true);
  assert.ok(v.n >= 10);
  const forged = JSON.parse(JSON.stringify(access.st.ledger));
  forged[3].data = { ...forged[3].data, org: '被篡改的主体' };
  assert.deepEqual(access.verifyLedger(forged), { ok: false, at: forged[3].i, why: '内容与哈希不符' });
  const cut = JSON.parse(JSON.stringify(access.st.ledger));
  cut.splice(2, 1); // 删掉一条
  assert.equal(access.verifyLedger(cut).ok, false);
});

test('上架预检用真实公开数据；只有入场的供给方能为自己的算力中心上架', () => {
  const T = 1794900300;
  const center = state.centers.find((c) => c.dcs.length && access.precheck(c).some((r) => r.pass));
  const other = state.centers.find((c) => c !== center);
  assert.ok(center, '应存在披露机房且有产品通过预检的算力中心');
  const rows = access.precheck(center);
  for (const r of rows) assert.equal(r.pass, r.quote.q !== 'unknown' && r.quote.st === 0 && r.quote.up1d != null && r.quote.up1d >= 95);
  const hidden = state.centers.find((c) => !c.dcs.length);
  assert.ok(access.precheck(hidden).every((r) => !r.pass), '未披露机房所在地的一律不通过');
  access.revoke(T);
  assert.equal(access.registerListings(center, T).ok, false); // 未入场
  access.submit(FORM, T); access.autoRun(T);
  assert.equal(access.registerListings(center, T).ok, false); // 买方不能上架
  access.revoke(T);
  access.submit({ ...FORM, role: 'supplier', materials: [true, true, true, true, true], category: 'serve', center: center.name }, T);
  assert.equal(access.autoRun(T).approved, true);
  assert.equal(access.registerListings(other, T).ok, false); // 不能替别人上架
  const ok = access.registerListings(center, T);
  assert.equal(ok.count, rows.filter((r) => r.pass).length);
  assert.equal(access.registerListings(center, T).ok, false); // 不重复登记
  assert.equal(access.verifyLedger().ok, true);
});

test('每日波动：涨跌以上一个已发布交易日为基准，留空日不参与', () => {
  const inst = state.insts.filter((i) => i.meets).sort((a, b) => a.suppliers - b.suppliers)[0];
  const rows = instDays(inst, NOW, Infinity);
  let prev = null, blanks = 0;
  for (const r of rows) {
    if (!r.bar.pub) { blanks++; assert.equal(r.chg, null); continue; }
    if (prev != null) {
      assert.equal(r.chg, r.bar.c / prev - 1);
      assert.ok(r.amp >= Math.abs(r.chg) - 1e-12 || r.bar.o !== prev); // 振幅覆盖当日区间
    }
    prev = r.bar.c;
  }
  assert.ok(blanks > 0);
});

test('每日波动：逐日家数加总等于当日在市桶数，公开统计不含被抑制的样本', () => {
  const pool = state.insts.filter((i) => i.meets);
  const days = marketDays(pool, NOW, 30);
  assert.equal(days.length, 30);
  assert.equal(days.at(-1).d, TODAY);
  for (const d of days) {
    assert.equal(d.adv + d.dec + d.flat + d.held + d.blank, d.rows.length);
    assert.equal(d.vol, d.rows.reduce((s, r) => s + (r.bar.pub ? r.bar.v : 0), 0));
    assert.ok(d.rows.length <= pool.length);
  }
  assert.ok(days.some((d) => d.adv > 0 && d.dec > 0));
});

test('真实报价变动比较：新增、下线、调价分别识别', () => {
  const d = diffBaskets({ a: 1, b: 2, c: 3, f: 0 }, { a: 1, b: 2.2, d: 5, f: 0.5 });
  assert.deepEqual(d.added, ['d']);
  assert.deepEqual(d.removed, ['c']);
  assert.equal(d.changed.length, 2);
  assert.ok(Math.abs(d.changed.find((x) => x.id === 'b').chg - 0.1) < 1e-12);
  assert.equal(d.changed.find((x) => x.id === 'f').chg, null); // 免费变收费：无法算涨跌幅
});

test('端点级调价比较：只认同一服务商同一端点；默认服务商切换不算调价', async () => {
  const { diffEndpoints } = await import('../public/static/js/core/normalize.js');
  const ep = (p, q, i, o, tag) => ({ p, q, tag, usd: { in: i, out: o } });
  const prev = { m1: [ep('A', 'fp8', 1, 1), ep('B', 'fp8', 2, 2)], m2: [ep('A', 'fp8', 5, 5)], gone: [ep('A', 'fp8', 1, 1)] };
  const cur = { m1: [ep('B', 'fp8', 2, 2), ep('A', 'fp8', 1, 1)], m2: [ep('A', 'fp8', 4, 4), ep('C', 'fp4', 3, 3)], fresh: [ep('Z', 'fp8', 1, 1)] };
  const d = diffEndpoints(prev, cur);
  assert.equal(d.compared, 3);            // m1 的 A、B，m2 的 A
  assert.equal(d.changes.length, 1);      // 只有 m2 的 A 调了价；m1 两家顺序互换不算
  assert.deepEqual(d.changes[0], { id: 'm2', p: 'A', q: 'fp8', a: 5, b: 4 });
  assert.equal(d.added, 1);               // m2 新增 C
  assert.equal(d.removed, 0);
});
