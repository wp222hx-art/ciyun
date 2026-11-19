// 跨法域矩阵（G07、G16）：主体所在地 × 供应所在地 × 客户所在地 × 使用地 × 资金／数据地。
// 输出的是"必须核查什么、不能推断什么"的清单，不是法律结论；本模块永远不会给出"合规通过"。
export const PLACES = { MO: '澳门', CN: '内地', HK: '香港', US: '美国', PT: '葡语国家及地区', OTHER: '其他海外' };
export const DIMS = [['entity', '主体所在地'], ['supply', '供应所在地'], ['customer', '客户所在地'], ['use', '使用地'], ['funds', '资金／数据地']];
export const PRODUCTS = {
  content: { name: '影视及内容许可', layer: '产业交易' },
  service: { name: '模型推理／算力服务', layer: '产业交易' },
  produce: { name: 'AI制作／译制与出海交付', layer: '产业交易' },
  saas: { name: '成本、质量与证据治理软件', layer: '产业交易' },
  collectible: { name: '数字收藏品／可转让凭证', layer: '数字权利', gate: '不默认首发：虚拟资产及金融属性须专项审查' },
  financial: { name: '收益权、应收、设备融资或衍生品', layer: '金融合作', gate: '受监管研究专区，首期不开放交易；本版金融产品收入一律为零' },
};
export const PAYMENTS = { bank: '银行认可的法币路径', stable: '稳定币或境外钱包' };

// 方案 V4.0 G16 表格原文
export const G16 = [
  { id: 'mo', scene: '澳门运营与收付', check: '经营、金融／支付边界、版权及集体管理、个人资料、税务', never: '公司登记或证据上链等于交易所牌照' },
  { id: 'cn', scene: '内地来源的内容、数据与供给', check: '创作及素材权利、经营、技术／数据出境、境内权益与相关监管', never: '经澳门或境外伙伴即可摆脱原适用规则' },
  { id: 'us', scene: '美国等内容目的地', check: '人类创作可保护性、数字替身与宣传、当地平台及版权规则', never: '一份澳门或NFT凭证即可取得各地排他版权' },
  { id: 'pt', scene: '葡语及其他海外发行', check: '当地发行／广告／消费者／税及内容要求，伙伴权限', never: '澳门联系优势自动带来海外准入或发行渠道' },
  { id: 'hk', scene: '香港或其他地金融合作', check: '产品法律性质、发行／分销／交易／托管及适当性权限', never: 'VATP等单项资格覆盖一切版权收益权及衍生品' },
];
// 方案 V4.0 G07 跨境路径矩阵原文
export const G07 = {
  out2out: '境外买方向境外供方采购：审双方及访问市场、制裁、出口管制和数据路径',
  mo2out: '澳门买方向境外供方：另核澳门个人资料与银行可受理性',
  cn2out: '内地供方向境外提供服务：另核内地经营、数据、技术／算法及相关出境义务',
  hops: '多跳路由：披露可知上游并禁止未获准跳转',
};

const overseas = (p) => p !== 'MO' && p !== 'CN';

export function assess(f) {
  const product = PRODUCTS[f.product];
  const places = DIMS.map(([k]) => f[k]);
  const rows = new Set(['mo']); // 澳门主运营：这一行始终适用
  if (places.includes('CN')) rows.add('cn');
  if (f.customer === 'US' || f.use === 'US') rows.add('us');
  if (['PT', 'OTHER'].includes(f.customer) || ['PT', 'OTHER'].includes(f.use)) rows.add('pt');
  if (f.product === 'financial' || (places.includes('HK') && f.product === 'collectible')) rows.add('hk');
  const paths = [];
  if (f.product === 'service' || f.product === 'produce') {
    if (overseas(f.supply) && overseas(f.customer)) paths.push(G07.out2out);
    if (f.customer === 'MO' && overseas(f.supply)) paths.push(G07.mo2out);
    if (f.supply === 'CN' && f.customer !== 'CN') paths.push(G07.cn2out);
  }
  if (f.hops) paths.push(G07.hops);
  const blocks = [];
  if (product?.gate) blocks.push(product.gate);
  if (f.payment === 'stable') blocks.push('稳定币与境外钱包是条件模块：在支付、虚拟资产、发行人、托管、兑换、客户地域、反洗钱及澳门关联活动逐项确认前不作为首发支付路径');
  const extras = [];
  if (f.personal) extras.push('涉及个人资料跨境：判断处理目的、数据种类、转移依据、通知／许可及合同，不能一句"用户同意"覆盖全部路径');
  if (f.collective) extras.push('若从逐单代理扩展为集中管理、监督使用及收取分配使用费，先取得当地专业意见并办理所需手续，不把科技平台登记当作集体管理资格');
  if (new Set(places).size > 1) extras.push('网站可访问不等于可招揽：禁止地区、受限产品和未验证身份在网页、API 及 Agent 一致阻断');
  return {
    verdict: blocks.length ? 'closed' : 'conditional',
    blocks, paths, extras,
    rows: G16.filter((r) => rows.has(r.id)),
    distinct: new Set(places).size,
  };
}
