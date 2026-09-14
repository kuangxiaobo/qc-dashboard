// 播报看门狗：对应时段的主播报工作流当天没有成功 run 就自动补发一次（到点必发双保险）
//   北京 9:40 检查 9:20 商户不认可播报；北京 19:25 检查 19:00 质检差异率播报
//   补发直接跑对应云端脚本（--scheduled 会再过一遍时段防护 + skip-days 双保险）
// 用法: node tools/broadcast-watchdog-cloud.js
const { execFileSync } = require('child_process');
const path = require('path');

const REPO = 'kuangxiaobo/qc-dashboard';
const TARGETS = {
  daily: { wf: 'daily-report.yml', script: 'daily-report-cloud.js', from: '18:30', to: '24:00' },
  merchant: { wf: 'merchant-feedback-report.yml', script: 'merchant-feedback-cloud.js', from: '08:30', to: '13:00' },
};

const bjNow = () => new Date(Date.now() + 8 * 3600 * 1000);

(async () => {
  const hm = bjNow().toISOString().slice(11, 16);
  const key = Object.keys(TARGETS).find(k => hm >= TARGETS[k].from && hm < TARGETS[k].to);
  if (!key) { console.log('北京时刻 ' + hm + ' 不在看门狗时段，退出'); return; }
  const t = TARGETS[key];
  console.log('看门狗：检查', t.wf, '（北京', hm, '）');

  // 1. 主工作流近 3 小时内的定时 run 有没有成功的
  //    只看 event=schedule 且 created_at 在近 3 小时内的（当天早些时候的手动 dispatch run 不算数，
  //    否则 19:25 看门狗会被早上/中午的 dispatch 骗过而漏补发）
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${t.wf}/runs?per_page=10&event=schedule`, {
    headers: {
      Authorization: 'Bearer ' + (process.env.WATCHDOG_TOKEN || ''),
      Accept: 'application/vnd.github+json',
      'User-Agent': 'qc-watchdog',
    },
  });
  if (!res.ok) { console.error('查 runs 失败:', res.status); process.exit(1); }
  const data = await res.json();
  const since = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const recent = (data.workflow_runs || []).filter(r => r.event === 'schedule' && r.created_at >= since);
  if (recent.some(r => r.status === 'completed' && r.conclusion === 'success')) {
    console.log('近 3 小时内', t.wf, '已有成功 run（含 skip-days 跳过），无需补发');
    return;
  }
  if (recent.some(r => r.status === 'in_progress' || r.status === 'queued')) {
    console.log('主任务仍在运行/排队中，本次不补发（避免重复）');
    return;
  }
  console.log('近 3 小时内', t.wf, '没有成功 run，自动补发...');

  // 2. 补发：直接跑对应云端脚本
  execFileSync('node', [path.join(__dirname, t.script), '--send', '--scheduled'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: process.env,
  });
  console.log('看门狗补发完成');
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
