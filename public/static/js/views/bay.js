// 词元出海：三种产品形态（G07）、出海看板（真实）、国产模型指数（合成）、广东公开背景（公开事实）
import * as market from '../core/market.js';
import { $, esc, fmtPx, fmtPct, fmtDay, dir, nowSec, REAL, SYN, COLOR, tag } from '../ui.js';
import { makeChart, addLine } from '../chart.js';
import { TIMELINE, srcLink } from '../facts.js';
import { $t } from '../i18n.js';

const IDX_FMT = { type: 'price', precision: 2, minMove: 0.01 };
const DONE = tag('real', $t("已做")), PART = tag('syn', $t("部分")), TODO = tag('todo', $t("未做"));

function goGlobal(S) {
  const rows = [], provs = new Set(), regions = new Map();
  let total = 0, unknown = 0;
  for (const inst of S.insts) {
    if (!market.CN_BRANDS.has(inst.brand) || !inst.main || inst.variant !== 'std') continue;
    total++;
    const home = [], abroad = [];
    for (const q of inst.quotes) {
      const hq = S.providerByName.get(q.p)?.hq;
      if (!hq) { unknown++; continue; }
      (hq === 'CN' ? home : abroad).push({ q, hq });
    }
    if (!abroad.length) continue;
    for (const a of abroad) { provs.add(a.q.p); regions.set(a.hq, (regions.get(a.hq) || 0) + 1); }
    const homeMin = home.length ? Math.min(...home.map((x) => x.q.basket)) : null;
    const abroadMin = Math.min(...abroad.map((x) => x.q.basket));
    rows.push({ inst, home: home.length, abroad: abroad.length, homeMin, abroadMin, spread: homeMin ? abroadMin / homeMin - 1 : null, regs: [...new Set(abroad.map((x) => x.hq))] });
  }
  rows.sort((a, b) => b.abroad - a.abroad);
  return { rows, total, unknown, provs: provs.size, regions: [...regions.entries()].sort((a, b) => b[1] - a[1]) };
}

export function mount(el) {
  const S = market.state;
  const now0 = nowSec();
  const ix = market.indices(now0);
  const G = goGlobal(S);
  const peak = Math.max(1, ...G.regions.map((r) => r[1]));

  el.innerHTML = `
  <div class="page-head"><h2>${$t("词元出海")}</h2>
    <p>${$t("词元出海，交易的是跨境模型服务，不是搬运一枚币。美元报价只是合同计价，技术 Token 不挂钩任何币值。这一页用公开目录里的真实数据直接看：国产模型正被哪些境外服务商部署、卖多少钱。")}</p></div>

  <section class="panel" style="margin-bottom:12px">
    <header><h3>${$t("三种产品形态")}</h3><span class="mute small">${$t("方案 V4.0 G07")}</span><span class="sp"></span><a class="btn sm" href="#/juris">${$t("看跨境路径要核查什么")}</a></header>
    <div class="arch" style="padding:12px 14px">
      <a href="#/procure"><small>${$t("形态一")}</small><b>${$t("境外企业采购模型推理 API")}</b><p>${$t("列明模型版本、tokenizer、分项计量、税币种、地域、限流与可用性。")}</p></a>
      <a href="#/listing"><small>${$t("形态二")}</small><b>${$t("制作方按任务采购生成能力")}</b><p>${$t("文生图、音频或视频生成，按合格任务与实际交付付费。")}</p></a>
      <a href="#/evidence"><small>${$t("形态三")}</small><b>${$t("成本、质量与证据治理软件")}</b><p>${$t("境外客户采购的是可核算的成本和可验证的记录。")}</p></a>
    </div>
    <p class="pad mute small" style="padding-top:0">${$t("提供方可为境内或境外主体，但来源、商用与转供条款、经营及数据路径须逐一核查。\"全球算力\"是合作愿景，不包括规避芯片、云访问、制裁或地域限制；不做无限额度、永续兑换或收益保底。")}</p>
  </section>

  <div class="cards">
    <div class="card"><h4>${$t("国产模型主桶")}</h4><p class="big">${G.total}</p><p class="sub">${$t("{0} 个国产品牌，按品牌人工标注", market.CN_BRANDS.size)}</p></div>
    <div class="card"><h4>${$t("已被境外服务商部署")}</h4><p class="big">${G.rows.length}</p><p class="sub">${$t("占 {0}", fmtPct(G.rows.length / Math.max(1, G.total), 0).replace('+', ''))}</p></div>
    <div class="card"><h4>${$t("境外服务商")}</h4><p class="big">${G.provs}</p><p class="sub">${$t("总部不在中国、在售国产模型")}</p></div>
    <div class="card"><h4>${$t("落地国家 / 地区")}</h4><p class="big">${G.regions.length}</p><p class="sub">${$t("按服务商总部所在地")}</p></div>
    <div class="card"><h4>${$t("国产模型参考价格指数")}</h4><p class="big" id="cn-now">—</p><p class="sub" id="cn-sub"></p></div>
  </div>

  <div class="grid-2">
    <section class="panel">
      <header><h3>${$t("词元出海看板")}</h3>${REAL}<span class="sp"></span><span class="mute small">${$t("共 {0} 个，显示境外服务商最多的 25 个", G.rows.length)}</span></header>
      <div class="table-wrap"><table class="tbl dense"><thead><tr><th>${$t("模型 / 桶")}</th><th>${$t("品牌")}</th><th class="num">${$t("境内服务商最低")}</th><th class="num">${$t("境外服务商")}</th><th class="num">${$t("境外最低")}</th><th class="num">${$t("境外较境内")}</th><th>${$t("落地")}</th></tr></thead><tbody>
      ${G.rows.slice(0, 25).map((r) => `<tr class="click" data-inst="${esc(r.inst.id)}"><td>${esc(r.inst.name)}<span class="chip sm">${esc(r.inst.qLabel)}</span></td><td>${esc(r.inst.brand)}</td>
        <td class="num">${r.homeMin == null ? `<span class="mute">${$t("无境内报价")}</span>` : fmtPx(r.homeMin)}</td><td class="num">${$t("{0} 家", r.abroad)}</td><td class="num">${fmtPx(r.abroadMin)}</td>
        <td class="num ${dir(r.spread)}">${r.spread == null ? '—' : fmtPct(r.spread, 0)}</td><td class="small">${r.regs.map((c) => `${market.flagOf(c)} ${esc(market.regionName(c))}`).join(' ')}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="pad mute small">${$t("价格单位：元 / 百万Token（固定篮子）。\"境内 / 境外\"按服务商总部所在地划分；{0} 条报价的服务商没有披露总部，没有计入。这张表说明的是国产模型在境外被部署并公开报价，不等于经交易所出海的成交量——后者需要平台自己的计量数据。", G.unknown)}</p>
    </section>
    <section class="panel">
      <header><h3>${$t("落地地区分布")}</h3>${REAL}</header>
      <div class="pad">${G.regions.map(([c, n]) => `<div class="kv"><span>${market.flagOf(c)} ${esc(market.regionName(c))}</span><b>${$t("{0} 条报价", n)}</b></div><div class="range" style="margin:2px 0 8px"><i style="left:0;width:${((n / peak) * 100).toFixed(1)}%;background:${COLOR.accent}"></i></div>`).join('')}</div>
      <header style="border-top:1px solid var(--line)"><h3>${$t("国产模型参考价格指数")}</h3>${SYN}</header>
      <div class="chart" id="cn-chart" style="height:210px"></div>
      <p class="pad mute small">${$t("紫线为国产模型（{0} 个桶），蓝线为全市场综合。基期 {1} = 100，输入是仿真成交，未获任何官方指数发布或冠名授权。", ix.cn.members, fmtDay(ix.base))}</p>
    </section>
  </div>

  <section class="panel" style="margin-bottom:12px">
    <header><h3>${$t("背景对照：广东\"湾数·元启\"公开宣布的五大能力")}</h3><span class="mute small">${$t("那是广东的平台，不是本中心")}</span><span class="sp"></span>${srcLink('gz')}</header>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>${$t("公开宣布的能力")}</th><th>${$t("本仿真里的对应")}</th><th>${$t("程度")}</th></tr></thead><tbody>
      <tr><td><b>${$t("可信流通")}</b></td><td style="white-space:normal"><a href="#/access">${$t("入场与审批")}</a>${$t("：场景登记、合规会审、上架预检、存证链。流程是我们的设想，不是交易所的实际规则。")}</td><td>${PART}</td></tr>
      <tr><td><b>${$t("可信计量")}</b></td><td style="white-space:normal">${$t("固定篮子归一、分项计量、发布门槛、")}<a href="#/procure">${$t("采购合同")}</a>${$t("的履约账单与签约报价勾稽。计量规则已实现，计量数据是仿真的。")}</td><td>${PART}</td></tr>
      <tr><td><b>${$t("词元出海")}</b></td><td style="white-space:normal">${$t("本页的出海看板和国产模型指数。看板用真实公开报价；没有经平台出海的交易数据。")}</td><td>${PART}</td></tr>
      <tr><td><b>${$t("综合公共服务")}</b></td><td style="white-space:normal"><a href="#/models">${$t("模型图谱")}</a>${$t("、")}<a href="#/compute">${$t("算力中心")}</a>${$t("、")}<a href="#/daily">${$t("每日波动")}</a>${$t("、")}<a href="#/method">${$t("方法与边界")}</a>${$t("。")}</td><td>${DONE}</td></tr>
      <tr><td><b>${$t("惠企政策")}</b></td><td style="white-space:normal">${$t("没有做。我们只读到两份政策文件的名称和总体目标（见下方时间线），补贴对象、标准和申报方式没有拿到原文，不编。")}</td><td>${TODO}</td></tr>
    </tbody></table></div>
  </section>

  <section class="panel">
    <header><h3>${$t("广东数据要素与词元经济：公开时间线")}</h3><span class="mute small">${$t("每一条都读过原文")}</span></header>
    <div class="table-wrap"><table class="tbl"><tbody>
      ${TIMELINE.map(([when, what, src]) => `<tr><td class="num" style="vertical-align:top"><b>${when}</b></td><td style="white-space:normal">${esc(what)}</td><td class="small" style="vertical-align:top">${srcLink(src)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="pad mute small">${$t("以上是公开报道的事实，只说明广东的既有布局，属于背景资料。本仿真没有接入\"湾数·元启\"，没有使用广州数据交易所的品牌、接口或数据，不代表其官方意见；澳门词元中心（拟议）也不是其分支。")}</p>
  </section>`;

  const chart = makeChart($('#cn-chart', el));
  const lines = [['cn', $t("国产"), '#c26bff'], ['all', $t("综合"), COLOR.accent]].map(([k, title, color]) => {
    const s = addLine(chart, color, IDX_FMT, { title, lineWidth: 2, lastValueVisible: true });
    s.setData(ix[k].series.map((p) => ({ time: fmtDay(p.d), value: p.v })));
    return { k, s };
  });
  chart.timeScale().fitContent();

  function paint(now) {
    const today = fmtDay(Math.floor((now + 8 * 3600) / 86400));
    for (const { k, s } of lines) { const v = ix[k].now(now); if (v != null) s.update({ time: today, value: v }); }
    const cur = ix.cn.now(now), prev = ix.cn.series.at(-1)?.v;
    const chg = cur != null && prev ? cur / prev - 1 : null;
    const big = $('#cn-now', el);
    big.textContent = cur == null ? '—' : cur.toFixed(2);
    big.className = `big ${dir(chg)}`;
    $('#cn-sub', el).innerHTML = `<span class="num ${dir(chg)}">${fmtPct(chg)}</span> ${$t("较上一发布日 · 合成")}`;
  }
  el.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const i = e.target.closest('[data-inst]');
    if (i) location.hash = `#/trade/${encodeURIComponent(i.dataset.inst)}`;
  });
  paint(now0);
  let n = 0;
  return { tick(now) { if (++n % 5 === 0) paint(now); }, destroy() { chart.remove(); } };
}
