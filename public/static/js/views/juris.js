// 跨法域：主体所在地 × 供应所在地 × 客户所在地 × 使用地 × 资金／数据地（方案 V4.0 G07、G16、G17）
// 输出的是"必须核查什么、不得推断什么"的清单，不是法律意见；本页永远不会给出"合规通过"。
import * as juris from '../core/juris.js';
import { $, esc, opt, tag, PROPOSED, CLOSED } from '../ui.js';
import { $t } from '../i18n.js';

const f = { product: 'content', entity: 'MO', supply: 'MO', customer: 'PT', use: 'PT', funds: 'MO', payment: 'bank', personal: false, collective: false, hops: false };
const PRESETS = [
  [$t("AI 短片授权给葡语发行方"), { product: 'content', entity: 'MO', supply: 'CN', customer: 'PT', use: 'PT', funds: 'MO', payment: 'bank', personal: false, collective: false, hops: false }],
  [$t("内地模型服务卖给美国客户"), { product: 'service', entity: 'MO', supply: 'CN', customer: 'US', use: 'US', funds: 'MO', payment: 'bank', personal: true, collective: false, hops: true }],
  [$t("澳门企业采购境外推理 API"), { product: 'service', entity: 'MO', supply: 'US', customer: 'MO', use: 'MO', funds: 'MO', payment: 'bank', personal: true, collective: false, hops: false }],
  [$t("用稳定币结算的内容许可"), { product: 'content', entity: 'MO', supply: 'MO', customer: 'OTHER', use: 'OTHER', funds: 'OTHER', payment: 'stable', personal: false, collective: false, hops: false }],
  [$t("版权收益份额卖给香港投资者"), { product: 'financial', entity: 'MO', supply: 'MO', customer: 'HK', use: 'HK', funds: 'HK', payment: 'bank', personal: false, collective: false, hops: false }],
];
const SOURCES = [
  ['M1', $t("澳门第13/2023号法律《金融体系法律制度》"), 'https://bo.dsaj.gov.mo/bo/i/2023/33/lei13_cn.asp', $t("金融业务与广告权限边界")],
  ['M2', $t("澳门金管局：虚拟货币不属法定货币（2022-01-06）"), 'https://www.amcm.gov.mo/zh-hant/news-notice/statement/detail/20220106/501', $t("银行、支付及未许可金融服务约束")],
  ['M3', $t("美国版权局：AI 报告第二部分发布说明（2025-01-29）"), 'https://www.copyright.gov/newsnet/2025/1060.html', $t("人类表达贡献及提示词边界")],
  ['M4', $t("C2PA 与 Content Credentials 官方说明"), 'https://spec.c2pa.org/specifications/specifications/2.4/explainer/Explainer.html', $t("签名来源、完整性及局限")],
  ['M5', $t("香港 SFC：虚拟资产交易平台名单"), 'https://www.sfc.hk/en/Welcome-to-the-Fintech-Contact-Point/Virtual-assets/Virtual-asset-trading-platforms-operators/Lists-of-virtual-asset-trading-platforms', $t("区分持牌、申请及其他状态")],
  ['M6', $t("澳门经科局知识产权 FAQ：版权及集体管理"), 'https://www.dsedt.gov.mo/zh_CN/web/public/pg_ip_faq?_refresh=true', $t("一般作品无需注册、集体管理登记边界")],
  ['M7', $t("FATF：Virtual Assets 主题页"), 'https://www.fatf-gafi.org/en/topics/virtual-assets.html', $t("风险导向监管、身份及旅行规则")],
  ['M8', $t("澳门政府：向个人资料保护局申请许可"), 'https://www.gov.mo/zh-hans/services/ps-2039/', $t("特定处理和跨境资料转移许可")],
  ['M9', $t("香港 SFC 关于代币化证券活动通函（23EC52）"), 'https://apps.sfc.hk/edistributionWeb/api/circular/list-content?lang=EN&refNo=23EC52', $t("证券性质不因技术包装消失")],
];
const HARD = [$t("明确可执行权利及破产／执行分析"), $t("真实资金需求及风险收益"), $t("目标法域及澳门关联活动法律意见"), $t("适格合作方与产品权限"), $t("有效投资者、托管及反洗钱安排"), $t("独立审查和必要许可")];

export function mount(el) {
  el.innerHTML = `
  <div class="page-head"><h2>${$t("跨法域矩阵")} ${PROPOSED}</h2>
    <p>${$t("一地上线不等于全球通行。一笔业务上架前，把主体、供应、客户、使用、资金与数据五个所在地摆在一起看：哪些事必须先核查，哪些结论不能想当然。这里给出的是核查清单，不是法律意见——它只会告诉你\"还要查什么\"和\"这条路现在是关着的\"，不会告诉你\"可以做了\"。")}</p></div>
  <section class="panel mb">
    <header><h3>${$t("选一个业务场景")}</h3><span class="sp"></span><div class="scn">${PRESETS.map(([name], i) => `<button class="btn sm" type="button" data-preset="${i}">${name}</button>`).join('')}</div></header>
    <form id="jf" class="pad" novalidate>
      <div class="form-grid">
        <label class="field"><span>${$t("产品")}</span><select class="input" name="product">${Object.entries(juris.PRODUCTS).map(([k, v]) => opt(k, $t("{0}（{1}）", v.name, v.layer), f.product)).join('')}</select></label>
        <label class="field"><span>${$t("收付路径")}</span><select class="input" name="payment">${Object.entries(juris.PAYMENTS).map(([k, v]) => opt(k, v, f.payment)).join('')}</select></label>
      </div>
      <div class="matrix5">${juris.DIMS.map(([k, label]) => `<label class="field"><span>${label}</span><select class="input" name="${k}">${Object.entries(juris.PLACES).map(([p, n]) => opt(p, n, f[k])).join('')}</select></label>`).join('')}</div>
      <div class="mat">
        <label class="inline"><input type="checkbox" name="personal"> ${$t("涉及个人资料")}</label>
        <label class="inline"><input type="checkbox" name="collective"> ${$t("集中管理并收取分配使用费")}</label>
        <label class="inline"><input type="checkbox" name="hops"> ${$t("多跳路由（经其他供方转接）")}</label>
      </div>
    </form>
  </section>
  <div id="result"></div>
  <div class="split">
    <section class="panel">
      <header><h3>${$t("金融化：保留方向，独立结构、独立获准")}</h3>${CLOSED}</header>
      <div class="pad">
        <p class="mute small" style="margin-bottom:8px">${$t("公众资金认购版权／算力收益份额、代币化证券、基金、质押借贷、做市、保证金、杠杆、AMM 收益池、永续及期权，都不直接进入首期。启动前要有六项硬证据，缺一项就保持关闭：")}</p>
        <ul class="todo-list" style="padding:0;columns:1">${HARD.map((h) => `<li>${h}</li>`).join('')}</ul>
        <p class="hint">${$t("不募集、不开放交易，也不计入估值基准。本版金融产品收入一律为零，不依赖其融资维持试点。")}</p>
      </div>
    </section>
    <section class="panel">
      <header><h3>${$t("方案核读的公开资料")}</h3><span class="mute small">${$t("V4.0 列明 · 核读截至 2026-11-19")}</span></header>
      <div class="table-wrap"><table class="tbl dense"><tbody>
      ${SOURCES.map(([id, name, url, use]) => `<tr><td class="mono">${id}</td><td class="wrap"><a href="${url}" target="_blank" rel="noopener noreferrer">${esc(name)} ↗</a><div class="small mute">${esc(use)}</div></td></tr>`).join('')}
      </tbody></table></div>
      <p class="pad mute small">${$t("这九份资料由方案 V4.0 的作者核读并注明范围；本站只转列出处与用途，没有另行核读原文，也不代表已完成任何法域的法律尽调。投产前必须由专业人士更新。")}</p>
    </section>
  </div>`;

  const form = $('#jf', el);
  function sync() {
    for (const [k, v] of Object.entries(f)) { const c = form.elements[k]; if (!c) continue; if (c.type === 'checkbox') c.checked = v; else c.value = v; }
  }
  function paint() {
    const r = juris.assess(f);
    const closed = r.verdict === 'closed';
    $('#result', el).innerHTML = `
    <div class="callout ${closed ? 'bad' : 'warn'}"><b>${closed ? $t("这条路径目前关闭") : $t("有条件：完成下列核查前不能上架")}</b>　${closed ? r.blocks.map(esc).join($t("；")) : $t("涉及 {0} 个不同法域，适用 {1} 组核查{2}。", r.distinct, r.rows.length, r.paths.length ? $t("和 {0} 条跨境路径要求", r.paths.length) : '')}
      <div class="small" style="margin-top:4px">${$t("产品：{0} · {1} · {2}", esc(juris.PRODUCTS[f.product].name), juris.DIMS.map(([k, label]) => `${label} ${juris.PLACES[f[k]]}`).join(' · '), juris.PAYMENTS[f.payment])}</div></div>
    <section class="panel mb">
      <header><h3>${$t("必须核查与不得推断")}</h3><span class="mute small">${$t("方案 V4.0 G16 原文")}</span></header>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>${$t("场景")}</th><th>${$t("本中心必须核查")}</th><th>${$t("不得作出的推断")}</th></tr></thead><tbody>
      ${r.rows.map((x) => `<tr><td><b>${x.scene}</b></td><td class="wrap">${x.check}</td><td class="wrap up">✗ ${x.never}</td></tr>`).join('')}
      </tbody></table></div>
    </section>
    ${r.paths.length || r.extras.length ? `<section class="panel mb"><header><h3>${$t("这条路径另外要注意")}</h3></header><ul class="checks pad" style="margin:0">
      ${r.paths.map((p) => `<li class="no">${esc(p)}</li>`).join('')}${r.extras.map((p) => `<li class="no">${esc(p)}</li>`).join('')}
      </ul><p class="pad mute small" style="padding-top:0">${$t("\"✗\"表示尚未完成、需要去办，不是已经判定违规。不能假定经澳门转接即不构成原产地的跨境活动；供方拒绝某市场或无法核实许可时，不绕开限制替客户购买。")}</p></section>` : ''}`;
  }

  form.addEventListener('change', () => {
    for (const k of Object.keys(f)) { const c = form.elements[k]; if (c) f[k] = c.type === 'checkbox' ? c.checked : c.value; }
    paint();
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    Object.assign(f, PRESETS[Number(b.dataset.preset)][1]);
    sync(); paint();
  });
  sync(); paint();
  return {};
}
