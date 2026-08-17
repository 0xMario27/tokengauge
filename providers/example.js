// ── ark-usage-widget 插件模版：DeepSeek 余额查询 ──
// 放到 ~/Library/Application Support/ark-usage-widget/providers/*.js 即被加载。
// 契约：module.exports = { id, name, fields[], query(credentials) -> UsageResult }
//   - id:     全局唯一（与内置/其他插件不重复）
//   - fields: 设置页动态渲染的凭据字段
//   - query:  并发调用，抛异常或返回 ok:false 均只影响该账号面板
//   - 返回:   { ok, plan?, tiers: [{ name, utilization(0-100), resetsAt? }], queriedAt }
// 改动插件后重启应用生效。
module.exports = {
  id: 'deepseek',
  name: 'DeepSeek 余额',
  fields: [
    { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...' },
  ],
  async query(creds) {
    const resp = await fetch('https://api.deepseek.com/user/balance', {
      headers: { Authorization: 'Bearer ' + creds.apiKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    // 官方返回 { balance_infos: [{ currency, total_balance, ... }] }
    const info = (data.balance_infos || [])[0] || {};
    const total = Number(info.total_balance ?? 0);
    const currency = info.currency === 'CNY' ? '¥' : '$';
    return {
      ok: true,
      plan: `余额 ${currency}${total.toFixed(2)}`,
      tiers: [], // 金额型数据无档位百分比，只展示 plan 文本
      queriedAt: Date.now(),
    };
  },
};
