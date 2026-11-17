// 入场与审批（拟议流程的仿真）+ 存证链
// 依据：广东公开表述的"无场景不登记、无登记不交易、无合规不上架"与合规会审机制。
// 具体环节、材料、时限均为我方设想，未取得广州数据交易所的业务规则，不代表其实际流程。
import { sha256 } from './sha256.js';

const KEY = 'zjt.access.v1';
const blank = () => ({ v: 1, app: null, member: null, listings: [], ledger: [], seq: 1 });
function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && raw.v === 1) return { ...blank(), ...raw };
  } catch { /* 存储不可用：仅本次会话有效 */ }
  return blank();
}
export let st = read();
const subs = new Set();
export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
function commit() {
  try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* 忽略 */ }
  for (const fn of subs) fn();
}
const fail = (error) => ({ ok: false, error });

export const ROLES = {
  buyer: { name: '企业买方', short: '买方', desc: '为实际使用采购推理服务或行业智能服务', unlock: '交易仿真、采购台签约',
    materials: ['营业执照', '法定代表人授权书', '采购用途说明', '数据处理与安全承诺书'] },
  supplier: { name: '推理服务商 / 算力中心', short: '供给方', desc: '提供可计量、可核验、可履约的推理服务', unlock: '产品上架预检与登记、交易仿真',
    materials: ['营业执照', '相应经营资质证明', '模型托管或转供授权证明', '计量口径与回执样例', 'SLA 与数据留存说明'] },
  broker: { name: '数据经纪人 / 服务商', short: '经纪人', desc: '受托撮合、合规辅导与交付协同', unlock: '代客询价与采购台签约、交易仿真',
    materials: ['营业执照', '经纪服务协议范本', '利益冲突披露声明', '从业人员名单'] },
};
export const CHANNELS = { online: '线上直接申请', base: '服务基地 / 专区受理', broker: '数据经纪人推荐' };
export const CATEGORIES = [
  { id: 'kb', name: '企业知识问答与售后助手', roles: ['buyer', 'broker'] },
  { id: 'doc', name: '文档抽取与审阅', roles: ['buyer', 'broker'] },
  { id: 'code', name: '研发提效', roles: ['buyer', 'broker'] },
  { id: 'agent', name: '业务流程自动化', roles: ['buyer', 'broker'] },
  { id: 'serve', name: '向已入场买方提供推理服务', roles: ['supplier'] },
  { id: 'match', name: '受托撮合与合规辅导', roles: ['broker'] },
  { id: 'resale', name: '额度转售 / 二次分销', roles: ['buyer', 'supplier', 'broker'], banned: true },
  { id: 'hold', name: '囤积额度等待升值', roles: ['buyer', 'broker'], banned: true },
];
export const STEPS = [
  { id: 'formal', name: '形式审查', actor: '平台运营方', sla: '1 个工作日', what: '主体真实、材料齐备、承诺已签' },
  { id: 'scene', name: '场景登记', actor: '场景登记岗', sla: '2 个工作日', what: '用途明确、类别相符、说明充分' },
  { id: 'compliance', name: '合规会审', actor: '合规委员会', sla: '5 个工作日', what: '实际使用、个人信息与出境合规' },
  { id: 'register', name: '登记公示', actor: '交易所登记岗', sla: '1 个工作日', what: '发放入场编号与场景登记号' },
];
export const EVENTS = {
  'access.submit': '提交入场申请', 'access.resubmit': '补正后重新提交', 'access.pass': '审核环节通过', 'access.return': '退回补正',
  'access.register': '登记公示 · 发放编号', 'access.withdraw': '撤回申请', 'access.revoke': '撤销入场资格', 'listing.register': '产品上架登记',
  'contract.sign': '采购合同签约', 'contract.deliver': '履约出账 · 计量存证', 'contract.settle': '验收结算',
};

// 统一社会信用代码：GB 32100-2015 校验位
const UC = '0123456789ABCDEFGHJKLMNPQRTUWXY';
const UW = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
export function usccValid(code) {
  code = String(code || '').trim().toUpperCase();
  if (code.length !== 18) return false;
  let s = 0;
  for (let k = 0; k < 17; k++) { const v = UC.indexOf(code[k]); if (v < 0) return false; s += v * UW[k]; }
  return UC[(31 - (s % 31)) % 31] === code[17];
}

/** 某个审核环节的自动检查项。任何一项不通过，该环节只能退回补正 */
export function checks(f, stepId) {
  const role = ROLES[f.role];
  const c = (ok, label) => ({ ok: !!ok, label });
  if (stepId === 'formal') return [
    c(role, '已选择入场角色'),
    c((f.org || '').trim().length >= 4, '主体名称完整'),
    c(usccValid(f.uscc), '统一社会信用代码校验位正确'),
    c(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.contact || ''), '联系邮箱格式有效'),
    c(role && role.materials.every((_, i) => f.materials?.[i]), `申请材料齐备（${role ? role.materials.length : 0} 项）`),
    c(f.pledge, '已签署真实性与合规承诺'),
  ];
  if (stepId === 'scene') return [
    c((f.sceneTitle || '').trim().length >= 4, '场景名称明确'),
    c(CATEGORIES.some((x) => x.id === f.category && x.roles.includes(f.role)), '用途类别已选择且与角色相符'),
    c((f.sceneDesc || '').trim().length >= 20, '场景说明不少于 20 字'),
  ];
  if (stepId === 'compliance') {
    const cat = CATEGORIES.find((x) => x.id === f.category);
    return [
      c(cat && !cat.banned, '用途为实际使用或合规供给，不属于额度转售或投机持有'),
      c(!f.pii || f.piiAssessed, f.pii ? '涉及个人信息：已完成个人信息保护影响评估' : '不涉及个人信息'),
      c(!f.cross || f.crossReady, f.cross ? '涉及数据出境：已确认出境合规路径' : '数据不出境'),
      ...(f.role === 'supplier' ? [c(f.center, '已指定拟上架的算力中心')] : []),
    ];
  }
  return [c(true, '前序环节全部通过，可发放登记编号')];
}

const stamp = (now) => new Date((now + 8 * 3600) * 1000).toISOString().slice(0, 10).replace(/-/g, '');
/** 演示编号：SIM 前缀，非真实登记凭证 */
const issue = (kind, now) => `SIM-${kind}-${stamp(now)}-${String(st.seq++).padStart(4, '0')}`;

// ---------- 存证链：每条记录的哈希包含上一条的哈希，改动任何一条都会被发现 ----------
function record(type, actor, ref, data, now) {
  const last = st.ledger[st.ledger.length - 1];
  const prev = last ? last.hash : 'GENESIS';
  const body = { i: (last ? last.i : 0) + 1, t: Math.floor(now), type, actor, ref, data };
  st.ledger.push({ ...body, prev, hash: sha256(`${prev}|${JSON.stringify(body)}`) });
  if (st.ledger.length > 400) st.ledger.splice(0, st.ledger.length - 400);
}
export function log(type, actor, ref, data, now) { record(type, actor, ref, data, now); commit(); }
export function verifyLedger(ledger = st.ledger) {
  for (let k = 0; k < ledger.length; k++) {
    const { prev, hash, ...body } = ledger[k];
    if (k > 0 && prev !== ledger[k - 1].hash) return { ok: false, at: body.i, why: '与上一条的哈希不连续' };
    if (sha256(`${prev}|${JSON.stringify(body)}`) !== hash) return { ok: false, at: body.i, why: '内容与哈希不符' };
  }
  return { ok: true, n: ledger.length };
}
export const digest = (obj) => sha256(JSON.stringify(obj));

// ---------- 申请与审核 ----------
export const canTrade = () => !!st.member;

export function submit(form, now) {
  if (st.member) return fail('已取得入场资格，无需重复申请');
  if (st.app && st.app.status === 'reviewing') return fail('申请正在审核中');
  if (!ROLES[form.role]) return fail('请选择入场角色');
  const first = !st.app;
  st.app = { id: st.app ? st.app.id : issue('SQ', now), status: 'reviewing', step: 0, form: JSON.parse(JSON.stringify(form)), trail: st.app ? st.app.trail : [] };
  st.app.trail.push({ t: now, who: '申请人', action: first ? '提交申请' : '补正后重新提交', note: '' });
  record(first ? 'access.submit' : 'access.resubmit', '申请人', st.app.id, { role: form.role, org: form.org, uscc: form.uscc, category: form.category }, now);
  commit();
  return { ok: true };
}

export function review(action, note, now) {
  const a = st.app;
  if (!a || a.status !== 'reviewing') return fail('没有待审核的申请');
  const step = STEPS[a.step];
  const bad = checks(a.form, step.id).filter((x) => !x.ok);
  if (action === 'return') {
    note = (note || '').trim() || (bad.length ? `未通过：${bad.map((x) => x.label).join('；')}` : '');
    if (!note) return fail('退回补正必须写明理由');
    a.status = 'returned'; a.returnNote = note; a.returnStep = step.name;
    a.trail.push({ t: now, who: step.actor, action: `${step.name} · 退回补正`, note });
    record('access.return', step.actor, a.id, { step: step.id, note }, now);
    commit();
    return { ok: true, returned: true };
  }
  if (bad.length) return fail(`"${step.name}"有 ${bad.length} 项检查未通过，只能退回补正：${bad[0].label}`);
  a.trail.push({ t: now, who: step.actor, action: `${step.name} · 通过`, note: '' });
  record('access.pass', step.actor, a.id, { step: step.id }, now);
  a.step++;
  if (a.step >= STEPS.length) {
    const f = a.form;
    a.status = 'approved';
    st.member = { no: issue('RC', now), sceneNo: issue('CJ', now), appId: a.id, role: f.role, org: f.org.trim(), uscc: f.uscc.trim().toUpperCase(),
      channel: f.channel, sceneTitle: f.sceneTitle.trim(), category: f.category, center: f.role === 'supplier' ? f.center : null, approvedAt: now };
    record('access.register', '交易所登记岗', st.member.no, { appId: a.id, sceneNo: st.member.sceneNo, role: f.role, org: st.member.org }, now);
  }
  commit();
  return { ok: true, approved: a.status === 'approved' };
}

/** 演示用：连续通过后续环节，遇到检查不通过即停下 */
export function autoRun(now) {
  let n = 0;
  for (;;) {
    const r = review('pass', '', now);
    if (!r.ok) return { ...r, passed: n, stoppedAt: STEPS[st.app.step].name };
    n++;
    if (r.approved) return { ok: true, approved: true, passed: n };
  }
}

export function withdraw(now) {
  if (!st.app || st.app.status !== 'reviewing') return fail('没有可撤回的申请');
  st.app.status = 'draft';
  st.app.trail.push({ t: now, who: '申请人', action: '撤回申请', note: '' });
  record('access.withdraw', '申请人', st.app.id, {}, now);
  commit();
  return { ok: true };
}

export function revoke(now) {
  if (!st.member && !st.app) return fail('当前没有入场资格或申请');
  record('access.revoke', '申请人', st.member ? st.member.no : st.app.id, { listings: st.listings.length }, now);
  st.member = null; st.app = null; st.listings = [];
  commit();
  return { ok: true };
}

// ---------- 上架预检（无合规不上架）：用算力中心的真实公开数据逐项检查 ----------
export function precheck(center) {
  const disclosed = center.dcs.length > 0;
  return center.rows.map(({ inst, quote }) => {
    const items = [
      { ok: quote.q !== 'unknown', label: '推理精度已声明', hard: true },
      { ok: quote.st === 0, label: '服务状态正常', hard: true },
      { ok: quote.up1d != null && quote.up1d >= 95, label: quote.up1d == null ? '近1日可用率无数据' : '近1日可用率 ≥95%', hard: true },
      { ok: disclosed, label: '机房所在地已披露', hard: true },
      { ok: !!inst.open, label: '权重可独立核验', hard: false },
    ];
    return { inst, quote, items, pass: items.every((x) => x.ok || !x.hard) };
  });
}
export const isListed = (instId, provider) => st.listings.some((l) => l.instId === instId && l.provider === provider);

export function registerListings(center, now) {
  const m = st.member;
  if (!m) return fail('尚未取得入场资格：无登记不交易，也不能上架');
  if (m.role !== 'supplier') return fail('只有以"推理服务商 / 算力中心"角色入场的主体可以上架产品');
  if (m.center !== center.name) return fail(`入场登记的算力中心是"${m.center}"，不能替其他主体上架`);
  const pass = precheck(center).filter((r) => r.pass && !isListed(r.inst.id, center.name));
  if (!pass.length) return fail('没有新的、通过预检的产品可登记');
  for (const r of pass) st.listings.push({ no: issue('CP', now), instId: r.inst.id, provider: center.name, t: now });
  record('listing.register', '交易所登记岗', m.no, { provider: center.name, count: pass.length, digest: digest(pass.map((r) => r.inst.id)) }, now);
  commit();
  return { ok: true, count: pass.length };
}
