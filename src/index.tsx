import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
// 与浏览器、快照脚本共用同一份归一实现，避免三处口径不一致
// @ts-ignore 纯 JS 模块
import { normalizeModel, normalizeEndpoint } from '../public/static/js/core/normalize.js'
// @ts-ignore 纯 JS 模块
import { GROUPS } from '../public/static/js/nav.js'
// @ts-ignore 纯 JS 模块
import EN_SHELL from '../public/static/js/i18n/en-shell.js'

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

app.get('/api/health', (c) => c.json({ ok: true, version: VERSION }))
app.all('/api/*', (c) => c.json({ error: '接口不存在' }, 404))

const VERSION = '4.2.0'
const LOGO = `<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#3d8bff"/><path d="M7.5 21.5l5.5-7.5 4 4 7.5-9.5" stroke="#fff" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24.5" cy="8.5" r="2.2" fill="#fff"/></svg>`

// 页面只加载同源脚本与样式，接口只连同源：外部目录数据一律经本 Worker 代理
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'"

// 界面语言：?lang=en|zh 显式指定（并记入 cookie，便于把英文链接发给别人），否则读 cookie，默认中文。
// 外壳由服务端按语言直接输出，页面内容由浏览器按 <html lang> 取同一种语言。
function pickLang(c: any): 'zh' | 'en' {
  const q = c.req.query('lang')
  if (q === 'en' || q === 'zh') {
    setCookie(c, 'lang', q, { path: '/', maxAge: 31536000, sameSite: 'Lax' })
    return q
  }
  return getCookie(c, 'lang') === 'en' ? 'en' : 'zh'
}
const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

app.get('/', (c) => {
  const lang = pickLang(c)
  const en = lang === 'en'
  // 键是中文原文；英文缺词条时退回中文，不留空
  const T = (s: string, ...a: any[]) => attr((en ? (EN_SHELL as any)[s] ?? s : s).replace(/\{(\d+)\}/g, (_: string, i: string) => String(a[Number(i)])))
  c.header('Content-Security-Policy', CSP)
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  c.header('Cache-Control', 'no-cache')
  c.header('Vary', 'Cookie')
  c.header('Content-Language', en ? 'en' : 'zh-CN')
  return c.html(`<!DOCTYPE html>
<html lang="${en ? 'en' : 'zh-CN'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0a0d12">
<title>${T('澳门词元中心（拟议）· AI 产业交易仿真')}</title>
<meta name="description" content="${T('按《全球AI产业交易与Web3／Web4升级方案 V4.0》搭建的仿真环境：公开模型报价行情、版权与服务挂牌、算力服务权益、版税分账、溯源存证与受控 Agent。名称为拟议，未登记、未获品牌授权或金融许可。')}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%233d8bff'/%3E%3Cpath d='M7.5 21.5l5.5-7.5 4 4 7.5-9.5' stroke='%23fff' stroke-width='2.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E">
<link href="/static/css/app.css?v=${VERSION}" rel="stylesheet">
</head>
<body>
<a class="skip" href="#view">${T('跳到主要内容')}</a>
<div id="chrome">
<header id="topbar">
  <a class="brand" href="#/home" aria-label="${T('澳门词元中心（拟议）首页')}">
    ${LOGO}
    <span class="brand-text"><span class="brand-name">${T('澳门词元中心')}</span><span class="brand-sub">${T('AI 产业交易仿真')}</span></span>
    <span class="brand-tag" title="${T('拟议名称：不是已核准登记的名称，不是广州数据交易所澳门分支，未取得交易所或金融业务许可')}">${T('拟议 · 仿真')}</span>
  </a>
  <nav id="main-nav" aria-label="${T('主导航')}">${GROUPS.filter((g: any) => g.id !== 'help').map((g: any) => `<a href="#/${g.pages[0][0]}" data-group="${g.id}">${T(g.name)}</a>`).join('')}</nav>
  <div class="top-right">
    <button id="cmdk-btn" class="search-btn" type="button" title="${T('搜索页面、模型、算力中心、挂牌（Ctrl / ⌘ + K）')}"><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.6 10.6L14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><span>${T('搜索')}</span><kbd>Ctrl K</kbd></button>
    <a id="help-btn" class="search-btn help-btn" href="#/help" title="${T('帮助中心：产品手册与新手导览')}" aria-label="${T('帮助中心')}"><i aria-hidden="true">?</i><span>${T('帮助')}</span></a>
    <button id="data-status" class="chip" type="button" title="${T('数据来源与新鲜度')}">${T('数据加载中')}</button>
    <a id="member-chip" class="chip" href="#/access" title="${T('入场状态')}">${T('未入场')}</a>
    <a id="top-balance" class="balance" href="#/assets" title="${T('研究记分：不可充值、不可转让、不可兑换')}"><span>${T('研究记分')}</span><b>—</b></a>
    <time id="clock" title="${T('北京时间')}">--:--:--</time>
    <div id="lang-switch" class="lang-switch" role="group" aria-label="${T('切换语言')}" translate="no"><button type="button" data-lang="zh" lang="zh-CN" aria-pressed="${!en}"${en ? '' : ' class="on"'}>中文</button><button type="button" data-lang="en" lang="en" aria-pressed="${en}"${en ? ' class="on"' : ''}>EN</button></div>
  </div>
</header>
<nav id="sub-nav" aria-label="${T('二级导航')}"></nav>
</div>
<div id="sim-notice"><b>${T('仿真环境')}</b><span class="full">${T('"澳门词元中心"是拟议名称，未登记、未获品牌授权或金融许可。模型与报价来自公开目录；成交、盘口、挂牌、许可、权益与分账均为合成或示例数据。研究记分不可充值、不可兑换，不构成投资建议。')}</span><span class="short">${T('拟议名称 · 公开报价为真实数据 · 其余为合成或示例')}</span><button id="notice-toggle" type="button" aria-expanded="true">${T('收起')}</button></div>
<main id="view" tabindex="-1"><div class="boot"><div class="spinner" aria-hidden="true"></div><p>${T('正在加载公开目录快照…')}</p></div></main>
<footer id="foot">
  <span>${T('方案版本 V4.0 · 站点 {0}', VERSION)}</span>
  <span id="foot-store" title="${T('本机存储状态')}">${T('本机存储检查中')}</span>
  <span id="foot-net">${T('网络正常')}</span>
  <span class="sp"></span>
  <a href="#/help">${T('帮助中心')}</a>
  <a href="#/method">${T('方法与边界')}</a>
  <span>${T('不代表广州数据交易所或任何机构的官方意见')}</span>
</footer>
<div id="toasts" role="status" aria-live="polite"></div>
<noscript><p style="padding:40px;text-align:center">${T('本页面需要启用 JavaScript。')}</p></noscript>
<script src="/static/vendor/lightweight-charts.js"></script>
<script type="module" src="/static/js/app.js?v=${VERSION}"></script>
</body>
</html>`)
})

// 页面路由全部在 # 之后；带扩展名的未知路径按文件处理返回 404，其余回到首页
app.notFound((c) => (/\.[a-z0-9]+$/i.test(c.req.path) ? c.text('Not Found', 404) : c.redirect('/')))
app.onError((e, c) => {
  console.error(e)
  return c.req.path.startsWith('/api/') ? c.json({ error: '服务暂时不可用' }, 500) : c.text('服务暂时不可用，请稍后刷新。 Service temporarily unavailable. Please reload shortly.', 500)
})

export default app
