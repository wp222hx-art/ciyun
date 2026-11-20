// 切换语言时保留填到一半的表单：只带走改动过的输入项，认不出的、敏感的、过期的都不带
import test from 'node:test';
import assert from 'node:assert/strict';
import * as keep from '../public/static/js/formkeep.js';

// 不依赖浏览器：用最小的假元素和假 sessionStorage
const field = (o) => ({ tagName: 'INPUT', type: 'text', name: '', id: '', value: '', checked: false, dataset: {}, disabled: false, readOnly: false, options: [], events: [], dispatchEvent(e) { this.events.push(e.type); }, ...o });
const rootOf = (els) => ({ querySelectorAll: () => els });
const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), size: () => m.size }; };

test('输入项的身份：name → id → 行号；复选框带上取值；认不出的不参与', () => {
  assert.equal(keep.keyOf(field({ name: 'org' })), 'n:org');
  assert.equal(keep.keyOf(field({ name: 'territory', type: 'checkbox', value: 'PT' })), 'n:territory=PT');
  assert.equal(keep.keyOf(field({ id: 'o-price', type: 'number' })), '#o-price');
  assert.equal(keep.keyOf(field({ dataset: { k: 'splits', i: '1', f: 'pct' } })), 'k:splits:1:pct');
  assert.equal(keep.keyOf(field({})), '');
});

test('密码、文件、隐藏域不记录', () => {
  for (const type of ['password', 'file', 'hidden', 'submit']) assert.equal(keep.keyOf(field({ name: 'x', type })), '', type);
});

test('只带走与首次打开时不同的输入项；后来才出现的输入项算改动', () => {
  const base = new Map([['n:org@0', ''], ['n:tenant@0', '示例制作公司（虚构）'], ['n:pledge@0', false]]);
  const now = new Map([['n:org@0', '测试机构甲'], ['n:tenant@0', '示例制作公司（虚构）'], ['n:pledge@0', true], ['n:consentRef@0', 'SIM-REF-1']]);
  assert.deepEqual(keep.changed(base, now), [['n:org@0', '测试机构甲'], ['n:pledge@0', true], ['n:consentRef@0', 'SIM-REF-1']]);
  assert.deepEqual(keep.changed(base, base), []);
});

test('同名输入项按出现顺序区分', () => {
  const a = field({ name: 'q', value: '甲' }), b = field({ name: 'q', value: '乙' });
  const v = keep.values(rootOf([a, b]));
  assert.deepEqual([...v], [['n:q@0', '甲'], ['n:q@1', '乙']]);
});

test('保存后只能取一次；地址不同、过期、格式不对都作废', () => {
  globalThis.sessionStorage = memory();
  globalThis.window = { scrollY: 120 };
  const els = [field({ name: 'org', value: '测试机构甲' })];
  const base = new Map([['n:org@0', '']]);
  assert.equal(keep.save(rootOf(els), base, '#/access'), true);
  const got = keep.take('#/access');
  assert.deepEqual(got.fields, [['n:org@0', '测试机构甲']]);
  assert.equal(got.y, 120);
  assert.equal(keep.take('#/access'), null, '取出即删');

  keep.save(rootOf(els), base, '#/access');
  assert.equal(keep.take('#/listing/new'), null, '换了页面不填');
  assert.equal(globalThis.sessionStorage.size(), 0, '作废的记录也要删掉');

  keep.save(rootOf(els), base, '#/access');
  assert.equal(keep.take('#/access', Date.now() + 10 * 60 * 1000), null, '过期');

  globalThis.sessionStorage.setItem('zjt.keep.v1', '{not json');
  assert.equal(keep.take('#/access'), null);
  globalThis.sessionStorage.setItem('zjt.keep.v1', JSON.stringify({ v: 1, at: Date.now(), hash: '#/access', fields: [['n:org@0', { evil: 1 }], 'x', ['n:a@0', 'ok']] }));
  assert.deepEqual(keep.take('#/access').fields, [['n:a@0', 'ok']], '只收字符串和布尔值');
  delete globalThis.sessionStorage; delete globalThis.window;
});

test('存不进去时返回 false（调用方据此保留离开提醒）', () => {
  globalThis.sessionStorage = { setItem() { throw new Error('quota'); }, getItem: () => null, removeItem() {} };
  globalThis.window = { scrollY: 0 };
  assert.equal(keep.save(rootOf([field({ name: 'org', value: 'x' })]), new Map(), '#/access'), false);
  delete globalThis.sessionStorage; delete globalThis.window;
  assert.equal(keep.save(rootOf([]), new Map(), '#/access'), false, '没有 sessionStorage 也不抛错');
  assert.equal(keep.take('#/access'), null);
});

test('填回：派发 input 与 change；禁用项、不存在的下拉选项不填，并如实报告个数', () => {
  const org = field({ name: 'org' });
  const box = field({ name: 'pledge', type: 'checkbox', value: 'on' });
  const locked = field({ name: 'uscc', disabled: true });
  const sel = field({ tagName: 'SELECT', type: 'select-one', name: 'category', value: 'a', options: [{ value: 'a' }, { value: 'b' }] });
  const r = keep.restore(rootOf([org, box, locked, sel]), [['n:org@0', '测试机构甲'], ['n:pledge=on@0', true], ['n:uscc@0', '911'], ['n:category@0', 'zzz'], ['n:gone@0', 'x']]);
  assert.equal(org.value, '测试机构甲');
  assert.deepEqual(org.events, ['input', 'change']);
  assert.equal(box.checked, true);
  assert.equal(locked.value, '');
  assert.equal(sel.value, 'a');
  assert.deepEqual(r, { done: 2, total: 5 });
});

test('按行号的输入项：行数变了整组不填，免得填到别的行上', () => {
  const row = (i, v) => field({ dataset: { k: 'splits', i: String(i), f: 'name' }, value: v });
  const kept = [['k:splits:0:name@0', '改过的名字'], ['n:gross@0', '500']];
  const gross = field({ name: 'gross', value: '100' });

  const same = [row(0, '原名'), row(1, '乙'), gross];
  assert.deepEqual(keep.restore(rootOf(same), kept, 2), { done: 2, total: 2 });
  assert.equal(same[0].value, '改过的名字');

  const gross2 = field({ name: 'gross', value: '100' });
  const fewer = [row(0, '原名'), gross2];
  assert.deepEqual(keep.restore(rootOf(fewer), kept, 2), { done: 1, total: 2 }, '少了一行：行内输入项不填，并报告有 1 项没填回');
  assert.equal(fewer[0].value, '原名');
  assert.equal(gross2.value, '500');
});
