// 中英文切换：翻译引擎的行为、词典完整性、以及"切换语言不改变数据与规则"
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { create, $t, tx, LANG } from '../public/static/js/i18n.js';
import { audit } from '../scripts/i18n-check.mjs';
import shell from '../public/static/js/i18n/en-shell.js';
import dict from '../public/static/js/i18n/en.js';
import { GROUPS, PAGES } from '../public/static/js/nav.js';
import * as rights from '../public/static/js/core/rights.js';

const D = { '已预订 {0}，权益 {1}': 'Booked {0}; entitlement {1}', '供方': 'Supplier', '买方': 'Buyer', '必填未齐：{0}': 'Required items missing: {0}', '权利人 holder': 'Rights holder (holder)', '许可地域 territory': 'Licensed territory (territory)',
  '未满足：{0}': 'Not met: {0}', '授权在有效期内': 'Authorisation is within its validity period', '授权已于 {0} 过期': 'Authorisation expired on {0}', '{0} 条': '{0}', '系统': 'System' };

test('中文界面：$t 只做插值，原文一字不动', () => {
  assert.equal(LANG, 'zh');
  assert.equal($t('已预订 {0}，权益 {1}', 400, 'SIM-QY-0002'), '已预订 400，权益 SIM-QY-0002');
  assert.equal(tx('供方'), '供方');
  const off = create(D, false);
  assert.equal(off.t('必填未齐：{0}', '权利人 holder'), '必填未齐：权利人 holder');
  assert.equal(off.misses.size, 0);
});

test('英文界面：按词典翻译并插值；缺词条时退回中文并记下来', () => {
  const e = create(D);
  assert.equal(e.t('已预订 {0}，权益 {1}', 400, 'SIM-QY-0002'), 'Booked 400; entitlement SIM-QY-0002');
  assert.equal(e.t('没有收录的句子 {0}', 7), '没有收录的句子 7');
  assert.deepEqual([...e.misses], ['没有收录的句子 {0}']);
});

test('英文界面：插值里带的中文（来自规则模块或已保存数据）一并翻译，HTML 片段不动', () => {
  const e = create(D);
  assert.equal(e.t('{0} 条', '供方'), 'Supplier');
  assert.equal(e.t('必填未齐：{0}', '<b>供方</b>'), 'Required items missing: <b>供方</b>');
  // 已转义的文本翻译后仍是转义的
  const e2 = create({ '甲 & 乙': 'A & B', '名称：{0}': 'Name: {0}' });
  assert.equal(e2.t('名称：{0}', '甲 &amp; 乙'), 'Name: A &amp; B');
});

test('英文界面：规则模块拼好的整句能拆回句式、列表逐项翻译', () => {
  const e = create(D);
  assert.equal(e.tx('必填未齐：权利人 holder、许可地域 territory'), 'Required items missing: Rights holder (holder), Licensed territory (territory)');
  assert.equal(e.tx('未满足：授权在有效期内'), 'Not met: Authorisation is within its validity period');
  assert.equal(e.tx('授权在有效期内：授权已于 2026-06-30 过期'), 'Authorisation is within its validity period: Authorisation expired on 2026-06-30');
  assert.equal(e.tx('供方；买方'), 'Supplier; Buyer');
  assert.equal(e.tx('  供方 '), '  Supplier ');
  // 翻不全就整段保留原文，不输出半中半英
  assert.equal(e.tx('供方、某个没收录的词'), '供方、某个没收录的词');
  assert.equal(e.tx('SIM-GP-0001'), 'SIM-GP-0001');
});

test('词典完整：界面与规则模块里的每条中文都有英文，占位符一致，译文不残留中文', async () => {
  const r = await audit();
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.broken, []);
  assert.ok(r.entries > 2400, `词典只有 ${r.entries} 条`);
});

test('外壳：服务端渲染用到的每条文案、每个导航分组和页面名都有英文', () => {
  const src = fs.readFileSync(new URL('../src/index.tsx', import.meta.url), 'utf8');
  const used = [...src.matchAll(/\bT\('((?:[^'\\]|\\.)+)'/g)].map((m) => m[1]);
  assert.ok(used.length > 25);
  for (const k of used) assert.ok(k in shell, `外壳缺英文：${k}`);
  for (const g of GROUPS) assert.ok(g.name in shell, `导航分组缺英文：${g.name}`);
  const all = { ...dict, ...shell };
  for (const p of PAGES) { assert.ok(p.name in all, `页面名缺英文：${p.name}`); assert.ok(p.desc in all, `页面说明缺英文：${p.desc}`); }
});

test('切换语言不影响规则：误导措辞用英文写也拦，结论与中文写法相同', () => {
  assert.equal(rights.BANNED_WORDS_EN.length, rights.BANNED_WORDS.length);
  for (const w of rights.BANNED_WORDS) assert.ok(dict[w], `禁用措辞缺英文：${w}`);
  assert.deepEqual(rights.BANNED_WORDS.map((w) => dict[w]), rights.BANNED_WORDS_EN);
  const S = rights.blank(), base = S.listings[0], day = '2026-11-20';
  const last = (c) => rights.review(S, c, day).flat().at(-1);
  assert.equal(last(base).ok, true);
  const zh = last({ ...base, title: '保本短片' }), en = last({ ...base, title: 'A Capital Guaranteed short film' });
  assert.equal(zh.ok, false);
  assert.equal(en.ok, false);
  assert.equal(en.note, zh.note);
});
