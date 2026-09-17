// 云端版每日差异率播报（2026-09-13 上线：GitHub Actions 每天 11:20 UTC = 北京 19:20，用户 09-17 要求晚上 7 点 20 分播报；避开整点分钟 0 防 GitHub 延迟/丢任务）
// 与 phone-inspection-app/daily-report.js 输出同款飞书交互卡片（schema 2.0 table 真表格）
// 云端差异：无 Edge 截图/无本地路径；密钥全部来自环境变量（FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_HOOK）
// 用法: node tools/daily-report-cloud.js                仅拉数据打印摘要（不发送）
//       node tools/daily-report-cloud.js --send         发卡片到 FEISHU_HOOK 指定群（DAILY_TEST_HOOK 可临时指向测试群）
//       node tools/daily-report-cloud.js --send --scheduled  定时触发：北京 18:30-24:00 之外跳过（防队列极端延迟凌晨播空数据）
//       node tools/daily-report-cloud.js --send --day=2026-09-12  补播指定日期
const { feishu } = require('./feishu');
const { getMarker, setMarker } = require('./marker');
const fs = require('fs');
const path = require('path');

const APP = 'XyAKwKKicinviXknZc5cdHyrnjb';
// 按北京月份自动选择「N月登记汇总」表
const MONTH_TABLES = {
  '2026-06': 'tblU59cYqoNrYOiS',
  '2026-07': 'tblpOy0UkrDdUqzV',
  '2026-08': 'tblQwX6Xy9xriYmB',
  '2026-09': 'tblP2SHNLPm834Mv',
  '2026-10': 'tbli7rxGkNbXGG1o',
  '2026-11': 'tbl13cd3UhoLjhYP',
  '2026-12': 'tblqntPYMgoGRi3a',
};
const NAMES = ['旷小波', '尚杰', '谢志亮', '黄少博'];
// 中心仓必须用指定值（不照抄表里原值）
const CANG = { 旷小波: '合肥库', 谢志亮: '杭州库', 尚杰: '武汉库', 黄少博: '西安中心仓' };
const SRC_ORDER = ['邮件推送', '中心仓拦截'];
const YW_ORDER = ['前置/后验', '入仓质检'];
// 谢志亮品类常填成品牌名，归并到手机
const BRANDS = ['vivo', '华为', 'OPPO', '联想', '小米', 'realme', '荣耀', '苹果', '红米', '一加'];

const BJS = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const dayOf = ts => new Date(ts + 8 * 3600 * 1000).toISOString().slice(0, 10);
const norm = f => ({ ...f, 品类: BRANDS.includes(f['品类']) ? '手机' : (f['品类'] || '(空)') });
const pct = (bad, total) => (total ? (bad / total * 100).toFixed(2) + '%' : '0.00%');

// ===== 飞书交互卡片（与 daily-report.js 同款）=====
const CARD_COLS = [
  { name: 'src', display_name: '来源', data_type: 'text', width: '200px' },
  { name: 'yw', display_name: '业务线', data_type: 'text', width: '130px' },
  { name: 'n', display_name: '复测量', data_type: 'text', width: '100px' },
  { name: 'bad', display_name: '差异', data_type: 'text', width: '100px' },
  { name: 'pct', display_name: '差异率', data_type: 'text', width: '110px' },
];
function personCardTable(p) {
  const rows = [];
  const groups = [p.sub.filter(f => f['品类'] === '手机'), p.sub.filter(f => f['品类'] !== '手机')];
  groups.forEach((g, gi) => {
    SRC_ORDER.forEach(src => {
      YW_ORDER.forEach(yw => {
        const s = g.filter(f => f['来源'] === src && f['业务线'] === yw);
        const bad = s.filter(f => f['是否一致'] === '否').length;
        rows.push({ src: `${gi === 0 ? '手机' : '四品类'}·${src}`, yw, n: String(s.length), bad: String(bad), pct: pct(bad, s.length) });
      });
    });
  });
  const badT = p.sub.filter(f => f['是否一致'] === '否').length;
  rows.push({ src: '合计', yw: '', n: String(p.sub.length), bad: String(badT), pct: pct(badT, p.sub.length) });
  return { tag: 'table', page_size: 20, columns: CARD_COLS, rows };
}
function buildCard(reportDay, persons) {
  const elements = [{ tag: 'markdown', content: `**【质检差异率播报】${reportDay}**` }];
  for (const p of persons) {
    elements.push({ tag: 'markdown', content: `**${p.name}（${p.cang}）**` });
    if (!p.sub.length) {
      elements.push({ tag: 'markdown', content: '今日暂无登记数据' });
      continue;
    }
    elements.push(personCardTable(p));
    const probs = p.sub.filter(f => f['是否一致'] === '否')
      .map(f => `${f['品类']}·${f['业务线']}：${f['差异项'] ?? '未知'}${f['差异原因描述'] ? '-' + f['差异原因描述'] : ''}`);
    elements.push({ tag: 'markdown', content: `主要问题：${probs.join('；') || '无'}` });
  }
  return { schema: '2.0', config: { wide_screen_mode: true }, body: { elements } };
}

(async () => {
  if (process.argv.includes('--send') && !process.env.FEISHU_HOOK && !process.env.DAILY_TEST_HOOK) {
    console.error('缺少 FEISHU_HOOK 环境变量（发送目标群 webhook）');
    process.exit(1);
  }
  // 定时触发时段防护：北京 18:30-24:00 之外跳过（GitHub 队列一般只晚几分钟，极端延迟到凌晨时避免播"当天"空数据）
  if (process.argv.includes('--scheduled') && process.argv.includes('--send')) {
    const bj = new Date(Date.now() + 8 * 3600 * 1000);
    const hhmm = bj.toISOString().slice(11, 16);
    if (hhmm < '18:30' || hhmm > '23:59') {
      console.log('当前北京时刻 ' + hhmm + ' 不在播报时段（18:30-24:00），跳过');
      return;
    }
  }
  // --day=YYYY-MM-DD 指定播报日期（默认今天）
  const dayArg = process.argv.find(a => a.startsWith('--day='));
  const reportDay = dayArg ? dayArg.split('=')[1] : BJS();

  // 当日已播报过则跳过（skip-days.txt 一行一天；仅 --scheduled 生效，手动 --send / workflow_dispatch 不受限）
  if (process.argv.includes('--scheduled') && process.argv.includes('--send')) {
    const skipPath = path.join(__dirname, 'skip-days.txt');
    if (fs.existsSync(skipPath) && fs.readFileSync(skipPath, 'utf8').split(/\r?\n/).map(s => s.trim()).includes(reportDay)) {
      console.log(reportDay + ' 在 skip-days.txt 中（当天已播报过），跳过发送');
      return;
    }
    // 飞书日报表 Z2 标记（本机 19:20 准点兜底或手动补发都会写标记）当天已发过则跳过
    const sent = await getMarker(feishu, 'daily');
    if (sent === BJS()) {
      console.log('当天已播报过（Z2 标记 ' + sent + '），跳过发送');
      return;
    }
  }

  // 1. 拉取最新数据（翻页只保留「当天+四人」防全表堆内存 OOM，同 daily-report.js）
  const useTable = MONTH_TABLES[reportDay.slice(0, 7)];
  if (!useTable) { console.error('未配置 ' + reportDay.slice(0, 7) + ' 的表 ID'); process.exit(1); }
  let items = [], pageToken = null, pageGuard = 0;
  do {
    const r = await feishu(`/open-apis/bitable/v1/apps/${APP}/tables/${useTable}/records?page_size=500${pageToken ? '&page_token=' + pageToken : ''}`);
    items = items.concat((r.data.items || []).filter(it => {
      const f = it.fields || {};
      return NAMES.includes(f['操作人']) && dayOf(f['登记时间']) === reportDay;
    }));
    pageToken = r.data.has_more ? r.data.page_token : null;
    if (++pageGuard > 200) { console.error('翻页超过 200 页，强制终止（防死循环）'); break; }
  } while (pageToken);

  const all = items.map(it => it.fields).filter(f => NAMES.includes(f['操作人']));
  const persons = NAMES.map(name => ({
    name,
    cang: CANG[name],
    sub: all.filter(f => f['操作人'] === name && dayOf(f['登记时间']) === reportDay).map(norm),
  }));

  // 2. 控制台摘要（云端日志用）
  console.log(`【质检差异率播报】${reportDay}`);
  for (const p of persons) {
    if (!p.sub.length) { console.log(`${p.name}（${p.cang}）：今日暂无登记数据`); continue; }
    const bad = p.sub.filter(f => f['是否一致'] === '否').length;
    console.log(`${p.name}（${p.cang}）：复测 ${p.sub.length} / 差异 ${bad} / 差异率 ${pct(bad, p.sub.length)}`);
  }

  // 3. 发卡片到飞书群（webhook 支持 interactive 卡片；DAILY_TEST_HOOK 环境变量可临时指向测试群）
  if (process.argv.includes('--send')) {
    const hook = process.env.DAILY_TEST_HOOK || process.env.FEISHU_HOOK;
    const res = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'interactive', card: buildCard(reportDay, persons) }),
    });
    const data = await res.json();
    if (data.code !== 0) { console.error('发送失败:', JSON.stringify(data)); process.exit(1); }
    console.log(`已发送卡片表格到飞书群（${hook.includes('58b1f75e') ? '测试群' : '正式群'}）`);
    // 写去重标记（Z2）：之后的本机兜底/云端延迟定时读到标记都会跳过，当天只发一次
    await setMarker(feishu, 'daily', reportDay);
  }
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
