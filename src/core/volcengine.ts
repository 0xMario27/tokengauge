import { createHash, createHmac } from 'node:crypto';

// 从 cc-switch src-tauri/src/services/coding_plan.rs 移植的火山引擎控制面 OpenAPI 逻辑
// （签名 V4 + GetAFPUsage/GetCodingPlanUsage 探测 + 档位解析），保持逐字一致。

export const VOLCENGINE_HOST = 'open.volcengineapi.com';
export const API_VERSION = '2024-01-01';
export const DEFAULT_REGION = 'cn-beijing';
const SERVICE = 'ark';
const CONTENT_TYPE = 'application/json; charset=utf-8';
const SIGNED_HEADERS = 'host;x-date;x-content-sha256;content-type';
const AKSK_HINT =
  'Check the AccessKey ID / Secret are correct and the account has Ark usage-query (OpenAPI) permission.';

// 与 cc-switch 显示名一致（zh locale：fiveHour/sevenDay/monthly）
export const TIER_FIVE_HOUR = '5小时';
export const TIER_WEEKLY = '7天';
export const TIER_MONTHLY = '每月';

export interface Tier { name: string; utilization: number; resetsAt?: string | null; }
export interface UsageResult {
  ok: boolean; plan?: string; tiers: Tier[]; error?: string; queriedAt: number;
}

function sha256Hex(data: Buffer | string): string { return createHash('sha256').update(data).digest('hex'); }
function hmacSha256(key: Buffer | string, data: Buffer | string): Buffer { return createHmac('sha256', key).update(data).digest(); }

// RFC3986 unreserved 之外全部 %XX（与 Rust volc_uri_encode 一致）
function volcUriEncode(input: string): string {
  return encodeURIComponent(input).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function fmtUtc(d: Date, kind: 'stamp' | 'short'): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const short = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
  return kind === 'short' ? short : `${short}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

export function canonicalQuery(action: string, region: string): string {
  const pairs: [string, string][] = [
    ['Action', action], ['Region', region], ['Version', API_VERSION],
  ];
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return pairs.map(([k, v]) => `${volcUriEncode(k)}=${volcUriEncode(v)}`).join('&');
}

export interface SignResult { authorization: string; xDate: string; xContentSha256: string; }

export function volcengineSign(
  accessKeyId: string, secretAccessKey: string, region: string,
  canonicalQueryStr: string, body: Buffer, now: Date,
): SignResult {
  const xDate = fmtUtc(now, 'stamp');
  const shortDate = fmtUtc(now, 'short');
  const xContentSha256 = sha256Hex(body);
  // 固定顺序 canonical headers（火山特有，不排序）
  const canonicalHeaders =
    `host:${VOLCENGINE_HOST}\nx-date:${xDate}\nx-content-sha256:${xContentSha256}\ncontent-type:${CONTENT_TYPE}\n`;
  const canonicalRequest =
    `POST\n/\n${canonicalQueryStr}\n${canonicalHeaders}\n${SIGNED_HEADERS}\n${xContentSha256}`;
  const credentialScope = `${shortDate}/${region}/${SERVICE}/request`;
  const stringToSign =
    `HMAC-SHA256\n${xDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;
  const kDate = hmacSha256(secretAccessKey, shortDate);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, SERVICE);
  const kSigning = hmacSha256(kService, 'request');
  const signature = hmacSha256(kSigning, stringToSign).toString('hex');
  return {
    authorization: `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${SIGNED_HEADERS}, Signature=${signature}`,
    xDate, xContentSha256,
  };
}

export type VolcCall =
  | { kind: 'body'; body: any }
  | { kind: 'auth'; detail: string }
  | { kind: 'soft'; detail: string }
  | { kind: 'transient'; detail: string };

function responseError(body: any): [string, string] | null {
  const err = body?.ResponseMetadata?.Error ?? body?.Error;
  if (!err) return null;
  const code = typeof err.Code === 'string' ? err.Code : '';
  const msg = typeof err.Message === 'string' ? err.Message : '';
  return code || msg ? [code, msg] : null;
}

function isAuthErrorCode(code: string): boolean {
  return /auth|signature|accessdenied|denied|unauthorized|forbidden|credential|token/i.test(code);
}

export async function volcengineOpenApiCall(
  region: string, accessKeyId: string, secretAccessKey: string, action: string,
): Promise<VolcCall> {
  const q = canonicalQuery(action, region);
  const url = `https://${VOLCENGINE_HOST}/?${q}`;
  const { authorization, xDate, xContentSha256 } = volcengineSign(
    accessKeyId, secretAccessKey, region, q, Buffer.alloc(0), new Date(),
  );
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Date': xDate, 'X-Content-Sha256': xContentSha256,
        'Content-Type': CONTENT_TYPE, Authorization: authorization,
      },
      body: Buffer.alloc(0),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e: any) {
    return { kind: 'transient', detail: `Network error: ${e?.message ?? e}` };
  }
  const status = resp.status;
  if (status === 401 || status === 403) {
    return { kind: 'auth', detail: `Authentication failed (HTTP ${status}). ${AKSK_HINT}` };
  }
  let raw: string;
  try { raw = await resp.text(); } catch (e: any) {
    return { kind: 'transient', detail: `Failed to read response: ${e?.message ?? e}` };
  }
  let body: any = null;
  try { body = JSON.parse(raw); } catch { /* keep null */ }
  if (!resp.ok) {
    const err = body ? responseError(body) : null;
    if (err) {
      const [code, msg] = err;
      if (isAuthErrorCode(code)) return { kind: 'auth', detail: `Authentication failed (HTTP ${status}, ${code}): ${msg}. ${AKSK_HINT}` };
      return { kind: 'soft', detail: `API error (HTTP ${status}, ${code}): ${msg}` };
    }
    return { kind: 'soft', detail: `API error (HTTP ${status}): ${raw.slice(0, 500)}` };
  }
  if (body === null) return { kind: 'soft', detail: 'Failed to parse response' };
  const err = responseError(body);
  if (err) {
    const [code, msg] = err;
    if (isAuthErrorCode(code)) return { kind: 'auth', detail: `Authentication failed (${code}): ${msg}. ${AKSK_HINT}` };
    return { kind: 'soft', detail: `API error (${code}): ${msg}` };
  }
  return { kind: 'body', body };
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
}

function extractResetTime(v: unknown): string | null {
  const n = toNum(v);
  if (n === null || n < 0) return null;
  const ms = n < 1e11 ? n * 1000 : n; // 秒级 / 毫秒级兼容
  return new Date(ms).toISOString();
}

export function parseAfpTiers(result: any): Tier[] {
  const tiers: Tier[] = [];
  for (const [key, name] of [
    ['AFPFiveHour', TIER_FIVE_HOUR], ['AFPWeekly', TIER_WEEKLY], ['AFPMonthly', TIER_MONTHLY],
  ] as const) {
    const win = result?.[key];
    if (!win) continue;
    const quota = toNum(win.Quota) ?? 0;
    if (quota <= 0) continue; // 未订阅/未启用窗口跳过（也用于识别"无 Agent Plan"）
    const used = toNum(win.Used) ?? 0;
    tiers.push({ name, utilization: (used / quota) * 100, resetsAt: extractResetTime(win.ResetTime) });
  }
  return tiers;
}

function codingWindow(label: string): string | null {
  switch (label.toLowerCase()) {
    case 'session': case '5h': case 'fivehour': case 'five_hour': case 'rolling_5h': return TIER_FIVE_HOUR;
    case 'weekly': case 'week': case '7d': return TIER_WEEKLY;
    case 'monthly': case 'month': return TIER_MONTHLY;
    default: return null;
  }
}

export function parseCodingPlanTiers(result: any): Tier[] {
  const arr = result?.QuotaUsage ?? result?.Usages ?? result?.Details;
  if (!Array.isArray(arr)) return [];
  const tiers: Tier[] = [];
  for (const item of arr) {
    const label = item?.Level ?? item?.Type ?? item?.Period ?? item?.Label ?? item?.Window ?? '';
    const name = codingWindow(String(label));
    if (!name) continue;
    const utilization = toNum(item?.Percent) ?? toNum(item?.UsedPercent) ?? toNum(item?.UsagePercent) ?? 0;
    tiers.push({ name, utilization, resetsAt: extractResetTime(item?.ResetTime ?? item?.ResetTimestamp) });
  }
  return tiers;
}

export async function queryVolcengineUsage(
  accessKeyId: string, secretAccessKey: string, region?: string,
): Promise<UsageResult> {
  const reg = region?.trim() || DEFAULT_REGION;
  const soft: string[] = [];
  const queriedAt = Date.now();

  // 1) Agent Plan 探测
  const afp = await volcengineOpenApiCall(reg, accessKeyId, secretAccessKey, 'GetAFPUsage');
  if (afp.kind === 'auth') return { ok: false, tiers: [], error: afp.detail, queriedAt };
  if (afp.kind === 'transient') return { ok: false, tiers: [], error: `GetAFPUsage: ${afp.detail}`, queriedAt };
  if (afp.kind === 'soft') soft.push(`GetAFPUsage: ${afp.detail}`);
  else {
    const result = afp.body?.Result ?? afp.body;
    const tiers = parseAfpTiers(result);
    if (tiers.length > 0) {
      const pt = result?.PlanType;
      const plan = typeof pt === 'string' && pt.trim() ? `Agent Plan ${pt.trim()}` : undefined;
      return { ok: true, plan, tiers, queriedAt };
    }
  }

  // 2) Coding Plan 回退
  const cp = await volcengineOpenApiCall(reg, accessKeyId, secretAccessKey, 'GetCodingPlanUsage');
  if (cp.kind === 'auth') return { ok: false, tiers: [], error: cp.detail, queriedAt };
  if (cp.kind === 'transient') return { ok: false, tiers: [], error: `GetCodingPlanUsage: ${cp.detail}`, queriedAt };
  if (cp.kind === 'soft') soft.push(`GetCodingPlanUsage: ${cp.detail}`);
  else {
    const result = cp.body?.Result ?? cp.body;
    const tiers = parseCodingPlanTiers(result);
    if (tiers.length > 0) return { ok: true, plan: 'Coding Plan', tiers, queriedAt };
  }

  return {
    ok: false, tiers: [],
    error: soft.length ? soft.join('; ') : 'No active Agent Plan or Coding Plan subscription found for this credential',
    queriedAt,
  };
}
