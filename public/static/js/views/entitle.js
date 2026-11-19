// 算力权益：登记 → 预订 → 交付核销 → 受限转让 → 到期（方案 V4.0 G08、G20）
// 数量账与资金账分开；每一步后都做守恒检查。批次、主体均为示例，不是真实供给。
import * as ent from '../core/entitle.js';
import * as access from '../core/access.js';
import { $, esc, toast, dialog, confirmDialog, nowSec, fmtUsd, fmtDateTime, EXAMPLE, PROPOSED, emptyState, opt, fmtInt } from '../ui.js';

const db = ent.db;
const C = { used: '#3d8bff', avail: '#0ecb81', frozen: '#f0b90b', expired: '#5b6573', unsold: '#262d37' };
const log = (type, actor, ref, data) => access.log(type, actor, ref, data, nowSec());
const n = (x) => fmtInt(x);
let replay = null; // G20 重放结果（只在内存里，不落盘）

export function mount(el) {
  el.innerHTML = `
  <div class="page-head"><h2>算力权益 ${EXAMPLE}</h2>
    <p>买下的算力不是一枚可以随便倒手的币，而是对某个供方、某个时段的服务请求权。这里把它做成一本数量账：供方登记批次，买方预订，用一点核销一点；合同允许时可以把没用完的部分转给别人，但要先冻结、供方同意、受让方确认。任何一步之后，批次容量都必须等于各项之和。</p></div>

  <section class="panel mb">
    <header><h3>方案算例重放：1,000 GPU小时怎么流转</h3><span class="mute small">V4.0 G20 · 机制示例，非行情或投资建议</span><span class="sp"></span>
      <button class="btn sm primary" type="button" data-act="replay">重放算例</button></header>
    <div id="replay"></div>
  </section>

  <div class="stats-bar" id="stats"></div>
  <div class="split wide-r">
    <section class="panel">
      <header><h3>供方登记批次</h3>${PROPOSED}</header>
      <form id="reg" class="pad" novalidate autocomplete="off">
        <div class="form-grid">
          <label class="field"><span>供方</span><input class="input" name="supplier" value="示例算力供方（虚构）"></label>
          <label class="field"><span>规格</span><input class="input" name="spec" value="指定 GPU 节点 · 推理"></label>
          <label class="field"><span>原生计量单位</span><select class="input" name="unit">${Object.entries(ent.UNITS).map(([k, v]) => opt(k, v, 'gpuh')).join('')}</select></label>
          <label class="field"><span>可承诺容量</span><input class="input mono" type="number" name="capacity" min="1" step="1" value="500"></label>
          <label class="field"><span>单价<em class="mute">美元 / 单位</em></span><input class="input mono" type="number" name="price" min="0" step="0.01" value="2"></label>
          <label class="field"><span>有效天数</span><input class="input mono" type="number" name="days" min="1" step="1" value="90"></label>
          <label class="field"><span>最低转让单位</span><input class="input mono" type="number" name="minUnit" min="1" step="1" value="10"></label>
          <label class="field"><span>容量证明与服务合同引用</span><input class="input" name="proof" value="SIM-容量证明-示例"></label>
        </div>
        <div class="btn-row"><label class="inline"><input type="checkbox" name="transferable" checked> 合同允许受限转让</label><button class="btn primary" type="submit">登记批次</button></div>
        <p class="hint">GPU小时、百万计费Token、视频秒数和合格任务分开计量；相同设备并非相同质量，不换算成一个统一单位。没有容量证明的额度不能登记。</p>
      </form>
    </section>
    <section class="panel" id="batches"></section>
  </div>
  <section class="panel mb" id="ents"></section>
  <div class="split">
    <section class="panel" id="transfers"></section>
    <section class="panel" id="money"></section>
  </div>
  <section class="panel"><div class="pad mute small">
    <b style="color:var(--text)">边界：</b>转让不是默认权利，合同允许且法域通过后才可发起；首期不转让或只做逐单协议转让，不把预付额度拆成可公众炒作的等份，不承诺随时有买家。转让价不保证高于原价，中心不提供流动性兜底。有持续消费和可转让合同，只说明存在商业请求权，不等于具备投资产品资格。编号带 SIM 前缀，不是真实权益凭证。
    <span class="btn-row" style="margin-top:10px"><button class="btn sm danger" type="button" data-act="reset">清空本页数据</button></span>
  </div></section>`;

  const barOf = (inv) => {
    const seg = (v, c, t) => (v > 0 ? `<i style="width:${(v / inv.capacity) * 100}%;background:${c}" title="${t} ${n(v)}"></i>` : '');
    return `<div class="bar" style="height:10px">${seg(inv.used, C.used, '已用')}${seg(inv.avail, C.avail, '可用')}${seg(inv.frozen, C.frozen, '冻结')}${seg(inv.expired, C.expired, '到期作废')}${seg(inv.unsold, C.unsold, '未售')}</div>`;
  };
  const LEGEND = `<div class="legend-row"><span><i style="background:${C.used}"></i>已用</span><span><i style="background:${C.avail}"></i>可用</span><span><i style="background:${C.frozen}"></i>转让冻结</span><span><i style="background:${C.expired}"></i>到期作废</span><span><i style="background:${C.unsold};border:1px solid var(--line2)"></i>未售</span></div>`;

  function paintReplay() {
    const box = $('#replay', el);
    if (!replay) { box.innerHTML = `<p class="pad mute">点"重放算例"，按方案原文一步步走：供方登记 1,000 → A 用 600 → A 转 300 给 B（先冻结）→ 供方同意、B 确认 → B 用 220。每一步右侧都会核对"已用 + 可用 + 冻结 = 1,000"。重放只在内存里演算，不写入下面的账本。</p>`; return; }
    box.innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th>步骤</th><th>各方余量</th><th style="min-width:220px">批次构成</th><th class="num">已用</th><th class="num">可用</th><th class="num">冻结</th><th class="num">合计</th><th>守恒</th></tr></thead><tbody>
      ${replay.steps.map((s, i) => `<tr><td class="wrap"><b>${i + 1}.</b> ${esc(s.label)}</td>
        <td class="small">${s.ents.map((e) => `${esc(e.holder)}：已用 ${n(e.used)} · 可用 ${n(e.avail)}${e.frozen ? ` · <span style="color:var(--gold)">冻结 ${n(e.frozen)}</span>` : ''}`).join('<br>')}</td>
        <td>${barOf(s)}</td><td class="num">${n(s.used)}</td><td class="num">${n(s.avail)}</td><td class="num">${n(s.frozen)}</td><td class="num"><b>${n(s.total)}</b></td>
        <td>${s.ok ? '<span class="badge ok">守恒</span>' : '<span class="badge bad">不守恒</span>'}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="pad">${LEGEND}<p class="mute small" style="margin-top:8px">全链合计：已用 820 ＋ A 余量 100 ＋ B 余量 80 ＝ 1,000。冻结中的权益不能重复消费；转让不额外创造容量。</p></div>`;
  }

  function paint() {
    const S = db.state, now = nowSec();
    const invs = S.batches.map((b) => ent.invariant(S, b.id));
    const allOk = invs.every((x) => x.ok);
    $('#stats', el).innerHTML = S.batches.length ? `批次<b>${S.batches.length}</b>权益<b>${S.ents.length}</b>转让完成<b>${S.transfers.filter((t) => t.status === 'done').length}</b>待确认<b>${S.transfers.filter((t) => t.status === 'pending').length}</b>
      数量守恒<b class="${allOk ? 'down' : 'up'}">${allOk ? '全部通过' : '存在不守恒'}</b>` : '账本是空的。在下面登记一个批次，或先看上面的方案算例。';

    $('#batches', el).innerHTML = `<header><h3>批次与守恒检查</h3><span class="mute small">容量 = 未售 + 已用 + 可用 + 冻结 + 到期</span></header>${S.batches.length ? `<div class="table-wrap"><table class="tbl dense"><thead><tr><th>批次</th><th>供方 / 规格</th><th class="num">容量</th><th class="num">已售</th><th style="min-width:160px">构成</th><th>守恒</th><th>到期</th><th></th></tr></thead><tbody>
      ${S.batches.map((b, i) => { const inv = invs[i]; const over = now >= b.expiresAt; return `<tr><td class="mono">${b.id}</td><td class="wrap">${esc(b.supplier)}<div class="small mute">${esc(b.spec)} · ${ent.UNITS[b.unit]}${b.transferable ? ` · 可转让（最低 ${b.minUnit}）` : ' · 不可转让'}</div></td>
        <td class="num">${n(b.capacity)}</td><td class="num">${n(b.sold)}</td><td>${barOf(inv)}</td><td>${inv.ok ? '<span class="badge ok">守恒</span>' : '<span class="badge bad">不守恒</span>'}</td>
        <td class="small">${b.closed ? '<span class="mute">已到期</span>' : fmtDateTime(b.expiresAt).slice(0, 10)}</td>
        <td><div class="acts">${over || b.closed ? '' : `<button class="btn sm primary" type="button" data-act="book" data-id="${b.id}">预订</button><button class="btn sm" type="button" data-act="oversell" data-id="${b.id}">试试超卖</button>`}</div></td></tr>`; }).join('')}
      </tbody></table></div><div class="pad" style="padding-top:8px">${LEGEND}</div>` : emptyState('还没有批次。左侧登记一个，供方的可承诺容量就是这个批次的上限。')}`;

    $('#ents', el).innerHTML = `<header><h3>权益持有与核销</h3><span class="mute small">${S.ents.length} 笔 · 可用 = 数量 − 已用 − 冻结 − 已转出 − 到期</span></header>${S.ents.length ? `<div class="table-wrap"><table class="tbl dense"><thead><tr><th>权益</th><th>持有方</th><th>批次</th><th class="num">数量</th><th class="num">已用</th><th class="num">冻结</th><th class="num">已转出</th><th class="num">可用</th><th>来源</th><th>办理</th></tr></thead><tbody>
      ${S.ents.map((e) => { const b = S.batches.find((x) => x.id === e.batchId); const a = ent.availOf(e); const live = a > 0 && !b.closed && now < b.expiresAt; return `<tr><td class="mono">${e.id}</td><td>${esc(e.holder)}</td><td class="mono small">${e.batchId}</td>
        <td class="num">${n(e.qty)}</td><td class="num">${n(e.used)}</td><td class="num ${e.frozen ? '' : 'mute'}" ${e.frozen ? 'style="color:var(--gold)"' : ''}>${n(e.frozen)}</td><td class="num">${n(e.out)}</td><td class="num"><b>${n(a)}</b>${e.expired ? `<div class="small mute">到期作废 ${n(e.expired)}</div>` : ''}</td>
        <td class="small mute">${e.parent ? `受让自 ${e.parent}` : '直接预订'}</td>
        <td><div class="acts">${live ? `<button class="btn sm primary" type="button" data-act="use" data-id="${e.id}">核销</button>${b.transferable ? `<button class="btn sm" type="button" data-act="transfer" data-id="${e.id}">转让</button>` : ''}` : ''}${e.receipts.length ? `<button class="btn sm" type="button" data-act="dup" data-id="${e.id}">重放上一张回执</button>` : ''}</div></td></tr>`; }).join('')}
      </tbody></table></div>` : emptyState('还没有权益。在批次上点"预订"。')}`;

    $('#transfers', el).innerHTML = `<header><h3>转让记录</h3><span class="mute small">冻结 → 供方同意 → 受让方确认 → 生成后继权益</span></header>${S.transfers.length ? `<div class="table-wrap"><table class="tbl dense"><thead><tr><th>编号</th><th>转出 → 受让</th><th class="num">数量</th><th>状态</th><th>办理</th></tr></thead><tbody>
      ${S.transfers.map((t) => `<tr><td class="mono">${t.id}</td><td class="wrap">${esc(t.from)} → ${esc(t.to)}</td><td class="num">${n(t.qty)}</td>
        <td>${t.status === 'done' ? `<span class="badge ok">已完成</span><div class="small mute mono">${t.newEnt}</div>` : t.status === 'cancelled' ? `<span class="badge off">已撤销</span><div class="small mute">${esc(t.why)}</div>` : `<span class="badge warn">冻结中</span><div class="small mute">供方${t.supplier ? '✓' : '未同意'} · 受让方${t.receiver ? '✓' : '未确认'}</div>`}</td>
        <td><div class="acts">${t.status === 'pending' ? `${t.supplier ? '' : `<button class="btn sm primary" type="button" data-act="ok-s" data-id="${t.id}">供方同意</button>`}${t.receiver ? '' : `<button class="btn sm primary" type="button" data-act="ok-r" data-id="${t.id}">受让方确认</button>`}<button class="btn sm danger" type="button" data-act="cancel" data-id="${t.id}">撤销</button>` : ''}</div></td></tr>`).join('')}
      </tbody></table></div>` : emptyState('还没有转让。只有合同允许转让的批次，才能在权益上发起。')}`;

    $('#money', el).innerHTML = `<header><h3>资金账</h3><span class="mute small">与数量账分开记 · 只记合同价与中心费用</span></header>${S.money.length ? `<div class="table-wrap"><table class="tbl dense"><thead><tr><th>时间</th><th>事项</th><th>付款方 → 收款方</th><th class="num">合同价</th><th class="num">中心组织费</th></tr></thead><tbody>
      ${S.money.map((m) => `<tr><td class="num">${fmtDateTime(m.t).slice(5, 16)}</td><td>${esc(m.kind)} <span class="mono small mute">${m.ref}</span></td><td class="wrap small">${esc(m.payer)} → ${esc(m.payee)}</td><td class="num">${fmtUsd(m.amount)}</td><td class="num">${fmtUsd(m.fee)}</td></tr>`).join('')}
      </tbody></table></div><p class="pad mute small">组织费按净交易规模的 ${(ent.COMPUTE_FEE * 100).toFixed(0)}% 测算（方案 G21 示例假设）。款项由买卖双方经银行认可的路径收付，中心不代收代管；这里没有任何真实资金。</p>` : emptyState('还没有资金记录。预订时按合同价记一笔。')}`;
  }

  const commit = (r, okMsg, ev) => { db.commit(); if (!r.ok) { toast(r.error, 'error'); return false; } if (ev) log(...ev); toast(okMsg, 'ok'); return true; };

  async function onAct(act, id) {
    const S = db.state, now = nowSec();
    if (act === 'replay') { replay = ent.replayG20(ent.blank(), now); paintReplay(); toast('已按方案 G20 重放：5 步全部守恒', 'ok'); return; }
    if (act === 'reset') {
      if (!await confirmDialog('清空算力权益数据', '批次、权益、转让和资金账全部清空，此操作不能撤销。已写入存证链的记录不受影响。', { okText: '清空', danger: true })) return;
      db.reset(); toast('已清空', 'ok'); return;
    }
    if (act === 'book') {
      const b = S.batches.find((x) => x.id === id);
      const who = await dialog({ title: `预订 ${b.id}`, body: `${esc(b.supplier)} · ${esc(b.spec)}<br>可售余量 <b>${n(b.capacity - b.sold)}</b> ${ent.UNITS[b.unit]}`, input: { label: '买方主体', line: true, value: access.st.member?.org || '企业A（虚构）', required: true }, okText: '下一步' });
      if (who === null) return;
      const q = await dialog({ title: '预订数量', input: { label: `数量（${ent.UNITS[b.unit]}）`, line: true, value: String(Math.min(200, b.capacity - b.sold)), required: true }, okText: '预订' });
      if (q === null) return;
      const r = ent.book(S, id, who, Number(q), now);
      commit(r, r.ok ? `已预订 ${n(r.ent.qty)}，权益 ${r.ent.id}` : '', r.ok && ['ent.book', '买方', r.ent.id, { batch: id, qty: r.ent.qty }]);
    } else if (act === 'oversell') {
      const b = S.batches.find((x) => x.id === id);
      const S2 = JSON.parse(JSON.stringify(S));
      const r = ent.book(S2, id, '超卖测试方', b.capacity - b.sold + 1, now);
      toast(r.ok ? '超卖成功（不应出现）' : `在一份副本里多订 1 个单位：被拦下——${r.error}`, r.ok ? 'error' : 'ok');
    } else if (act === 'use') {
      const e = S.ents.find((x) => x.id === id);
      const q = await dialog({ title: `核销 ${e.id}`, body: `持有方 ${esc(e.holder)} · 可用 <b>${n(ent.availOf(e))}</b>${e.frozen ? ` · 另有 ${n(e.frozen)} 冻结中不能消费` : ''}`, input: { label: '本次核销数量', line: true, value: String(Math.min(50, ent.availOf(e))), required: true }, okText: '核销' });
      if (q === null) return;
      const receipt = `${e.id}-R${e.receipts.length + 1}`;
      const r = ent.consume(S, id, Number(q), receipt, now);
      commit(r, `已核销 ${q}，回执 ${receipt}`, r.ok && ['ent.consume', '供方回执', e.id, { qty: Number(q), receipt }]);
    } else if (act === 'dup') {
      const e = S.ents.find((x) => x.id === id);
      const before = e.used;
      const r = ent.consume(S, id, 9999, e.receipts.at(-1), now);
      toast(r.duplicate && e.used === before ? `重复提交回执 ${e.receipts.at(-1)}：识别为重复，已用量保持 ${n(before)}，不重复计量` : '重复回执被重复计量（不应出现）', r.duplicate ? 'ok' : 'error');
    } else if (act === 'transfer') {
      const e = S.ents.find((x) => x.id === id), b = S.batches.find((x) => x.id === e.batchId);
      const to = await dialog({ title: `转让 ${e.id}`, body: `未使用余量 <b>${n(ent.availOf(e))}</b>，最低转让单位 ${b.minUnit}。发起后先冻结，供方同意且受让方确认才生效。`, input: { label: '受让方', line: true, value: '制作方B（虚构）', required: true }, okText: '下一步' });
      if (to === null) return;
      const q = await dialog({ title: '转让数量', input: { label: `数量（${ent.UNITS[b.unit]}）`, line: true, value: String(Math.min(ent.availOf(e), Math.max(b.minUnit, 100))), required: true }, okText: '发起并冻结' });
      if (q === null) return;
      const r = ent.requestTransfer(S, id, to, Number(q), now);
      commit(r, r.ok ? `已冻结 ${n(r.transfer.qty)}，等待供方同意与受让方确认` : '', r.ok && ['ent.transfer', '转出方', r.transfer.id, { ent: id, to: r.transfer.to, qty: r.transfer.qty }]);
    } else if (act === 'ok-s' || act === 'ok-r') {
      const party = act === 'ok-s' ? 'supplier' : 'receiver';
      const r = ent.confirm(S, id, party, now);
      if (commit(r, r.done ? `转让完成，后继权益 ${r.ent.id}` : `${party === 'supplier' ? '供方已同意' : '受让方已确认'}，还差另一方`, r.ok && ['ent.confirm', party === 'supplier' ? '供方' : '受让方', id, { party }]) && r.done) log('ent.transfer.done', '系统', id, { newEnt: r.ent.id, qty: r.ent.qty });
    } else if (act === 'cancel') {
      const why = await dialog({ title: '撤销转让', body: '撤销后冻结的数量回到原权益。', input: { label: '理由', line: true, value: '受让方拒绝' }, okText: '撤销转让', danger: true });
      if (why === null) return;
      commit(ent.cancelTransfer(S, id, why, now), '已撤销，数量已解冻', ['ent.transfer.cancel', '转出方', id, { why }]);
    }
  }

  el.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) onAct(b.dataset.act, b.dataset.id); });
  el.addEventListener('submit', (e) => {
    if (e.target.id !== 'reg') return;
    e.preventDefault();
    const f = e.target, v = (k) => f.elements[k].value, now = nowSec();
    const r = ent.register(db.state, { supplier: v('supplier'), spec: v('spec'), unit: v('unit'), capacity: Number(v('capacity')), price: Number(v('price')), minUnit: Number(v('minUnit')), proof: v('proof'), transferable: f.elements.transferable.checked, expiresAt: now + Math.max(1, Number(v('days')) || 0) * 86400 }, now);
    commit(r, r.ok ? `批次已登记：${r.batch.id}` : '', r.ok && ['ent.register', '供方', r.batch.id, { capacity: r.batch.capacity, unit: r.batch.unit }]);
  });

  const off = db.onChange(paint);
  if (ent.expire(db.state, nowSec())) db.commit();
  paintReplay(); paint();
  return { destroy: off };
}
