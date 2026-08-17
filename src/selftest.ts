// 移植自 cc-switch coding_plan.rs 的确定性自检：签名结构 + 解析向量。
import { canonicalQuery, volcengineSign, parseAfpTiers, parseCodingPlanTiers, TIER_FIVE_HOUR, TIER_WEEKLY, TIER_MONTHLY, volcengineProvider } from './core/providers/volcengine';

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  ✓ ${name}`); } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('canonical query:');
check('排序并编码', canonicalQuery('GetAFPUsage', 'cn-beijing') === 'Action=GetAFPUsage&Region=cn-beijing&Version=2024-01-01', canonicalQuery('GetAFPUsage', 'cn-beijing'));

console.log('签名 V4（AKLTtest/secretkey @ 2024-06-21T00:00:00Z, GetAFPUsage/cn-beijing, 空 body）:');
const now = new Date('2024-06-21T00:00:00Z');
const q = canonicalQuery('GetAFPUsage', 'cn-beijing');
const s1 = volcengineSign('AKLTtest', 'secretkey', 'cn-beijing', q, Buffer.alloc(0), now);
check('空 body SHA-256 固定值', s1.xContentSha256 === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', s1.xContentSha256);
check('X-Date 格式', s1.xDate === '20240621T000000Z', s1.xDate);
check('Credential/scope 结构（无 AWS4 前缀、ark/request 结尾）', s1.authorization.startsWith('HMAC-SHA256 Credential=AKLTtest/20240621/cn-beijing/ark/request,'), s1.authorization);
check('固定 SignedHeaders 顺序', s1.authorization.includes('SignedHeaders=host;x-date;x-content-sha256;content-type,'), s1.authorization);
const sig = s1.authorization.split('Signature=')[1] ?? '';
check('签名 64 位十六进制', sig.length === 64 && /^[0-9a-f]{64}$/.test(sig), sig);
check('确定性：同输入同输出', JSON.stringify(s1) === JSON.stringify(volcengineSign('AKLTtest', 'secretkey', 'cn-beijing', q, Buffer.alloc(0), now)));

console.log('parseAfpTiers（官方示例 5h 25% / 周 30% / 月 42.525%，跳过 daily）:');
const afp = parseAfpTiers({
  PlanType: 'Large',
  AFPFiveHour: { Quota: 50, Used: 12.5, ResetTime: 1778806800000 },
  AFPDaily: { Quota: 100, Used: 22.5 },
  AFPWeekly: { Quota: 500, Used: 150, ResetTime: 1779062400000 },
  AFPMonthly: { Quota: 2000, Used: 850.5, ResetTime: 1780531200000 },
});
check('三档（跳过 daily）', afp.length === 3 && afp[0].name === TIER_FIVE_HOUR && afp[1].name === TIER_WEEKLY && afp[2].name === TIER_MONTHLY, JSON.stringify(afp.map(t => t.name)));
check('5h 25%', Math.abs(afp[0].utilization - 25) < 1e-9, String(afp[0].utilization));
check('周 30%', Math.abs(afp[1].utilization - 30) < 1e-9, String(afp[1].utilization));
check('月 42.525%', Math.abs(afp[2].utilization - 42.525) < 1e-9, String(afp[2].utilization));
check('重置时间为 ISO', typeof afp[2].resetsAt === 'string' && !Number.isNaN(Date.parse(afp[2].resetsAt!)));
check('Quota=0 → 空（无 Agent Plan 判定）', parseAfpTiers({ AFPFiveHour: { Quota: 0, Used: 0 }, AFPWeekly: { Quota: 0, Used: 0 } }).length === 0);

console.log('parseCodingPlanTiers（真实响应：session/weekly/monthly 百分比 + 秒级时间戳）:');
const cpt = parseCodingPlanTiers({
  Status: 'Running', UpdateTimestamp: 1782053286,
  QuotaUsage: [
    { Level: 'session', Percent: 0, ResetTimestamp: -1 },
    { Level: 'weekly', Percent: 1.672568, ResetTimestamp: 1782057600 },
    { Level: 'monthly', Percent: 0.836284, ResetTimestamp: 1784303999 },
  ],
});
check('三档映射', cpt.length === 3 && cpt[0].name === TIER_FIVE_HOUR && cpt[1].name === TIER_WEEKLY && cpt[2].name === TIER_MONTHLY, JSON.stringify(cpt.map(t => t.name)));
check('session 0% 且无重置（-1）', cpt[0].utilization === 0 && cpt[0].resetsAt == null);
check('weekly 1.672568%', Math.abs(cpt[1].utilization - 1.672568) < 1e-6, String(cpt[1].utilization));
check('monthly 0.836284%', Math.abs(cpt[2].utilization - 0.836284) < 1e-6, String(cpt[2].utilization));
check('秒级时间戳→ISO', typeof cpt[2].resetsAt === 'string' && !Number.isNaN(Date.parse(cpt[2].resetsAt!)));
check('未知窗口跳过', parseCodingPlanTiers({ QuotaUsage: [{ Level: 'daily', Percent: 9 }, { Level: 'weekly', Percent: 20 }] }).length === 1);

console.log('配置持久化（写入/读取往返）：');
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { normalizeConfig, normalizeAccount, saveConfig, loadConfig } from './core/config';
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-widget-test-'));
  const file = path.join(dir, 'config.json');
  saveConfig(file, {
    refreshIntervalSec: 45,
    accounts: [{ provider: 'volcengine', alias: '主力', credentials: { accessKeyId: 'AK1', secretAccessKey: 'SK1', region: 'cn-beijing' } }],
  });
  const loaded = loadConfig(file);
  check('账号完整写入并读回', loaded.accounts.length === 1 && loaded.accounts[0].alias === '主力' && loaded.accounts[0].credentials.secretAccessKey === 'SK1' && loaded.refreshIntervalSec === 45, JSON.stringify(loaded));
  fs.rmSync(dir, { recursive: true, force: true });
}
check('normalize 拒绝缺字段账号', normalizeConfig({ accounts: [{ alias: 'x', accessKeyId: 'k' }] }).accounts.length === 0);

console.log('Provider 注册形态：');
check('内置 volcengine provider 形状', volcengineProvider.id === 'volcengine' && volcengineProvider.fields.length === 3 && typeof volcengineProvider.query === 'function');

console.log('配置 v1 -> v2 迁移：');
{
  const acc = normalizeAccount({ alias: ' 旧账号 ', accessKeyId: ' AK1 ', secretAccessKey: ' SK1 ', region: ' ' });
  check('v1 迁移为 volcengine + credentials', acc !== null && acc.provider === 'volcengine' && acc.alias === '旧账号' && acc.credentials.accessKeyId === 'AK1' && acc.credentials.secretAccessKey === 'SK1' && acc.credentials.region === undefined, JSON.stringify(acc));
  const acc2 = normalizeAccount({ provider: 'deepseek', alias: 'x', credentials: { apiKey: ' k ' } });
  check('v2 直取并 trim', acc2 !== null && acc2.credentials.apiKey === 'k');
  check('缺凭据/缺别名拒绝', normalizeAccount({ alias: 'a', provider: 'p', credentials: {} }) === null && normalizeAccount({ accessKeyId: 'k' }) === null);
  const cfg = normalizeConfig({ accounts: [{ alias: 'v1', accessKeyId: 'AK', secretAccessKey: 'SK' }] });
  check('normalizeConfig 整体迁移', cfg.accounts.length === 1 && cfg.accounts[0].provider === 'volcengine');
}

if (failures > 0) { console.error(`FAIL: ${failures} 项未通过`); process.exit(1); }
console.log('PASS：全部自检通过');
