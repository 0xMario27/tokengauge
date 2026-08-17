// ── Provider contract: the single interface for all usage-query plugins ──
// Output is normalized to UsageResult (tiers model), decoupling the UI from vendors.

export interface Tier { name: string; utilization: number; resetsAt?: string | null; }

export interface UsageResult {
  ok: boolean;
  plan?: string;
  tiers: Tier[];
  error?: string;
  queriedAt: number;
}

/** Settings form field declaration (the renderer builds inputs from this) */
export interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'password';
  placeholder?: string;
  optional?: boolean;
}

/** Provider definition: built-ins and user plugins (userData/providers/*.js) share the same shape */
export interface ProviderDef {
  id: string;
  name: string;
  fields: FieldDef[];
  query(credentials: Record<string, string>): Promise<UsageResult>;
}

/** Serializable shape sent to the renderer over IPC (no functions) */
export interface ProviderInfo {
  id: string;
  name: string;
  fields: FieldDef[];
}
