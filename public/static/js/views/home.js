// 总览：拟议定位、产业价值链、三层业务、四种 Token、上手路径、尚未取得的关键事实（方案 V4.0 G01—G04、G23、G26）
import * as market from '../core/market.js';
import * as access from '../core/access.js';
import * as account from '../core/account.js';
import * as rights from '../core/rights.js';
import * as entitle from '../core/entitle.js';
import * as evidence from '../core/evidence.js';
import { $, esc, fmtInt, fmtPct, fmtUsd, dir, nowSec, REAL, SYN, EXAMPLE, CLOSED, tag } from '../ui.js';
import { $t } from '../i18n.js';
import { ui } from '../uistate.js';

const CHAIN = [
  [$t("资源"), $t("算力／模型服务"), $t("公开目录里的真实报价"), 'compute'],
  [$t("服务"), $t("可验证调用"), $t("分项计量、回执、账单勾稽"), 'procure'],
  [$t("作品"), $t("AI影视、内容与企业任务"), $t("有创作证据的作品与任务"), 'listing'],
  [$t("权利"), $t("合法授权与海外渠道"), $t("限定地域、语言、渠道、期限"), 'listing'],
  [$t("经营"), $t("真实销售／服务回款"), $t("外部到账凭证，不是链上转账"), 'royalty'],
  [$t("经营"), $t("经营与权利人分配"), $t("先清权、到账，再按合同分"), 'royalty'],
  [$t("资源"), $t("再投入"), $t("剩余算力权益受限转让"), 'entitle'],
];
const TOKENS = [
  [$t("技术词元"), $t("分词与调用计费单位"), $t("行情、采购台里的\"百万Token\""), $t("不因上链就变成可投资资产")],
  [$t("服务额度"), $t("对特定供应商的合同请求权"), $t("算力权益、交易页持仓"), $t("先消费；转让须合同允许并经供方同意")],
  [$t("链上凭证"), $t("某组记录或权利状态的技术表示"), $t("溯源存证的哈希与批次根"), $t("不定义版权、金融或支付性质")],
  [$t("金融代币"), $t("可能代表证券、收益权、支付等受监管权益"), $t("本环境不提供"), $t("未获准保持关闭，收入一律为零")],
];
const PENDING = [$t("拟议名称的正式登记"), $t("广州数据交易所相关品牌授权"), $t("澳门金融及支付准入意见"), $t("银行接受的具体资金路径"), $t("海外实际发行买家"), $t("版权及供方合同"), $t("合规合作伙伴"), $t("真实成交与续费")];
const PHASES = [
  [$t("0—30 天"), $t("名称、法域和银行过闸"), $t("核品牌及主体、业务及金融边界、银行可受理路径；关键意见不能取得时只开发研究原型。")],
  [$t("31—90 天"), $t("三个可收费样板"), $t("一笔影视／素材许可或出海服务；一笔模型／算力采购与真实任务交付；一份计量及证据治理订阅。")],
  [$t("3—12 个月"), $t("同类订单复制"), $t("把素材清单、版权许可、模型规格、计量映射、渠道对账及退出做成模板。")],
  [$t("12—36 个月"), $t("伙伴与受控 Web4 网络"), $t("接入更多发行、资源及专业伙伴；开放受预算和地域约束的 Agent 工作流。")],
];

export function mount(el) {
  const S = market.state;
  const now0 = nowSec();
  const ix = market.indices(now0);
  const quotes = S.insts.reduce((a, i) => a + i.quotes.length, 0);
  const tradable = S.insts.filter((i) => i.meets).length;

  el.innerHTML = `
  ${ui.state.welcomeOff ? '' : `<section class="welcome" id="welcome"><p><b>${$t("第一次来？")}</b>${$t("花一分钟认一遍界面，或者直接按角色看怎么用。")}</p>
    <div class="btn-row"><button class="btn sm primary" type="button" data-tour>${$t("开始新手导览")}</button><a class="btn sm" href="#/help/start">${$t("十分钟快速上手")}</a><a class="btn sm" href="#/help">${$t("帮助中心")}</a><button class="btn sm ghost" type="button" id="welcome-x">${$t("不再显示")}</button></div></section>`}
  <section class="hero">
    <p class="eyebrow">${$t("拟议名称 · 正式登记及相关品牌授权待确认 · 方案 V4.0")}</p>
    <h1>${$t("澳门词元中心：把可核实、可授权、可交付的 AI 供给，接进真实创收应用")}</h1>
    <p class="lead">${$t("不是把算力都发成币。这里把\"算力与模型服务 → AI 影视与企业任务 → 合法授权 → 真实回款 → 合同分配\"接成一条可以审查的产业链：价格可比、用量可核、交付可验。 本站是按方案搭出来的仿真环境，模型与报价是公开目录里的真实数据，成交、挂牌、许可和分账是合成或示例数据。")}</p>
    <div class="btn-row">
      <a class="btn primary" href="#/listing">${$t("看版权与服务挂牌")}</a>
      <a class="btn" href="#/market">${$t("看模型服务行情")}</a>
      <a class="btn" href="#/finance">${$t("看 36 个月财务模型")}</a>
      <button class="btn ghost" type="button" data-cmdk>${$t("搜索")} <kbd>Ctrl K</kbd></button>
    </div>
  </section>

  <div class="cards" id="kpi">
    <a class="card" href="#/models"><h4>${$t("公开目录模型")} ${REAL}</h4><p class="big">${fmtInt(S.models.length)}</p><p class="sub">${$t("{0} 条服务商报价", fmtInt(quotes))}</p></a>
    <a class="card" href="#/compute"><h4>${$t("算力中心")} ${REAL}</h4><p class="big">${S.centers.length}</p><p class="sub">${$t("{0} 个可比桶达到发布门槛", tradable)}</p></a>
    <a class="card" href="#/market"><h4>${$t("综合参考价格指数")} ${SYN}</h4><p class="big" id="k-idx">—</p><p class="sub" id="k-idx-sub"></p></a>
    <a class="card" href="#/listing"><h4>${$t("挂牌与许可")} ${EXAMPLE}</h4><p class="big" id="k-lst">—</p><p class="sub" id="k-lst-sub"></p></a>
    <a class="card" href="#/entitle"><h4>${$t("算力权益批次")} ${EXAMPLE}</h4><p class="big" id="k-ent">—</p><p class="sub" id="k-ent-sub"></p></a>
    <a class="card" href="#/evidence"><h4>${$t("本机存证记录")}</h4><p class="big" id="k-ev">—</p><p class="sub" id="k-ev-sub"></p></a>
  </div>

  <section class="panel mb">
    <header><h3>${$t("一条产业价值链")}</h3><span class="mute small">${$t("每一层有自己的单位和责任，不折算成一个万能 Token · 点击进入对应页面")}</span></header>
    <div class="chain">${CHAIN.map(([layer, name, note, to]) => `<a href="#/${to}"><small>${$t("{0}层", layer)}</small><b>${name}</b><span>${note}</span></a>`).join('')}</div>
  </section>

  <div class="layers">
    <article class="layer"><h3>${$t("产业交易")} ${tag('real', $t("可体验"))}</h3><p>${$t("AI 影视制作与出海、版权许可、算力及模型采购、治理软件。普通商业订单优先，逐类核经营、权利、银行、地域及数据。")}</p>
      <div class="links"><a href="#/listing">${$t("挂牌大厅")}</a><a href="#/procure">${$t("采购台")}</a><a href="#/market">${$t("行情")}</a><a href="#/bay">${$t("词元出海")}</a></div></article>
    <article class="layer l2"><h3>${$t("数字权利")} ${tag('syn', $t("机制演示"))}</h3><p>${$t("可验证许可、链上证据、批次核销、受限转让、合同分账。须合同可执行、供方同意、分类与安全审查通过；不默认公开流转。")}</p>
      <div class="links"><a href="#/entitle">${$t("算力权益")}</a><a href="#/royalty">${$t("版税分账")}</a><a href="#/evidence">${$t("溯源存证")}</a><a href="#/agent">${$t("受控Agent")}</a></div></article>
    <article class="layer l3"><h3>${$t("金融合作")} ${CLOSED}</h3><p>${$t("应收、设备、版权现金流融资及风险工具只做专项研究。须适格主体、对应产品与地域权限；未获准保持关闭，本环境不提供，财务模型里收入为零。")}</p>
      <div class="links"><a href="#/juris">${$t("看跨法域矩阵怎么拦")}</a><a href="#/method">${$t("边界说明")}</a></div></article>
  </div>

  <div class="split wide-l">
    <section class="panel">
      <header><h3>${$t("上手路径")}</h3><span class="mute small">${$t("按顺序走一遍，大约十分钟")}</span></header>
      <div class="quick" id="quick"></div>
    </section>
    <section class="panel">
      <header><h3>${$t("仍未取得的关键事实")}</h3>${tag('todo', $t("待确认"))}</header>
      <ul class="todo-list">${PENDING.map((x) => `<li>${x}</li>`).join('')}</ul>
      <p class="pad mute small" style="padding-top:0">${$t("方案完整不意味着这些条件已满足。本站不是已核准登记的机构网站，不是广州数据交易所澳门分支，未取得交易所或金融业务许可。")}</p>
    </section>
  </div>

  <section class="panel mb">
    <header><h3>${$t("四种 Token 绝不混用")}</h3><span class="mute small">${$t("名称相同不改变性质")}</span></header>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>${$t("类别")}</th><th>${$t("是什么")}</th><th>${$t("在本站哪里出现")}</th><th>${$t("边界")}</th></tr></thead><tbody>
      ${TOKENS.map(([a, b, c, d]) => `<tr><td><b>${a}</b></td><td class="wrap">${b}</td><td class="wrap">${c}</td><td class="wrap mute">${d}</td></tr>`).join('')}
    </tbody></table></div>
  </section>

  <section class="panel">
    <header><h3>${$t("分阶段建设")}</h3>${tag('syn', $t("拟议路线"))}<span class="mute small">${$t("先跑通三类产业订单；金融化不由达到某个规模自动触发")}</span></header>
    <div class="matrix5" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));padding:14px">
      ${PHASES.map(([when, name, what]) => `<div class="review-col"><small>${when}</small><h4>${name}</h4><p class="mute small" style="margin-top:4px">${what}</p></div>`).join('')}
    </div>
  </section>`;

  function paintQuick() {
    const m = access.st.member;
    const R = rights.db.state, E = entitle.db.state;
    const steps = [
      ['access', $t("取得入场资格"), m ? $t("已入场：{0}", access.ROLES[m.role].name) : $t("主体登记、场景登记、合规会审"), !!m],
      ['trade', $t("看行情并下一笔单"), $t("用研究记分体验撮合，不涉及资金"), account.acct.fills.length > 0],
      ['listing', $t("挂牌、询价、签一份许可"), $t("三道审核 → 锁定合同快照 → 外部到账 → 交付"), R.orders.some((o) => o.status === 'accepted')],
      ['entitle', $t("转让一笔算力权益"), $t("冻结 → 供方同意 → 受让确认，数量守恒"), E.transfers.some((t) => t.status === 'done')],
      ['royalty', $t("算一次版税瀑布"), $t("10,000 美元毛收入怎么分到每一方"), access.st.ledger.some((e) => e.type === 'royalty.allocate')],
      ['evidence', $t("封一个证据批次并验证"), $t("Merkle 根 + 包含性证明"), evidence.db.state.batches.length > 0],
    ];
    $('#quick', el).innerHTML = steps.map(([to, name, note, done], i) => `<a href="#/${to}" class="${done ? 'done' : ''}"><i>${done ? '✓' : i + 1}</i><b>${name}</b><span>${esc(note)}</span></a>`).join('');
  }

  function paintStats() {
    const st = rights.stats(rights.db.state);
    $('#k-lst', el).textContent = $t("{0} 个挂牌中", st.listed);
    $('#k-lst-sub', el).textContent = $t("已成立许可 {0} 笔 · 合同对价 {1}", st.licences, fmtUsd(st.contractValue, 0));
    const E = entitle.db.state;
    $('#k-ent', el).textContent = $t("{0} 个", E.batches.length);
    $('#k-ent-sub', el).textContent = E.batches.length ? $t("全部数量守恒：{0}", E.batches.every((b) => entitle.invariant(E, b.id).ok) ? $t("是") : $t("否")) : $t("尚未登记，进去可重放 G20 算例");
    const L = access.st.ledger;
    $('#k-ev', el).textContent = $t("{0} 条", L.length);
    $('#k-ev-sub', el).textContent = $t("已封存 {0} 个批次 · 仅存本机", evidence.db.state.batches.length);
  }

  function paintIndex(now) {
    const cur = ix.all.now(now), prev = ix.all.series.at(-1)?.v;
    const chg = cur != null && prev ? cur / prev - 1 : null;
    const big = $('#k-idx', el);
    big.textContent = cur == null ? '—' : cur.toFixed(2);
    big.className = `big ${dir(chg)}`;
    $('#k-idx-sub', el).innerHTML = `<span class="num ${dir(chg)}">${fmtPct(chg)}</span> ${$t("较上一发布日")}`;
  }

  el.addEventListener('click', (e) => {
    if (!e.target.closest('#welcome-x')) return;
    ui.state.welcomeOff = true; ui.commit();
    $('#welcome', el)?.remove();
  });
  const offs = [access.onChange(() => { paintQuick(); paintStats(); }), rights.db.onChange(paintStats), entitle.db.onChange(paintStats)];
  paintQuick(); paintStats(); paintIndex(now0);
  let n = 0;
  return { tick(now) { if (++n % 3 === 0) paintIndex(now); }, destroy() { offs.forEach((f) => f()); } };
}
