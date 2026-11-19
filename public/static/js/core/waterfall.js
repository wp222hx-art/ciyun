// 版税瀑布（G14、G19）：真实渠道收入 → 扣有凭证的退款与费用 → 可分配收入 → 中心费用 → 按合同比例分配。
// 全程用"分"做整数运算，余数按最大余数法分配，保证各项相加严格等于毛收入。
const cents = (x) => Math.round(Number(x) * 100);
const fail = (error) => ({ ok: false, error });

export const G19 = {
  gross: 10000,
  deductions: [{ label: '渠道退款及费用', amount: 2000, evidence: '渠道结算单（示例）' }],
  feeRate: 0.10,
  splits: [{ name: '权利人', pct: 80 }, { name: '译制／制作合作方', pct: 20 }],
};

export function allocate({ gross, deductions = [], feeRate, splits = [], received = true }) {
  const G = cents(gross);
  if (!Number.isFinite(G) || G <= 0) return fail('渠道毛收入必须大于 0');
  if (!(feeRate >= 0 && feeRate < 1)) return fail('中心费率必须在 0 到 100% 之间');
  if (!splits.length) return fail('至少要有一个分配对象');
  if (splits.some((s) => !(s.pct > 0) || !String(s.name || '').trim())) return fail('每个分配对象都要有名称和大于 0 的比例');
  if (Math.abs(splits.reduce((a, s) => a + Number(s.pct), 0) - 100) > 1e-9) return fail('各方分配比例之和必须等于 100%');
  const accepted = [], rejected = [];
  for (const d of deductions) {
    const amt = cents(d.amount);
    if (!(amt > 0)) continue;
    // 合同明确且有凭证才可扣：没有凭证引用的扣项不进瀑布
    (String(d.evidence || '').trim() ? accepted : rejected).push({ label: d.label || '扣项', cents: amt, evidence: d.evidence || '' });
  }
  const D = accepted.reduce((a, d) => a + d.cents, 0);
  if (D > G) return fail('有凭证的扣项合计超过了毛收入');
  const base = G - D;                       // 可分配收入
  const fee = Math.round(base * feeRate);   // 中心费用只在可分配收入上收一次
  const rest = base - fee;
  // 最大余数法
  const raw = splits.map((s) => (rest * Number(s.pct)) / 100);
  const shares = raw.map(Math.floor);
  let left = rest - shares.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k++, left--) shares[order[k % order.length][1]]++;
  const total = D + fee + shares.reduce((a, b) => a + b, 0);
  const usd = (c) => c / 100;
  return {
    ok: true, received,
    gross: usd(G), deducted: usd(D), base: usd(base), fee: usd(fee), rest: usd(rest),
    deductions: accepted.map((d) => ({ ...d, amount: usd(d.cents) })),
    rejected: rejected.map((d) => ({ ...d, amount: usd(d.cents) })),
    shares: splits.map((s, i) => ({ name: s.name, pct: Number(s.pct), amount: usd(shares[i]) })),
    balanced: total === G,
    // 未到账不显示已分配：应付金额只有在外部到账确认后才不为零
    payable: received ? usd(rest) : 0,
    centreRevenue: received ? usd(fee) : 0,
  };
}
