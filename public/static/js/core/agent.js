// 受控 Agent（G18）：授权凭证 + 分级审批。裁决只看结构化的凭证与请求字段，
// 任务上下文里的任何文字（网页、素材、提示词）都不参与裁决，只取摘要留痕。
import { sha256 } from './sha256.js';
import { persisted } from './store.js';

export const POLICY_VERSION = 'agent-policy-sim-0.1';
export const ROLES = {
  buyer: { name: '采购 Agent', does: '读取预算、地域和允许模型，筛选合格服务并提出订单' },
  maker: { name: '制作 Agent', does: '在授权素材与许可模型内生成和编辑' },
  rights: { name: '权利 Agent', does: '检查权利范围冲突及到期' },
  recon: { name: '核对 Agent', does: '校验用量、交付、渠道账单' },
  alloc: { name: '分配 Agent', does: '生成需批准或受限自动执行的分配指令' },
};
export const TOOLS = { catalog: '读取公开目录与行情', procure: '发起模型／算力调用', rights: '读取权利登记', listing: '挂牌与许可操作', transfer: '服务权益转让', payment: '付款指令', policy: '策略与权限配置' };
// tier 0 只读；1 预算内可事前授权自动执行；2 须更高一级人工审批；3 关闭
export const ACTIONS = {
  read: { name: '只读分析', tier: 0, tool: 'catalog' },
  call: { name: '预算内模型调用／任务', tier: 1, tool: 'procure' },
  new_supplier: { name: '新增供方', tier: 2, tool: 'procure' },
  exclusive: { name: '版权排他授权', tier: 2, tool: 'listing', sign: true },
  transfer: { name: '服务权益转让', tier: 2, tool: 'transfer', sign: true },
  fiat: { name: '法币付款', tier: 2, tool: 'payment', sign: true },
  upgrade: { name: '合约或自身权限升级', tier: 2, tool: 'policy' },
  finance: { name: '金融投资、借贷', tier: 3, tool: 'payment' },
};

const blank = () => ({ v: 1, creds: [], audit: [], seq: 1 });
export const db = persisted('zjt.agent.v1', blank);
const fail = (error) => ({ ok: false, error });

export function issue(S, f, now) {
  if (!ROLES[f.role]) return fail('请选择 Agent 角色');
  if (!String(f.tenant || '').trim()) return fail('凭证必须归属一个可追责的企业（租户）');
  if (!String(f.operator || '').trim()) return fail('凭证必须写明负责的操作者');
  const tools = (f.tools || []).filter((t) => TOOLS[t]);
  if (!tools.length) return fail('至少授予一个工具');
  if (!(f.amountCap >= 0) || !(f.days > 0)) return fail('金额上限不能为负，有效期必须大于 0 天');
  if (!(f.territories || []).length) return fail('至少限定一个地域');
  const c = { id: `SIM-AG-${String(S.seq++).padStart(4, '0')}`, role: f.role, tenant: f.tenant.trim(), operator: f.operator.trim(), tools,
    amountCap: Number(f.amountCap), usageCap: Number(f.usageCap) || 0, spent: 0, used: 0, territories: [...f.territories], suppliers: [...(f.suppliers || [])],
    canSign: !!f.canSign, issuedAt: now, expiresAt: now + f.days * 86400, revoked: false, policy: POLICY_VERSION };
  S.creds.unshift(c);
  return { ok: true, cred: c };
}

/** 裁决：allow 自动执行 / approve 生成提案等人工审批 / deny 拒绝 */
export function authorize(cred, req, now) {
  const a = ACTIONS[req.action];
  const out = (decision, reasons) => ({ decision, reasons, tier: a ? a.tier : null, policy: POLICY_VERSION });
  if (!cred) return out('deny', ['没有授权凭证']);
  if (!a) return out('deny', ['未知的动作类型']);
  if (cred.revoked) return out('deny', ['凭证已撤销']);
  if (now >= cred.expiresAt) return out('deny', ['凭证已过有效期']);
  if (req.tenant && req.tenant !== cred.tenant) return out('deny', ['不能读取或操作其他租户的资源']);
  if (a.tier === 3) return out('deny', ['金融投资与借贷功能未获许可，保持关闭；不因 Agent 建议而绕过适当性或许可']);
  if (!cred.tools.includes(a.tool)) return out('deny', [`凭证未授予工具"${TOOLS[a.tool]}"`]);
  const amount = Number(req.amount) || 0, usage = Number(req.usage) || 0;
  if (amount < 0 || usage < 0) return out('deny', ['金额与用量不能为负']);
  if (cred.spent + amount > cred.amountCap + 1e-9) return out('deny', [`超出金额上限：已用 ${cred.spent.toFixed(2)} ＋ 本次 ${amount.toFixed(2)} ＞ 上限 ${cred.amountCap.toFixed(2)}`]);
  if (cred.usageCap && cred.used + usage > cred.usageCap + 1e-9) return out('deny', ['超出用量上限']);
  const up = [];
  if (a.tier === 2) up.push(`"${a.name}"属于须更高一级审批的动作`);
  if (req.territory && !cred.territories.includes(req.territory)) up.push('目标地域不在凭证限定范围内（地域变化）');
  if (req.supplier && cred.suppliers.length && !cred.suppliers.includes(req.supplier)) up.push('供方不在已批准名单内（新增供方）');
  if (a.sign && !cred.canSign) up.push('凭证没有签约权限，只能生成提案');
  if (!up.length) return out('allow', [a.tier === 0 ? '只读分析，不产生合同' : '在预算、地域和已批准供方范围内，按事前授权自动执行']);
  const ref = String(req.approvalRef || '').trim();
  if (!ref) return out('approve', up);
  // 审批必须来自人：Agent 不能用自己的身份给自己批
  if (ref === cred.id || String(req.approver || '').trim() === cred.id) return out('deny', ['Agent 不能自我授权：审批引用必须来自有权的人']);
  if (!String(req.approver || '').trim()) return out('approve', [...up, '审批引用缺少审批人']);
  if (a.sign && !cred.canSign) return out('approve', [...up, '已有人工审批，但签约仍须由有权签字人完成']);
  return out('allow', [...up.map((x) => `${x} → 已由 ${req.approver} 审批（${ref}）`)]);
}

/** 执行并留痕。上下文原文不保存，只留摘要 */
export function act(S, credId, req, now) {
  const cred = S.creds.find((c) => c.id === credId);
  const r = authorize(cred, req, now);
  if (r.decision === 'allow' && cred) { cred.spent += Number(req.amount) || 0; cred.used += Number(req.usage) || 0; }
  const rec = { i: S.seq++, t: Math.floor(now), cred: credId, action: req.action, amount: Number(req.amount) || 0, territory: req.territory || '', supplier: req.supplier || '',
    decision: r.decision, reasons: r.reasons, policy: r.policy, context: req.context ? sha256(String(req.context)).slice(0, 16) : '' };
  S.audit.unshift(rec);
  if (S.audit.length > 200) S.audit.length = 200;
  return { ...r, rec };
}

export function revoke(S, credId) {
  const c = S.creds.find((x) => x.id === credId);
  if (!c) return fail('凭证不存在');
  if (c.revoked) return fail('凭证已撤销');
  c.revoked = true;
  return { ok: true };
}
