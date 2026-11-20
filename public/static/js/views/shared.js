// 交易终端与资产页共用的表格
import * as sim from '../core/sim.js';
import * as market from '../core/market.js';
import * as account from '../core/account.js';
import { esc, fmtPx, fmtNum, fmtPct, fmtDateTime, dir, toast, nowSec } from '../ui.js';
import { $t } from '../i18n.js';

export const STATUS = { open: $t("挂单中"), filled: $t("全部成交"), partial: $t("部分成交"), canceled: $t("已撤销"), expired: $t("已过期") };
const SIDE = { buy: [$t("买入"), 'up'], sell: [$t("卖出"), 'down'] };

export function instLink(id) {
  const i = market.state.instById.get(id);
  if (!i) return `<span class="mute">${$t("{0}（已下线）", esc(id))}</span>`;
  return `<a href="#/trade/${encodeURIComponent(id)}">${esc(i.name)}</a><span class="chip sm">${esc(i.qLabel)}</span>`;
}
const side = (s) => `<span class="${SIDE[s][1]}">${SIDE[s][0]}</span>`;
const empty = (text) => `<p class="empty">${text}</p>`;

export function ordersTable(list) {
  if (!list.length) return empty($t("暂无委托"));
  return `<div class="table-wrap"><table class="tbl dense"><thead><tr><th>${$t("时间")}</th><th>${$t("品种")}</th><th>${$t("方向")}</th><th>${$t("类型")}</th><th class="num">${$t("委托价")}</th><th class="num">${$t("数量")}</th><th class="num">${$t("已成交")}</th><th class="num">${$t("成交均价")}</th><th>${$t("状态")}</th><th></th></tr></thead><tbody>${list.map((o) => `<tr>
    <td class="num">${fmtDateTime(o.t).slice(5)}</td><td>${instLink(o.instId)}</td><td>${side(o.side)}</td><td>${o.type === 'limit' ? $t("限价") : $t("市价")}</td>
    <td class="num">${o.price == null ? $t("市价") : fmtPx(o.price)}</td><td class="num">${o.qty}</td><td class="num">${o.filled}</td><td class="num">${o.filled ? fmtPx(o.avg) : '—'}</td>
    <td title="${esc(o.note || '')}">${STATUS[o.status] || o.status}${o.note ? ' <span class="mute small">ⓘ</span>' : ''}</td>
    <td>${o.status === 'open' ? `<button class="btn sm danger" data-cancel="${o.id}">${$t("撤单")}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}

export function positionsTable(now, withConsume = false) {
  const ids = Object.keys(account.acct.positions);
  if (!ids.length) return empty($t("暂无持仓。在交易页买入后，这里显示持有的服务额度。"));
  return `<div class="table-wrap"><table class="tbl dense"><thead><tr><th>${$t("品种")}</th><th class="num">${$t("持有（百万Token）")}</th><th class="num">${$t("可用")}</th><th class="num">${$t("成本均价")}</th><th class="num">${$t("最新价")}</th><th class="num">${$t("市值")}</th><th class="num">${$t("浮动盈亏")}</th>${withConsume ? `<th>${$t("模拟履约")}</th>` : ''}</tr></thead><tbody>${ids.map((id) => {
    const p = account.acct.positions[id];
    const inst = market.state.instById.get(id);
    const last = inst ? sim.live(inst, now).last : null;
    const avg = p.cost / p.qty;
    const mv = last == null ? p.cost : last * p.qty;
    const pnl = mv - p.cost;
    return `<tr><td>${instLink(id)}</td><td class="num">${p.qty}</td><td class="num">${account.availQty(id)}</td><td class="num">${fmtPx(avg)}</td><td class="num">${fmtPx(last)}</td>
      <td class="num">${fmtNum(mv)}</td><td class="num ${dir(pnl)}">${$t("{0}（{1}）", fmtNum(pnl), fmtPct(pnl / p.cost))}</td>
      ${withConsume ? `<td><input class="input mono" style="width:70px;padding:3px 6px" type="number" min="1" step="1" value="1" aria-label="${$t("消耗数量")}"> <button class="btn sm" data-consume="${esc(id)}">${$t("消耗额度")}</button></td>` : ''}</tr>`;
  }).join('')}</tbody></table></div>`;
}

export function fillsTable(list) {
  if (!list.length) return empty($t("暂无成交记录"));
  return `<div class="table-wrap"><table class="tbl dense"><thead><tr><th>${$t("时间")}</th><th>${$t("品种")}</th><th>${$t("方向")}</th><th class="num">${$t("成交价")}</th><th class="num">${$t("数量")}</th><th class="num">${$t("金额")}</th><th class="num">${$t("手续费")}</th><th class="num">${$t("已实现盈亏")}</th></tr></thead><tbody>${list.map((f) => `<tr>
    <td class="num">${fmtDateTime(f.t).slice(5)}</td><td>${instLink(f.instId)}</td><td>${side(f.side)}</td><td class="num">${fmtPx(f.p)}</td><td class="num">${f.q}</td>
    <td class="num">${fmtNum(f.amt)}</td><td class="num">${fmtNum(f.fee, 4)}</td><td class="num ${f.pnl == null ? '' : dir(f.pnl)}">${f.pnl == null ? '—' : fmtNum(f.pnl)}</td></tr>`).join('')}</tbody></table></div>`;
}

/** 撤单 / 消耗额度：事件委托，表格重绘不影响点击 */
export function bindActions(root) {
  root.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cancel]');
    if (c) {
      const r = account.cancelOrder(Number(c.dataset.cancel));
      toast(r.ok ? $t("已撤单，冻结的研究记分已释放") : r.error, r.ok ? 'ok' : 'error');
      return;
    }
    const u = e.target.closest('[data-consume]');
    if (u) {
      const qty = u.parentElement.querySelector('input').value;
      const r = account.consume(u.dataset.consume, qty, nowSec());
      toast(r.ok ? $t("已模拟履约 {0} 百万Token，按成本 {1} 计入已消耗", Math.floor(qty), fmtNum(r.cost)) : r.error, r.ok ? 'ok' : 'error');
    }
  });
}
