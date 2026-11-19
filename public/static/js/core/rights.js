// 版权与服务挂牌（G04 挂牌卡、G09 三道审核与状态机、G10 询价成交）。
// 全部函数只操作传入的状态 S，不碰时钟和存储，方便单测；预置挂牌为〔示例规格，不是真实商品〕。
import { sha256 } from './sha256.js';
import { persisted } from './store.js';

export const TERRITORIES = { MO: '澳门', HK: '香港', PT: '葡萄牙', BR: '巴西', US: '美国', EU: '欧盟其他', SEA: '东南亚', JP: '日本' };
export const LANGS = { zh: '中文', pt: '葡语', en: '英语', ja: '日语', es: '西语' };
export const CHANNELS = { stream: '流媒体', tv: '电视', short: '短视频', ad: '广告', cinema: '院线', lib: '图库／素材库', game: '游戏／虚拟制作' };
// G05 十类海外 AIGC 版权交易对象与关键核查（方案原文）
export const CATEGORIES = {
  film: { name: 'AI电影、短剧、动画、纪录及广告片', check: '剧本、音乐、肖像、表演、素材及AI生成部分' },
  image: { name: '图像、插画、海报、摄影合成', check: '人类创作、商标、人物及原素材限制' },
  music: { name: '音乐、歌曲、音效、配乐', check: '各权利分开，翻唱／仿声不自动获许可' },
  text: { name: '剧本、文学、翻译、字幕及配音', check: '原作、译制贡献、AI配音及声纹授权' },
  asset3d: { name: '3D、游戏及虚拟场景素材', check: '资产依赖、引擎许可、不得转售等限制' },
  human: { name: '数字人、角色与虚拟偶像', check: '肖像、声音、人格及未成年人保护' },
  design: { name: '设计、字体、模板及营销素材', check: '字体及底层元素许可、商标与外观限制' },
  dataset: { name: '数据集、训练、评测及微调资料', check: '训练、RAG、再分发、个人资料及来源分开' },
  weights: { name: '模型权重、LoRA、工作流与Agent', check: '开源义务、转供、衍生物和数据权利' },
  collect: { name: '收藏、会员与互动体验', check: '不默认含版权、金融收益或自由转售' },
};
// G04 六类挂牌对象
export const OBJECTS = {
  task: { name: 'AI制作与企业任务服务', stage: '产业服务试点，明确交付及责任' },
  content: { name: '影视及其他内容许可', stage: '权利核清后协议挂牌与采购' },
  compute: { name: '算力容量及模型调用服务', stage: '先消费；转让另过许可及供方同意' },
  data: { name: '数据、训练及微调许可', stage: '独立授权，不随作品许可自动附带' },
  collectible: { name: '数字收藏品／可转让凭证', stage: '不默认首发；虚拟资产及金融属性专项审查', gate: 'isolated' },
  financial: { name: '收益权、应收、设备融资或衍生品', stage: '受监管研究专区，不在首期开放交易', gate: 'closed' },
};
// G05 四种主要收入结构
export const STRUCTURES = { oneoff: '一次性非独占许可', exclusive: '排他／买断范围许可', usage: '按期订阅与按量使用', royalty: '基于真实渠道收入的合同版税' };
export const AI_MODES = { none: '未使用 AI', assist: 'AI 辅助，人类主导创作', gen: 'AI 生成为主' };
export const BANNED_WORDS = ['官方确权', '绝对保真', '保本', '稳定升值'];
export const LICENCE_FEE = 0.08; // G21：许可对价的 8% 为中心服务费〔示例假设〕

export const STATES = {
  draft: '草稿', need_info: '资料待补', verifying: '核验／法律分类', admitted: '准入通过', listed: '挂牌',
  suspended: '争议中 · 暂停新授权', closed: '结清／到期／撤牌',
};
export const FLOW = ['draft', 'need_info', 'verifying', 'admitted', 'listed', 'closed'];
export const REVIEWS = [
  { id: 'party', name: '主体及地域审核', what: '确认签约权、受益所有人和目标市场' },
  { id: 'asset', name: '资产及权利审核', what: '确认来源、允许用途和无明显冲突' },
  { id: 'product', name: '产品及履约审核', what: '确认规格、价格、责任、交付和银行路径' },
];
export const ORDER_STATES = {
  rfq: '买方询价', quoted: '供方已报价', locked: '已锁定合同快照', signed: '已签约 · 成交', paid: '外部到账已确认',
  delivered: '凭证已签发 · 已交付', accepted: '已验收', disputed: '争议中', cancelled: '已取消',
};
export const ORDER_FLOW = ['rfq', 'quoted', 'locked', 'signed', 'paid', 'delivered', 'accepted'];
const LIVE_LICENCE = new Set(['signed', 'paid', 'delivered', 'accepted', 'disputed']);

const fail = (error, extra) => ({ ok: false, error, ...extra });
const has = (s) => String(s ?? '').trim().length > 0;
const hit = (a, b) => (a || []).some((x) => (b || []).includes(x));
const within = (a, b) => (a || []).length > 0 && a.every((x) => (b || []).includes(x));
const termHit = (a, b) => a.from <= b.to && b.from <= a.to;
/** 两个许可范围是否相交：地域、语言、渠道、期限四个维度同时相交才算 */
export const scopeHit = (a, b) => hit(a.territory, b.territory) && hit(a.language, b.language) && hit(a.channel, b.channel) && termHit(a, b);
const scopeOf = (x) => ({ territory: x.territory, language: x.language, channel: x.channel, from: x.from, to: x.to });
export const dayStr = (sec) => new Date((sec + 8 * 3600) * 1000).toISOString().slice(0, 10);

export const emptyCard = () => ({
  assetId: '', title: '', desc: '', category: 'film', object: 'content', structure: 'oneoff',
  holder: '', owner: '', agent: '', territory: [], language: [], channel: [], from: '', to: '',
  exclusive: false, sublicense: false, transferable: false, consentRef: '',
  ai: '', human: '', manifest: '', thirdParty: false, delivery: '', price: '', payment: 'bank',
  forum: '', law: '', evidence: [], authUntil: '',
});

const REQUIRED = [
  ['assetId', '标的编号 asset_id'], ['title', '标的名称'], ['holder', '权利人 holder'], ['owner', '受益所有人'],
  ['from', '许可起始日'], ['to', '许可到期日'], ['manifest', '模型及素材来源清单 source_manifest'], ['ai', 'AI 参与方式'],
  ['delivery', '交付与验收标准 delivery_criteria'], ['forum', '争议解决 dispute_forum'], ['law', '适用法律 applicable_law'], ['authUntil', '授权有效期'],
];

/** 必填项缺失清单 */
export function missing(c) {
  const out = REQUIRED.filter(([k]) => !has(c[k])).map(([, label]) => label);
  if (!(c.territory || []).length) out.push('许可地域 territory');
  if (!(c.language || []).length) out.push('许可语言 language');
  if (!(c.channel || []).length) out.push('许可渠道 channel');
  if (!(Number(c.price) > 0)) out.push('价格快照 price_snapshot');
  if (!(c.evidence || []).length) out.push('证据引用 evidence_refs');
  if (c.transferable && !has(c.consentRef)) out.push('可转让须附供方同意引用');
  return out;
}

/** 同一标的下，与本卡排他范围相交的其他有效挂牌 */
export function conflicts(S, c) {
  return S.listings.filter((o) => o.id !== c.id && o.assetId === c.assetId && ['admitted', 'listed', 'suspended'].includes(o.status)
    && (o.exclusive || c.exclusive) && scopeHit(scopeOf(o), scopeOf(c)));
}

/** 三道审核的自动检查项 */
export function review(S, c, today) {
  const k = (ok, label, note = '') => ({ ok: !!ok, label, note });
  const text = `${c.title} ${c.desc}`;
  const bad = BANNED_WORDS.filter((w) => text.includes(w));
  const obj = OBJECTS[c.object];
  const cf = conflicts(S, c);
  const unsure = c.ai && c.ai !== 'none' && String(c.human || '').trim().length < 6;
  return [
    [
      k(has(c.holder), '权利人已填写'),
      k(has(c.owner), '受益所有人已披露'),
      k(has(c.agent) || has(c.holder), '签约权明确（权利人自行签约或指定授权代理）'),
      k((c.territory || []).length > 0, '目标市场已列明'),
    ],
    [
      k(has(c.manifest), '模型及素材来源清单已提交'),
      k(has(c.ai), 'AI 参与方式已披露', '隐瞒 AI 生成属于禁止挂牌'),
      k(!(c.exclusive && unsure), '不出售无法证明的排他版权', '缺少人类创作记录的 AI 输出，只能如实说明交付与合同使用权限，不能挂排他许可'),
      k(c.thirdParty, '音乐、肖像、声音及素材等第三方权利已核清'),
      k(has(c.authUntil) && c.authUntil >= today, '授权在有效期内', has(c.authUntil) && c.authUntil < today ? `授权已于 ${c.authUntil} 过期` : ''),
      k(cf.length === 0, '与同一标的的其他挂牌没有排他范围相交', cf.length ? `与 ${cf.map((x) => x.id).join('、')} 的排他范围相交` : ''),
      k((c.evidence || []).length > 0, '至少一条证据引用'),
    ],
    [
      k(!obj?.gate, '商品类别可在产业交易层挂牌', obj?.gate === 'closed' ? '金融属性商品：未获准，保持关闭' : obj?.gate === 'isolated' ? '虚拟资产及金融属性须先进入隔离评审' : ''),
      k(has(c.delivery), '交付与验收标准已写明'),
      k(Number(c.price) > 0, '价格快照有效'),
      k(c.payment === 'bank', '收付走银行认可的法币路径', c.payment === 'bank' ? '' : '稳定币与境外钱包是条件模块，未逐项确认前不作为首发支付路径'),
      k(has(c.forum) && has(c.law), '争议解决与适用法律已约定'),
      k(has(c.from) && has(c.to) && c.from < c.to, '许可期限有效'),
      k(!c.transferable || has(c.consentRef), '可转让的已附供方同意引用'),
      k(bad.length === 0, '名称与说明没有误导措辞', bad.length ? `含禁用措辞：${bad.join('、')}` : ''),
    ],
  ];
}

/** 当前不能发布的全部原因（任一条存在即阻断） */
export function blockers(S, c, today) {
  const miss = missing(c);
  const fails = review(S, c, today).flat().filter((x) => !x.ok).map((x) => (x.note ? `${x.label}：${x.note}` : `未满足：${x.label}`));
  return [...(miss.length ? [`必填未齐：${miss.join('、')}`] : []), ...fails];
}

const id = (S, kind) => `SIM-${kind}-${String(S.seq++).padStart(4, '0')}`;
const note = (c, now, who, action, text = '') => { c.history.push({ t: Math.floor(now), who, action, note: text }); };
const find = (S, lid) => S.listings.find((x) => x.id === lid);

export function create(S, card, now) {
  const c = { ...emptyCard(), ...card, id: id(S, 'GP'), version: 1, status: 'draft', step: 0, history: [], createdAt: Math.floor(now) };
  c.price = Number(c.price) || '';
  note(c, now, '挂牌方', '创建草稿');
  S.listings.unshift(c);
  return { ok: true, listing: c };
}

/** 修改挂牌卡。已准入或已挂牌的卡改动后版本号加一，并回到审核，不能静默换权利或换价 */
export function update(S, lid, patch, now) {
  const c = find(S, lid);
  if (!c) return fail('挂牌不存在');
  if (c.status === 'closed') return fail('已撤牌或到期的挂牌不能修改');
  if (c.status === 'verifying') return fail('审核进行中，退回或通过后再修改');
  const bump = ['admitted', 'listed', 'suspended'].includes(c.status);
  Object.assign(c, patch);
  c.price = Number(c.price) || '';
  if (bump) { c.version++; c.status = 'verifying'; c.step = 0; note(c, now, '挂牌方', `改版为 v${c.version}`, '改动已挂牌内容：重新进入三道审核，旧版本锁定的订单须重新报价'); } else note(c, now, '挂牌方', '修改草稿');
  return { ok: true, bumped: bump, listing: c };
}

export function submit(S, lid, now) {
  const c = find(S, lid);
  if (!c) return fail('挂牌不存在');
  if (!['draft', 'need_info'].includes(c.status)) return fail('只有草稿或资料待补状态可以提交');
  const miss = missing(c);
  if (miss.length) { c.status = 'need_info'; note(c, now, '系统', '资料待补', miss.join('、')); return fail(`必填未齐：${miss.join('、')}`, { missing: miss }); }
  c.status = 'verifying'; c.step = 0;
  note(c, now, '挂牌方', '提交审核');
  return { ok: true };
}

export function pass(S, lid, today, now) {
  const c = find(S, lid);
  if (!c || c.status !== 'verifying') return fail('没有待审核的挂牌');
  const stage = REVIEWS[c.step];
  const bad = review(S, c, today)[c.step].filter((x) => !x.ok);
  if (bad.length) return fail(`"${stage.name}"有 ${bad.length} 项未通过，只能退回：${bad[0].note || bad[0].label}`, { bad });
  note(c, now, stage.name, '通过');
  c.step++;
  if (c.step >= REVIEWS.length) { c.status = 'admitted'; note(c, now, '系统', '准入通过'); }
  return { ok: true, admitted: c.status === 'admitted' };
}

export function sendBack(S, lid, reason, today, now) {
  const c = find(S, lid);
  if (!c || c.status !== 'verifying') return fail('没有待审核的挂牌');
  const stage = REVIEWS[c.step];
  const bad = review(S, c, today)[c.step].filter((x) => !x.ok);
  const text = has(reason) ? reason.trim() : bad.map((x) => x.note || x.label).join('；');
  if (!text) return fail('驳回必须写明理由');
  c.status = 'need_info'; c.step = 0;
  note(c, now, stage.name, '退回补正', text);
  return { ok: true };
}

export function publish(S, lid, today, now) {
  const c = find(S, lid);
  if (!c || c.status !== 'admitted') return fail('只有准入通过的商品可以挂牌');
  const why = blockers(S, c, today); // 发布前再核一次：准入后可能出现新的冲突或授权到期
  if (why.length) return fail(`发布被阻断：${why[0]}`, { blockers: why });
  c.status = 'listed'; c.listedAt = Math.floor(now);
  note(c, now, '系统', '挂牌');
  return { ok: true };
}

export function suspend(S, lid, reason, now) {
  const c = find(S, lid);
  if (!c || c.status !== 'listed') return fail('只有挂牌中的商品可以暂停');
  if (!has(reason)) return fail('暂停必须写明理由');
  c.status = 'suspended';
  note(c, now, '权利审核', '暂停新授权 · 保全现有记录', reason.trim());
  return { ok: true };
}
export function resume(S, lid, today, now) {
  const c = find(S, lid);
  if (!c || c.status !== 'suspended') return fail('该商品没有被暂停');
  const why = blockers(S, c, today);
  if (why.length) return fail(`不能恢复：${why[0]}`);
  c.status = 'listed'; note(c, now, '权利审核', '恢复挂牌');
  return { ok: true };
}
export function delist(S, lid, now) {
  const c = find(S, lid);
  if (!c || c.status === 'closed') return fail('挂牌不存在或已撤牌');
  if (S.orders.some((o) => o.listingId === lid && ['locked', 'signed', 'paid', 'delivered', 'disputed'].includes(o.status))) return fail('还有未结清的订单，先完成交付验收或处理争议');
  c.status = 'closed'; note(c, now, '挂牌方', '撤牌', '存量许可按合同继续有效');
  return { ok: true };
}
/** 授权或许可期限到期：停止新授权 */
export function expire(S, today, now) {
  let n = 0;
  for (const c of S.listings) {
    if (!['admitted', 'listed', 'suspended'].includes(c.status)) continue;
    if (c.authUntil < today || c.to < today) { c.status = 'closed'; note(c, now, '系统', '到期', c.authUntil < today ? '授权已过期' : '许可期限届满'); n++; }
  }
  return n;
}

// ---------- 订单：询价 → 报价 → 锁定快照 → 签约 → 外部到账 → 交付 → 验收 ----------
/** 请求的许可范围是否与该标的已成立的许可冲突 */
export function licenceConflicts(S, listing, req, skipId) {
  return S.orders.filter((o) => o.id !== skipId && o.assetId === listing.assetId && LIVE_LICENCE.has(o.status)
    && (o.scope.exclusive || req.exclusive) && scopeHit(o.scope, req));
}

export function rfq(S, lid, f, now) {
  const c = find(S, lid);
  if (!c) return fail('挂牌不存在');
  if (c.status === 'suspended') return fail('该商品争议处理中，已暂停新授权');
  if (c.status !== 'listed') return fail('只有挂牌中的商品可以询价');
  if (!has(f.buyer)) return fail('请填写买方主体');
  if (f.buyer.trim() === c.holder.trim() || (has(c.agent) && f.buyer.trim() === c.agent.trim())) return fail('买方与权利人或其代理是同一主体：自买自卖不计入成交');
  const req = { territory: f.territory || [], language: f.language || [], channel: f.channel || [], from: f.from, to: f.to, exclusive: !!f.exclusive };
  if (!within(req.territory, c.territory) || !within(req.language, c.language) || !within(req.channel, c.channel)) return fail('请求范围超出挂牌卡列明的地域、语言或渠道');
  if (!has(req.from) || !has(req.to) || req.from >= req.to) return fail('请求的许可期限无效');
  if (req.from < c.from || req.to > c.to) return fail('请求期限超出挂牌卡列明的期限');
  if (req.exclusive && !c.exclusive) return fail('该挂牌只提供非独占许可');
  const cf = licenceConflicts(S, c, req);
  if (cf.length) return fail(`与已成立的许可 ${cf.map((o) => o.id).join('、')} 范围相交，不能重复授权`);
  const o = { id: id(S, 'DD'), listingId: lid, assetId: c.assetId, title: c.title, holder: c.holder, buyer: f.buyer.trim(), scope: req, offer: Number(f.offer) || null, price: null, status: 'rfq', t: { rfq: Math.floor(now) }, version: c.version };
  S.orders.unshift(o);
  return { ok: true, order: o };
}

const order = (S, oid) => S.orders.find((x) => x.id === oid);

export function quote(S, oid, price, now) {
  const o = order(S, oid);
  if (!o || !['rfq', 'quoted'].includes(o.status)) return fail('订单不在询价阶段');
  if (!(Number(price) > 0)) return fail('报价必须大于 0');
  o.price = Number(price); o.status = 'quoted'; o.t.quoted = Math.floor(now);
  return { ok: true };
}

const snapshotOf = (o, c) => ({ order: o.id, listing: c.id, asset: c.assetId, version: c.version, holder: c.holder, buyer: o.buyer, scope: o.scope,
  price: o.price, currency: 'USD', feeRate: LICENCE_FEE, delivery: c.delivery, payment: c.payment, forum: c.forum, law: c.law, sublicense: c.sublicense, transferable: c.transferable });

/** 锁定规格与合同快照：权利范围、价格和费用一起冻结，之后任何一项被改动都能查出来 */
export function lock(S, oid, today, now) {
  const o = order(S, oid);
  if (!o || o.status !== 'quoted') return fail('须先有供方报价才能锁定');
  const c = find(S, o.listingId);
  if (!c || c.status !== 'listed') return fail('挂牌已不在可成交状态');
  if (c.version !== o.version) return fail(`挂牌已改版为 v${c.version}，原询价基于 v${o.version}，须重新询价`);
  if (c.authUntil < today) return fail('授权已过期，不能成交');
  const cf = licenceConflicts(S, c, o.scope, o.id);
  if (cf.length) return fail(`与已成立的许可 ${cf.map((x) => x.id).join('、')} 范围相交，不能重复授权`);
  o.snapshot = snapshotOf(o, c);
  o.snapHash = sha256(JSON.stringify(o.snapshot));
  o.status = 'locked'; o.t.locked = Math.floor(now);
  return { ok: true, hash: o.snapHash };
}

/** 快照是否仍与锁定时一致 */
export function snapshotIntact(S, o) {
  if (!o.snapshot) return { ok: false, why: '尚未锁定' };
  if (sha256(JSON.stringify(o.snapshot)) !== o.snapHash) return { ok: false, why: '合同快照内容与锁定时的哈希不符' };
  if (o.snapshot.price !== o.price) return { ok: false, why: '订单价格与锁定的合同快照不一致' };
  if (JSON.stringify(o.snapshot.scope) !== JSON.stringify(o.scope)) return { ok: false, why: '订单权利范围与锁定的合同快照不一致' };
  const c = find(S, o.listingId);
  if (c && c.version !== o.snapshot.version) return { ok: false, why: `挂牌已改版为 v${c.version}，合同快照锁定的是 v${o.snapshot.version}` };
  return { ok: true };
}

export function sign(S, oid, now) {
  const o = order(S, oid);
  if (!o || o.status !== 'locked') return fail('须先锁定合同快照');
  const ok = snapshotIntact(S, o);
  if (!ok.ok) return fail(`不能签约：${ok.why}`);
  o.status = 'signed'; o.t.signed = Math.floor(now);
  return { ok: true };
}
/** 外部合法支付确认：中心不代收代管，只登记对方银行的到账凭证引用 */
export function confirmPayment(S, oid, ref, now) {
  const o = order(S, oid);
  if (!o || o.status !== 'signed') return fail('须先签约');
  if (!has(ref)) return fail('须填写外部到账凭证引用；未到账不能进入交付');
  o.payRef = ref.trim(); o.status = 'paid'; o.t.paid = Math.floor(now);
  return { ok: true };
}
export function deliver(S, oid, now) {
  const o = order(S, oid);
  if (!o || o.status !== 'paid') return fail('须先确认外部到账');
  o.licence = { no: id(S, 'XK'), hash: sha256(`${o.snapHash}|${o.payRef}|${o.id}`) };
  o.status = 'delivered'; o.t.delivered = Math.floor(now);
  return { ok: true, licence: o.licence };
}
export function accept(S, oid, now) {
  const o = order(S, oid);
  if (!o || o.status !== 'delivered') return fail('须先交付');
  o.fee = Math.round(o.price * LICENCE_FEE * 100) / 100;
  o.status = 'accepted'; o.t.accepted = Math.floor(now);
  return { ok: true, fee: o.fee };
}
export function dispute(S, oid, reason, now) {
  const o = order(S, oid);
  if (!o || !['delivered', 'paid', 'signed'].includes(o.status)) return fail('该订单当前不能发起争议');
  if (!has(reason)) return fail('争议必须写明理由');
  o.before = o.status; o.status = 'disputed'; o.disputeNote = reason.trim(); o.t.disputed = Math.floor(now);
  return { ok: true };
}
export function resolve(S, oid, now) {
  const o = order(S, oid);
  if (!o || o.status !== 'disputed') return fail('该订单没有争议');
  o.status = o.before; delete o.before; o.t.resolved = Math.floor(now);
  return { ok: true };
}
export function cancel(S, oid, now) {
  const o = order(S, oid);
  if (!o || !['rfq', 'quoted', 'locked'].includes(o.status)) return fail('已签约的订单不能直接取消，须走争议或合同终止');
  o.status = 'cancelled'; o.t.cancelled = Math.floor(now);
  return { ok: true };
}

/** 口径分列：成交对价、已到账、中心服务费各算各的，不合并成一个"规模" */
export function stats(S) {
  const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
  const signed = S.orders.filter((o) => LIVE_LICENCE.has(o.status));
  const paid = S.orders.filter((o) => ['paid', 'delivered', 'accepted'].includes(o.status));
  const done = S.orders.filter((o) => o.status === 'accepted');
  return {
    listed: S.listings.filter((c) => c.status === 'listed').length,
    reviewing: S.listings.filter((c) => ['need_info', 'verifying', 'admitted'].includes(c.status)).length,
    licences: signed.length, contractValue: sum(signed, (o) => o.price), received: sum(paid, (o) => o.price),
    accepted: done.length, centreFee: Math.round(sum(done, (o) => o.fee || 0) * 100) / 100,
  };
}

// ---------- 预置示例 ----------
const base = { owner: '同权利人', forum: '澳门仲裁（示例）', law: '澳门特别行政区法律（示例）', payment: 'bank', from: '2026-12-01', to: '2027-11-30', authUntil: '2028-12-31', thirdParty: true };
const SEEDS = [
  { ...base, assetId: 'SIM-AST-0001', title: '《潮汐来信》AI辅助短片（虚构）', desc: '12 分钟剧情短片，葡语字幕与英语字幕各一版。', category: 'film', object: 'content', structure: 'oneoff',
    holder: '示例片方甲（虚构）', territory: ['PT', 'BR'], language: ['pt', 'en'], channel: ['stream', 'tv'], ai: 'assist', human: '人类编剧、剪辑与创意修改记录（示例）',
    manifest: '视频生成模型声明、音乐与肖像授权清单（示例）', delivery: '加密母版、审片水印版、字幕、许可书、证据清单', price: 3000, evidence: ['SIM-EV-素材清单', 'SIM-EV-创作记录'], _status: 'listed' },
  { ...base, assetId: 'SIM-AST-0002', title: '《濠江夜曲》原创配乐（虚构）', desc: '3 分钟器乐，含分轨。', category: 'music', object: 'content', structure: 'exclusive', exclusive: true,
    holder: '示例音乐工作室乙（虚构）', territory: ['BR'], language: ['pt'], channel: ['ad'], ai: 'assist', human: '人类作曲与编曲，AI 仅用于混音辅助（示例）',
    manifest: '词曲、母带、表演权利分项清单（示例）', delivery: '母带、分轨、同步许可书', price: 5200, evidence: ['SIM-EV-词曲登记'], _status: 'listed' },
  { ...base, assetId: 'SIM-AST-0003', title: '《岭南节气》插画素材包（虚构）', desc: '24 张节气主题插画，商业用途。', category: 'image', object: 'content', structure: 'usage',
    holder: '示例插画师丙（虚构）', territory: ['US', 'EU', 'JP'], language: ['en', 'ja'], channel: ['lib', 'ad'], ai: 'assist', human: '手绘线稿与人工上色修改记录（示例）',
    manifest: '图像模型声明与参考素材清单（示例）', delivery: '分层源文件、商用许可书', price: 480, evidence: ['SIM-EV-线稿存档'], _status: 'listed' },
  { ...base, assetId: 'SIM-AST-0004', title: '数字角色「阿濠」品牌互动许可（虚构）', desc: '虚拟角色形象与声音，用于品牌互动。', category: 'human', object: 'content', structure: 'oneoff',
    holder: '示例工作室丁（虚构）', territory: ['MO', 'HK'], language: ['zh'], channel: ['ad', 'short'], ai: 'gen', human: '',
    manifest: '角色设定稿（示例）', delivery: '角色模型、声音包、许可书', price: 2600, evidence: ['SIM-EV-设定稿'], thirdParty: false, _status: 'draft' },
  { ...base, assetId: 'SIM-AST-0005', title: '《镜海》AI动画短片（虚构）', desc: '8 分钟动画短片。', category: 'film', object: 'content', structure: 'oneoff',
    holder: '示例片方戊（虚构）', territory: ['PT'], language: ['pt'], channel: ['stream'], ai: 'assist', human: '人类分镜与剪辑记录（示例）',
    manifest: '动画生成模型声明（示例）', delivery: '母版与字幕', price: 1800, evidence: ['SIM-EV-分镜'], authUntil: '2026-06-30', _status: 'draft' },
  { ...base, assetId: 'SIM-AST-0001', title: '《潮汐来信》发行收益份额（虚构）', desc: '按发行收入向持有人分配。', category: 'film', object: 'financial', structure: 'royalty',
    holder: '示例片方甲（虚构）', territory: ['HK'], language: ['zh'], channel: ['stream'], ai: 'assist', human: '同原片（示例）',
    manifest: '同原片（示例）', delivery: '收益分配报告', price: 100, evidence: ['SIM-EV-发行合同'], _status: 'draft' },
];
export function blank() {
  const S = { v: 1, listings: [], orders: [], seq: 1 };
  const t0 = 1763510400; // 2026-11-19 00:00 UTC，固定值：预置数据不随打开时间变化
  for (const { _status, ...card } of SEEDS) {
    const { listing } = create(S, card, t0);
    listing.seed = true;
    if (_status === 'listed') { listing.status = 'listed'; listing.step = 3; listing.listedAt = t0; note(listing, t0, '系统', '示例数据：预置为已挂牌'); }
  }
  S.listings.reverse(); // 编号 0001 排在最前
  return S;
}
export const db = persisted('zjt.rights.v1', blank, (v) => Array.isArray(v.listings) && Array.isArray(v.orders));
