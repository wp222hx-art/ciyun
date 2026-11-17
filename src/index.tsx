import { Hono } from 'hono'
// 与浏览器、快照脚本共用同一份归一实现，避免三处口径不一致
// @ts-ignore 纯 JS 模块
import { normalizeModel, normalizeEndpoint } from '../public/static/js/core/normalize.js'

const OR = 'https://openrouter.ai/api/v1'
const FX = 'https://open.er-api.com/v6/latest/USD'

const app = new Hono()

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12000) })
  if (!res.ok) throw new Error(`上游返回 HTTP ${res.status}`)
  return res.json()
}

/**
 * 边缘缓存 ttl 秒。缓存的是归一后的最终响应体：命中时直接返回，
 * 不重复解析上游的大 JSON（免费版 Worker 单次请求只有 10ms CPU）。
 */
async function cached(c: any, key: string, ttl: number, produce: () => Promise<unknown>): Promise<Response> {
  const cache = (globalThis as any).caches?.default
  const req = new Request('https://edge-cache.local/' + key)
  if (cache) {
    const hit = await cache.match(req)
    if (hit) return hit
  }
  const res = new Response(JSON.stringify(await produce()), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${ttl}` },
  })
  if (cache) {
    const put = cache.put(req, res.clone())
    try { c.executionCtx.waitUntil(put) } catch { await put }
  }
  return res
}

const fail = (c: any, e: unknown) => c.json({ error: String((e as Error)?.message || e) }, 502)

// 模型目录（公开信息：模型、版本、分项费率、上下文、tokenizer）
app.get('/api/catalog', async (c) => {
  try {
    return await cached(c, 'catalog', 300, async () => {
      const data = await getJson(`${OR}/models`)
      return { asOf: new Date().toISOString(), source: 'OpenRouter /models', models: (data.data || []).map(normalizeModel) }
    })
  } catch (e) { return fail(c, e) }
})

// 单个模型的部署端点（公开信息：服务商、精度、分项费率、可用率）
app.get('/api/endpoints', async (c) => {
  const id = c.req.query('id') || ''
  // 只接受 "品牌/型号[:变体]" 形式，防止拼接出任意上游路径
  if (!/^~?[\w.-]+\/[\w.-]+(:[\w.-]+)?$/.test(id) || id.includes('..')) return c.json({ error: '模型 ID 格式不正确' }, 400)
  try {
    return await cached(c, 'endpoints/' + encodeURIComponent(id), 60, async () => {
      const data = await getJson(`${OR}/models/${id}/endpoints`)
      return { asOf: new Date().toISOString(), id, endpoints: (data.data?.endpoints || []).map(normalizeEndpoint) }
    })
  } catch (e) { return fail(c, e) }
})

app.get('/api/fx', async (c) => {
  try {
    return await cached(c, 'fx', 3600, async () => {
      const data = await getJson(FX)
      if (data.result !== 'success' || !data.rates?.CNY) throw new Error('汇率数据不可用')
      return { rate: data.rates.CNY, asOf: new Date(data.time_last_update_unix * 1000).toISOString(), source: 'open.er-api.com' }
    })
  } catch (e) { return fail(c, e) }
})

app.get('/api/health', (c) => c.json({ ok: true }))

const NAV = [
  ['market', '行情'], ['trade', '交易'], ['models', '模型图谱'], ['compute', '算力中心'],
  ['procure', '采购台'], ['assets', '资产'], ['method', '方法与边界'],
]

app.get('/', (c) => c.html(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>智价台 · 词元经济行情与智能服务交易仿真</title>
<meta name="description" content="以公开模型目录与服务商报价为锚的 AI 推理服务行情、K线与采购履约仿真环境">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%234c8dff'/%3E%3Cpath d='M8 21l5-7 4 4 7-9' stroke='%23fff' stroke-width='3' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<link href="/static/css/app.css" rel="stylesheet">
</head>
<body>
<header id="topbar">
  <a class="brand" href="#/market">
    <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#4c8dff"/><path d="M8 21l5-7 4 4 7-9" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <span class="brand-name">智价台</span><span class="brand-tag">仿真</span>
  </a>
  <nav id="main-nav">${NAV.map(([k, v]) => `<a href="#/${k}" data-nav="${k}">${v}</a>`).join('')}</nav>
  <div class="top-right">
    <button id="data-status" class="chip" type="button" title="数据来源与新鲜度">数据加载中</button>
    <a id="top-balance" class="balance" href="#/assets" title="研究记分：不可充值、不可转让、不可兑换"><span>研究记分</span><b>—</b></a>
    <time id="clock" title="北京时间">--:--:--</time>
  </div>
</header>
<p id="sim-notice"><b>仿真环境</b>模型、服务商与今日报价来自公开目录；成交、盘口与历史走势为合成数据，不是真实行情。研究记分不可充值、不可兑换，不构成投资建议。</p>
<main id="view"><p class="loading">正在加载公开目录快照…</p></main>
<div id="toasts" aria-live="polite"></div>
<script src="/static/vendor/lightweight-charts.js"></script>
<script type="module" src="/static/js/app.js"></script>
</body>
</html>`))

export default app
