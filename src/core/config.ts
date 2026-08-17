import * as fs from 'node:fs';
import * as path from 'node:path';

export interface AccountConfig {
  alias: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
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

export function normalizeConfig(raw: any): WidgetConfig {
  const accounts: AccountConfig[] = Array.isArray(raw?.accounts)
    ? raw.accounts
        .filter((a: any) => a && typeof a.alias === 'string' && typeof a.accessKeyId === 'string' && typeof a.secretAccessKey === 'string')
        .map((a: any) => ({
          alias: a.alias.trim(),
          accessKeyId: a.accessKeyId.trim(),
          secretAccessKey: a.secretAccessKey.trim(),
          region: typeof a.region === 'string' && a.region.trim() ? a.region.trim() : undefined,
        }))
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
  // 含 SecretAccessKey，权限 600（仅属主可读写）
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600); // rename 不继承权限语义跨平台一致，显式设一次
  fs.renameSync(tmp, filePath);
}
