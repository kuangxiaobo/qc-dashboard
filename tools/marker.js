// 播报去重标记（2026-09-17 上线）
// 写进飞书日报电子表远端列：Z1 = 商户不认可反馈最近一次成功播报的日期，Z2 = 质检差异率最近一次成功播报的日期
// 用途：本机 9:20/19:15 准点兜底播报后写标记；GitHub 云端定时延迟到达时读标记跳过，防止双发
// 云端与本机都能读写这张表（fill-daily-sheet.js 已在写它），不依赖 GitHub 写权限
const SPREADSHEET = 'RCuIs0ny8hBsxCtcTRBci2TFnwh';
const SHEET = '592084';
const CELLS = { merchant: 'Z1', daily: 'Z2' };

async function getMarker(feishu, which) {
  try {
    const r = await feishu(`/open-apis/sheets/v2/spreadsheets/${SPREADSHEET}/values/${SHEET}!${CELLS[which]}:${CELLS[which]}`);
    const v = r.data && r.data.valueRange && r.data.valueRange.values;
    return v && v[0] && v[0][0] ? String(v[0][0]).trim() : '';
  } catch (e) {
    console.error('读播报标记失败（忽略，继续）:', e.message);
    return '';
  }
}

async function setMarker(feishu, which, day) {
  try {
    await feishu(`/open-apis/sheets/v2/spreadsheets/${SPREADSHEET}/values`, {
      method: 'PUT',
      body: { valueRange: { range: `${SHEET}!${CELLS[which]}:${CELLS[which]}`, values: [[day]] } },
    });
    console.log(`已写播报标记 ${CELLS[which]} = ${day}`);
  } catch (e) {
    console.error('写播报标记失败（忽略，可能双发）:', e.message);
  }
}

module.exports = { getMarker, setMarker };
