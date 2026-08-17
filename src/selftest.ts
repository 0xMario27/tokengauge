// Deterministic self-tests ported from cc-switch coding_plan.rs: signature structure + parsing vectors.
import { canonicalQuery, volcengineSign, parseAfpTiers, parseCodingPlanTiers, TIER_FIVE_HOUR, TIER_WEEKLY, TIER_MONTHLY, volcengineProvider } from './core/providers/volcengine';

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  ✓ ${name}`); } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('canonical query:');
check('sorted & encoded query', canonicalQuery('GetAFPUsage', 'cn-beijing') === 'Action=GetAFPUsage&Region=cn-beijing&Version=2024-01-01', canonicalQuery('GetAFPUsage', 'cn-beijing'));

console.log('Signature V4 (AKLTtest/secretkey @ 2024-06-21T00:00:00Z, GetAFPUsage/cn-beijing, empty body):');
const now = new Date('2024-06-21T00:00:00Z');
const q = canonicalQuery('GetAFPUsage', 'cn-beijing');
const s1 = volcengineSign('AKLTtest', 'secretkey', 'cn-beijing', q, Buffer.alloc(0), now);
check('empty body SHA-256 constant', s1.xContentSha256 === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', s1.xContentSha256);
check('X-Date format', s1.xDate === '20240621T000000Z', s1.xDate);
check('Credential/scope structure (no AWS4 prefix, ark/request suffix)', s1.authorization.startsWith('HMAC-SHA256 Credential=AKLTtest/20240621/cn-beijing/ark/request,'), s1.authorization);
check('fixed SignedHeaders order', s1.authorization.includes('SignedHeaders=host;x-date;x-content-sha256;content-type,'), s1.authorization);
const sig = s1.authorization.split('Signature=')[1] ?? '';
check('signature is 64 hex chars', sig.length === 64 && /^[0-9a-f]{64}$/.test(sig), sig);
check('determinism: same input, same output', JSON.stringify(s1) === JSON.stringify(volcengineSign('AKLTtest', 'secretkey', 'cn-beijing', q, Buffer.alloc(0), now)));

console.log('parseAfpTiers (official sample: 5h 25% / weekly 30% / monthly 42.525%, daily skipped):');
const afp = parseAfpTiers({
  PlanType: 'Large',
  AFPFiveHour: { Quota: 50, Used: 12.5, ResetTime: 1778806800000 },
  AFPDaily: { Quota: 100, Used: 22.5 },
  AFPWeekly: { Quota: 500, Used: 150, ResetTime: 1779062400000 },
  AFPMonthly: { Quota: 2000, Used: 850.5, ResetTime: 1780531200000 },
});
check('three tiers (daily skipped)', afp.length === 3 && afp[0].name === TIER_FIVE_HOUR && afp[1].name === TIER_WEEKLY && afp[2].name === TIER_MONTHLY, JSON.stringify(afp.map(t => t.name)));
check('5h 25%', Math.abs(afp[0].utilization - 25) < 1e-9, String(afp[0].utilization));
check('weekly 30%', Math.abs(afp[1].utilization - 30) < 1e-9, String(afp[1].utilization));
check('monthly 42.525%', Math.abs(afp[2].utilization - 42.525) < 1e-9, String(afp[2].utilization));
check('resetsAt is ISO', typeof afp[2].resetsAt === 'string' && !Number.isNaN(Date.parse(afp[2].resetsAt!)));
check('Quota=0 -> empty (no Agent Plan detection)', parseAfpTiers({ AFPFiveHour: { Quota: 0, Used: 0 }, AFPWeekly: { Quota: 0, Used: 0 } }).length === 0);

console.log('parseCodingPlanTiers (real response: session/weekly/monthly percentages + second-level timestamps):');
const cpt = parseCodingPlanTiers({
  Status: 'Running', UpdateTimestamp: 1782053286,
  QuotaUsage: [
    { Level: 'session', Percent: 0, ResetTimestamp: -1 },
    { Level: 'weekly', Percent: 1.672568, ResetTimestamp: 1782057600 },
    { Level: 'monthly', Percent: 0.836284, ResetTimestamp: 1784303999 },
  ],
});
check('three-tier mapping', cpt.length === 3 && cpt[0].name === TIER_FIVE_HOUR && cpt[1].name === TIER_WEEKLY && cpt[2].name === TIER_MONTHLY, JSON.stringify(cpt.map(t => t.name)));
check('session 0% with no reset (-1)', cpt[0].utilization === 0 && cpt[0].resetsAt == null);
check('weekly 1.672568%', Math.abs(cpt[1].utilization - 1.672568) < 1e-6, String(cpt[1].utilization));
check('monthly 0.836284%', Math.abs(cpt[2].utilization - 0.836284) < 1e-6, String(cpt[2].utilization));
check('seconds timestamp -> ISO', typeof cpt[2].resetsAt === 'string' && !Number.isNaN(Date.parse(cpt[2].resetsAt!)));
check('unknown windows skipped', parseCodingPlanTiers({ QuotaUsage: [{ Level: 'daily', Percent: 9 }, { Level: 'weekly', Percent: 20 }] }).length === 1);

console.log('Config persistence (write/read round-trip):');
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { normalizeConfig, normalizeAccount, saveConfig, loadConfig } from './core/config';
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-widget-test-'));
  const file = path.join(dir, 'config.json');
  saveConfig(file, {
    refreshIntervalSec: 45,
    accounts: [{ provider: 'volcengine', alias: 'primary', credentials: { accessKeyId: 'AK1', secretAccessKey: 'SK1', region: 'cn-beijing' } }],
  });
  const loaded = loadConfig(file);
  check('account round-trips intact', loaded.accounts.length === 1 && loaded.accounts[0].alias === 'primary' && loaded.accounts[0].credentials.secretAccessKey === 'SK1' && loaded.refreshIntervalSec === 45, JSON.stringify(loaded));
  fs.rmSync(dir, { recursive: true, force: true });
}
check('normalize rejects incomplete accounts', normalizeConfig({ accounts: [{ alias: 'x', accessKeyId: 'k' }] }).accounts.length === 0);

console.log('Provider registration shape:');
check('built-in volcengine provider shape', volcengineProvider.id === 'volcengine' && volcengineProvider.fields.length === 3 && typeof volcengineProvider.query === 'function');

console.log('Config v1 -> v2 migration:');
{
  const acc = normalizeAccount({ alias: ' legacy ', accessKeyId: ' AK1 ', secretAccessKey: ' SK1 ', region: ' ' });
  check('v1 migrates to volcengine + credentials', acc !== null && acc.provider === 'volcengine' && acc.alias === 'legacy' && acc.credentials.accessKeyId === 'AK1' && acc.credentials.secretAccessKey === 'SK1' && acc.credentials.region === undefined, JSON.stringify(acc));
  const acc2 = normalizeAccount({ provider: 'deepseek', alias: 'x', credentials: { apiKey: ' k ' } });
  check('v2 passes through trimmed', acc2 !== null && acc2.credentials.apiKey === 'k');
  check('missing credentials / alias rejected', normalizeAccount({ alias: 'a', provider: 'p', credentials: {} }) === null && normalizeAccount({ accessKeyId: 'k' }) === null);
  const cfg = normalizeConfig({ accounts: [{ alias: 'v1', accessKeyId: 'AK', secretAccessKey: 'SK' }] });
  check('normalizeConfig migrates wholesale', cfg.accounts.length === 1 && cfg.accounts[0].provider === 'volcengine');
}

if (failures > 0) { console.error(`FAIL: ${failures} check(s) failed`); process.exit(1); }
console.log('PASS: all self-tests passed');
