// 采购台：询价 → 比较 → 签约 → 履约计量 → 验收结算（§09、§10 的真实采购路径，仿真版）
// 供应商与费率为真实公开报价；合格率、履约计量为合成；结算只扣研究记分
import * as sim from '../core/sim.js';
import * as market from '../core/market.js';
import * as account from '../core/account.js';
import * as access from '../core/access.js';
import { hashStr, mix, mulberry32, gauss } from '../core/rng.js';
import { $, $$, esc, fmtPx, fmtPct, fmtNum, fmtInt, fmtDateTime, fmtIso, toast, nowSec, REAL, SYN, tag } from '../ui.js';

const QUOTE_TTL = 600; // 询价结果有效期（秒）
const form = { task: 'kb', volume: 20000, floor: 90, uptime: 99, region: '', open: false, budget: '' };
let rfq = null;
const STATUS = { signed: '已签约 · 待履约', delivered: '已出账 · 待验收', settled: '已验收结算' };
const r4 = (x) => Math.round(x * 1e4) / 1e4;

function runRfq(now) {
  const S = market.state;
  const task = market.TASKS.find((t) => t.id === form.task);
  const floor = form.floor / 100;
  const ex = { open: 0, quality: 0, uptime: 0, region: 0, budget: 0 };
  const rows = [];
  for (const inst of S.insts) {
    if (!inst.main || inst.variant !== 'std') continue;
    if (form.open && !inst.open) { ex.open += inst.quotes.length; continue; }
    const pass = market.passRate(inst, task);
    if (pass < floor) { ex.quality += inst.quotes.length; continue; }
    for (const q of inst.quotes) {
      if (!q.ok || (q.up1d != null && q.up1d < form.uptime)) { ex.uptime++; continue; }
      if (form.region) {
        const c = S.providerByName.get(q.p);
        if (!c || !c.dcs.includes(form.region)) { ex.region++; continue; }
      }
      const unit = sim.taskCost({ inCny: q.cny.in, outCny: q.cny.out, inTok: task.inTok, outTok: task.outTok, pass, review: task.review });
      const monthly = unit * form.volume;
      if (form.budget && monthly > Number(form.budget)) { ex.budget++; continue; }
      rows.push({ inst, q, pass, unit, monthly });
    }
  }
  rows.sort((a, b) => a.unit - b.unit);
  rows.forEach((r, i) => { r.rank = i + 1; });
  const cheapestToken = rows.length ? rows.reduce((a, b) => (b.q.basket < a.q.basket ? b : a)) : null;
  rfq = { t: now, validUntil: now + QUOTE_TTL, task, form: { ...form }, rows, ex, cheapestToken };
}

/** 模拟一个账期的履约计量（确定性：同一合同重算结果一致） */
function simulateBill(c) {
  const r = mulberry32(mix(hashStr(`${c.instId}|${c.provider}`), c.id));
  const N = c.volume;
  const actual = Math.min(0.995, Math.max(0.3, c.pass + 0.02 * gauss(r))); // 实际合格率与评测存在偏差
  const pass1 = Math.round(N * actual);
  const retries = N - pass1;                 // 首次不合格的任务重试一次
  const pass2 = Math.round(retries * actual);
  const attempts = N + retries;
  const inTok = Math.round(attempts * c.task.inTok * (0.95 + 0.1 * r()));
  const outTok = Math.round(attempts * c.task.outTok * (0.95 + 0.1 * r()));
  const inFee = r4((inTok / 1e6) * c.rates.in);
  const outFee = r4((outTok / 1e6) * c.rates.out);
  const review = r4(attempts * c.task.review);
  const total = r4(inFee + outFee + review);
  const qualified = pass1 + pass2;
  return { attempts, retries, qualified, failed: N - qualified, inTok, outTok, inFee, outFee, review, total, unit: qualified ? total / qualified : null, actual };
}

export function mount(el) {
  const S = market.state;
  const regions = new Map();
  for (const c of S.centers) for (const d of c.dcs) regions.set(d, (regions.get(d) || 0) + 1);
  const regionOpts = [...regions.entries()].sort((a, b) => b[1] - a[1]);
  const cnCenters = regions.get('CN') || 0;

  el.innerHTML = `
  <div class="page-head"><h2>采购台</h2>
    <p>买的是可交付的服务，不是涨跌。提出业务需求，在真实公开报价里筛出能满足约束的供给，比较"单合格任务有效成本"，签约、履约计量、验收后再结算。</p></div>
  ${access.canTrade() ? '' : '<p class="hint warn" style="margin:0 0 12px">尚未取得入场资格：可以询价和比较，但签约前须先完成入场申请与审批。<a href="#/access">前往入场 →</a></p>'}
  <div class="steps" id="steps"></div>
  <section class="panel" style="margin-bottom:12px">
    <header><h3>① 提交采购需求</h3></header>
    <form class="pad" id="rfq" novalidate>
      <div class="form-grid">
        <label class="field"><span>业务任务</span><select class="input" name="task">${market.TASKS.map((t) => `<option value="${t.id}">${esc(t.name)}（${esc(t.note)}）</option>`).join('')}</select></label>
        <label class="field"><span>账期任务量<em class="mute">个</em></span><input class="input mono" name="volume" type="number" min="100" step="100"></label>
        <label class="field"><span>合格率下限<em class="mute">%</em></span><input class="input mono" name="floor" type="number" min="50" max="99" step="1"></label>
        <label class="field"><span>近1日可用率下限<em class="mute">%</em></span><input class="input mono" name="uptime" type="number" min="90" max="100" step="0.5"></label>
        <label class="field"><span>机房所在地</span><select class="input" name="region"><option value="">不限</option>${regionOpts.map(([cc, n]) => `<option value="${esc(cc)}">${esc(market.regionName(cc))}（${n} 家）</option>`).join('')}${cnCenters ? '' : '<option value="CN">中国境内（0 家）</option>'}</select></label>
        <label class="field"><span>账期预算上限<em class="mute">研究记分，可不填</em></span><input class="input mono" name="budget" type="number" min="0" step="100" placeholder="不限"></label>
      </div>
      <label style="display:inline-flex;gap:6px;align-items:center;margin:2px 0 12px"><input type="checkbox" name="open"> 只要开放权重模型</label>
      <div><button class="btn primary" type="submit">发起询价</button></div>
    </form>
  </section>
  <section class="panel" id="result" style="margin-bottom:12px" hidden></section>
  <section class="panel">
    <header><h3>我的采购合同</h3></header>
    <div id="contracts"></div>
  </section>`;

  const f = $('#rfq', el);
  for (const k of ['task', 'volume', 'floor', 'uptime', 'region', 'budget']) f.elements[k].value = form[k];
  f.elements.open.checked = form.open;

  function paintSteps() {
    const cs = account.acct.contracts;
    const done = [!!rfq, !!rfq && rfq.rows.length > 0, cs.length > 0, cs.some((c) => c.status !== 'signed'), cs.some((c) => c.status === 'settled')];
    const names = ['提交需求', '比较报价', '签约', '履约计量', '验收结算'];
    const cur = done.indexOf(false);
    $('#steps', el).innerHTML = names.map((n, i) => `<span class="${done[i] ? 'done' : i === cur ? 'on' : ''}">${done[i] ? '✓ ' : `${i + 1} `}${n}</span>`).join('');
  }

  function paintResult(now) {
    const box = $('#result', el);
    if (!rfq) { box.hidden = true; return; }
    box.hidden = false;
    const left = Math.max(0, Math.round(rfq.validUntil - now));
    const exText = [['quality', '合格率不达标'], ['uptime', '可用率不达标或降级'], ['region', '机房所在地不符'], ['budget', '超出预算'], ['open', '非开放权重']]
      .filter(([k]) => rfq.ex[k]).map(([k, v]) => `${v} ${rfq.ex[k]} 条`).join(' · ');
    const head = `<header><h3>② 比较报价</h3>${REAL}<span class="mute small">费率与供应商</span>${SYN}<span class="mute small">合格率</span><span class="sp"></span>
      <span class="small ${left ? 'mute' : 'up'}" id="ttl">${left ? `报价有效期剩余 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '报价已过期，请重新询价'}</span></header>`;
    if (!rfq.rows.length) {
      const cn = rfq.form.region === 'CN' ? '公开目录里没有披露机房在中国境内的供应商。境内算力中心的报价需要供应商授权接入，不能用境外报价顶替。' : '可以放宽合格率、可用率、地域或预算后重新询价。';
      box.innerHTML = `${head}<p class="empty">没有同时满足全部约束的供给。${cn}<br><span class="small">被排除：${exText || '无'}</span></p>`;
      return;
    }
    const top = rfq.rows.slice(0, 15);
    const ct = rfq.cheapestToken;
    const insight = ct && ct.rank > 1
      ? `Token 单价最低的是 <b>${esc(ct.inst.name)}</b>（${esc(ct.q.p)}，固定篮子 ${fmtPx(ct.q.basket)} 元/百万Token），但算上不合格重试和人工复核，它的单合格任务成本排第 <b>${ct.rank}</b>。便宜的 Token 不等于划算的结果。`
      : '本次询价中，Token 单价最低的供给同时也是单合格任务成本最低的。';
    box.innerHTML = `${head}
      <p class="pad small" style="color:#c5cad3">共 <b>${rfq.rows.length}</b> 条报价满足全部约束，按单合格任务有效成本从低到高排列，显示前 ${top.length} 条。${insight}<br><span class="mute">被排除：${exText || '无'}</span></p>
      <div class="table-wrap"><table class="tbl dense"><thead><tr><th>#</th><th>模型 / 桶</th><th>供应商</th><th>机房</th><th class="num">输入</th><th class="num">输出</th><th class="num">合格率</th><th class="num">单合格任务成本</th><th class="num">账期预计</th><th class="num">可用率</th><th>推荐理由</th><th></th></tr></thead><tbody>
      ${top.map((r, i) => {
        const c = S.providerByName.get(r.q.p);
        const why = i === 0 ? '满足全部约束后成本最低' : r === ct ? 'Token 单价最低' : r.pass === Math.max(...top.map((x) => x.pass)) ? '合格率最高' : '';
        return `<tr><td class="num">${r.rank}</td><td>${esc(r.inst.name)}<span class="chip sm">${esc(r.inst.qLabel)}</span>${r.inst.open ? '<span class="chip sm open">开放权重</span>' : ''}</td>
          <td>${esc(r.q.p)}</td><td class="small">${c && c.dcs.length ? c.dcs.map((d) => esc(market.regionName(d))).join('、') : '<span class="mute">未披露</span>'}</td>
          <td class="num">${fmtPx(r.q.cny.in)}</td><td class="num">${fmtPx(r.q.cny.out)}</td><td class="num">${(r.pass * 100).toFixed(1)}%</td>
          <td class="num"><b>${r.unit.toFixed(4)}</b></td><td class="num">${fmtNum(r.monthly)}</td><td class="num">${r.q.up1d == null ? '—' : `${r.q.up1d.toFixed(1)}%`}</td>
          <td class="small">${why}</td><td><button class="btn sm primary" data-sign="${i}">签约</button></td></tr>`;
      }).join('')}</tbody></table></div>
      <p class="pad mute small">单合格任务有效成本 =（单次推理费 + 单次复核费）÷ 合格率。任务规格：每次 ${rfq.task.inTok} 输入 / ${rfq.task.outTok} 输出 Token，复核 ${rfq.task.review} 元/次〔示例假设〕。排序只看约束与成本，不含付费推广。合格率是合成演示值，没有做真实同题评测。</p>`;
  }

  function billHtml(c) {
    const b = c.bill;
    const dev = b.unit / c.unit - 1;
    return `<tr class="detail"><td colspan="8"><div class="dl">
      <div><b>计量</b><div class="mute small">调用 ${fmtInt(b.attempts)} 次（含不合格重试 ${fmtInt(b.retries)} 次）<br>输入 ${fmtInt(b.inTok)} Token · 输出 ${fmtInt(b.outTok)} Token</div></div>
      <div><b>交付</b><div class="mute small">合格 ${fmtInt(b.qualified)} 个 · 不合格 ${fmtInt(b.failed)} 个<br>实际合格率 ${(b.actual * 100).toFixed(1)}%（评测 ${(c.pass * 100).toFixed(1)}%）</div></div>
      <div><b>账单</b><div class="mute small">输入费 ${fmtNum(b.inFee, 4)} + 输出费 ${fmtNum(b.outFee, 4)} + 复核费 ${fmtNum(b.review, 4)}<br>合计 <b style="color:var(--text)">${fmtNum(b.total)}</b> 研究记分</div></div>
      <div><b>与签约报价勾稽</b><div class="mute small">签约单合格任务成本 ${c.unit.toFixed(4)} → 实际 ${b.unit == null ? '不可计算' : b.unit.toFixed(4)}<br>偏差 <span class="${dev > 0 ? 'up' : 'down'}">${fmtPct(dev)}</span>：来自实际合格率与 Token 用量波动，费率按签约快照未变</div></div>
    </div></td></tr>`;
  }

  function paintContracts() {
    const cs = account.acct.contracts;
    $('#contracts', el).innerHTML = cs.length ? `<div class="table-wrap"><table class="tbl dense"><thead><tr><th>合同</th><th>服务</th><th>供应商</th><th>任务</th><th class="num">任务量</th><th class="num">签约单合格任务成本</th><th>状态</th><th></th></tr></thead><tbody>
      ${cs.map((c) => `<tr><td class="num">#${c.id}<br><span class="mute small">${fmtDateTime(c.t).slice(5, 16)}</span></td>
        <td>${esc(c.modelName)}<span class="chip sm">${esc(c.qLabel)}</span></td><td>${esc(c.provider)}</td><td>${esc(c.task.name)}</td>
        <td class="num">${fmtInt(c.volume)}</td><td class="num">${c.unit.toFixed(4)}</td><td>${STATUS[c.status]}</td>
        <td>${c.status === 'signed' ? `<button class="btn sm primary" data-deliver="${c.id}">模拟一个账期履约</button>` : c.status === 'delivered' ? `<button class="btn sm primary" data-settle="${c.id}">验收并结算</button>` : `<span class="mute small">${fmtDateTime(c.settledAt).slice(5, 16)} 结算</span>`}</td></tr>${c.bill ? billHtml(c) : ''}`).join('')}
      </tbody></table></div>
      <p class="pad mute small">合同编号只用于履约追踪，不可转让、不可分割、不承诺升值。签约时冻结费率与规格快照；履约出账后先验收，再结算，两步分开。签约、出账、结算三个环节都写入存证链，可在"入场"页校验。</p>`
      : '<p class="empty">还没有合同。发起询价并签约后，这里显示履约、计量与账单。</p>';
    paintSteps();
  }

  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const volume = Math.floor(Number(v.volume)), floor = Number(v.floor), uptime = Number(v.uptime);
    if (!(volume >= 100)) return toast('账期任务量至少 100 个', 'error');
    if (!(floor >= 50 && floor <= 99)) return toast('合格率下限请填 50–99', 'error');
    if (!(uptime >= 90 && uptime <= 100)) return toast('可用率下限请填 90–100', 'error');
    if (v.budget !== '' && !(Number(v.budget) > 0)) return toast('预算上限请填正数，或留空表示不限', 'error');
    Object.assign(form, { task: v.task, volume, floor, uptime, region: v.region, budget: v.budget, open: f.elements.open.checked });
    const now = nowSec();
    runRfq(now);
    paintResult(now); paintSteps();
    $('#result', el).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  el.addEventListener('click', (e) => {
    const now = nowSec();
    const s = e.target.closest('[data-sign]');
    if (s) {
      if (!rfq || now > rfq.validUntil) return toast('报价已过期，不能按过期价格签约。请重新询价。', 'error');
      const m = access.st.member;
      if (!m) return toast('尚未取得入场资格：无登记不交易。请先到"入场"完成申请与审批。', 'error');
      if (m.role === 'supplier') return toast('当前以供给方角色入场，不能作为买方签约。', 'error');
      const r = rfq.rows[Number(s.dataset.sign)];
      const c = account.addContract({
        status: 'signed', t: now, instId: r.inst.id, modelName: r.inst.name, qLabel: r.inst.qLabel, provider: r.q.p,
        task: { ...rfq.task }, volume: rfq.form.volume, rates: { in: r.q.cny.in, out: r.q.cny.out }, pass: r.pass, unit: r.unit,
        monthly: r.monthly, quotedAt: rfq.t, snapshotAt: S.snapshotAt, sceneNo: m.sceneNo,
      });
      access.log('contract.sign', m.org, `合同#${c.id}`, { provider: r.q.p, inst: r.inst.id, sceneNo: m.sceneNo, digest: access.digest({ rates: c.rates, volume: c.volume, task: c.task.id }) }, now);
      toast(`已签约合同 #${c.id}：${r.inst.name} · ${r.q.p}，费率与规格已冻结`, 'ok');
      return;
    }
    const d = e.target.closest('[data-deliver]');
    if (d) {
      const c = account.acct.contracts.find((x) => x.id === Number(d.dataset.deliver));
      const r = account.deliverContract(c.id, simulateBill(c), now);
      if (r.ok) access.log('contract.deliver', c.provider, `合同#${c.id}`, { qualified: c.bill.qualified, total: c.bill.total, digest: access.digest(c.bill) }, now);
      toast(r.ok ? `合同 #${c.id} 已出账，请核对计量后验收` : r.error, r.ok ? 'ok' : 'error');
      return;
    }
    const st = e.target.closest('[data-settle]');
    if (st) {
      const id = Number(st.dataset.settle);
      const c = account.acct.contracts.find((x) => x.id === id);
      const r = account.settleContract(id, now);
      if (r.ok) access.log('contract.settle', access.st.member?.org || '买方', `合同#${id}`, { total: c.bill.total }, now);
      toast(r.ok ? `合同 #${id} 已验收，结算 ${fmtNum(c.bill.total)} 研究记分` : r.error, r.ok ? 'ok' : 'error');
    }
  });

  const off = account.onChange(paintContracts);
  paintResult(nowSec()); paintContracts();
  return {
    tick(now) {
      const t = $('#ttl', el);
      if (!t || !rfq) return;
      const left = Math.max(0, Math.round(rfq.validUntil - now));
      t.textContent = left ? `报价有效期剩余 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '报价已过期，请重新询价';
      t.className = `small ${left ? 'mute' : 'up'}`;
    },
    destroy() { off(); },
  };
}
