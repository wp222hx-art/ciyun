// 词典完整性检查：界面里每一条中文文案、规则模块里每一条中文提示，都必须在英文词典里有对应词条。
// 用法：npm run i18n:check（缺词条时退出码为 1）。tests/i18n.test.mjs 也调用这里的 audit()。
import { parse } from 'acorn';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../public/static/js/', import.meta.url));
const IDEO = /[\u3400-\u9fff]/;
// 只用来做字符串处理的中文字面量（比较、替换、拆分），不是界面文案
const TEXT_OPS = new Set(['replace', 'replaceAll', 'split', 'startsWith', 'endsWith', 'includes', 'indexOf', 'match', 'test']);
// 专有名称在英文里保留原文
const KEEP = ['湾数·元启', '澳广州数交所澳门词元交易中心'];

function walk(n, p, cb) {
  cb(n, p);
  for (const k of Object.keys(n)) {
    const v = n[k];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, n, cb));
    else if (v && typeof v.type === 'string') walk(v, n, cb);
  }
}
const calleeName = (p) => (p && p.type === 'CallExpression' ? (p.callee.type === 'Identifier' ? p.callee.name : p.callee.type === 'MemberExpression' && !p.callee.computed ? p.callee.property.name : '') : '');
const files = (dir) => fs.readdirSync(ROOT + dir).filter((f) => f.endsWith('.js')).map((f) => `${dir}/${f}`);

/** 返回 Map：中文原文 → 首次出现的文件 */
export function extract() {
  const keys = new Map();
  const add = (k, f) => { if (IDEO.test(k) && !keys.has(k)) keys.set(k, f); };
  const ast = (f) => parse(fs.readFileSync(ROOT + f, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
  for (const f of ['app.js', 'cmdk.js', 'ui.js', 'facts.js', ...files('views')]) {
    walk(ast(f), null, (n, p) => {
      if (n.type !== 'Literal' || typeof n.value !== 'string') return;
      const name = calleeName(p);
      if (name === '$t' ? p.arguments[0] === n : !TEXT_OPS.has(name)) add(n.value, f);
    });
  }
  for (const f of ['nav.js', ...files('core')]) {
    walk(ast(f), null, (n, p) => {
      if (n.type === 'Literal' && typeof n.value === 'string') {
        if ((p.type === 'Property' && p.key === n && p.value !== n) || TEXT_OPS.has(calleeName(p))) return;
        add(n.value, f);
      } else if (n.type === 'TemplateLiteral' && n.quasis.some((q) => IDEO.test(q.value.cooked))) {
        add(n.quasis.map((q, i) => q.value.cooked + (i < n.quasis.length - 1 ? `{${i}}` : '')).join(''), f);
      }
    });
  }
  return keys;
}

export async function audit() {
  const dict = { ...(await import(`${ROOT}i18n/en.js`)).default, ...(await import(`${ROOT}i18n/en-shell.js`)).default };
  const slots = (s) => [...new Set(s.match(/\{\d+\}/g) || [])].sort().join();
  const missing = [], broken = [];
  for (const [k, f] of extract()) if (!(k in dict)) missing.push(`${f}: ${k.slice(0, 70)}`);
  for (const [k, v] of Object.entries(dict)) {
    if (slots(k) !== slots(v)) broken.push(`占位符不一致: ${k.slice(0, 50)}`);
    if (IDEO.test(KEEP.reduce((t, x) => t.split(x).join(''), v))) broken.push(`译文里残留中文: ${k.slice(0, 50)}`);
    if (/[<"]/.test(v)) broken.push(`译文含 < 或 "，会破坏页面结构: ${k.slice(0, 50)}`);
    if (!v.trim()) broken.push(`译文为空: ${k.slice(0, 50)}`);
  }
  return { entries: Object.keys(dict).length, missing, broken };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await audit();
  console.log(`词典 ${r.entries} 条 · 缺词条 ${r.missing.length} · 有问题的词条 ${r.broken.length}`);
  for (const x of [...r.missing, ...r.broken].slice(0, 60)) console.log('  ' + x);
  process.exit(r.missing.length || r.broken.length ? 1 : 0);
}
