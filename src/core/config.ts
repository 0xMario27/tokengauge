import * as fs from 'node:fs';
import * as path from 'node:path';

/** v2 account: provider + credentials map (v1 had top-level accessKeyId/secretAccessKey, auto-migrated on load) */
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

// Standard macOS app-support directory (per-app subdirectory); same as Electron's app.getPath('userData').
export function defaultConfigPath(): string {
  const home = process.env.HOME || '';
  return path.join(home, 'Library', 'Application Support', 'TokenGauge', 'config.json');
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

/** Normalize one account: v2 as-is; v1 (top-level AK/SK) migrated to volcengine; invalid entries skipped (null) */
export function normalizeAccount(raw: any): AccountConfig | null {
  if (!raw || typeof raw.alias !== 'string' || raw.alias.trim() === '') return null;
  const alias = raw.alias.trim();
  if (typeof raw.provider === 'string' && raw.provider.trim() !== '') {
    // v2
    const credentials = normalizeCredentials(raw.credentials);
    if (Object.keys(credentials).length === 0) return null;
    return { provider: raw.provider.trim(), alias, credentials };
  }
  // v1 -> volcengine migration
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
  // Contains secrets: 0600 (owner read/write only)
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600); // rename permission semantics vary across platforms, set explicitly
  fs.renameSync(tmp, filePath);
}
