// 方法与边界：产品架构、数据真伪清单、K线的价值与规则、业务分层、未接入项
import * as sim from '../core/sim.js';
import * as market from '../core/market.js';
import * as account from '../core/account.js';
import { THRESHOLD, BASKET } from '../core/normalize.js';
import { esc, fmtIso, ago, fmtInt, tag } from '../ui.js';

const R = tag('real', '真实'), Y = tag('syn', '合成'), T = tag('todo', '待接入');

export function mount(el) {
  const S = market.state;
  const tradable = S.insts.filter((i) => i.meets);
  const intraday = tradable.filter((i) => sim.hasIntraday(i));
  const quotes = S.insts.reduce((s, i) => s + i.quotes.length, 0);
  const cn = S.centers.filter((c) => c.dcs.includes('CN')).length;

  el.innerHTML = `<div class="prose">
  <div class="page-head"><h2>方法与边界</h2>
    <p>这是按《战略深化方案 V2.0》搭的前端仿真环境：哪些数字是真的、哪些是合成的、每条规则对应方案哪一章，都写在这里。</p></div>

  <h3>产品架构：一图谱、三行情、双路径、一仿真</h3>
  <div class="arch">
    <a href="#/models"><small>一图谱</small><b>模型图谱</b><p>模型家族 → 精确版本 → 部署配置 → 服务规格 → 商务版本，别名与路由单列。</p></a>
    <a href="#/trade"><small>三行情</small><b>成交 / 报价 / 任务成本</b><p>三个视图分开命名、分开作图，报价不冒充成交，任务成本不冒充市场价。</p></a>
    <a href="#/compute"><small>供给侧</small><b>算力中心</b><p>同一模型跨中心的真实报价差、可用率、报价溢价与供给成本算例。</p></a>
    <a href="#/procure"><small>双路径</small><b>采购台</b><p>询价 → 比较 → 签约 → 履约计量 → 验收结算，买的是可交付服务。</p></a>
    <a href="#/market"><small>一仿真</small><b>行情与撮合仿真</b><p>以真实报价为锚的合成成交、盘口与指数，用研究记分体验交易所流程。</p></a>
    <a href="#/access"><small>准入</small><b>入场与审批</b><p>四个审核环节、上架预检、可校验的存证链。无登记不交易。</p></a>
    <a href="#/daily"><small>日度</small><b>每日波动</b><p>逐日涨跌家数、指数日涨跌、桶 × 日热力矩阵，以及两次真实观测之间的报价变动。</p></a>
    <a href="#/bay"><small>特色</small><b>湾区特色</b><p>词元出海看板、国产模型指数、"湾数·元启"五大能力对照。</p></a>
    <a href="#/assets"><small>账务</small><b>资产与勾稽</b><p>持仓、委托、成交、履约记录，期初到期末逐项可对。</p></a>
  </div>

  <h3>哪些是真的，哪些是合成的</h3>
  <div class="panel"><div class="table-wrap"><table class="tbl"><thead><tr><th>数据</th><th>性质</th><th>来源与说明</th></tr></thead><tbody>
    <tr><td>模型目录（${S.models.length} 个）</td><td>${R}</td><td>OpenRouter 公开目录 API。${S.catalogLive ? '本次打开时已实时拉取' : '当前为离线快照'}，时间 ${fmtIso(S.catalogAt)}。</td></tr>
    <tr><td>分项费率、上下文、tokenizer、模态</td><td>${R}</td><td>同上。原始币种美元，按 USD/CNY ${S.fx.rate.toFixed(4)}（open.er-api.com，${fmtIso(S.fx.asOf)}）换算，未含税。</td></tr>
    <tr><td>算力中心与公开报价（${S.centers.length} 家、${fmtInt(quotes)} 条）</td><td>${R}</td><td>每个模型的部署端点：供应商、推理精度、费率、近1日可用率、状态。快照 ${fmtIso(S.snapshotAt)}（${ago(S.snapshotAt)}）；交易页可按需拉取单个模型的实时报价。</td></tr>
    <tr><td>可比桶（${S.insts.length} 个）与公开报价区间</td><td>${R}</td><td>由真实端点按"模型 × 推理精度"切分。演示口径只按精度分桶；方案 §06 要求的地域、服务等级、上下文档位、税币种尚未纳入。</td></tr>
    <tr><td>成交价、K线、交付量、成交额、逐笔</td><td>${Y}</td><td>确定性随机过程，围绕真实报价锚波动。没有任何一笔对应真实成交。</td></tr>
    <tr><td>盘口</td><td>${Y}</td><td>围绕最新仿真成交价生成，深度随真实供应商数增加。</td></tr>
    <tr><td>报价历史走势</td><td>${Y}</td><td>公开目录只有当前价，没有历史。图上只有观测日一点是真实值，之前为合成回溯，之后沿用并标"陈旧"。</td></tr>
    <tr><td>参考指数、景气指标</td><td>${Y}</td><td>计算方法是真的（见下），输入是仿真成交。未获任何官方指数发布或冠名授权。</td></tr>
    <tr><td>任务合格率</td><td>${Y}</td><td>没有做真实同题评测。由模型 ID 种子生成，仅用于演示"单合格任务有效成本"怎么算，不代表任何模型的真实能力。</td></tr>
    <tr><td>词元出海看板</td><td>${R}</td><td>国产模型被哪些境外服务商部署、报价多少，来自同一份公开目录。"国产"按品牌人工标注，"境外"按服务商总部所在地判断。</td></tr>
    <tr><td>真实报价变动</td><td>${R}</td><td>分两层。服务商调价：两次端点快照之间，同一模型、同一服务商、同一端点的报价差，目前 ${S.history.length} 个观测区间，随站点发布。目录默认标价：实时目录对比上一次观测，变了可能只是默认服务商切换，不一定有人调价。</td></tr>
    <tr><td>入场审批流程</td><td>${Y}</td><td>环节、材料、时限是按公开原则设计的设想，不是广州数据交易所的实际业务规则。演示里由你自己扮演审核方。编号带 SIM 前缀，不是真实登记凭证。</td></tr>
    <tr><td>存证链</td><td>${R}</td><td>哈希是真算的（SHA-256，每条包含上一条的哈希），改动任意一条都能校验出来。但只存在本机浏览器，没有第三方见证，不具备法律存证效力。</td></tr>
    <tr><td>真实成交、私有用量、负载与利用率</td><td>${T}</td><td>属于供应商与客户的私有数据，须授权接入并与订单账单勾稽后才能进成交行情。这里不估算、不补全。</td></tr>
    <tr><td>境内算力中心报价</td><td>${T}</td><td>公开目录中披露机房在中国境内的供应商为 ${cn} 家。方案首期要求的"境内可合法采购供给"需要供应商主动入驻或授权。</td></tr>
    <tr><td>权重摘要核验、许可条款核查</td><td>${T}</td><td>目前全部是"版本由供应商声明"。"开放权重"只表示目录登记了公开权重仓库。</td></tr>
  </tbody></table></div></div>

  <h3>K线和走势图在这里到底有什么用</h3>
  <p>模型推理服务不是股票：不能储存、会被新版本淘汰、同名模型在不同精度和供应商之间并不等价。所以这里的K线不是用来猜涨跌的，它回答四个采购问题：</p>
  <ul>
    <li><b>现在的报价贵不贵。</b>把一条报价放回同规格桶的成交区间里看，议价时有依据。</li>
    <li><b>什么时候签。</b>推理价格长期下行、偶有上调。看得到降价的节奏，才能决定签长约还是按量。</li>
    <li><b>供给稳不稳。</b>留空的日子、单样本的蜡烛、放大的影线，直接暴露这个桶样本稀、供应少。</li>
    <li><b>便宜是不是真的划算。</b>任务成本视图把 Token 单价换算成"每个合格结果多少钱"，低价模型常常排不到前面。</li>
  </ul>
  <p>它不能证明的事同样重要：参考价上不一定有可买的容量；均线只描述历史，不是买卖信号。</p>

  <h3>行情规则（已实现并有单测覆盖）</h3>
  <div class="panel"><div class="table-wrap"><table class="tbl"><thead><tr><th>规则</th><th>实现</th><th>方案出处</th></tr></thead><tbody>
    <tr><td>固定篮子参考价</td><td>${BASKET.in * 100}% 输入 + ${BASKET.out * 100}% 输出。输入 2 元、输出 6 元 → 2.8 元。任一分项缺失就不计算。</td><td>§06</td></tr>
    <tr><td>有观测才有蜡烛</td><td>当日无样本则留空，不复制前收制造成交。</td><td>§07</td></tr>
    <tr><td>单样本</td><td>只有一笔时开高低收相同，并标注"单样本"。</td><td>§07</td></tr>
    <tr><td>发布门槛</td><td>单桶日线须同时满足 ≥${THRESHOLD.suppliers} 家独立供应主体、≥${THRESHOLD.buyers} 个独立买方、≥${THRESHOLD.samples} 笔样本，否则抑制发布。当前 ${S.insts.length} 个桶中 ${tradable.length} 个供应商数达标。</td><td>§08</td></tr>
    <tr><td>粒度随样本密度开放</td><td>日均样本 ≥${sim.INTRADAY_MIN} 笔的桶才提供分钟与小时线，当前 ${intraday.length} 个；其余只有日线和周线。</td><td>§07</td></tr>
    <tr><td>换代另开序列</td><td>每个模型版本、每种精度各自成序列，序列不早于模型收录日；别名与路由不入桶。</td><td>§05 §08</td></tr>
    <tr><td>指数</td><td>固定基期 = 100 的加权价格相对数，等品牌组权重、组内等权。缺失样本沿用最近发布值，超过 ${sim.GRACE_DAYS} 天宽限期当日剔除。</td><td>§08</td></tr>
    <tr><td>可复算</td><td>同一输入重算结果逐位一致；盘中聚合到收盘等于该日日线；换日后历史不变。</td><td>§11 T-A04</td></tr>
    <tr><td>行情卡</td><td>每张图下方列出桶ID、价格类型、单位、样本数、供应商数、统计窗、数据新鲜度、覆盖范围、方法版本、质量标记。</td><td>§07</td></tr>
  </tbody></table></div></div>

  <h3>业务边界：这个仿真处在哪一层</h3>
  <div class="panel"><div class="table-wrap"><table class="tbl"><thead><tr><th>层级</th><th>产品实质</th><th>本环境</th></tr></thead><tbody>
    <tr><td>L1 信息与分析</td><td>公开价格、指数、评测</td><td>模型图谱、算力中心、报价视图：用真实公开数据。</td></tr>
    <tr><td>L2 服务采购与履约</td><td>为实际使用采购服务</td><td>采购台：流程完整，结算只用研究记分，不涉及真实资金与合同。</td></tr>
    <tr><td>L3 容量预订及合同变更</td><td>特定时段服务承诺</td><td>未做。方案要求独立评审。</td></tr>
    <tr><td>L4 金融化交易</td><td>差价结算、杠杆、衍生品、代币化</td><td>未做，也不在迭代计划内。</td></tr>
  </tbody></table></div></div>
  <p>交易页的盘口、限价单和连续撮合属于方案 §08 的"市场机制研究"：用来观察稀疏样本下的波动、折价和成交困难，只使用研究记分——期初 ${fmtInt(account.INITIAL)}，不可充值、不可转让、不可兑换、不挂钩奖品。方案 §09 明确首期真实业务不做匿名连续竞价，所以这套撮合界面是研究与演示用，不是首期上线形态。持有的额度可以在资产页"消耗"，对应的是服务被使用，而不是等待升值。</p>

  <h3>仿真参数〔示例假设〕</h3>
  <ul>
    <li>成交价对数向"真实报价锚 ×（1 − 议价折扣 0–4%）"均值回归，日回归速度 0.25；日波动随供应商数减少而放大。</li>
    <li>日均样本数约为 2.2 × 供应商数²，周末减半；日内节律以北京时间 15 时为峰。</li>
    <li>报价调整事件每 180 天约 1.2–4 次，其中约 85% 为降价（5–22%），15% 为上调（3–10%）。</li>
    <li>撮合手续费 ${(account.FEE * 100).toFixed(1)}%；限价单偏离最新价超过 20% 会被拒绝；市价单只吃可见盘口，余量撤销。</li>
    <li>所有序列由桶 ID 与日期做种子，刷新页面、换设备结果相同。方法版本 sim-v1。</li>
  </ul>

  <h3>声明</h3>
  <p class="mute">本环境是产品概念演示，不代表广州数据交易所、广东词元交易和服务中心或"湾数·元启"的官方意见，未使用其品牌、接口或数据。所有合成行情不对应真实品牌的真实成交，不用于投资或经营预测，不构成金融业务许可、投资建议或收益承诺。数据来源 ${esc('OpenRouter 公开目录 API')} 仅说明公开字段的技术可得性，不代表已获再分发授权。</p>
  </div>`;
  return {};
}
