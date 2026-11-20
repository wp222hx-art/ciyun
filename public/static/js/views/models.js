// 模型图谱：公开目录中的全部模型，按"家族 → 精确版本 → 部署配置 → 服务规格 → 商务版本"分层（§05）
import * as market from '../core/market.js';
import { precisionLabel } from '../core/normalize.js';
import { $, $$, esc, fmtPx, fmtCtx, fmtInt, fmtIso, ago, debounce, REAL, tag } from '../ui.js';
import { $t } from '../i18n.js';

const prefs = { q: '', kind: 'all', brand: '', sort: 'created', desc: true, limit: 60, open: null };
const KIND = { model: $t("精确版本"), alias: $t("别名"), router: $t("路由") };
const KTABS = [['all', $t("全部")], ['open', $t("开放权重")], ['closed', $t("闭源 / 未公开")], ['alias', $t("别名与路由")], ['free', $t("免费")]];
const COLS = [['name', $t("模型"), 0], ['brand', $t("品牌"), 0], ['ctx', $t("上下文"), 1], ['in', $t("输入"), 1], ['out', $t("输出"), 1], ['basket', $t("固定篮子参考价"), 1], ['sup', $t("独立供应商"), 1], ['created', $t("收录日期"), 1]];
const day = (sec) => (sec ? new Date(sec * 1000).toISOString().slice(0, 10) : '—');
const isFree = (m) => m.usd.in === 0 && m.usd.out === 0;

export function mount(el) {
  const S = market.state;
  const brands = [...new Set(S.models.map((m) => m.brand))].sort();
  const counts = { model: 0, alias: 0, router: 0, open: 0, free: 0 };
  for (const m of S.models) { counts[m.kind]++; if (m.hf) counts.open++; if (isFree(m)) counts.free++; }

  el.innerHTML = `
  <div class="page-head"><h2>${$t("模型图谱")}</h2>
    <p>${$t("公开目录里能发现的全部模型，一个都没有筛掉。别名和路由单独标出，不进可比桶；同一模型的不同推理精度拆成不同的桶，不混成一个品种。")}</p></div>
  <div class="stats-bar">
    <span>${$t("收录模型")}<b>${S.models.length}</b></span><span>${$t("精确版本")}<b>${counts.model}</b></span><span>${$t("别名")}<b>${counts.alias}</b></span><span>${$t("路由")}<b>${counts.router}</b></span>
    <span>${$t("有公开权重仓库")}<b>${counts.open}</b></span><span>${$t("免费")}<b>${counts.free}</b></span><span>${$t("品牌")}<b>${brands.length}</b></span>
    <span>${REAL} ${$t("目录{0} {1}（{2}）", S.catalogLive ? $t("实时拉取") : $t("快照"), fmtIso(S.catalogAt), ago(S.catalogAt))}</span>
  </div>
  <section class="panel">
    <header>
      <div class="tabs" id="ktabs">${KTABS.map(([k, v]) => `<button data-kind="${k}">${v}</button>`).join('')}</div>
      <span class="sp"></span>
      <select class="input" id="brand" style="width:auto" aria-label="${$t("品牌")}"><option value="">${$t("全部品牌")}</option>${brands.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join('')}</select>
      <input class="input search" id="q" type="search" placeholder="${$t("搜索模型、ID、tokenizer…")}" value="${esc(prefs.q)}" aria-label="${$t("搜索")}">
    </header>
    <div class="table-wrap"><table class="tbl" id="tbl">
      <thead><tr>${COLS.map(([k, v, n]) => `<th class="sortable ${n ? 'num' : ''}" data-sort="${k}">${v}</th>`).join('')}<th>${$t("类型")}</th><th>tokenizer</th><th>${$t("模态")}</th></tr></thead>
      <tbody></tbody>
    </table></div>
    <button class="more" id="more" hidden>${$t("加载更多")}</button>
    <p class="pad mute small">${$t("费率单位：元 / 百万Token，原始币种为美元，按 USD/CNY {0} 换算，未含税。\"开放权重\"只表示目录登记了公开权重仓库，不等于符合开放源代码定义的许可；许可条款未核验。点击任意一行查看分层详情。", S.fx.rate.toFixed(4))}</p>
  </section>`;

  const tbody = $('#tbl tbody', el);
  $('#brand', el).value = prefs.brand;

  function list() {
    const q = prefs.q.trim().toLowerCase();
    const xs = S.models.filter((m) => {
      if (prefs.kind === 'open' && !(m.hf && m.kind === 'model')) return false;
      if (prefs.kind === 'closed' && (m.hf || m.kind !== 'model')) return false;
      if (prefs.kind === 'alias' && m.kind === 'model') return false;
      if (prefs.kind === 'free' && !isFree(m)) return false;
      if (prefs.brand && m.brand !== prefs.brand) return false;
      return !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || (m.tokenizer || '').toLowerCase().includes(q);
    });
    const val = {
      name: (m) => m.name.toLowerCase(), brand: (m) => m.brand, ctx: (m) => m.ctx ?? -1, in: (m) => m.cny?.in ?? -1, out: (m) => m.cny?.out ?? -1,
      basket: (m) => m.basketCny ?? -1, sup: (m) => m.suppliers || 0, created: (m) => m.created || 0,
    }[prefs.sort];
    const keyed = xs.map((m) => [val(m), m]);
    keyed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) * (prefs.desc ? -1 : 1));
    return keyed.map((k) => k[1]);
  }

  const rate = (v) => (v == null ? '—' : v < 0 ? $t("动态") : v === 0 ? $t("免费") : fmtPx(v));

  function detail(m) {
    const insts = S.instsByModel.get(m.id) || [];
    const eps = S.endpoints?.[m.id] || [];
    const precisions = [...new Set(eps.map((e) => e.q))];
    const layer = (title, body) => `<div><b>${title}</b><div class="mute small" style="margin-top:2px">${body}</div></div>`;
    return `<tr class="detail"><td colspan="${COLS.length + 3}"><div class="dl">
      ${layer($t("模型家族"), `${$t("品牌 {0} · 模态 {1} · 输入 {2} → 输出", esc(m.brand), esc(m.modality || $t("未披露")), esc(m.inMods.join($t("、")) || '—'))} ${esc(m.outMods.join($t("、")) || '—')}`)}
      ${layer($t("精确版本"), `${$t("目录 ID")} <span class="mono">${esc(m.id)}</span><br>${$t("规范标识")} <span class="mono">${esc(m.slug)}</span><br>${$t("权重仓库 {0} · tokenizer {1}", m.hf ? `<span class="mono">${esc(m.hf)}</span>` : $t("未登记"), esc(m.tokenizer || $t("未披露")))}<br>${tag('todo', $t("版本由供应商声明"))} ${$t("权重摘要未核验")}`)}
      ${layer($t("部署配置"), eps.length ? `${$t("{0} 个端点 · {1} 家供应商 · 精度", eps.length, new Set(eps.map((e) => e.p)).size)} ${precisions.map((q) => esc(precisionLabel(q))).join($t("、"))}` : (m.kind === 'model' ? $t("快照中没有可用端点") : $t("别名 / 路由不对应固定部署")))}
      ${layer($t("服务规格"), `${$t("上下文 {0} · 最大输出 {1}{2}", fmtCtx(m.ctx), fmtCtx(m.maxOut), m.expires ? ` ${$t("· 计划下线 {0}", esc(String(m.expires).slice(0, 10)))}` : '')}<br>${tag('todo', $t("待接入"))} ${$t("并发、时延档位、数据留存须由供应商授权提供")}`)}
      ${layer($t("商务版本"), `${$t("输入 {0} · 输出 {1} · 缓存读 {2} · 缓存写 {3}", rate(m.cny?.in), rate(m.cny?.out), rate(m.cny?.cr), rate(m.cny?.cw))}${m.tiered ? `<br>${$t("存在按上下文长度分档的阶梯价（此处显示基础档）")}` : ''}${m.extras.length ? `<br>${$t("另有独立计费项：{0}（不计入固定篮子）", m.extras.map(esc).join($t("、")))}` : ''}${m.variant !== 'std' ? `<br>${$t("计费变体：{0}", esc(m.variant === 'batch' ? $t("批处理") : m.variant === 'free' ? $t("免费额度") : m.variant))}` : ''}`)}
      ${layer($t("可比桶"), insts.length ? insts.map((i) => `<a href="#/trade/${encodeURIComponent(i.id)}">${$t("{0} 桶", esc(i.qLabel))}</a>${$t("（{0} 家{1}）", i.suppliers, i.meets ? ` ${$t("· 可仿真撮合")}` : ` ${$t("· 仅报价")}`)}`).join('　') : m.kind !== 'model' ? $t("别名与路由不入可比桶：其指向会变化，价格不可比") : $t("没有可计算固定篮子的端点（免费或分项缺失）"))}
    </div></td></tr>`;
  }

  function render() {
    const xs = list();
    $$('#ktabs button', el).forEach((b) => b.classList.toggle('on', b.dataset.kind === prefs.kind));
    $$('#tbl th[data-sort]', el).forEach((th) => {
      const on = th.dataset.sort === prefs.sort;
      th.classList.toggle('sorted', on);
      th.textContent = COLS.find((c) => c[0] === th.dataset.sort)[1] + (on ? (prefs.desc ? ' ↓' : ' ↑') : '');
    });
    const shown = xs.slice(0, prefs.limit);
    tbody.innerHTML = shown.length ? shown.map((m) => `<tr class="click" data-id="${esc(m.id)}">
      <td class="c-name"><b>${esc(m.name)}</b>${m.hf && m.kind === 'model' ? `<span class="chip sm open">${$t("开放权重")}</span>` : ''}${m.variant !== 'std' ? `<span class="chip sm">${esc(m.variant === 'batch' ? $t("批处理") : m.variant === 'free' ? $t("免费") : m.variant)}</span>` : ''}${m.fresh ? tag('real', $t("新收录")) : ''}<small class="mono">${esc(m.id)}</small></td>
      <td>${esc(m.brand)}</td><td class="num">${fmtCtx(m.ctx)}</td><td class="num">${rate(m.cny?.in)}</td><td class="num">${rate(m.cny?.out)}</td>
      <td class="num">${m.basketCny == null ? '—' : m.basketCny === 0 ? $t("免费") : `<b>${fmtPx(m.basketCny)}</b>`}</td>
      <td class="num">${m.suppliers || '—'}</td><td class="num">${day(m.created)}</td>
      <td>${m.kind === 'model' ? KIND.model : `<span class="mute">${KIND[m.kind]}</span>`}</td><td>${esc(m.tokenizer || '—')}</td><td class="small">${esc(m.modality || '—')}</td></tr>${prefs.open === m.id ? detail(m) : ''}`).join('')
      : `<tr><td colspan="${COLS.length + 3}" class="empty">${$t("没有符合条件的模型")}</td></tr>`;
    const more = $('#more', el);
    more.hidden = xs.length <= prefs.limit;
    more.textContent = $t("加载更多（已显示 {0} / {1}）", shown.length, fmtInt(xs.length));
  }

  $('#ktabs', el).addEventListener('click', (e) => { const b = e.target.closest('[data-kind]'); if (b) { prefs.kind = b.dataset.kind; prefs.limit = 60; render(); } });
  $('#tbl thead', el).addEventListener('click', (e) => {
    const th = e.target.closest('[data-sort]');
    if (!th) return;
    if (prefs.sort === th.dataset.sort) prefs.desc = !prefs.desc;
    else { prefs.sort = th.dataset.sort; prefs.desc = !['name', 'brand'].includes(th.dataset.sort); }
    render();
  });
  tbody.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr) { prefs.open = prefs.open === tr.dataset.id ? null : tr.dataset.id; render(); }
  });
  $('#brand', el).addEventListener('change', (e) => { prefs.brand = e.target.value; prefs.limit = 60; render(); });
  $('#q', el).addEventListener('input', debounce((e) => { prefs.q = e.target.value; prefs.limit = 60; render(); }));
  $('#more', el).addEventListener('click', () => { prefs.limit += 60; render(); });

  render();
  return {};
}
