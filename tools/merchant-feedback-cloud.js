// 云端版「商户不认可反馈」每日播报（2026-09-13 上线：GitHub Actions 每天 01:20 UTC = 北京 09:20）
// 与 phone-inspection-app/merchant-feedback-report.js 输出同款飞书交互卡片（统计摘要 + 今日/昨日明细 table）
// 云端差异：无 Excel/无 Edge 图片/无免密文件链接（报表图片链接可用 FEISHU_REPORT_IMG 环境变量自行提供）
// 密钥全部来自环境变量：FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_CHAT_ID（群 chat_id）/ FEISHU_HOOK（webhook 兜底）
// 用法: node tools/merchant-feedback-cloud.js [--day=YYYY-MM-DD] [--send] [--scheduled]
const { feishu } = require('./feishu');

const SPREADSHEET = 'Xm4NsSKjuh7wBRtWkhDcYY7on9b';
const SHEET = '36eE7u';
const STATUS_ORDER = ['待处理', '已处理', '已评价', '处理中'];
const BJS = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
// 北京时区的「前一天」：全程 UTC 毫秒（不能本地 setDate）
const dayBefore = d => new Date(new Date(d + 'T00:00:00+08:00').getTime() - 24 * 3600 * 1000 + 8 * 3600 * 1000).toISOString().slice(0, 10);

// ===== 数据 =====
async function fetchAll() {
  const r = await feishu(`/open-apis/sheets/v2/spreadsheets/${SPREADSHEET}/values/${SHEET}!A1:Z5020?valueRenderOption=ToString&dateTimeRenderOption=FormattedString`);
  const values = r.data.valueRange.values;
  const header = values[0];
  return values.slice(1).map(row => Object.fromEntries(header.map((h, i) => [h, row[i] ?? null])));
}

function stats(rows) {
  const status = {}, cats = {}, wh = {}, reasons = {};
  rows.forEach(r => {
    const k = r['状态'] || '(空)'; status[k] = (status[k] || 0) + 1;
    const c = r['类目'] || '(空)'; cats[c] = (cats[c] || 0) + 1;
    const w = r['中心仓'] || '(空)'; wh[w] = (wh[w] || 0) + 1;
    const re = (r['不认可原因'] || '').trim();
    if (re) reasons[re] = (reasons[re] || 0) + 1;
  });
  return { n: rows.length, status, cats, wh, reasons };
}
const sorted = obj => Object.entries(obj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'));

const short = (s, n = 24) => ([...s].length > n ? [...s].slice(0, n).join('') + '…' : s);
const normMerchant = s => String(s ?? '').replace(/-/g, '.');
// 明细行字段：质检码/商户/不认可原因/反馈时间(MM-DD HH:mm)/商品标题
function detailCells(r) {
  const t = String(r['反馈时间'] || '').trim();
  const time = t.length >= 16 ? t.slice(5, 16) : t;
  const reason = (r['不认可原因'] || '').trim().replace(/\s+/g, ' ') || '（空）';
  return [String(r['质检码'] || '—'), normMerchant(r['商户名称']) || '—', reason, time, String(r['商品标题'] || '—')];
}
const detailSorted = rows => rows.slice().sort((a, b) => String(b['反馈时间'] || '').localeCompare(String(a['反馈时间'] || '')));

// ===== 飞书交互卡片（与 merchant-feedback-report.js 同款）=====
const CARD_COLS = [
  { name: 'qc', display_name: '质检码', data_type: 'text', width: '110px' },
  { name: 'mch', display_name: '商户', data_type: 'text', width: '150px' },
  { name: 'reason', display_name: '不认可原因', data_type: 'text', width: '220px' },
  { name: 'time', display_name: '反馈时间', data_type: 'text', width: '110px' },
  { name: 'title', display_name: '商品标题', data_type: 'text', width: '230px' },
];
function cardTable(rows) {
  const body = detailSorted(rows).map(r => {
    const [qc, mch, reason, time, title2] = detailCells(r);
    return { qc, mch, reason: short(reason, 20), time, title: short(title2, 22) };
  });
  return {
    tag: 'table',
    page_size: 20,
    columns: CARD_COLS,
    rows: body.length ? body : [{ qc: '（暂无）', mch: '', reason: '', time: '', title: '' }],
  };
}
function buildCard(today, yday, sT, sY, tRows, yRows) {
  const stKeys = [...STATUS_ORDER, ...sorted(sT.status).map(([k]) => k).filter(k => !STATUS_ORDER.includes(k))];
  const md = `**▶ 今天: ${sT.n} 单 ｜ 昨天(${yday}): ${sY.n} 单**\n`
    + `\n**一、状态分布**\n今天　${stKeys.map(k => `${k} ${sT.status[k] || 0}`).join(' / ')}\n昨天　${stKeys.map(k => `${k} ${sY.status[k] || 0}`).join(' / ')}`
    + `\n\n**二、类目分布**\n今天　${sorted(sT.cats).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(' / ') || '无'}\n昨天　${sorted(sY.cats).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(' / ') || '无'}`
    + `\n\n**三、中心仓 Top5**\n今天　${sorted(sT.wh).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(' / ') || '无'}\n昨天　${sorted(sY.wh).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(' / ') || '无'}`
    + `\n\n**四、高频不认可原因 Top5**\n今天　${sorted(sT.reasons).slice(0, 5).map(([k, v], i) => `${i + 1}.「${short(k)}」×${v}`).join('　') || '无'}\n昨天　${sorted(sY.reasons).slice(0, 5).map(([k, v], i) => `${i + 1}.「${short(k)}」×${v}`).join('　') || '无'}`;
  const imgUrl = process.env.FEISHU_REPORT_IMG;
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    body: {
      elements: [
        { tag: 'markdown', content: `**【商户不认可反馈日报】${today}（当天为实时累计）**\n${md}` },
        { tag: 'hr' },
        { tag: 'markdown', content: `**五、今日反馈明细（共 ${tRows.length} 单）**` },
        cardTable(tRows),
        { tag: 'markdown', content: `**六、昨日反馈明细（${yday}）（共 ${yRows.length} 单）**` },
        cardTable(yRows),
        { tag: 'hr' },
        { tag: 'markdown', content: `📊 完整明细原表: https://zhuanspirit.feishu.cn/wiki/BMwBwg0CQiWHw7kmgHJcsv8NnFh?sheet=36eE7u${imgUrl ? `\n📎 报表图片: ${imgUrl}` : ''}` },
      ],
    },
  };
}

// ===== 发送 =====
async function sendMsg(chatId, msgType, content) {
  return feishu(`/open-apis/im/v1/messages?receive_id_type=chat_id`, {
    method: 'POST',
    body: { receive_id: chatId, msg_type: msgType, content: JSON.stringify(content) },
  });
}

// ===== 主流程 =====
(async () => {
  if (process.argv.includes('--send')) {
    if (!process.env.FEISHU_CHAT_ID) { console.error('缺少 FEISHU_CHAT_ID 环境变量（群 chat_id）'); process.exit(1); }
    if (!process.env.FEISHU_HOOK) { console.error('缺少 FEISHU_HOOK 环境变量（webhook 兜底）'); process.exit(1); }
  }
  // 定时触发时段防护：北京 08:30-13:00 之外跳过（09:20 播报，极端延迟到下午/晚上时避免突兀打扰）
  if (process.argv.includes('--scheduled') && process.argv.includes('--send')) {
    const bj = new Date(Date.now() + 8 * 3600 * 1000);
    const hhmm = bj.toISOString().slice(11, 16);
    if (hhmm < '08:30' || hhmm > '13:00') {
      console.log('当前北京时刻 ' + hhmm + ' 不在播报时段（08:30-13:00），跳过');
      return;
    }
  }
  const dayArg = process.argv.find(a => a.startsWith('--day='));
  const today = dayArg ? dayArg.split('=')[1] : BJS();
  const yday = dayBefore(today);

  const rows = await fetchAll();
  const tRows = rows.filter(r => (r['反馈时间'] || '').slice(0, 10) === today);
  const yRows = rows.filter(r => (r['反馈时间'] || '').slice(0, 10) === yday);
  const sT = stats(tRows), sY = stats(yRows);

  console.log(`【商户不认可反馈日报】${today}`);
  console.log(`今天: ${sT.n} 单 ｜ 昨天(${yday}): ${sY.n} 单`);
  console.log(`状态: 今天 ${Object.entries(sT.status).map(([k, v]) => `${k} ${v}`).join(' / ') || '无'}`);
  console.log(`明细: 今日 ${tRows.length} 单 / 昨日 ${yRows.length} 单`);

  if (process.argv.includes('--send')) {
    const card = buildCard(today, yday, sT, sY, tRows, yRows);
    try {
      await sendMsg(process.env.FEISHU_CHAT_ID, 'interactive', card);
      console.log('已发送明细表格卡片到群「天命牛马」');
    } catch (e) {
      console.error('机器人卡片发送失败，webhook 兜底:', e.message);
      const res = await fetch(process.env.FEISHU_HOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'interactive', card }),
      });
      const data = await res.json();
      if (data.code !== 0) { console.error('webhook 兜底也失败:', JSON.stringify(data)); process.exit(1); }
      console.log('已用 webhook 兜底发送卡片');
    }
  }
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
