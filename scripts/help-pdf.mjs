// 把帮助中心的"整本手册"页（#/help/print）导出成 PDF。
// 用法：先启动站点，再运行
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs node scripts/help-pdf.mjs [输出目录] [zh|en]
// 本仓库不把 Playwright 列为依赖；没装时这个脚本不能运行，站点里的"打印 / 存为 PDF"按钮不受影响。
import fs from 'node:fs';

const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.argv[2] || '.';
const LANGS = process.argv[3] ? [process.argv[3]] : ['zh', 'en'];
const NAME = { zh: '澳门词元中心（拟议）使用手册', en: 'Macau Token Centre (proposed) User Manual' };
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
for (const lang of LANGS) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 } });
  await ctx.addCookies([{ name: 'lang', value: lang, url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#/help/print`);
  await page.waitForSelector('.help-print article.help-doc', { timeout: 30000 });
  const imgs = await page.evaluate(async () => {
    const all = [...document.querySelectorAll('.shot img')];
    for (const i of all) { try { await i.decode(); } catch { /* 下面统计坏图 */ } }
    const bad = all.filter((i) => !i.naturalWidth).length;
    // PDF 里的图换成 JPEG：WebP 会被按无损重新编码，文件大好几倍；JPEG 可以原样嵌入
    for (const i of all) {
      if (!i.naturalWidth) continue;
      const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight;
      c.getContext('2d').drawImage(i, 0, 0);
      i.src = c.toDataURL('image/jpeg', 0.84);
      await i.decode();
    }
    return { n: all.length, bad };
  });
  if (imgs.bad) throw new Error(`${lang}: ${imgs.bad} 张截图没有加载出来`);
  const version = await page.evaluate(() => document.querySelector('#foot span')?.textContent || '');
  await page.emulateMedia({ media: 'print' });
  const file = `${OUT}/manual-${lang}.pdf`;
  const font = 'font-family: \'Noto Sans CJK SC\', \'PingFang SC\', \'Microsoft YaHei\', sans-serif; font-size: 8px; color: #666;';
  await page.pdf({
    path: file, format: 'A4', printBackground: true, displayHeaderFooter: true,
    margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
    headerTemplate: `<div style="${font} width: 100%; padding: 0 14mm; display: flex; justify-content: space-between;"><span>${NAME[lang]}</span><span>${version}</span></div>`,
    footerTemplate: `<div style="${font} width: 100%; text-align: center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
  });
  console.log(`${lang}: ${file} · ${imgs.n} 张截图 · ${(fs.statSync(file).size / 1048576).toFixed(1)} MB`);
  await ctx.close();
}
await browser.close();
