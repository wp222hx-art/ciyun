// 每日波动：把日线整理成"每天发生了什么"
import * as sim from './sim.js';

/**
 * 一个桶的日度明细（含今日盘中）。
 * 涨跌 = 当日收盘 ÷ 上一个已发布交易日的收盘 − 1；振幅 =（最高 − 最低）÷ 同一基准。
 * 留空的日子不计算涨跌，也不作为下一日的比较基准。
 */
export function instDays(inst, nowSec, n = 30) {
  const D = sim.daily(inst, sim.dayIdxOf(nowSec));
  const out = [];
  let prev = null;
  for (const b of D.days.concat(sim.todayCandle(inst, nowSec))) {
    const row = { d: b.d, bar: b, prev, chg: null, amp: null };
    if (b.pub) {
      if (prev != null) { row.chg = b.c / prev - 1; row.amp = (b.h - b.l) / prev; }
      prev = b.c;
    }
    out.push(row);
  }
  return n >= out.length ? out : out.slice(-n);
}

/** 全市场最近 n 天的逐日统计。交付量与样本数只汇总已发布的日线（被抑制的不计入公开统计） */
export function marketDays(insts, nowSec, n = 60) {
  const from = sim.dayIdxOf(nowSec) - n + 1;
  const days = Array.from({ length: n }, (_, k) => ({ d: from + k, adv: 0, dec: 0, flat: 0, held: 0, blank: 0, vol: 0, samples: 0, rows: [] }));
  for (const inst of insts) {
    for (const r of instDays(inst, nowSec, Infinity)) {
      if (r.d < from) continue;
      const day = days[r.d - from];
      day.rows.push({ inst, ...r });
      const b = r.bar;
      if (b.pub) {
        day.vol += b.v; day.samples += b.n;
        if (r.chg == null || r.chg === 0) day.flat++; else if (r.chg > 0) day.adv++; else day.dec++;
      } else if (b.n > 0) day.held++; else day.blank++;
    }
  }
  return days;
}
