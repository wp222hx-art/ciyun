// 帮助中心截图：在真实界面上把主流程走一遍，边走边截图，并按帮助内容里 marks 的顺序打上编号。
// 用法：先启动站点（默认 http://localhost:3000），再运行
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs node scripts/help-shots.mjs [zh|en]
// 只重拍其中几张（其余保持不动）：ONLY=tour,page-tour node scripts/help-shots.mjs
// 产物：public/static/help/{zh,en}/*.webp 与 public/static/js/help/shots.js（清单）。
// 本仓库不把 Playwright 列为依赖；没装时这个脚本不能运行，站点本身不受影响。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:3000';
const ROOT = fileURLToPath(new URL('../public/static/', import.meta.url));
const LANGS = process.argv[2] ? [process.argv[2]] : ['zh', 'en'];
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',').map((x) => x.trim()).filter(Boolean)) : null;
const W = 1280, TALL = 3200, DSF = 1.5;
const manifestFile = `${ROOT}js/help/shots.js`;
const manifest = (await import(`${manifestFile}?t=${Date.now()}`)).default;

const browser = await chromium.launch();
const conv = await (await browser.newContext()).newPage();
const toWebp = async (png) => Buffer.from(await conv.evaluate(async (b64) => {
  const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  return c.toDataURL('image/webp', 0.8).split(',')[1];
}, png.toString('base64')), 'base64');

let failed = 0;
for (const lang of LANGS) {
  const EN = lang === 'en', L = (zh, en) => (EN ? en : zh);
  const ctx = await browser.newContext({ viewport: { width: W, height: TALL }, deviceScaleFactor: DSF });
  await ctx.addCookies([{ name: 'lang', value: lang, url: BASE }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
  const outDir = `${ROOT}help/${lang}/`;
  if (!ONLY) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const out = {};
  const wait = (ms) => page.waitForTimeout(ms);
  const go = async (hash, sel, ms = 1100) => { await page.evaluate((h) => { location.hash = `#/${h}`; }, hash); await page.waitForSelector(sel, { timeout: 20000 }); await wait(ms); };
  const click = async (sel, ms = 350) => { await page.click(sel); await wait(ms); };
  const dlg = async (val) => { await page.waitForSelector('dialog.dlg[open]', { timeout: 6000 }); if (val !== undefined) await page.fill('dialog.dlg .dlg-in', String(val)); await page.click('dialog.dlg button[type=submit]'); await wait(350); };

  /** clip / marks 里的写法：'#a' 单个元素；'sec:#a' 所在的 section；'lab:#a' 所在的 label；'all:.a' 全部匹配；数组取并集 */
  async function snap(name, { clip, marks = [], pad = marks.length ? 18 : 8, maxH = 0, mode = 'page', vh = 800 } = {}) {
    if (ONLY && !ONLY.has(name)) return; // 只重拍指定的几张：流程照走，这一张不拍
    try {
      await page.setViewportSize({ width: W, height: mode === 'page' ? TALL : vh });
      if (mode === 'page') await page.evaluate(() => window.scrollTo(0, 0));
      await wait(250);
      const box = await page.evaluate(({ clip, marks, pad, maxH, mode, W }) => {
        document.querySelectorAll('#toasts > *').forEach((e) => e.remove());
        const one = (spec) => {
          const [, pre, sel] = /^(sec:|lab:|all:)?(.*)$/.exec(spec);
          const els = pre === 'all:' ? [...document.querySelectorAll(sel)] : [document.querySelector(sel)];
          return els.map((e) => { if (!e) throw new Error(`找不到 ${spec}`); const t = pre === 'sec:' ? e.closest('section') : pre === 'lab:' ? e.closest('label') : e; if (!t) throw new Error(`没有外层 ${spec}`); return t.getBoundingClientRect(); });
        };
        const union = (spec) => {
          const rs = [].concat(spec).flatMap(one).filter((r) => r.width > 0 && r.height > 0);
          if (!rs.length) throw new Error(`不可见 ${JSON.stringify(spec)}`);
          return { x: Math.min(...rs.map((r) => r.left)), y: Math.min(...rs.map((r) => r.top)), r: Math.max(...rs.map((r) => r.right)), b: Math.max(...rs.map((r) => r.bottom)) };
        };
        const vh = window.innerHeight;
        const u = clip ? union(clip) : { x: 0, y: 0, r: W, b: vh };
        const c = { x: Math.max(0, Math.floor(u.x - pad)), y: Math.max(0, Math.floor(u.y - pad)) };
        c.w = Math.min(W, Math.ceil(u.r + pad)) - c.x; c.h = Math.ceil(u.b + pad) - c.y;
        if (mode !== 'page') c.h = Math.min(c.h, vh - c.y);
        if (maxH && c.h > maxH) c.h = maxH;
        const layer = document.createElement('div'); layer.id = '__marks';
        layer.style.cssText = `position:${mode === 'page' ? 'absolute' : 'fixed'};left:0;top:0;width:0;height:0;z-index:99999;pointer-events:none`;
        marks.forEach((m, i) => {
          const r = union(m);
          const x = Math.max(c.x + 2, r.x - 3), y = Math.max(c.y + 2, r.y - 3), x2 = Math.min(c.x + c.w - 2, r.r + 3), y2 = Math.min(c.y + c.h - 2, r.b + 3);
          if (x2 - x < 6 || y2 - y < 6) throw new Error(`第 ${i + 1} 个标注落在截图范围外`);
          const o = document.createElement('div');
          o.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${x2 - x}px;height:${y2 - y}px;border:2px solid #f0b90b;border-radius:6px;box-sizing:border-box`;
          const b = document.createElement('div'); b.textContent = String(i + 1);
          b.style.cssText = `position:absolute;left:${Math.max(c.x + 1, x - 19)}px;top:${Math.max(c.y + 1, y - 15)}px;width:22px;height:22px;border-radius:50%;background:#f0b90b;color:#14181f;font:700 12px/22px ui-monospace,Menlo,Consolas,monospace;text-align:center;box-shadow:0 0 0 2px #0a0d12`;
          layer.append(o, b);
        });
        document.body.append(layer);
        return c;
      }, { clip, marks, pad, maxH, mode, W });
      const png = await page.screenshot({ fullPage: mode === 'page', clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
      fs.writeFileSync(`${outDir}${name}.webp`, await toWebp(png));
      out[name] = { w: box.w, h: box.h, n: marks.length };
    } catch (e) { failed++; console.log(`  FAIL ${lang}/${name}: ${String(e.message).split('\n')[0]}`); }
    await page.evaluate(() => document.getElementById('__marks')?.remove()).catch(() => {});
    await page.setViewportSize({ width: W, height: TALL });
  }

  await page.goto(`${BASE}/`);
  await page.waitForSelector('#view .page.v-home', { timeout: 30000 });
  await wait(2500);

  // ---- 总览、搜索、导览（导览结束后欢迎条消失，所以先拍总览）
  await snap('home', { clip: ['#chrome', '#sim-notice', '#welcome', '.hero', '#kpi'], pad: 0,
    marks: ['#main-nav', '#cmdk-btn', '#help-btn', '#member-chip', '#top-balance', '#lang-switch', '#sim-notice', '#welcome', '#kpi'] });
  await page.setViewportSize({ width: W, height: 760 }); await wait(200);
  await page.keyboard.press('Control+k'); await page.waitForSelector('dialog.cmdk[open]');
  await page.fill('dialog.cmdk input', L('挂牌', 'listing')); await wait(400);
  await snap('search', { mode: 'viewport', vh: 760, maxH: 600 });
  await page.keyboard.press('Escape'); await wait(200);
  await page.setViewportSize({ width: W, height: 760 }); await wait(200);
  await click('#welcome [data-tour]', 900); await page.waitForSelector('.tour-pop');
  await click('.tour-pop [data-t="next"]', 400);
  await snap('tour', { mode: 'viewport', vh: 760, maxH: 440 });
  await page.keyboard.press('Escape'); await wait(300);

  // ---- 行情
  await go('market', '#tbl tbody tr[data-id]', 2200);
  // 本页导览：在行情总览上走到第 2 步再拍
  await page.setViewportSize({ width: W, height: 760 }); await wait(200);
  await click('#sub-nav [data-page-tour]', 700); await page.waitForSelector('.tour-pop');
  await click('.tour-pop [data-t="next"]', 500);
  await snap('page-tour', { mode: 'viewport', vh: 760, maxH: 560 });
  await page.keyboard.press('Escape'); await wait(300);
  await page.setViewportSize({ width: W, height: TALL }); await wait(200);
  await snap('market', { clip: ['.stats-bar', '#idx-cards', 'sec:#idx-chart', 'sec:#movers', 'sec:#heat'], marks: ['.stats-bar', '#idx-cards', 'sec:#idx-chart', 'sec:#movers', 'sec:#heat'] });
  await snap('market-table', { clip: 'sec:#tbl', maxH: 430, marks: ['#tabs', '#q', '#tbl tbody tr[data-id]'] });
  await go('daily', '#matrix table', 2500);
  await snap('daily-real', { clip: '#real', maxH: 620 });
  await snap('daily', { clip: ['sec:#cells', '#detail', '#lists'], maxH: 900, marks: ['#cells', ['#detail', '#lists']] });
  await go('models', '#tbl tbody tr[data-id]', 800);
  await click('#tbl tbody tr[data-id]');
  await snap('models', { clip: ['.stats-bar', 'sec:#tbl'], maxH: 640, marks: ['#ktabs', '#brand', '#q', 'tr.detail'] });
  await go('compute', '#tbl tbody tr[data-center]', 1500);
  await snap('compute', { clip: ['.cards', '.grid-half'], marks: ['.cards', '.grid-half table', 'sec:#q-chart'] });
  await snap('compute-cost', { clip: 'sec:#cost-form' });

  // ---- 入场：先演示被拦下，再走通
  await go('access', '#apply');
  await click('[data-act="fill"]');
  await snap('access-form', { clip: '#main', marks: ['[data-act="fill"]', 'lab:#apply [name=role]', 'lab:#apply [name=channel]', 'lab:#apply [name=uscc]', '#apply .mat', 'lab:#apply [name=category]', 'lab:#apply [name=pii]', '#apply button[type=submit]'] });
  await page.selectOption('#apply [name=category]', 'resale');
  await click('#apply button[type=submit]'); await page.waitForSelector('[data-act="auto"]');
  await click('[data-act="auto"]', 500);
  await snap('access-blocked', { clip: ['sec:#pipe', '#main'] });
  await click('[data-act="return"]'); await page.waitForSelector('#apply');
  await page.selectOption('#apply [name=category]', 'kb'); await wait(200);
  await click('#apply button[type=submit]'); await page.waitForSelector('[data-act="pass"]');
  await snap('access-review', { clip: ['sec:#pipe', '#main'], marks: ['#pipe', '#main .checks', '[data-act="pass"]', '[data-act="return"]', '[data-act="auto"]'] });
  await click('[data-act="auto"]', 600); await page.waitForSelector('#cert');
  await snap('access-cert', { clip: '#main' });

  // ---- 交易、资产
  await go('trade', '#book .book-row', 1800);
  await snap('trade', { clip: ['.inst-head', '.terminal'], marks: ['#pick', '#h-stats', '#views', '#tfs', '#book', '.col-order'] });
  await snap('trade-order', { clip: '.col-order', pad: 14, marks: ['.side-tabs', '#otype', '#o-price', '#o-qty', '.pct', '#o-submit'] });
  await click('#otype [data-type="market"]'); await page.fill('#o-qty', '10'); await click('#o-submit', 500);
  const last = Number(await page.textContent('#h-last'));
  await click('#otype [data-type="limit"]'); await page.fill('#o-price', String((last * 0.95).toPrecision(4))); await page.fill('#o-qty', '5'); await click('#o-submit', 500);
  await click('#btabs [data-btab="fills"]');
  await snap('trade-bottom', { clip: 'sec:#btabs', maxH: 300 });
  await go('assets', '#cards .card', 800);
  await snap('assets', { clip: ['.page-head', '#cards', 'sec:#tabs', 'sec:#recon'], marks: ['#cards', '#tabs', '#recon', '#reset'] });

  // ---- 采购
  await go('procure', '#rfq');
  await snap('procure', { clip: ['#steps', 'sec:#rfq'], marks: ['#steps', 'lab:#rfq [name=task]', 'lab:#rfq [name=volume]', ['lab:#rfq [name=floor]', 'lab:#rfq [name=uptime]'], 'lab:#rfq [name=region]', '#rfq button[type=submit]'] });
  await click('#rfq button[type=submit]'); await page.waitForSelector('#result [data-sign]'); await wait(300);
  await snap('procure-result', { clip: '#result', maxH: 520, marks: ['#result [data-sign]', '#ttl'] });
  await click('#result [data-sign]', 500); await click('[data-deliver]', 500);
  await snap('procure-contract', { clip: 'sec:#contracts', maxH: 520 });
  await click('[data-settle]', 400);

  // ---- 挂牌：大厅 → 新建 → 被拦 → 三审 → 发布 → 询价 → 锁定 → 签约 → 到账 → 交付 → 验收
  await go('listing', '#grid .lst-card');
  await snap('listing', { clip: ['.page-head', '#stats', 'sec:#tabs', '#grid'], marks: ['#stats', '#tabs', '#cat', '#q', '#view a.btn.primary[href="#/listing/new"]', '#grid .lst-card'] });
  await go('listing/new', '#card');
  await snap('listing-new', { mode: 'viewport', vh: 860, clip: ['#card', '#side'], marks: ['#card', '#side', '#card button[type=submit]', '#card [data-fill]', '#left'] });
  await click('#card button[type=submit]', 700);
  const id = (await page.evaluate(() => location.hash)).split('/').pop();
  await page.waitForSelector('.stepper'); await wait(400);
  await snap('listing-blocked', { clip: ['.page-head', 'sec:.stepper', '.callout'] });
  await go(`listing/${id}/edit`, '#card');
  await click('#card [data-fill]'); await click('#card button[type=submit]', 700);
  await page.waitForSelector('[data-act="submit"]'); await click('[data-act="submit"]', 500);
  await page.waitForSelector('[data-act="pass"]');
  await snap('listing-review', { clip: ['.page-head', 'sec:.stepper'], marks: ['.stepper', '[data-act="pass"]', '[data-act="auto"]', '[data-act="back"]'] });
  await snap('listing-checks', { clip: 'sec:.review-cols' });
  await click('[data-act="auto"]', 500); await click('[data-act="publish"]', 600);
  await page.waitForSelector('#rfq');
  await page.fill('#rfq [name=buyer]', L('示例发行方（虚构）', 'Example Distributor (fictional)'));
  await snap('listing-rfq', { clip: 'sec:#rfq', marks: ['lab:#rfq [name=buyer]', 'all:#rfq .field-row', '#rfq button[type=submit]'] });
  await click('#rfq button[type=submit]', 500);
  await click('[data-oact="quote"]'); await dlg(2400);
  await click('[data-oact="lock"]', 500);
  await snap('listing-order', { clip: 'sec:[data-oact="sign"]', marks: ['[data-oact="sign"]', '[data-oact="tamper"]', '.hash.copy'] });
  await click('[data-oact="sign"]', 500);
  await click('[data-oact="pay"]'); await dlg('SIM-BANK-0001');
  await click('[data-oact="deliver"]', 500); await click('[data-oact="accept"]', 500);
  await snap('listing-order-done', { clip: 'sec:.hash.copy' });

  // ---- 算力权益
  await go('entitle', '[data-act="replay"]');
  await click('[data-act="replay"]', 500);
  await snap('entitle-replay', { clip: 'sec:#replay' });
  await page.check('#reg [name=transferable]');
  await click('#reg button[type=submit]', 500);
  await snap('entitle-reg', { clip: ['sec:#reg', '#batches'], marks: ['#reg', 'lab:#reg [name=transferable]', '#reg button[type=submit]', '[data-act="book"]', '[data-act="oversell"]'] });
  await click('[data-act="book"]'); await dlg(L('企业A（虚构）', 'Company A (fictional)')); await dlg(400);
  await click('[data-act="use"]'); await dlg(100);
  await snap('entitle-ents', { clip: '#ents', marks: ['[data-act="use"]', '[data-act="transfer"]', '[data-act="dup"]'] });
  await click('[data-act="transfer"]'); await dlg(L('制作方B（虚构）', 'Producer B (fictional)')); await dlg(200);
  await snap('entitle-transfer', { clip: '#transfers', marks: ['[data-act="ok-s"]', '[data-act="ok-r"]'] });
  await click('[data-act="ok-s"]'); await click('[data-act="ok-r"]');

  // ---- 版税分账
  await go('royalty', '#out');
  await snap('royalty', { clip: ['sec:#f', 'sec:#out', 'sec:#rev'], marks: ['lab:#f [name=gross]', 'lab:#f [name=feePct]', '#ded', '#spl', 'lab:#f [name=received]', '#out', '#rev', '[data-act="save"]'] });
  await click('[data-act="save"]');

  // ---- 受控 Agent
  await go('agent', '#issue');
  await click('#issue button[type=submit]', 500);
  await snap('agent-issue', { clip: ['sec:#issue', '#creds'], marks: ['lab:#issue [name=role]', ['lab:#issue [name=amountCap]', 'lab:#issue [name=days]'], '#issue .field-row', '#issue .field-row ~ .field-row', 'lab:#issue [name=canSign]', '#issue button[type=submit]', '#creds'] });
  for (const i of [0, 1, 3, 4, 5, 6, 7, 8, 2]) await click(`[data-scene="${i}"]`, 250);
  await snap('agent-sim', { clip: 'sec:#sim', marks: ['.scn', 'lab:#sim-cred', '#sim button[type=submit]', '#verdict'] });
  await snap('agent-audit', { clip: '#audit', maxH: 440 });

  // ---- 溯源存证
  await go('evidence', '#metrics');
  await click('[data-act="verify"]'); await click('[data-act="anchor"]', 600);
  await snap('evidence', { clip: ['#metrics', 'sec:#msg'], marks: ['#metrics', '[data-act="verify"]', '[data-act="tamper"]', '[data-act="anchor"]', '#batches'] });
  await snap('evidence-ledger', { clip: 'sec:#ledger', maxH: 460, marks: ['#groups', '[data-prove]'] });
  await click('[data-prove]', 600);
  await snap('evidence-proof', { clip: '#proof' });

  // ---- 跨法域、财务、出海、方法
  await go('juris', '#result');
  await click('[data-preset="0"]');
  await snap('juris', { clip: ['sec:#jf', '#result'], maxH: 1100, marks: ['.scn', ['lab:#jf [name=product]', 'lab:#jf [name=payment]'], '.matrix5', '#result .callout', '#result table'] });
  await click('[data-preset="3"]');
  await snap('juris-closed', { clip: '#result', maxH: 460 });
  await go('finance', '#kpi', 1200);
  await snap('finance', { clip: ['.page-head', '.callout', 'sec:#scn', '#kpi'], marks: ['#scn', '#sliders', '#kpi'] });
  await snap('finance-years', { clip: 'sec:#years' });
  await go('bay', '#cn-chart canvas', 1500);
  await snap('bay', { clip: ['.page-head', 'sec:.arch', '.cards', '.grid-2'], maxH: 1000, marks: ['.arch', '.cards', '.grid-2 table'] });
  await go('method', '.prose', 600);
  await snap('method', { clip: '#view .page', maxH: 760 });

  // ---- 供给方：撤销后以供给方入场，拍上架预检；再回总览拍打了勾的上手路径
  await go('access', '#ledger table');
  await snap('access-ledger', { clip: '#ledger', maxH: 520, marks: ['#ledger [data-act="verify"]', '#ledger [data-act="tamper"]'] });
  await click('[data-act="revoke"]'); await dlg(); await page.waitForSelector('#apply');
  await page.selectOption('#apply [name=role]', 'supplier'); await wait(300);
  await click('[data-act="fill"]'); await click('#apply button[type=submit]'); await page.waitForSelector('[data-act="auto"]');
  await click('[data-act="auto"]', 600); await page.waitForSelector('#listing table');
  await snap('access-precheck', { clip: '#listing', maxH: 480 });
  await go('home', '#quick a', 800);
  await snap('home-path', { clip: 'sec:#quick' });

  manifest[lang] = ONLY ? { ...manifest[lang], ...out } : out;
  console.log(`${lang}: ${Object.keys(out).length} 张${ONLY ? `（只重拍 ${[...ONLY].join('、')}）` : ''}`);
  if (ONLY) for (const n of ONLY) if (!out[n]) { failed++; console.log(`  FAIL ${lang}/${n}: 没有这张截图，或没拍成`); }
  await ctx.close();
}
await browser.close();
manifest.v = Math.floor(Date.now() / 1000);
const body = ['zh', 'en'].filter((l) => manifest[l]).map((l) => `  ${l}: {\n${Object.entries(manifest[l]).map(([k, v]) => `    '${k}': { w: ${v.w}, h: ${v.h}, n: ${v.n} },`).join('\n')}\n  },`).join('\n');
fs.writeFileSync(manifestFile, `// 由 scripts/help-shots.mjs 生成：截图名 → 显示尺寸与标注个数。不要手改。\nexport default {\n  v: ${manifest.v},\n${body}\n};\n`);
console.log(failed ? `有 ${failed} 张没拍成` : '全部完成');
process.exit(failed ? 1 : 0);
