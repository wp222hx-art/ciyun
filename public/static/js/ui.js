// 展示层公共工具：转义、格式化、迷你走势图、提示
import { tickOf, decimalsOf, TZ } from './core/sim.js';

/** 外部目录字段（模型名、服务商名）一律转义后再插入页面 */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export const pxDec = (p) => (p > 0 ? decimalsOf(tickOf(p)) : 2);
/** 价格：按该价位的最小变动单位显示（4 位有效数字） */
export const fmtPx = (p, dec) => (p == null || !Number.isFinite(p) ? '—' : p.toFixed(dec ?? pxDec(p)));
export const fmtPct = (x, d = 2) => (x == null || !Number.isFinite(x) ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(d)}%`);
export const fmtInt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('zh-CN'));
export const fmtNum = (n, d = 2) => (n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d }));
export function fmtMoney(x) {
  if (x == null || !Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a >= 1e8) return `${(x / 1e8).toFixed(2)}亿`;
  if (a >= 1e4) return `${(x / 1e4).toFixed(2)}万`;
  return x.toFixed(2);
}
/** 数量：单位为百万Token */
export function fmtQty(q) {
  if (q == null) return '—';
  if (q >= 1e8) return `${(q / 1e8).toFixed(2)}亿`;
  if (q >= 1e4) return `${(q / 1e4).toFixed(2)}万`;
  return fmtInt(q);
}
export const fmtCtx = (n) => (n == null ? '—' : n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
export const dir = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : 'flat');

const bj = (sec) => new Date((sec + TZ) * 1000).toISOString();
export const fmtTime = (sec) => bj(sec).slice(11, 19);
export const fmtDateTime = (sec) => bj(sec).slice(0, 19).replace('T', ' ');
export const fmtDay = (dayIdx) => new Date(dayIdx * 86400000).toISOString().slice(0, 10);
export const fmtIso = (iso) => (iso ? fmtDateTime(Date.parse(iso) / 1000).slice(0, 16) : '—');
export const nowSec = () => Date.now() / 1000;

export function ago(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return '刚刚';
  if (s < 5400) return `${Math.round(s / 60)} 分钟前`;
  if (s < 129600) return `${Math.round(s / 3600)} 小时前`;
  return `${Math.round(s / 86400)} 天前`;
}

export const COLOR = { up: '#f6465d', down: '#0ecb81', flat: '#848e9c', accent: '#4c8dff', gold: '#f0b90b', grid: '#1e2329', text: '#848e9c' };

/** 迷你走势图 */
export function spark(canvas, xs, color) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 96, h = canvas.clientHeight || 28;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);
  if (!xs || xs.length < 2) return;
  const lo = Math.min(...xs), hi = Math.max(...xs), span = hi - lo || 1;
  const X = (i) => (i / (xs.length - 1)) * (w - 2) + 1;
  const Y = (v) => h - 3 - ((v - lo) / span) * (h - 6);
  const c = color || COLOR[dir(xs[xs.length - 1] - xs[0])];
  g.beginPath();
  xs.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
  g.strokeStyle = c; g.lineWidth = 1.4; g.lineJoin = 'round'; g.stroke();
  g.lineTo(X(xs.length - 1), h); g.lineTo(X(0), h); g.closePath();
  g.fillStyle = `${c}22`; g.fill();
}

export function toast(msg, kind = 'info') {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, kind === 'error' ? 5200 : 3200);
}

/** 证据标签：真实 / 合成 / 待接入 */
export const tag = (kind, text) => `<span class="ev ev-${kind}">${esc(text)}</span>`;
export const REAL = tag('real', '公开目录');
export const SYN = tag('syn', '合成');

export function chips(inst) {
  return `<span class="chip sm">${esc(inst.qLabel)}</span>${inst.open ? '<span class="chip sm open">开放权重</span>' : ''}${inst.variant !== 'std' ? `<span class="chip sm">${esc(inst.variant === 'batch' ? '批处理' : inst.variant)}</span>` : ''}`;
}

export function debounce(fn, ms = 160) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
