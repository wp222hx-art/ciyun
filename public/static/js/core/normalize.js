// 归一口径（Worker、快照脚本、浏览器共用同一份实现，避免三处口径不一致）
// 对应方案 §06：原始分项费率 / 固定篮子参考价 / 可比桶

/** 固定篮子：每百万计费 Token 中 80% 非缓存输入 + 20% 输出，不含缓存及其他费用 */
export const BASKET = Object.freeze({ in: 0.8, out: 0.2 });

/** 发布门槛（§08 拟议）：单桶日线至少 3 家独立供应主体、5 个独立买方、10 笔可核样本 */
export const THRESHOLD = Object.freeze({ suppliers: 3, buyers: 5, samples: 10 });

const toNum = (v) => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 美元/Token → 美元/百万Token，消除浮点尾差 */
const perM = (v) => {
  const n = toNum(v);
  return n == null ? null : Number((n * 1e6).toPrecision(10));
};

const EXTRA_FEES = {
  image: '图像输入', audio: '音频输入', image_output: '图像输出', audio_output: '音频输出',
  internal_reasoning: '隐藏推理', web_search: '联网搜索', input_audio_cache: '音频缓存',
  input_cache_write_1h: '1小时缓存写',
};

function rates(pricing = {}) {
  return {
    in: perM(pricing.prompt),
    out: perM(pricing.completion),
    cr: perM(pricing.input_cache_read),
    cw: perM(pricing.input_cache_write),
  };
}

export function normalizeModel(raw) {
  const id = String(raw.id);
  const [brand, rest = ''] = id.split('/');
  const usd = rates(raw.pricing);
  const colon = rest.indexOf(':');
  const variant = colon >= 0 ? rest.slice(colon + 1) : 'std';
  // 别名与路由不是"精确版本"，不入可比桶（§05：别名变化触发人工复核）
  let kind = 'model';
  if (brand.startsWith('~')) kind = 'alias';
  else if ((usd.in ?? 0) < 0 || (usd.out ?? 0) < 0) kind = 'router';

  const arch = raw.architecture || {};
  const name = String(raw.name || id);
  const sep = name.indexOf(': ');
  return {
    id,
    slug: raw.canonical_slug || id,
    name: sep >= 0 ? name.slice(sep + 2) : name,
    brand: brand.replace(/^~/, ''),
    kind,
    variant,
    hf: raw.hugging_face_id || null,
    created: raw.created || null,
    expires: raw.expiration_date || null,
    ctx: raw.context_length || null,
    maxOut: raw.top_provider?.max_completion_tokens || null,
    modality: arch.modality || null,
    inMods: arch.input_modalities || [],
    outMods: arch.output_modalities || [],
    tokenizer: arch.tokenizer || null,
    usd,
    extras: Object.keys(EXTRA_FEES).filter((k) => toNum(raw.pricing?.[k]) > 0).map((k) => EXTRA_FEES[k]),
    tiered: Array.isArray(raw.pricing?.overrides) && raw.pricing.overrides.length > 0,
  };
}

export function normalizeEndpoint(raw) {
  return {
    p: raw.provider_name || '未知',
    tag: raw.tag || null,
    q: raw.quantization && raw.quantization !== 'unknown' ? String(raw.quantization) : 'unknown',
    ctx: raw.context_length || null,
    maxOut: raw.max_completion_tokens || null,
    usd: rates(raw.pricing),
    up1d: toNum(raw.uptime_last_1d),
    up30m: toNum(raw.uptime_last_30m),
    st: toNum(raw.status) ?? 0,
    cache: !!raw.supports_implicit_caching,
  };
}

export function normalizeProvider(raw) {
  return { name: raw.name, slug: raw.slug, hq: raw.headquarters || null, dcs: raw.datacenters || [] };
}

/** 固定篮子参考价：0.8×输入 + 0.2×输出。任一分项缺失则不可计算，返回 null（不猜） */
export function basket(r) {
  if (!r || r.in == null || r.out == null) return null;
  if (r.in < 0 || r.out < 0) return null;
  // 消除二进制浮点尾差：0.8×0.1 + 0.2×0.1 会得到 0.10000000000000002
  return Number((BASKET.in * r.in + BASKET.out * r.out).toPrecision(12));
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** 供应商是否"合格"：状态正常且近一日可用率 ≥95%（无可用率数据时只看状态） */
export const eligible = (e) => e.st === 0 && (e.up1d == null || e.up1d >= 95);

/**
 * 把一个模型的部署端点切成可比桶。
 * 演示口径：按推理精度分组（同一模型不同量化精度不可混为同一成交品种）。
 * 生产口径还须区分地域、服务等级、上下文档位、计费方式与税币种（§06）。
 */
export function buildBuckets(endpoints = []) {
  const groups = new Map();
  for (const e of endpoints) {
    const b = basket(e.usd);
    if (b == null || b <= 0) continue;
    if (!groups.has(e.q)) groups.set(e.q, []);
    groups.get(e.q).push({ ...e, basketUsd: b });
  }
  const buckets = [];
  for (const [q, list] of groups) {
    // 同一供应商多个端点：取其最低报价代表该供应主体，供应商数按独立主体计
    const byProv = new Map();
    for (const e of list) {
      const cur = byProv.get(e.p);
      if (!cur || e.basketUsd < cur.basketUsd) byProv.set(e.p, e);
    }
    const quotes = [...byProv.values()].sort((a, b) => a.basketUsd - b.basketUsd);
    const ok = quotes.filter(eligible);
    const prices = quotes.map((e) => e.basketUsd);
    buckets.push({
      q,
      suppliers: quotes.length,
      eligibleSuppliers: ok.length,
      quotes,
      minUsd: prices[0],
      maxUsd: prices[prices.length - 1],
      medianUsd: median(prices),
      // 仿真中间价锚：合格供应商最低报价；无合格者时退回全体最低
      anchorUsd: (ok[0] || quotes[0]).basketUsd,
      anchorProvider: (ok[0] || quotes[0]).p,
      meets: quotes.length >= THRESHOLD.suppliers,
    });
  }
  // 主桶：独立供应商最多者；并列取报价中位更低者
  buckets.sort((a, b) => b.suppliers - a.suppliers || a.medianUsd - b.medianUsd);
  return buckets;
}

export const PRECISION_LABEL = {
  unknown: '精度未声明', fp4: 'FP4', fp8: 'FP8', fp16: 'FP16', bf16: 'BF16', fp32: 'FP32',
  int4: 'INT4', int8: 'INT8', mxfp4: 'MXFP4',
};
export const precisionLabel = (q) => PRECISION_LABEL[q] || String(q).toUpperCase();
