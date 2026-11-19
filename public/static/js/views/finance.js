// 财务模型：36 个月、万美元、税前、融资前（方案 V4.0 G21、G22）
// 全部输入是方案的〔示例假设〕，不是预算、预测或回报承诺；金融产品收入恒为零。
import * as fin from '../core/finmodel.js';
import { barLine, legend } from '../svgchart.js';
import { $, esc, tag, fmtSigned, debounce } from '../ui.js';

const C = { sub: '#3d8bff', project: '#b07cff', licence: '#0ecb81', compute: '#f0b90b', evidence: '#2cc7d6', profit: '#0ecb81', loss: '#f6465d', cash: '#f0b90b' };
const LINES = [['sub', '订阅服务净收入'], ['project', '制作／出海项目收入'], ['licence', '版权许可代理净收入'], ['compute', '算力采购组织净收入'], ['evidence', '独立证据工具收入']];
const SLIDERS = [
  ['scale', '新增及项目规模倍率', 0.3, 2, 0.05, (v) => `${v.toFixed(2)}×`],
  ['retention', '年度等价留存率', 0.5, 0.98, 0.01, (v) => `${(v * 100).toFixed(0)}%`],
  ['price', '月订阅单价', 300, 1000, 10, (v) => `$${v}`],
  ['days', '回款天数', 30, 60, 1, (v) => `${v} 天`],
  ['loss', '预计信用损失率', 0, 0.05, 0.001, (v) => `${(v * 100).toFixed(1)}%`],
];
let state = { id: 'base', input: { ...fin.SCENARIOS.base }, showAll: false };
const w = (x, d = 2) => fmtSigned(x, d);
const cls = (x) => (x < 0 ? 'up' : x > 0 ? 'down' : '');

export function mount(el) {
  el.innerHTML = `
  <div class="page-head"><h2>财务模型 ${tag('syn', '示例假设')}</h2>
    <p>不靠发币，五条收入线能不能养活这个中心。这是方案里的 36 个月管理模型，单位万美元：没有既有客户、没有补贴、没有代币融资、没有受监管金融收入。浏览器里按方案写明的口径逐月重算，拖动参数看结果怎么变。它是税前、融资前的测算，不是预算，更不是回报承诺。</p></div>
  <div class="callout warn"><b>先看结论：</b>三种情景前两年都亏损；保守情景第三年仍然亏损。所得税、间接税、跨境预提税、汇率、持牌费用和重大诉讼都没有建模，所以这里不叫净利润，也不是完整的融资额。</div>
  <section class="panel mb">
    <header><h3>情景与参数</h3><div class="tabs" id="scn"></div><span class="sp"></span><span id="custom"></span></header>
    <div class="pad"><div class="form-grid" id="sliders" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:4px 26px"></div>
      <p class="mute small" id="fixed-note"></p></div>
  </section>
  <div class="cards" id="kpi"></div>
  <div class="split">
    <section class="panel"><header><h3>逐月收入结构</h3><span class="mute small">万美元 · 五条收入线之外没有别的收入</span></header><div id="c-rev" style="height:270px;padding:8px 8px 0"></div>${legend(LINES.map(([k, n]) => [n, C[k]]))}</section>
    <section class="panel"><header><h3>利润与到账的区别</h3><span class="mute small">柱：单月税前利润 · 线：累计现金</span></header><div id="c-cash" style="height:270px;padding:8px 8px 0"></div>${legend([['单月税前利润（盈）', C.profit], ['单月税前利润（亏）', C.loss], ['累计现金', C.cash]])}</section>
  </div>
  <section class="panel mb"><header><h3>年度输出</h3><span class="mute small">万美元</span><span class="sp"></span><span id="match"></span></header><div id="years"></div></section>
  <section class="panel mb"><header><h3>复核控制</h3></header><div class="pad" id="ident"></div></section>
  <section class="panel mb"><header><h3>月度明细</h3><span class="sp"></span><button class="btn sm" type="button" data-act="toggle"></button></header><div id="months"></div></section>
  <div class="split">
    <section class="panel"><header><h3>单位经济</h3><span class="mute small">方案 V4.0 G21 · 美元 · 待报价和客户验证</span></header>
      <div class="table-wrap"><table class="tbl dense"><thead><tr><th>收入线</th><th class="num">单价</th><th class="num">直接成本</th><th class="num">贡献</th></tr></thead><tbody>
        <tr><td>治理 SaaS 订阅（每月）</td><td class="num">600</td><td class="num">${fin.UNIT.subCost}</td><td class="num">440</td></tr>
        <tr><td>标准制作／出海项目</td><td class="num">${fin.UNIT.project.toLocaleString()}</td><td class="num">${fin.UNIT.projectCost.toLocaleString()}</td><td class="num">3,000</td></tr>
        <tr><td class="wrap">版权许可代理（平均对价 3,000 × ${(fin.UNIT.licenceFee * 100).toFixed(0)}%）</td><td class="num">240</td><td class="num">72</td><td class="num">168</td></tr>
        <tr><td class="wrap">算力采购组织（净规模 × ${(fin.UNIT.computeFee * 100).toFixed(0)}%）</td><td class="num">按规模</td><td class="num">费用的 ${(fin.UNIT.computeCostRate * 100).toFixed(0)}%</td><td class="num">费用的 60%</td></tr>
        <tr><td>独立证据项目</td><td class="num">${fin.UNIT.evidence}</td><td class="num">${fin.UNIT.evidenceCost}</td><td class="num">120</td></tr>
      </tbody></table></div>
      <p class="pad mute small">均未扣共同研发、法律、安全、销售、坏账及税。许可交易对价与算力规模分别记录，不与制作收入合并成一个虚高的交易总额；平台代理业务只按自有净费用确认收入。</p></section>
    <section class="panel"><header><h3>模型口径</h3></header><div class="pad mute small" style="line-height:1.8">
      <p>Y1—Y3 是项目启动后的相对年度，不是已发生的自然年。平均客户按月初、月末均值，年度留存按十二次方根逐月折算；客户和项目出现小数是管理期望值。</p>
      <p>M1 费用化法务及合同准备 3、M3 安全准备 2；M1／M13／M25 资本开支 2／1／1，36 个月直线折旧。回款 30 天收上月、60 天收上两月、45 天各半，并扣预计信用损失；成本当月付。</p>
      <p>测算资金 = 各月"累计现金缺口 + 三个月共同固定费与销售费"的最大值。它只覆盖本假设下的现金路径，法律、安全、交付工时、税务及银行成本未取得实际报价，调整后可能显著上升。</p>
      <p>受监管金融、NFT 二次交易版税、通用币、质押收益及补贴在基准里一律取零。</p></div></section>
  </div>`;

  function paintControls() {
    $('#scn', el).innerHTML = Object.entries(fin.SCENARIOS).map(([k, s]) => `<button type="button" data-scn="${k}" class="${state.id === k ? 'on' : ''}">${s.name}</button>`).join('');
    $('#custom', el).innerHTML = state.id === 'custom' ? '<span class="badge warn">自定义参数</span>' : '';
    $('#sliders', el).innerHTML = SLIDERS.map(([k, label, lo, hi, step, fmt]) => `<label class="field"><span>${label}<b class="mono" id="v-${k}" style="color:var(--text)">${fmt(state.input[k])}</b></span><input type="range" name="${k}" min="${lo}" max="${hi}" step="${step}" value="${state.input[k]}" aria-label="${label}"></label>`).join('');
    const s = state.input;
    $('#fixed-note', el).textContent = `月共同固定费 Y1／Y2／Y3：${s.fixed.join('／')}　月销售费：${s.sales.join('／')}（万美元，随情景切换；拖动滑块不改这两项）`;
  }

  function paint() {
    const out = fin.run(state.input);
    const Y = out.years, last = out.rows.at(-1);
    const card = (h, big, sub, c = '') => `<div class="card"><h4>${h}</h4><p class="big ${c}">${big}</p><p class="sub">${sub}</p></div>`;
    $('#kpi', el).innerHTML = [
      card('Y3 自有服务收入', w(Y[2].revenue), `Y1 ${w(Y[0].revenue)} · Y2 ${w(Y[1].revenue)}`),
      card('Y3 税前经营利润', w(Y[2].profit), `Y1 ${w(Y[0].profit)} · Y2 ${w(Y[1].profit)}`, cls(Y[2].profit)),
      card('最大累计现金缺口', w(out.maxGap), `出现在 M${out.rows.findIndex((r) => -r.cum === out.maxGap) + 1}`),
      card('测算资金（含安全垫）', w(out.funding), '缺口 + 三个月固定与销售费'),
      card('首个单月税前盈利', out.breakeven ? `M${out.breakeven}` : '36 个月内没有', out.cashTurn ? `单月净现金流转正 M${out.cashTurn}` : '单月净现金流未转正'),
      card('M36 累计现金', w(last.cum), `期末净应收 ${w(last.ar)} 尚未收回`, cls(last.cum)),
    ].join('');

    const labels = out.rows.map((r) => `M${r.m}`);
    const marks = [{ at: 12, label: 'Y2' }, { at: 24, label: 'Y3' }];
    barLine($('#c-rev', el), { labels, stack: true, marks, bars: LINES.map(([k, name]) => ({ name, color: C[k], values: out.rows.map((r) => r[k]) })) });
    barLine($('#c-cash', el), { labels, marks, bars: [{ name: '单月税前利润', color: (v) => (v < 0 ? C.loss : C.profit), values: out.rows.map((r) => r.profit) }], lines: [{ name: '累计现金', color: C.cash, values: out.rows.map((r) => r.cum) }] });

    const pub = state.id === 'base' ? fin.PUBLISHED.base.years : null;
    const ROWS = [['sub', '订阅服务净收入'], ['project', '制作／出海项目收入'], ['licence', '版权许可代理净收入'], ['compute', '算力采购组织净收入'], ['evidence', '独立证据工具收入'], ['revenue', '自有服务收入合计', 1], ['direct', '直接成本'], ['gross', '直接毛利', 1],
      ['fixed', '共同固定费'], ['sales', '销售费'], ['prep', '准备费用'], ['loss', '预计信用损失'], ['depr', '折旧'], ['profit', '税前经营利润', 1], ['cash', '融资前税前净现金流', 1]];
    $('#years', el).innerHTML = `<div class="table-wrap"><table class="tbl dense"><thead><tr><th>项目</th><th class="num">Y1</th><th class="num">Y2</th><th class="num">Y3</th>${pub ? '<th class="num">方案公布值 Y1／Y2／Y3</th><th>复算</th>' : ''}</tr></thead><tbody>
      ${ROWS.map(([k, name, bold]) => { const ok = pub && Y.every((y, i) => Math.abs(y[k] - pub[i][k]) <= 0.0051); return `<tr${bold ? ' style="font-weight:600"' : ''}><td>${name}</td>${Y.map((y) => `<td class="num ${['profit', 'cash'].includes(k) ? cls(y[k]) : ''}">${w(y[k])}</td>`).join('')}
        ${pub ? `<td class="num mute">${pub.map((p) => w(p[k])).join('／')}</td><td>${ok ? '<span class="down">✓ 一致</span>' : '<span class="up">✗ 有偏差</span>'}</td>` : ''}</tr>`; }).join('')}
      </tbody></table></div>
      <p class="pad mute small">利润 = 收入 − 直接成本 − 固定费 − 销售费 − 准备费 − 预计信用损失 − 折旧。现金流 = 实际回款 − 当期现金成本与费用 − 资本开支，不再扣一次非现金的信用损失。${pub ? '' : '当前不是基准情景，右侧不显示方案公布值对照。'}</p>`;
    const named = fin.PUBLISHED[state.id];
    if (named) { const c = fin.compare(state.id); $('#match', el).innerHTML = `<span class="badge ${c.max <= 0.0051 ? 'ok' : 'bad'}">与方案公布值比对 ${c.diffs.length} 项 · 最大偏差 ${c.max.toFixed(4)}</span>`; } else $('#match', el).innerHTML = '<span class="badge off">自定义参数 · 无公布值可比</span>';

    const id = out.identity;
    $('#ident', el).innerHTML = `<div class="kv"><span>累计现金流</span><b class="${cls(last.cum)}">${w(last.cum, 4)}</b></div><div class="kv"><span>＋ 期末净应收</span><b>${w(last.ar, 4)}</b></div><div class="kv"><span>＋ 固定资产净额</span><b>${w(last.nbv, 4)}</b></div>
      <div class="kv" style="border-top:1px solid var(--line);margin-top:4px;padding-top:6px"><span>＝ 左侧合计</span><b>${w(id.lhs, 4)}</b></div><div class="kv"><span>累计税前利润</span><b>${w(id.rhs, 4)}</b></div>
      <p class="hint ${id.gap < 1e-9 ? '' : 'warn'}">${id.gap < 1e-9 ? '两侧一致：利润和现金的差额全部落在应收和固定资产上，没有凭空多出或少掉的钱。' : `两侧相差 ${id.gap.toExponential(2)}，模型口径有误。`}无应付融资、无分红及所得税；末期应收仍未收回，不在 M36 人为清零。</p>`;

    const rows = state.showAll ? out.rows : out.rows.filter((r) => r.m % 3 === 0 || r.m === 1);
    $('[data-act="toggle"]', el).textContent = state.showAll ? '只看每季度' : '展开全部 36 个月';
    $('#months', el).innerHTML = `<div class="table-wrap"><table class="tbl dense"><thead><tr><th class="num">月</th><th class="num">新增客户</th><th class="num">期末活跃</th><th class="num">收入</th><th class="num">直接成本</th><th class="num">税前利润</th><th class="num">回款</th><th class="num">净现金流</th><th class="num">累计现金</th><th class="num">期末应收</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="num">M${r.m}</td><td class="num">${w(r.add)}</td><td class="num">${w(r.active)}</td><td class="num">${w(r.revenue)}</td><td class="num">${w(r.direct)}</td><td class="num ${cls(r.profit)}">${w(r.profit)}</td><td class="num">${w(r.collected)}</td><td class="num ${cls(r.cash)}">${w(r.cash)}</td><td class="num ${cls(r.cum)}">${w(r.cum)}</td><td class="num">${w(r.ar)}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  const repaint = debounce(paint, 60);
  el.addEventListener('input', (e) => {
    if (e.target.type !== 'range') return;
    const k = e.target.name, v = Number(e.target.value);
    state.input = { ...state.input, [k]: v };
    state.id = 'custom';
    $(`#v-${k}`, el).textContent = SLIDERS.find((s) => s[0] === k)[5](v);
    $('#custom', el).innerHTML = '<span class="badge warn">自定义参数</span>';
    for (const b of el.querySelectorAll('[data-scn]')) b.classList.remove('on');
    repaint();
  });
  el.addEventListener('click', (e) => {
    const s = e.target.closest('[data-scn]');
    if (s) { state = { ...state, id: s.dataset.scn, input: { ...fin.SCENARIOS[s.dataset.scn] } }; paintControls(); paint(); return; }
    if (e.target.closest('[data-act="toggle"]')) { state.showAll = !state.showAll; paint(); }
  });
  const onResize = debounce(paint, 150);
  window.addEventListener('resize', onResize);
  paintControls(); paint();
  return { destroy() { window.removeEventListener('resize', onResize); } };
}
