// 帮助内容里的行内标记。纯函数，不依赖浏览器，单元测试直接用。
//   {{提交申请}}     界面上的按钮、标签、页面名：写中文原文，渲染时换成界面当前语言的叫法
//   **重点**         加粗
//   `#/access`       代码或路径
//   [文字](#/trade)  站内链接；也接受 https:// 外链，其他一律当普通文字
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const TOKEN = /\{\{([^{}]+)\}\}|\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(((?:#\/|https:\/\/)[^)\s]*)\)/g;

function walk(s, on) {
  s = String(s ?? '');
  let out = '', i = 0;
  for (const m of s.matchAll(TOKEN)) {
    out += on.text(s.slice(i, m.index));
    if (m[1] != null) out += on.label(m[1]);
    else if (m[2] != null) out += on.bold(m[2]);
    else if (m[3] != null) out += on.code(m[3]);
    else out += on.link(m[4], m[5]);
    i = m.index + m[0].length;
  }
  return out + on.text(s.slice(i));
}

/** 转成 HTML。label 把界面文案的中文原文换成当前语言 */
export function inline(s, label = (x) => x) {
  return walk(s, {
    text: esc,
    label: (k) => `<b class="ui">${esc(label(k))}</b>`,
    bold: (t) => `<strong>${esc(t)}</strong>`,
    code: (t) => `<code>${esc(t)}</code>`,
    link: (t, href) => `<a href="${esc(href)}"${href.startsWith('#') ? '' : ' target="_blank" rel="noopener noreferrer"'}>${esc(t)}</a>`,
  });
}

/** 去掉标记的纯文字，用在图片说明（alt）和搜索里 */
export function plain(s, label = (x) => x) {
  const same = (t) => t;
  return walk(s, { text: same, label, bold: same, code: same, link: same });
}

/** 一段文字里引用的界面文案（中文原文） */
export const labelsIn = (s) => [...String(s ?? '').matchAll(TOKEN)].filter((m) => m[1] != null).map((m) => m[1]);
/** 一段文字里的站内链接，如 #/help/access */
export const linksIn = (s) => [...String(s ?? '').matchAll(TOKEN)].filter((m) => m[5] != null && m[5].startsWith('#/')).map((m) => m[5]);

/** 把一个帮助主题里所有会显示出来的文字摊平成数组（测试与搜索用） */
export function textsOf(topic) {
  const out = [];
  const add = (x) => { if (typeof x === 'string') out.push(x); };
  const shot = (s) => { if (s) { add(s.cap); (s.marks || []).forEach(add); } };
  for (const k of ['title', 'lead', 'what', 'stepsTitle']) add(topic[k]);
  for (const k of ['who', 'rules', 'tips', 'can', 'cannot']) (topic[k] || []).forEach(add);
  (topic.shots || []).forEach(shot);
  for (const s of topic.steps || []) { add(s.t); add(s.d); shot(s.shot); }
  for (const q of topic.qa || []) { add(q.q); add(q.a); }
  for (const t of topic.terms || []) { add(t.t); add(t.d); }
  return out;
}
/** 一个主题用到的全部截图名 */
export const shotsOf = (topic) => [...(topic.shots || []), ...(topic.steps || []).map((s) => s.shot).filter(Boolean)];
