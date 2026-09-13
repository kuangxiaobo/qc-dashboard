// 飞书 API 客户端（云端版：密钥必须来自环境变量 GitHub Secrets，无硬编码回退）
const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const BASE_URL = 'https://open.feishu.cn';

if (!APP_ID || !APP_SECRET) {
  console.error('缺少环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET（GitHub Secrets）');
  process.exit(1);
}

let tokenCache = { token: null, expiresAt: 0 };

async function getTenantToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 5 * 60 * 1000) {
    return tokenCache.token;
  }
  const res = await fetch(`${BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Feishu auth error: ${data.msg}`);
  tokenCache = { token: data.tenant_access_token, expiresAt: Date.now() + data.expire * 1000 };
  return tokenCache.token;
}

async function feishu(path, opts = {}) {
  const { method = 'GET', body } = opts;
  const token = await getTenantToken();
  const url = `${BASE_URL}${path}`;
  const fetchOpts = {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  };
  if (body) fetchOpts.body = JSON.stringify(body);

  let res = await fetch(url, fetchOpts);
  let data = await res.json();

  // Token expired - retry once
  if (data.code === 99991663 || data.code === 99991664 || res.status === 401) {
    tokenCache = { token: null, expiresAt: 0 };
    const newToken = await getTenantToken();
    fetchOpts.headers.Authorization = `Bearer ${newToken}`;
    res = await fetch(url, fetchOpts);
    data = await res.json();
  }

  if (data.code !== 0) {
    throw new Error(`Feishu API error [${data.code}]: ${data.msg}`);
  }
  return data;
}

module.exports = { feishu };
