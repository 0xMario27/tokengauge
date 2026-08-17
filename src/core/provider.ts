// ── Provider 契约：所有用量查询插件的统一接口 ──
// 产出统一为 UsageResult（tiers 模型），显示层与供应商解耦。

export interface Tier { name: string; utilization: number; resetsAt?: string | null; }

export interface UsageResult {
  ok: boolean;
  plan?: string;
  tiers: Tier[];
  error?: string;
  queriedAt: number;
}

/** 设置表单字段声明（渲染层据此动态生成输入框） */
export interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'password';
  placeholder?: string;
  optional?: boolean;
}

/** Provider 定义：内置实现与用户插件（userData/providers/*.js）共用同一形状 */
export interface ProviderDef {
  id: string;
  name: string;
  fields: FieldDef[];
  query(credentials: Record<string, string>): Promise<UsageResult>;
}

/** 通过 IPC 传给渲染层的可序列化形态（不含函数） */
export interface ProviderInfo {
  id: string;
  name: string;
  fields: FieldDef[];
}
