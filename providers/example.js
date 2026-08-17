// ── TokenGauge plugin template: DeepSeek balance query ──
// Drop into ~/Library/Application Support/TokenGauge/providers/*.js and it gets loaded.
// Contract: module.exports = { id, name, fields[], query(credentials) -> UsageResult }
//   - id:     globally unique (no clash with built-ins or other plugins)
//   - fields: credential fields rendered dynamically in Settings
//   - query:  called concurrently; throwing or returning ok:false only affects that account panel
//   - result: { ok, plan?, tiers: [{ name, utilization(0-100), resetsAt? }], queriedAt }
// Restart the app after changing a plugin.
module.exports = {
  id: 'deepseek',
  name: 'DeepSeek Balance',
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
    // API returns { balance_infos: [{ currency, total_balance, ... }] }
    const info = (data.balance_infos || [])[0] || {};
    const total = Number(info.total_balance ?? 0);
    const currency = info.currency === 'CNY' ? '¥' : '$';
    return {
      ok: true,
      plan: `Balance ${currency}${total.toFixed(2)}`,
      tiers: [], // Monetary data has no tier percentages; only the plan text is shown
      queriedAt: Date.now(),
    };
  },
};
