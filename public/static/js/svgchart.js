// 轻量 SVG 图表：按"期数"（M1…M36）画柱与线，带十字光标和提示。财务模型用，不依赖时间轴。
import { esc } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

function niceStep(span, target = 5) {
  const raw = span / target, mag = 10 ** Math.floor(Math.log10(raw)), r = raw / mag;
  return (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
}

/**
 * @param host 容器
 * @param labels 横轴标签
 * @param bars  [{name,color,values}] 分组柱（可选 stack:true 堆叠）
 * @param lines [{name,color,values}]
 */
export function barLine(host, { labels, bars = [], lines = [], unit = '', stack = false, digits = 2, marks = [] }) {
  const W = Math.max(320, host.clientWidth || 800), H = host.clientHeight || 260;
  const m = { l: 46, r: 12, t: 12, b: 24 };
  const n = labels.length, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const stacks = labels.map((_, i) => { let p = 0, q = 0; for (const b of bars) { const v = b.values[i] || 0; if (v >= 0) p += v; else q += v; } return [q, p]; });
  const all = [...lines.flatMap((l) => l.values), ...(stack ? stacks.flat() : bars.flatMap((b) => b.values)), 0].filter(Number.isFinite);
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi === lo) hi = lo + 1;
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const X = (i) => m.l + (i + 0.5) * (iw / n), Y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img' });
  for (let v = lo; v <= hi + step / 2; v += step) {
    svg.appendChild(el('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: Math.abs(v) < step / 1e6 ? '#3a424d' : '#1c222b', 'stroke-width': 1 }));
    const t = el('text', { x: m.l - 6, y: Y(v) + 3.5, 'text-anchor': 'end', fill: '#7d8794', 'font-size': 10 });
    t.textContent = Math.abs(v) < step / 1e6 ? '0' : Number(v.toFixed(6)).toString();
    svg.appendChild(t);
  }
  const every = Math.ceil(n / 12);
  labels.forEach((lab, i) => {
    if (i % every && i !== n - 1) return;
    const t = el('text', { x: X(i), y: H - 7, 'text-anchor': 'middle', fill: '#7d8794', 'font-size': 10 });
    t.textContent = lab;
    svg.appendChild(t);
  });
  for (const mk of marks) {
    const x = m.l + mk.at * (iw / n);
    svg.appendChild(el('line', { x1: x, x2: x, y1: m.t, y2: m.t + ih, stroke: '#2a313b', 'stroke-dasharray': '3 3' }));
    const t = el('text', { x: x + 4, y: m.t + 10, fill: '#7d8794', 'font-size': 10 });
    t.textContent = mk.label;
    svg.appendChild(t);
  }
  const slot = iw / n, bw = Math.max(2, (slot * 0.72) / (stack ? 1 : Math.max(1, bars.length)));
  labels.forEach((_, i) => {
    let up = 0, dn = 0;
    bars.forEach((b, k) => {
      const v = b.values[i] || 0;
      if (!v) return;
      let y0, y1, x;
      if (stack) { const base = v >= 0 ? up : dn; y0 = Y(base); y1 = Y(base + v); if (v >= 0) up += v; else dn += v; x = X(i) - bw / 2; } else { y0 = Y(0); y1 = Y(v); x = X(i) - (bars.length * bw) / 2 + k * bw; }
      const color = typeof b.color === 'function' ? b.color(v) : b.color;
      svg.appendChild(el('rect', { x, y: Math.min(y0, y1), width: Math.max(1, bw - (stack ? 0 : 1)), height: Math.max(0.5, Math.abs(y1 - y0)), fill: color, rx: 1 }));
    });
  });
  for (const l of lines) {
    const d = l.values.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    svg.appendChild(el('path', { d, fill: 'none', stroke: l.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  }
  const cross = el('line', { y1: m.t, y2: m.t + ih, stroke: '#5b6573', 'stroke-dasharray': '2 3', visibility: 'hidden' });
  svg.appendChild(cross);
  host.replaceChildren(svg);
  host.classList.add('svgc');
  const tip = document.createElement('div');
  tip.className = 'svgc-tip';
  tip.hidden = true;
  host.appendChild(tip);
  const fmt = (v) => (v == null || !Number.isFinite(v) ? '—' : `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`);
  const move = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.min(n - 1, Math.max(0, Math.floor((px - m.l) / slot)));
    cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
    tip.innerHTML = `<b>${esc(labels[i])}</b>${[...bars, ...lines].map((s) => `<div><i style="background:${typeof s.color === 'function' ? s.color(s.values[i]) : s.color}"></i>${esc(s.name)}<span>${fmt(s.values[i])}${esc(unit)}</span></div>`).join('')}`;
    tip.hidden = false;
    const left = (X(i) / W) * r.width;
    tip.style.left = `${Math.min(r.width - tip.offsetWidth - 6, Math.max(6, left + (left > r.width * 0.6 ? -tip.offsetWidth - 12 : 12)))}px`;
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
}

export const legend = (items) => `<div class="svgc-legend">${items.map(([name, color]) => `<span><i style="background:${color}"></i>${esc(name)}</span>`).join('')}</div>`;
