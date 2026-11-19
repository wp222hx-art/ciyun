// 导航结构：Worker 渲染外壳与浏览器路由共用同一份，避免两处不一致
export const GROUPS = [
  { id: 'home', name: '总览', pages: [['home', '总览', '定位、产业链、三层业务与上手路径']] },
  { id: 'quotes', name: '行情', pages: [
    ['market', '行情总览', '参考指数、涨跌榜、全部可比桶'],
    ['daily', '每日波动', '逐日涨跌家数与真实调价'],
    ['trade', '交易终端', 'K线、盘口、下单（研究记分）'],
    ['models', '模型图谱', '公开目录里的模型与版本'],
    ['compute', '算力中心', '服务商报价、可用率与溢价'],
    ['assets', '账户资产', '持仓、委托、成交与账务勾稽'],
  ] },
  { id: 'deal', name: '产业交易', pages: [
    ['listing', '挂牌大厅', '版权与服务挂牌、三道审核、询价成交'],
    ['procure', '采购台', '模型服务询价、签约、履约、验收'],
    ['entitle', '算力权益', '登记、预订、核销、受限转让'],
    ['royalty', '版税分账', '渠道收入瀑布与分配'],
  ] },
  { id: 'trust', name: '可信治理', pages: [
    ['access', '入场审批', '主体登记、场景登记、合规会审'],
    ['evidence', '溯源存证', '哈希链、Merkle 批次与包含性证明'],
    ['agent', '受控Agent', '授权凭证、分级审批与审计'],
    ['juris', '跨法域', '五维矩阵：必须核查与不得推断'],
  ] },
  { id: 'research', name: '研究', pages: [
    ['finance', '财务模型', '36 个月税前模型，可调参数逐月复算'],
    ['bay', '词元出海', '国产模型在境外的部署与报价'],
    ['method', '方法与边界', '哪些是真的、哪些是合成的'],
  ] },
];
export const PAGES = GROUPS.flatMap((g) => g.pages.map(([id, name, desc]) => ({ id, name, desc, group: g.id, groupName: g.name })));
export const pageOf = (id) => PAGES.find((p) => p.id === id);
export const groupOf = (id) => GROUPS.find((g) => g.pages.some((p) => p[0] === id));
export const HOME = 'home';
