// 总览：拟议定位、产业价值链、三层业务、四种 Token、上手路径、尚未取得的关键事实（方案 V4.0 G01—G04、G23、G26）
import * as market from '../core/market.js';
import * as access from '../core/access.js';
import * as account from '../core/account.js';
import * as rights from '../core/rights.js';
import * as entitle from '../core/entitle.js';
import * as evidence from '../core/evidence.js';
import { $, esc, fmtInt, fmtPct, fmtUsd, dir, nowSec, REAL, SYN, EXAMPLE, CLOSED, tag } from '../ui.js';

const CHAIN = [
  ['资源', '算力／模型服务', '公开目录里的真实报价', 'compute'],
  ['服务', '可验证调用', '分项计量、回执、账单勾稽', 'procure'],
  ['作品', 'AI影视、内容与企业任务', '有创作证据的作品与任务', 'listing'],
  ['权利', '合法授权与海外渠道', '限定地域、语言、渠道、期限', 'listing'],
  ['经营', '真实销售／服务回款', '外部到账凭证，不是链上转账', 'royalty'],
  ['经营', '经营与权利人分配', '先清权、到账，再按合同分', 'royalty'],
  ['资源', '再投入', '剩余算力权益受限转让', 'entitle'],
];
const TOKENS = [
  ['技术词元', '分词与调用计费单位', '行情、采购台里的"百万Token"', '不因上链就变成可投资资产'],
  ['服务额度', '对特定供应商的合同请求权', '算力权益、交易页持仓', '先消费；转让须合同允许并经供方同意'],
  ['链上凭证', '某组记录或权利状态的技术表示', '溯源存证的哈希与批次根', '不定义版权、金融或支付性质'],
  ['金融代币', '可能代表证券、收益权、支付等受监管权益', '本环境不提供', '未获准保持关闭，收入一律为零'],
];
const PENDING = ['拟议名称的正式登记', '广州数据交易所相关品牌授权', '澳门金融及支付准入意见', '银行接受的具体资金路径', '海外实际发行买家', '版权及供方合同', '合规合作伙伴', '真实成交与续费'];
const PHASES = [
  ['0—30 天', '名称、法域和银行过闸', '核品牌及主体、业务及金融边界、银行可受理路径；关键意见不能取得时只开发研究原型。'],
  ['31—90 天', '三个可收费样板', '一笔影视／素材许可或出海服务；一笔模型／算力采购与真实任务交付；一份计量及证据治理订阅。'],
  ['3—12 个月', '同类订单复制', '把素材清单、版权许可、模型规格、计量映射、渠道对账及退出做成模板。'],
  ['12—36 个月', '伙伴与受控 Web4 网络', '接入更多发行、资源及专业伙伴；开放受预算和地域约束的 Agent 工作流。'],
];

export function mount(el) {
  const S = market.state;
  const now0 = nowSec();
  const ix = market.indices(now0);
  const quotes = S.insts.reduce((a, i) => a + i.quotes.length, 0);
  const tradable = S.insts.filter((i) => i.meets).length;

  el.innerHTML = `
  <section class="hero">
    <p class="eyebrow">拟议名称 · 正式登记及相关品牌授权待确认 · 方案 V4.0</p>
    <h1>澳门词元中心：把可核实、可授权、可交付的 AI 供给，接进真实创收应用</h1>
    <p class="lead">不是把算力都发成币。这里把"算力与模型服务 → AI 影视与企业任务 → 合法授权 → 真实回款 → 合同分配"接成一条可以审查的产业链：价格可比、用量可核、交付可验。
      本站是按方案搭出来的仿真环境，模型与报价是公开目录里的真实数据，成交、挂牌、许可和分账是合成或示例数据。</p>
    <div class="btn-row">
      <a class="btn primary" href="#/listing">看版权与服务挂牌</a>
      <a class="btn" href="#/market">看模型服务行情</a>
      <a class="btn" href="#/finance">看 36 个月财务模型</a>
      <button class="btn ghost" type="button" data-cmdk>搜索 <kbd>Ctrl K</kbd></button>
    </div>
  </section>

  <div class="cards" id="kpi">
    <a class="card" href="#/models"><h4>公开目录模型 ${REAL}</h4><p class="big">${fmtInt(S.models.length)}</p><p class="sub">${fmtInt(quotes)} 条服务商报价</p></a>
    <a class="card" href="#/compute"><h4>算力中心 ${REAL}</h4><p class="big">${S.centers.length}</p><p class="sub">${tradable} 个可比桶达到发布门槛</p></a>
    <a class="card" href="#/market"><h4>综合参考价格指数 ${SYN}</h4><p class="big" id="k-idx">—</p><p class="sub" id="k-idx-sub"></p></a>
    <a class="card" href="#/listing"><h4>挂牌与许可 ${EXAMPLE}</h4><p class="big" id="k-lst">—</p><p class="sub" id="k-lst-sub"></p></a>
    <a class="card" href="#/entitle"><h4>算力权益批次 ${EXAMPLE}</h4><p class="big" id="k-ent">—</p><p class="sub" id="k-ent-sub"></p></a>
    <a class="card" href="#/evidence"><h4>本机存证记录</h4><p class="big" id="k-ev">—</p><p class="sub" id="k-ev-sub"></p></a>
  </div>

  <section class="panel mb">
    <header><h3>一条产业价值链</h3><span class="mute small">每一层有自己的单位和责任，不折算成一个万能 Token · 点击进入对应页面</span></header>
    <div class="chain">${CHAIN.map(([layer, name, note, to]) => `<a href="#/${to}"><small>${layer}层</small><b>${name}</b><span>${note}</span></a>`).join('')}</div>
  </section>

  <div class="layers">
    <article class="layer"><h3>产业交易 ${tag('real', '可体验')}</h3><p>AI 影视制作与出海、版权许可、算力及模型采购、治理软件。普通商业订单优先，逐类核经营、权利、银行、地域及数据。</p>
      <div class="links"><a href="#/listing">挂牌大厅</a><a href="#/procure">采购台</a><a href="#/market">行情</a><a href="#/bay">词元出海</a></div></article>
    <article class="layer l2"><h3>数字权利 ${tag('syn', '机制演示')}</h3><p>可验证许可、链上证据、批次核销、受限转让、合同分账。须合同可执行、供方同意、分类与安全审查通过；不默认公开流转。</p>
      <div class="links"><a href="#/entitle">算力权益</a><a href="#/royalty">版税分账</a><a href="#/evidence">溯源存证</a><a href="#/agent">受控Agent</a></div></article>
    <article class="layer l3"><h3>金融合作 ${CLOSED}</h3><p>应收、设备、版权现金流融资及风险工具只做专项研究。须适格主体、对应产品与地域权限；未获准保持关闭，本环境不提供，财务模型里收入为零。</p>
      <div class="links"><a href="#/juris">看跨法域矩阵怎么拦</a><a href="#/method">边界说明</a></div></article>
  </div>

  <div class="split wide-l">
    <section class="panel">
      <header><h3>上手路径</h3><span class="mute small">按顺序走一遍，大约十分钟</span></header>
      <div class="quick" id="quick"></div>
    </section>
    <section class="panel">
      <header><h3>仍未取得的关键事实</h3>${tag('todo', '待确认')}</header>
      <ul class="todo-list">${PENDING.map((x) => `<li>${x}</li>`).join('')}</ul>
      <p class="pad mute small" style="padding-top:0">方案完整不意味着这些条件已满足。本站不是已核准登记的机构网站，不是广州数据交易所澳门分支，未取得交易所或金融业务许可。</p>
    </section>
  </div>

  <section class="panel mb">
    <header><h3>四种 Token 绝不混用</h3><span class="mute small">名称相同不改变性质</span></header>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>类别</th><th>是什么</th><th>在本站哪里出现</th><th>边界</th></tr></thead><tbody>
      ${TOKENS.map(([a, b, c, d]) => `<tr><td><b>${a}</b></td><td class="wrap">${b}</td><td class="wrap">${c}</td><td class="wrap mute">${d}</td></tr>`).join('')}
    </tbody></table></div>
  </section>

  <section class="panel">
    <header><h3>分阶段建设</h3>${tag('syn', '拟议路线')}<span class="mute small">先跑通三类产业订单；金融化不由达到某个规模自动触发</span></header>
    <div class="matrix5" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));padding:14px">
      ${PHASES.map(([when, name, what]) => `<div class="review-col"><small>${when}</small><h4>${name}</h4><p class="mute small" style="margin-top:4px">${what}</p></div>`).join('')}
    </div>
  </section>`;

  function paintQuick() {
    const m = access.st.member;
    const R = rights.db.state, E = entitle.db.state;
    const steps = [
      ['access', '取得入场资格', m ? `已入场：${access.ROLES[m.role].name}` : '主体登记、场景登记、合规会审', !!m],
      ['trade', '看行情并下一笔单', '用研究记分体验撮合，不涉及资金', account.acct.fills.length > 0],
      ['listing', '挂牌、询价、签一份许可', '三道审核 → 锁定合同快照 → 外部到账 → 交付', R.orders.some((o) => o.status === 'accepted')],
      ['entitle', '转让一笔算力权益', '冻结 → 供方同意 → 受让确认，数量守恒', E.transfers.some((t) => t.status === 'done')],
      ['royalty', '算一次版税瀑布', '10,000 美元毛收入怎么分到每一方', access.st.ledger.some((e) => e.type === 'royalty.allocate')],
      ['evidence', '封一个证据批次并验证', 'Merkle 根 + 包含性证明', evidence.db.state.batches.length > 0],
    ];
    $('#quick', el).innerHTML = steps.map(([to, name, note, done], i) => `<a href="#/${to}" class="${done ? 'done' : ''}"><i>${done ? '✓' : i + 1}</i><b>${name}</b><span>${esc(note)}</span></a>`).join('');
  }

  function paintStats() {
    const st = rights.stats(rights.db.state);
    $('#k-lst', el).textContent = `${st.listed} 个挂牌中`;
    $('#k-lst-sub', el).textContent = `已成立许可 ${st.licences} 笔 · 合同对价 ${fmtUsd(st.contractValue, 0)}`;
    const E = entitle.db.state;
    $('#k-ent', el).textContent = `${E.batches.length} 个`;
    $('#k-ent-sub', el).textContent = E.batches.length ? `全部数量守恒：${E.batches.every((b) => entitle.invariant(E, b.id).ok) ? '是' : '否'}` : '尚未登记，进去可重放 G20 算例';
    const L = access.st.ledger;
    $('#k-ev', el).textContent = `${L.length} 条`;
    $('#k-ev-sub', el).textContent = `已封存 ${evidence.db.state.batches.length} 个批次 · 仅存本机`;
  }

  function paintIndex(now) {
    const cur = ix.all.now(now), prev = ix.all.series.at(-1)?.v;
    const chg = cur != null && prev ? cur / prev - 1 : null;
    const big = $('#k-idx', el);
    big.textContent = cur == null ? '—' : cur.toFixed(2);
    big.className = `big ${dir(chg)}`;
    $('#k-idx-sub', el).innerHTML = `<span class="num ${dir(chg)}">${fmtPct(chg)}</span> 较上一发布日`;
  }

  const offs = [access.onChange(() => { paintQuick(); paintStats(); }), rights.db.onChange(paintStats), entitle.db.onChange(paintStats)];
  paintQuick(); paintStats(); paintIndex(now0);
  let n = 0;
  return { tick(now) { if (++n % 3 === 0) paintIndex(now); }, destroy() { offs.forEach((f) => f()); } };
}
