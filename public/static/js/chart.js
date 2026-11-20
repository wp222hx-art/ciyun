// 图表封装（TradingView Lightweight Charts v4，Apache-2.0，本地托管）
import { COLOR } from './ui.js';
import { EN } from './i18n.js';

const LC = () => window.LightweightCharts;

export function makeChart(el, { intraday = false, ...extra } = {}) {
  return LC().createChart(el, {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: COLOR.text, fontSize: 11 },
    grid: { vertLines: { color: COLOR.grid }, horzLines: { color: COLOR.grid } },
    rightPriceScale: { borderColor: '#2a3038' },
    timeScale: { borderColor: '#2a3038', timeVisible: intraday, secondsVisible: false, rightOffset: 3 },
    crosshair: { mode: 0 },
    localization: { locale: EN ? 'en-US' : 'zh-CN' },
    ...extra,
  });
}

export const priceFormat = (tick, dec) => ({ type: 'price', precision: dec, minMove: tick });

/** 蜡烛 + 成交量 + 均线。红涨绿跌 */
export function addCandles(chart, fmt) {
  const candle = chart.addCandlestickSeries({
    upColor: COLOR.up, downColor: COLOR.down, borderUpColor: COLOR.up, borderDownColor: COLOR.down,
    wickUpColor: COLOR.up, wickDownColor: COLOR.down, priceFormat: fmt,
  });
  candle.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.26 } });
  const vol = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  return { candle, vol };
}

export function addLine(chart, color, fmt, extra = {}) {
  return chart.addLineSeries({ color, lineWidth: 1, priceFormat: fmt, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, ...extra });
}

/** 简单移动平均：只在已发布的蜡烛上计算，留空日不参与 */
export function sma(rows, n) {
  const out = [];
  let sum = 0;
  const q = [];
  for (const r of rows) {
    if (!r.b.pub) continue;
    q.push(r.b.c); sum += r.b.c;
    if (q.length > n) sum -= q.shift();
    if (q.length === n) out.push({ time: r.time, value: sum / n });
  }
  return out;
}

export const MA_SET = [[5, '#f0b90b'], [10, '#4c8dff'], [20, '#c26bff']];
