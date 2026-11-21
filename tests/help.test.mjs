// 帮助中心：行内标记的渲染；中英文两份手册逐项对齐；手册里引用的按钮名确实是界面文案；链接与截图都对得上
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inline, plain, labelsIn, linksIn, textsOf, shotsOf } from '../public/static/js/help/format.js';
import ZH from '../public/static/js/help/zh.js';
import EN from '../public/static/js/help/en.js';
import SHOTS from '../public/static/js/help/shots.js';
import dict from '../public/static/js/i18n/en.js';
import shell from '../public/static/js/i18n/en-shell.js';
import { PAGES, tourKey } from '../public/static/js/nav.js';
import { ROLES } from '../public/static/js/core/access.js';
import { extract } from '../scripts/i18n-check.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const IDEO = /[\u3400-\u9fff]/;
const all = { ...dict, ...shell };
const byId = (H) => new Map(H.topics.map((t) => [t.id, t]));
const count = (x) => (Array.isArray(x) ? x.length : x == null ? -1 : 1);

test('行内标记：转义 HTML，渲染按钮名、加粗、代码与链接', () => {
  assert.equal(inline('a < b & "c"'), 'a &lt; b &amp; &quot;c&quot;');
  assert.equal(inline('点{{提交申请}}'), '点<b class="ui">提交申请</b>');
  assert.equal(inline('点{{提交申请}}', () => 'Submit'), '点<b class="ui">Submit</b>');
  assert.equal(inline('**重点** 与 `#/access`'), '<strong>重点</strong> 与 <code>#/access</code>');
  assert.equal(inline('见 [入场审批](#/help/access)'), '见 <a href="#/help/access">入场审批</a>');
  assert.match(inline('[外链](https://example.com/a)'), /target="_blank" rel="noopener noreferrer"/);
  assert.equal(inline('{{<img src=x>}}'), '<b class="ui">&lt;img src=x&gt;</b>');
});

test('行内标记：只认站内链接和 https，其他协议当普通文字', () => {
  for (const bad of ['[x](javascript:alert(1))', '[x](http://example.com)', '[x](data:text/html,1)', '[x](//evil.example)']) assert.ok(!inline(bad).includes('<a '), bad);
});

test('纯文字：去掉标记，按钮名按当前语言显示', () => {
  assert.equal(plain('点{{提交申请}}，见 [入场](#/help/access) 的 **说明** `x`', () => 'Submit'), '点Submit，见 入场 的 说明 x');
  assert.deepEqual(labelsIn('{{甲}} 和 {{乙}}'), ['甲', '乙']);
  assert.deepEqual(linksIn('[a](#/help/x) [b](https://e.com) [c](#/trade)'), ['#/help/x', '#/trade']);
});

test('每个页面、每种入场角色都有帮助主题；主题编号不重复', () => {
  const ids = ZH.topics.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of PAGES) if (p.id !== 'help') assert.ok(ids.includes(p.id), `页面缺帮助：${p.id}`);
  for (const r of Object.keys(ROLES)) assert.ok(ids.includes(`role-${r}`), `角色缺帮助：${r}`);
  for (const x of ['start', 'faq', 'glossary']) assert.ok(ids.includes(x), x);
  for (const t of ZH.topics) assert.ok(t.title || PAGES.some((p) => p.id === t.id), `主题没有标题：${t.id}`);
});

test('中英文两份手册逐项对齐：主题、段落、步骤数、截图与标注数', () => {
  assert.deepEqual(EN.topics.map((t) => t.id), ZH.topics.map((t) => t.id));
  const en = byId(EN);
  for (const z of ZH.topics) {
    const e = en.get(z.id);
    assert.deepEqual(Object.keys(e).sort(), Object.keys(z).sort(), `${z.id} 的段落不一致`);
    for (const k of ['who', 'can', 'cannot', 'rules', 'tips', 'steps', 'shots', 'qa', 'terms']) assert.equal(count(e[k]), count(z[k]), `${z.id}.${k} 条数不一致`);
    (z.steps || []).forEach((s, i) => { assert.equal(!!e.steps[i].d, !!s.d, `${z.id} 第 ${i + 1} 步说明`); assert.equal(!!e.steps[i].shot, !!s.shot, `${z.id} 第 ${i + 1} 步截图`); });
    assert.deepEqual(shotsOf(e).map((s) => [s.name, (s.marks || []).length]), shotsOf(z).map((s) => [s.name, (s.marks || []).length]), `${z.id} 的截图或标注数不一致`);
  }
});

test('中英文两份手册在同一处引用同一批按钮名', () => {
  const en = byId(EN);
  for (const z of ZH.topics) {
    // 同一段里引用的是同一批按钮名；英文语序不同，先后顺序可以不一样
    const key = (x) => labelsIn(x).sort().join('|');
    const a = textsOf(z).map(key), b = textsOf(en.get(z.id)).map(key);
    a.forEach((x, i) => assert.equal(b[i], x, `${z.id} 第 ${i + 1} 段引用的按钮名不一致`));
  }
});

test('手册里引用的按钮名都是界面上真实存在的文案，并且有英文', () => {
  const ui = extract();
  for (const H of [ZH, EN]) for (const t of H.topics) for (const s of textsOf(t)) for (const l of labelsIn(s)) {
    assert.ok(ui.has(l) || l in shell, `${t.id}：界面上没有"${l}"这个文案`);
    assert.ok(l in all && !IDEO.test(all[l]), `${t.id}："${l}"缺英文`);
  }
});

test('手册里的站内链接都指向存在的页面或主题', () => {
  for (const H of [ZH, EN]) {
    const ids = new Set(H.topics.map((t) => t.id));
    for (const t of H.topics) for (const s of textsOf(t)) for (const k of linksIn(s)) {
      const [a, b] = k.slice(2).split('/');
      assert.ok(a === 'help' ? (!b || ids.has(b)) : PAGES.some((p) => p.id === a), `${t.id}：链接 ${k} 无效`);
    }
  }
});

test('英文手册除按钮名引用外不含中文；两份手册都不出现"合规通过"', () => {
  const strip = (s) => s.replace(/\{\{[^{}]+\}\}/g, '');
  for (const t of EN.topics) for (const s of textsOf(t)) assert.ok(!IDEO.test(strip(s)), `${t.id}：${s.slice(0, 50)}`);
  for (const s of [...EN.tour.flatMap((x) => [x.t, x.d]), ...Object.values(EN.tourUi)]) assert.ok(!IDEO.test(s), s);
  for (const H of [ZH, EN]) for (const t of H.topics) for (const s of textsOf(t)) assert.ok(!/合规通过|compliance passed/i.test(s), `${t.id}：${s.slice(0, 50)}`);
});

test('新手导览：中英文步数与定位点一致，定位点在外壳或首页里确实存在', () => {
  assert.deepEqual(EN.tour.map((s) => s.sel || ''), ZH.tour.map((s) => s.sel || ''));
  assert.deepEqual(Object.keys(EN.tourUi).sort(), Object.keys(ZH.tourUi).sort());
  const src = fs.readFileSync(`${ROOT}src/index.tsx`, 'utf8') + fs.readFileSync(`${ROOT}public/static/js/views/home.js`, 'utf8');
  for (const s of ZH.tour) if (s.sel) assert.ok(src.includes(`id="${s.sel.slice(1)}"`), `找不到 ${s.sel}`);
  for (const H of [ZH, EN]) for (const s of H.tour) assert.ok(s.t && s.d);
});

test('截图：手册引用的每一张都已生成，标注个数与图上的编号一致', () => {
  for (const lang of ['zh', 'en']) {
    const H = lang === 'zh' ? ZH : EN, M = SHOTS[lang];
    assert.ok(M, `还没有生成 ${lang} 截图`);
    for (const t of H.topics) for (const s of shotsOf(t)) {
      assert.ok(M[s.name], `${lang}/${s.name} 没有生成（${t.id}）`);
      assert.equal((s.marks || []).length, M[s.name].n, `${lang}/${s.name} 的标注说明与图上的编号个数不一致（${t.id}）`);
      assert.ok(fs.existsSync(`${ROOT}public/static/help/${lang}/${s.name}.webp`), `${lang}/${s.name}.webp 不在磁盘上`);
    }
  }
});

test('本页导览：每个功能页面都有一套，同一页面的列表、详情、编辑各用各的', () => {
  for (const p of PAGES) if (p.id !== 'home' && p.id !== 'help') assert.ok(ZH.tours[tourKey(p.id)]?.length >= 3, `页面缺本页导览：${p.id}`);
  assert.equal(tourKey('compute', ['DeepInfra']), 'compute/detail');
  assert.equal(tourKey('listing', ['new']), 'listing/edit');
  assert.equal(tourKey('listing', ['SIM-GP-0001', 'edit']), 'listing/edit');
  assert.equal(tourKey('listing', ['SIM-GP-0001']), 'listing/detail');
  assert.equal(tourKey('listing', []), 'listing');
  assert.equal(tourKey('trade', ['x']), 'trade');
  for (const k of ['compute/detail', 'listing/detail', 'listing/edit']) assert.ok(ZH.tours[k]?.length >= 3, k);
  for (const k of Object.keys(ZH.tours)) assert.ok(PAGES.some((p) => p.id === k.split('/')[0]), `导览对应的页面不存在：${k}`);
});

test('本页导览：中英文逐步对齐，圈的是同一个位置，引用同一批按钮名', () => {
  assert.deepEqual(Object.keys(EN.tours), Object.keys(ZH.tours));
  const key = (x) => labelsIn(x).sort().join('|');
  for (const [k, zh] of Object.entries(ZH.tours)) {
    const en = EN.tours[k];
    assert.deepEqual(en.map((s) => s.sel), zh.map((s) => s.sel), `${k} 的定位点不一致`);
    zh.forEach((s, i) => {
      assert.ok(s.sel && s.t && s.d && en[i].t && en[i].d, `${k} 第 ${i + 1} 步不完整`);
      assert.equal(key(en[i].t + en[i].d), key(s.t + s.d), `${k} 第 ${i + 1} 步引用的按钮名不一致`);
    });
    assert.equal(new Set(zh.map((s) => s.sel)).size, zh.length, `${k} 有重复的定位点`);
  }
});

test('本页导览：定位点在对应页面的源码里确实存在；按钮名是界面文案；英文不含中文', () => {
  const ui = extract();
  const uiJs = fs.readFileSync(`${ROOT}public/static/js/ui.js`, 'utf8');
  const strip = (s) => s.replace(/\{\{[^{}]+\}\}/g, '');
  for (const [k, steps] of Object.entries(ZH.tours)) {
    const src = fs.readFileSync(`${ROOT}public/static/js/views/${k.split('/')[0]}.js`, 'utf8') + uiJs;
    for (const s of steps) {
      const sel = s.sel.replace(/^sec:/, '');
      const m = /^#([\w-]+)$/.exec(sel) || /^\.([\w-]+)$/.exec(sel) || /^\[(href="[^"]+")\]$/.exec(sel);
      assert.ok(m, `${k}：定位点写法不认识 ${s.sel}`);
      const needle = sel.startsWith('#') ? `id="${m[1]}"` : m[1];
      assert.ok(src.includes(needle), `${k}：页面里找不到 ${s.sel}`);
    }
  }
  for (const H of [ZH, EN]) for (const [k, steps] of Object.entries(H.tours)) for (const s of steps) for (const x of [s.t, s.d]) {
    for (const l of labelsIn(x)) { assert.ok(ui.has(l) || l in shell, `${k}：界面上没有"${l}"这个文案`); assert.ok(l in all && !IDEO.test(all[l]), `${k}："${l}"缺英文`); }
    assert.ok(!/合规通过|compliance passed/i.test(x), `${k}：${x.slice(0, 40)}`);
  }
  for (const [k, steps] of Object.entries(EN.tours)) for (const s of steps) for (const x of [s.t, s.d]) assert.ok(!IDEO.test(strip(x)), `${k}：${x.slice(0, 50)}`);
});
