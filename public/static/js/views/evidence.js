// 溯源存证：本机哈希链 + Merkle 批次承诺 + 包含性证明（方案 V4.0 G12）
// 哈希与证明都是真算的；但只存在本机浏览器，没有签名、没有第三方见证，不具备法律存证效力。
import * as access from '../core/access.js';
import * as evidence from '../core/evidence.js';
import * as merkle from '../core/merkle.js';
import * as account from '../core/account.js';
import { sha256 } from '../core/sha256.js';
import { $, esc, toast, nowSec, fmtDateTime, fmtPct, tag, emptyState, copyText } from '../ui.js';
import { $t } from '../i18n.js';

const db = evidence.db;
const view = { group: '', proof: null, msg: '' };
const FIELDS = [$t("租户、签约及受益主体"), 'supplier / model / deployment', $t("request_id 及 attempt_id"), $t("tokenizer 及计费维度"), $t("原始与已映射用量"), $t("事件／接收／首次可知时间"), $t("合同与价格版本"), $t("服务权益批次"), $t("数据及地域策略"), $t("产物与素材清单摘要"), $t("签名回执"), $t("验收和争议引用")];

export function mount(el) {
  el.innerHTML = `
  <div class="page-head"><h2>${$t("溯源存证")}</h2>
    <p>${$t("平台上每一步办理——入场审核、挂牌、签约、到账确认、权益转让、分账测算、Agent 裁决——都写进一条哈希链。再把一段记录封成一个批次，只对外公布批次根：持有某条记录原文的人，凭几条兄弟哈希就能证明\"它在这一批里\"，别人仅凭根值推不出原文。")}</p></div>
  <div class="cards" id="metrics"></div>
  <section class="panel mb">
    <header><h3>${$t("批次承诺")}</h3>${tag('real', $t("哈希真算"))}<span class="mute small">${$t("方法 {0}", evidence.METHOD)}</span><span class="sp"></span>
      <button class="btn sm" type="button" data-act="verify">${$t("校验哈希链")}</button>
      <button class="btn sm" type="button" data-act="tamper">${$t("模拟篡改")}</button>
      <button class="btn sm primary" type="button" data-act="anchor">${$t("封存新批次")}</button></header>
    <p class="pad" id="msg" style="padding-bottom:10px"></p>
    <div id="batches"></div>
  </section>
  <section class="panel mb" id="proof" hidden></section>
  <section class="panel mb">
    <header><h3>${$t("事件记录")}</h3><div class="tabs" id="groups"></div></header>
    <div id="ledger"></div>
  </section>
  <div class="split">
    <section class="panel"><header><h3>${$t("能承诺什么，不能承诺什么")}</h3></header><div class="pad mute small" style="line-height:1.8">
      <p><b style="color:var(--text)">${$t("可承诺：")}</b>${$t("对本平台已授权接入、按指定版本记录的事件，关联主体、合同、价格、任务和产物，并且事后改不了。")}</p>
      <p><b style="color:var(--text)">${$t("不承诺：")}</b>${$t("未接入节点、供方未披露的内部推理、平台外的后续使用。对全网全部技术词元逐枚标识既无统一语义，也不是能够验证的事实。")}</p>
      <p><b style="color:var(--text)">${$t("上链方式：")}</b>${$t("敏感原文、合同正文、密钥、人脸声纹及商业条款留在受控存储；只对规范化事件及内容哈希形成批次承诺。哈希不自动匿名，可枚举的数据仍可能被识别。")}</p>
      <p><b style="color:var(--text)">${$t("本站的差距：")}</b>${$t("没有数字签名，没有加密存储与撤销，没有第三方或许可型证据网络见证；记录只在你这台设备的浏览器里，最多保留最近 400 条。签名证明来源与完整性，也不能独立证明供方真的用了其宣称的模型。")}</p>
    </div></section>
    <section class="panel"><header><h3>${$t("最小证据字段")}</h3><span class="mute small">${$t("方案 V4.0 G12 · 真实接入时每条调用应带")}</span></header>
      <ul class="todo-list" style="padding-top:12px">${FIELDS.map((f) => `<li>${f}</li>`).join('')}</ul>
      <p class="pad mute small" style="padding-top:0">${$t("本站的事件只带了其中的主体、合同引用、数量与时间；其余字段需要供方与客户授权接入后才有。")}</p>
    </section>
  </div>`;

  const batchOf = (i) => db.state.batches.find((b) => i >= b.from && i <= b.to);

  function paint() {
    const L = access.st.ledger, S = db.state;
    const chain = access.verifyLedger();
    const m = evidence.metrics(S, L, chain.ok, account.acct.contracts);
    const pend = evidence.pending(L, S.batches).length;
    const card = (h, big, sub, cls = '') => `<div class="card"><h4>${h}</h4><p class="big ${cls}">${big}</p><p class="sub">${sub}</p></div>`;
    $('#metrics', el).innerHTML = [
      card($t("已记录事件"), m.events, $t("待入批 {0} 条", pend)),
      card($t("哈希链完整性"), chain.ok ? $t("完整") : $t("已断"), chain.ok ? $t("{0} 条逐条重算一致", chain.n) : $t("第 {0} 条{1}", chain.at, chain.why), chain.ok ? 'down' : 'up'),
      card($t("已入批比例"), m.anchoredRate == null ? '—' : fmtPct(m.anchoredRate, 0).replace('+', ''), $t("{0} / {1} 条", m.anchored, m.events)),
      card($t("批次重算通过"), `${m.batchesOk} / ${m.batches}`, m.batches ? $t("用本机原始记录重算批次根") : $t("还没有封存批次")),
      card($t("订单账单可勾稽率"), m.tiedRate == null ? '—' : fmtPct(m.tiedRate, 0).replace('+', ''), m.billed ? $t("{0} 份采购账单：分项之和 = 总额", m.billed) : $t("采购台出账后才有")),
      card(`${$t("有效签名率")} ${tag('todo', $t("待接入"))}`, '—', $t("需要供方签名回执，本站不编数")),
    ].join('');
    $('#msg', el).innerHTML = view.msg || `<span class="mute">${$t("\"封存新批次\"把尚未入批的记录算成一个 Merkle 根；\"模拟篡改\"在一份副本里改一条已入批的记录，看哈希链和批次根能不能查出来。")}</span>`;
    $('#batches', el).innerHTML = S.batches.length ? `<div class="table-wrap"><table class="tbl dense"><thead><tr><th>${$t("批次")}</th><th>${$t("记录范围")}</th><th class="num">${$t("条数")}</th><th>${$t("批次根")}</th><th>${$t("上一批封印")}</th><th>${$t("封存时间")}</th><th>${$t("重算")}</th></tr></thead><tbody>
      ${S.batches.map((b) => { const v = evidence.verifyBatch(L, b); return `<tr><td class="mono">${b.id}</td><td class="num">#${b.from} — #${b.to}</td><td class="num">${b.n}</td>
        <td class="hash copy" data-copy="${b.root}" title="${$t("点击复制完整批次根")}">${b.root.slice(0, 24)}…</td><td class="hash">${b.prev === 'GENESIS' ? $t("起始") : `${b.prev.slice(0, 10)}…`}</td><td class="num">${fmtDateTime(b.t).slice(5, 16)}</td>
        <td>${v.ok ? `<span class="badge ok">${$t("一致")}</span>` : `<span class="badge warn" title="${esc(v.why)}">${$t("无法重算")}</span>`}</td></tr>`; }).join('')}
      </tbody></table></div>` : emptyState(L.length ? $t("有 {0} 条记录还没有入批。点\"封存新批次\"。", pend) : $t("还没有任何事件。先去走一遍入场审批、挂牌或算力权益，这里就有记录了。"), L.length ? '' : `<a class="btn primary" href="#/access">${$t("去入场审批")}</a>`);

    const groups = [['', $t("全部")], ...Object.entries(access.EVENT_GROUPS)].filter(([k]) => !k || L.some((e) => access.groupOfEvent(e.type) === k));
    $('#groups', el).innerHTML = groups.map(([k, v]) => `<button type="button" data-group="${k}" class="${k === view.group ? 'on' : ''}">${v}</button>`).join('');
    const rows = [...L].reverse().filter((e) => !view.group || access.groupOfEvent(e.type) === view.group).slice(0, 80);
    $('#ledger', el).innerHTML = rows.length ? `<div class="table-wrap"><table class="tbl dense"><thead><tr><th class="num">#</th><th>${$t("时间")}</th><th>${$t("事件")}</th><th>${$t("经办")}</th><th>${$t("关联编号")}</th><th>${$t("本条哈希")}</th><th>${$t("批次")}</th><th></th></tr></thead><tbody>
      ${rows.map((e) => { const b = batchOf(e.i); return `<tr class="${view.proof?.i === e.i ? 'sel' : ''}"><td class="num">${e.i}</td><td class="num">${fmtDateTime(e.t).slice(5, 16)}</td><td>${esc(access.EVENTS[e.type] || e.type)}</td><td>${esc(e.actor)}</td><td class="mono small">${esc(e.ref)}</td>
        <td class="hash copy" data-copy="${e.hash}" title="${$t("点击复制")}">${e.hash.slice(0, 16)}…</td><td class="mono small">${b ? b.id : `<span class="mute">${$t("未入批")}</span>`}</td>
        <td>${b ? `<button class="btn sm" type="button" data-prove="${e.i}">${$t("出具证明")}</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div>${L.length > 80 ? `<p class="pad mute small">${$t("只显示最近 80 条。")}</p>` : ''}` : emptyState($t("这个分组下没有记录。"));

    const box = $('#proof', el);
    box.hidden = !view.proof;
    if (view.proof) {
      const p = view.proof;
      let h = merkle.leafHash(p.leaf);
      const lines = p.path.map((s, k) => `<span class="lv">${$t("第 {0} 层　兄弟在{1}", k + 1, s.side === 'L' ? $t("左") : $t("右"))}　<b>${s.hash}</b></span>`);
      for (const s of p.path) h = s.side === 'L' ? sha256(`N|${s.hash}|${h}`) : sha256(`N|${h}|${s.hash}`);
      box.innerHTML = `<header><h3>${$t("包含性证明：第 {0} 条记录", p.i)}</h3><span class="badge ${p.valid ? 'ok' : 'bad'}">${p.valid ? $t("验证通过") : $t("验证失败")}</span><span class="sp"></span>
        <button class="btn sm" type="button" data-act="forge">${$t("换成伪造记录再验证")}</button><button class="btn sm" type="button" data-act="close-proof">${$t("关闭")}</button></header>
        <div class="proof"><span class="lv">${$t("记录哈希（叶子原文）")}　<b>${p.leaf}</b></span>${lines.join('') || `<span class="lv">${$t("该批次只有这一条记录，不需要兄弟节点")}</span>`}
          <span class="lv">${$t("沿路径算出的根")}　　　<b>${h}</b></span><span class="lv">${$t("{0} 的批次根", p.batch.id)}　<b>${p.batch.root}</b>　${h === p.batch.root ? `<span class="down">${$t("两者一致")}</span>` : `<span class="up">${$t("两者不一致")}</span>`}</span></div>
        <p class="pad mute small" style="padding-top:0">${$t("验证方只需要这条记录、{0} 个兄弟哈希和公开的批次根，不需要看到同批其他 {1} 条记录的内容。", p.path.length, p.batch.n - 1)}${p.forged ? `<br><span class="down">${$t("伪造测试：把叶子换成一条不存在的记录，沿同一条路径算出的根与批次根不一致，证明不成立。")}</span>` : ''}</p>`;
    }
  }

  el.addEventListener('click', (e) => {
    const cp = e.target.closest('[data-copy]'); if (cp) return void copyText(cp.dataset.copy, $t("哈希"));
    const g = e.target.closest('[data-group]'); if (g) { view.group = g.dataset.group; return paint(); }
    const pv = e.target.closest('[data-prove]');
    if (pv) {
      const i = Number(pv.dataset.prove);
      const r = evidence.prove(db.state, access.st.ledger, i);
      if (!r.ok) return toast(r.error, 'error');
      view.proof = { ...r, i, forged: false };
      paint();
      $('#proof', el).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const L = access.st.ledger, a = b.dataset.act;
    if (a === 'verify') {
      const v = access.verifyLedger();
      view.msg = v.ok ? `<span class="down">${$t("校验通过：{0} 条记录哈希连续，内容没有被改动。", v.n)}</span>` : `<span class="up">${$t("校验失败：第 {0} 条{1}。", v.at, v.why)}</span>`;
    } else if (a === 'anchor') {
      const r = evidence.anchor(db.state, L, nowSec());
      if (!r.ok) return toast(r.error, 'error');
      db.commit();
      access.log('evidence.anchor', '证据服务', r.batch.id, { from: r.batch.from, to: r.batch.to, n: r.batch.n, root: r.batch.root }, nowSec());
      view.msg = `<span class="down">${$t("已封存 {0}：第 {1}—{2} 条，共 {3} 条。", r.batch.id, r.batch.from, r.batch.to, r.batch.n)}</span>${$t("这条\"封存\"动作本身是一条新事件，留给下一个批次。")}`;
      toast($t("批次已封存：{0} 条记录", r.batch.n), 'ok');
    } else if (a === 'tamper') {
      const batch = db.state.batches.find((x) => evidence.verifyBatch(L, x).ok);
      if (!batch) return toast($t("先封存一个批次，再做篡改测试"), 'error');
      const L2 = JSON.parse(JSON.stringify(L));
      const k = L2.findIndex((x) => x.i === batch.from);
      const { prev, hash: _h, ...body } = L2[k];
      body.data = { ...body.data, tampered: true };
      L2[k] = { ...body, prev, hash: sha256(`${prev}|${JSON.stringify(body)}`) }; // 攻击者连这条记录自己的哈希也重算了
      const c = access.verifyLedger(L2), v = evidence.verifyBatch(L2, batch);
      view.msg = $t("在一份副本里改动第 {0} 条记录，并重算了它自己的哈希：哈希链{1}；{2} 的批次根{3}。真实记录没有被改动。", batch.from, c.ok ? `<span class="mute">${$t("未发现（它是最后一条，后面没有记录引用它）")}</span>` : `<span class="down">${$t("查出第 {0} 条{1}", c.at, c.why)}</span>`, batch.id, v.ok ? `<span class="up">${$t("仍然一致（不应出现）")}</span>` : `<span class="down">${$t("重算不一致，篡改被发现")}</span>`);
    } else if (a === 'forge') {
      const p = view.proof;
      view.proof = { ...p, leaf: sha256($t("伪造记录|{0}", p.i)), valid: false, forged: true };
    } else if (a === 'close-proof') view.proof = null;
    paint();
  });

  const offs = [db.onChange(paint), access.onChange(paint)];
  paint();
  return { destroy() { offs.forEach((f) => f()); } };
}
