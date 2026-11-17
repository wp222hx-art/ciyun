// 拉取公开目录的离线快照：模型目录 + 服务商名录 + 每个模型的部署端点 + 汇率
// 用法：node scripts/snapshot.mjs
// 产物：public/static/data/snapshot.json（上游不可达时页面以此兜底，并显示快照时间）
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { normalizeModel, normalizeEndpoint, normalizeProvider, diffEndpoints } from '../public/static/js/core/normalize.js';

const OR = 'https://openrouter.ai/api/v1';
const FX = 'https://open.er-api.com/v6/latest/USD';
const CONCURRENCY = 6;

async function getJson(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) return { error: `HTTP ${res.status}` };
      return { data: await res.json() };
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  return { error: String(lastErr?.message || lastErr) };
}

const started = Date.now();
const [cat, prov, fx] = await Promise.all([getJson(`${OR}/models`), getJson(`${OR}/providers`), getJson(FX)]);
if (cat.error) throw new Error(`模型目录拉取失败：${cat.error}`);
if (fx.error || fx.data?.result !== 'success') throw new Error(`汇率拉取失败：${fx.error || fx.data?.result}`);

const models = cat.data.data.map(normalizeModel);
const providers = prov.error ? [] : prov.data.data.map(normalizeProvider);
if (prov.error) console.warn('服务商名录拉取失败：', prov.error);

const targets = models.filter((m) => m.kind === 'model');
const endpoints = {};
const failed = [];
let done = 0;
async function worker(queue) {
  for (;;) {
    const m = queue.shift();
    if (!m) return;
    const r = await getJson(`${OR}/models/${m.id}/endpoints`);
    if (r.error) failed.push({ id: m.id, error: r.error });
    else endpoints[m.id] = (r.data?.data?.endpoints || []).map(normalizeEndpoint);
    if (++done % 60 === 0) console.log(`  端点 ${done}/${targets.length}`);
  }
}
const queue = [...targets];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));

const snapshot = {
  asOf: new Date().toISOString(),
  source: 'OpenRouter 公开目录 API（/models、/providers、/models/{id}/endpoints）',
  fx: { rate: fx.data.rates.CNY, asOf: new Date(fx.data.time_last_update_unix * 1000).toISOString(), source: 'open.er-api.com' },
  models,
  providers,
  endpoints,
  endpointFailures: failed,
};

await mkdir(new URL('../public/static/data/', import.meta.url), { recursive: true });
const out = new URL('../public/static/data/snapshot.json', import.meta.url);
const body = JSON.stringify(snapshot);

// 与上一份快照比较，把真实调价记入 history.json（最多保留 30 个观测区间）
const histUrl = new URL('../public/static/data/history.json', import.meta.url);
const readJson = async (u) => { try { return JSON.parse(await readFile(u, 'utf8')); } catch { return null; } };
const prev = await readJson(out);
if (prev && prev.asOf !== snapshot.asOf && prev.endpoints) {
  const d = diffEndpoints(prev.endpoints, endpoints);
  const before = new Set(prev.models.map((m) => m.id)), after = new Set(models.map((m) => m.id));
  const hist = (await readJson(histUrl)) || { intervals: [] };
  hist.intervals.push({
    from: prev.asOf, to: snapshot.asOf, compared: d.compared, epAdded: d.added, epRemoved: d.removed,
    modelsAdded: [...after].filter((x) => !before.has(x)), modelsRemoved: [...before].filter((x) => !after.has(x)),
    changes: d.changes.slice(0, 400), totalChanges: d.changes.length,
  });
  hist.intervals = hist.intervals.slice(-30);
  await writeFile(histUrl, JSON.stringify(hist));
  console.log(`与上一份快照（${prev.asOf}）比较：同端点 ${d.compared} 个，其中调价 ${d.changes.length} 个；新增端点 ${d.added}，下线端点 ${d.removed}`);
}
await writeFile(out, body);

const epCount = Object.values(endpoints).reduce((s, e) => s + e.length, 0);
console.log(JSON.stringify({
  seconds: Math.round((Date.now() - started) / 1000),
  models: models.length,
  exactVersions: targets.length,
  aliases: models.filter((m) => m.kind === 'alias').length,
  routers: models.filter((m) => m.kind === 'router').length,
  providers: providers.length,
  modelsWithEndpoints: Object.keys(endpoints).length,
  endpoints: epCount,
  failed: failed.length,
  fx: snapshot.fx.rate,
  bytes: body.length,
}, null, 2));
if (failed.length) console.log('失败样例：', failed.slice(0, 5));
