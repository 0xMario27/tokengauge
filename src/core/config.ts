import * as fs from 'node:fs';
import * as path from 'node:path';

/** v2 账户：供应商 + 凭据字典（v1 为顶层 accessKeyId/secretAccessKey，读取时自动迁移） */
export interface AccountConfig {
  provider: string;
  alias: string;
  credentials: Record<string, string>;
}

export interface WidgetConfig {
  refreshIntervalSec: number;
  accounts: AccountConfig[];
}

export const DEFAULT_CONFIG: WidgetConfig = { refreshIntervalSec: 30, accounts: [] };

// macOS 常规应用数据目录（应用名子目录下）；Electron 的 app.getPath('userData') 同此。
export function defaultConfigPath(): string {
  const home = process.env.HOME || '';
  return path.join(home, 'Library', 'Application Support', 'ark-usage-widget', 'config.json');
}

function normalizeCredentials(raw: any): Record<string, string> {
  const creds: Record<string, string> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string' && v.trim() !== '') creds[k] = v.trim();
    }
  }
  return creds;
}

/** 单账号归一化：v2 直取；v1（顶层 AK/SK）迁移为 volcengine；无效跳过返回 null */
export function normalizeAccount(raw: any): AccountConfig | null {
  if (!raw || typeof raw.alias !== 'string' || raw.alias.trim() === '') return null;
  const alias = raw.alias.trim();
  if (typeof raw.provider === 'string' && raw.provider.trim() !== '') {
    // v2
    const credentials = normalizeCredentials(raw.credentials);
    if (Object.keys(credentials).length === 0) return null;
    return { provider: raw.provider.trim(), alias, credentials };
  }
  // v1 -> volcengine 迁移
  if (typeof raw.accessKeyId === 'string' && typeof raw.secretAccessKey === 'string' &&
      raw.accessKeyId.trim() !== '' && raw.secretAccessKey.trim() !== '') {
    return {
      provider: 'volcengine',
      alias,
      credentials: normalizeCredentials({
        accessKeyId: raw.accessKeyId,
        secretAccessKey: raw.secretAccessKey,
        region: raw.region,
      }),
    };
  }
  return null;
}

export function normalizeConfig(raw: any): WidgetConfig {
  const accounts: AccountConfig[] = Array.isArray(raw?.accounts)
    ? raw.accounts.map(normalizeAccount).filter((a: AccountConfig | null): a is AccountConfig => a !== null)
    : [];
  const interval =
    typeof raw?.refreshIntervalSec === 'number' && raw.refreshIntervalSec >= 5
      ? Math.round(raw.refreshIntervalSec)
      : DEFAULT_CONFIG.refreshIntervalSec;
  return { refreshIntervalSec: interval, accounts };
}

export function loadConfig(filePath: string): WidgetConfig {
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return { ...DEFAULT_CONFIG, accounts: [] };
  }
}

export function saveConfig(filePath: string, cfg: WidgetConfig): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  // 含密钥，权限 600（仅属主可读写）
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600); // rename 不继承权限语义跨平台一致，显式设一次
  fs.renameSync(tmp, filePath);
}
