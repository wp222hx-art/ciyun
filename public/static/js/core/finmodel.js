// G22 新跨境业务财务模型：36 个月、万美元、税前、融资前。
// 全部输入为方案 V4.0 的〔示例假设〕，不是预算、预测或回报承诺；金融产品收入恒为零。
// 本文件只做一件事：按方案写明的口径逐月复算，并核对"累计现金 + 期末净应收 + 固定资产净额 = 累计税前利润"。

/** G21 单位经济（美元） */
export const UNIT = {
  subCost: 160,                 // 订阅：月直接运维及工具成本
  project: 8000, projectCost: 5000,
  licence: 3000, licenceFee: 0.08, licenceCostRate: 0.30,
  computeFee: 0.03, computeCostRate: 0.40,
  evidence: 200, evidenceCost: 80,
};

/** 基准交付量（年）：新增客户按月给出，其余按年 */
export const BASE_VOLUME = {
  newByMonth: [0, 0, 3, 2, 2, 2, 3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10],
  projects: [8, 24, 48],
  licences: [60, 240, 600],
  compute: [20, 150, 600],      // 净算力／模型服务规模，万美元
  evidence: [80, 300, 900],
};

export const PREP = { 1: 3, 3: 2 };            // 费用化准备：M1 法务及合同 3，M3 安全 2
export const CAPEX = { 1: 2, 13: 1, 25: 1 };   // 资本开支，36 个月直线折旧，当月起算
export const DEPR_MONTHS = 36;
export const MONTHS = 36;

export const SCENARIOS = {
  low: { name: '保守', scale: 0.6, retention: 0.75, price: 500, fixed: [1.8, 2.5, 3.4], sales: [0.5, 0.8, 1.2], days: 60, loss: 0.02 },
  base: { name: '基准', scale: 1.0, retention: 0.85, price: 600, fixed: [2.2, 3.4, 5.0], sales: [0.6, 1.0, 1.5], days: 45, loss: 0.01 },
  high: { name: '进取', scale: 1.5, retention: 0.90, price: 650, fixed: [2.8, 4.7, 7.2], sales: [0.9, 1.6, 2.6], days: 30, loss: 0.008 },
};

/** 方案 G22 表格中的公布值（万美元），用于复算核对 */
export const PUBLISHED = {
  base: {
    years: [
      { revenue: 17.68, sub: 7.64, project: 6.40, licence: 1.44, compute: 0.60, evidence: 1.60, direct: 7.35, gross: 10.33, fixed: 26.40, sales: 7.20, prep: 5.00, loss: 0.18, depr: 0.67, profit: -29.11, cash: -34.20 },
      { revenue: 73.49, sub: 38.03, project: 19.20, licence: 5.76, compute: 4.50, evidence: 6.00, direct: 28.07, gross: 45.42, fixed: 40.80, sales: 12.00, prep: 0, loss: 0.73, depr: 1.00, profit: -9.11, cash: -16.53 },
      { revenue: 174.69, sub: 85.89, project: 38.40, licence: 14.40, compute: 18.00, evidence: 18.00, direct: 65.63, gross: 109.07, fixed: 60.00, sales: 18.00, prep: 0, loss: 1.75, depr: 1.33, profit: 27.99, cash: 14.52 },
    ],
    y3Profit: 27.99, maxGap: 57.30, funding: 76.80,
  },
  low: { revenue: [9.74, 39.08, 92.12], y3Profit: -4.31, maxGap: 69.10, funding: 82.90 },
  high: { revenue: [27.63, 116.93, 279.64], y3Profit: 58.35, maxGap: 56.46, funding: 85.86 },
};

/** 回款：30 天收上月，60 天收上两月，45 天两者各半；其余天数在相邻档之间线性插值 */
export function collectionWeights(days) {
  const d = Math.min(60, Math.max(30, days));
  const w2 = (d - 30) / 30;
  return [1 - w2, w2]; // [上月权重, 上两月权重]
}

const yearOf = (m) => Math.min(2, Math.floor((m - 1) / 12));

/** 某年内参与等量交付的月份数：Y1 前两个月只做准备 */
const activeMonths = (y) => (y === 0 ? 10 : 12);
const delivers = (m) => m >= 3;

export function run(input = SCENARIOS.base) {
  const s = { ...SCENARIOS.base, ...input };
  const r = Math.pow(s.retention, 1 / 12);
  const [w1, w2] = collectionWeights(s.days);
  const rows = [];
  let active = 0, cum = 0, cumProfit = 0, ar = 0, nbv = 0;
  const capexLive = []; // {amount, left}
  for (let m = 1; m <= MONTHS; m++) {
    const y = yearOf(m);
    const add = BASE_VOLUME.newByMonth[m - 1] * s.scale;
    const prev = active;
    active = prev * r + add;
    const avg = (prev + active) / 2;
    const k = delivers(m) ? s.scale / activeMonths(y) : 0;
    const nProject = BASE_VOLUME.projects[y] * k;
    const nLicence = BASE_VOLUME.licences[y] * k;
    const vCompute = BASE_VOLUME.compute[y] * k;       // 万美元
    const nEvidence = BASE_VOLUME.evidence[y] * k;

    const sub = (avg * s.price) / 1e4;
    const project = (nProject * UNIT.project) / 1e4;
    const licence = (nLicence * UNIT.licence * UNIT.licenceFee) / 1e4;
    const compute = vCompute * UNIT.computeFee;
    const evidence = (nEvidence * UNIT.evidence) / 1e4;
    const revenue = sub + project + licence + compute + evidence;

    const direct = (avg * UNIT.subCost) / 1e4 + (nProject * UNIT.projectCost) / 1e4 + licence * UNIT.licenceCostRate + compute * UNIT.computeCostRate + (nEvidence * UNIT.evidenceCost) / 1e4;
    const fixed = s.fixed[y], sales = s.sales[y];
    const prep = PREP[m] || 0;
    const capex = CAPEX[m] || 0;
    if (capex) capexLive.push({ per: capex / DEPR_MONTHS, left: DEPR_MONTHS });
    let depr = 0;
    for (const c of capexLive) if (c.left > 0) { depr += c.per; c.left--; }
    const loss = revenue * s.loss;
    const profit = revenue - direct - fixed - sales - prep - loss - depr;

    const r1 = rows[m - 2]?.revenue || 0, r2 = rows[m - 3]?.revenue || 0;
    const collected = (w1 * r1 + w2 * r2) * (1 - s.loss);
    const cash = collected - direct - fixed - sales - prep - capex;
    cum += cash; cumProfit += profit;
    ar += revenue * (1 - s.loss) - collected;   // 期末净应收（已扣预计信用损失）
    nbv += capex - depr;
    rows.push({ m, y, add, active, avg, sub, project, licence, compute, evidence, revenue, direct, fixed, sales, prep, loss, depr, profit, capex, collected, cash, cum, cumProfit, ar, nbv,
      need: -cum + 3 * (fixed + sales) });
  }
  const KEYS = ['sub', 'project', 'licence', 'compute', 'evidence', 'revenue', 'direct', 'fixed', 'sales', 'prep', 'loss', 'depr', 'profit', 'cash', 'capex'];
  const years = [0, 1, 2].map((y) => {
    const o = { y };
    for (const key of KEYS) o[key] = rows.filter((x) => x.y === y).reduce((a, x) => a + x[key], 0);
    o.gross = o.revenue - o.direct;
    return o;
  });
  const last = rows[rows.length - 1];
  const maxGap = Math.max(0, ...rows.map((x) => -x.cum));
  const funding = Math.max(0, ...rows.map((x) => x.need));
  const breakeven = rows.find((x) => x.profit > 0)?.m ?? null;      // 首个单月税前盈利
  const cashTurn = rows.find((x) => x.cash > 0)?.m ?? null;         // 首个单月净现金流为正
  return { input: s, rows, years, maxGap, funding, breakeven, cashTurn,
    // 复核控制：累计现金流 + 期末净应收 + 固定资产净额 = 累计税前利润
    identity: { lhs: last.cum + last.ar + last.nbv, rhs: last.cumProfit, gap: Math.abs(last.cum + last.ar + last.nbv - last.cumProfit) } };
}

/** 与方案公布值逐项比对，返回最大偏差（万美元） */
export function compare(id) {
  const out = run(SCENARIOS[id]);
  const pub = PUBLISHED[id];
  const diffs = [];
  const push = (label, mine, theirs) => diffs.push({ label, mine, theirs, diff: Math.abs(mine - theirs) });
  if (id === 'base') {
    pub.years.forEach((py, y) => { for (const [k, v] of Object.entries(py)) push(`Y${y + 1} ${k}`, out.years[y][k], v); });
  } else {
    pub.revenue.forEach((v, y) => push(`Y${y + 1} revenue`, out.years[y].revenue, v));
  }
  push('Y3 profit', out.years[2].profit, pub.y3Profit);
  push('maxGap', out.maxGap, pub.maxGap);
  push('funding', out.funding, pub.funding);
  return { out, diffs, max: Math.max(...diffs.map((d) => d.diff)) };
}
