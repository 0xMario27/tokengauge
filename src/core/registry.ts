// ── Provider 注册表：内置实现 + 用户插件（userData/providers/*.js）──
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ProviderDef, ProviderInfo } from './provider';
import { volcengineProvider } from './providers/volcengine';

export interface Registry {
  defs: ProviderDef[];
  errors: { file: string; error: string }[];
}

/** 校验插件形状（module.exports 或 export default 均可） */
function validatePlugin(mod: any): ProviderDef {
  const def = mod?.default ?? mod;
  if (
    !def || typeof def !== 'object' ||
    typeof def.id !== 'string' || def.id.trim() === '' ||
    typeof def.name !== 'string' ||
    !Array.isArray(def.fields) ||
    typeof def.query !== 'function'
  ) {
    throw new Error('invalid provider shape (need { id, name, fields[], query() })');
  }
  return def as ProviderDef;
}

/**
 * 加载注册表。插件目录不存在则创建（首次运行），并从 example 源复制示例插件。
 * 加载失败/重复 id 的插件记入 errors，不影响其余插件与内置实现。
 */
export function loadRegistry(pluginsDir: string, exampleSrc?: string): Registry {
  if (!fs.existsSync(pluginsDir)) {
    fs.mkdirSync(pluginsDir, { recursive: true });
    if (exampleSrc && fs.existsSync(exampleSrc)) {
      try { fs.copyFileSync(exampleSrc, path.join(pluginsDir, path.basename(exampleSrc))); } catch { /* 忽略 */ }
    }
  }
  const defs: ProviderDef[] = [volcengineProvider];
  const errors: Registry['errors'] = [];
  const files = fs.readdirSync(pluginsDir).filter((f) => f.endsWith('.js')).sort();
  for (const f of files) {
    try {
      // 插件运行在主进程，等同用户自己写的代码（同 VS Code 扩展信任模型）
      const def = validatePlugin(require(path.join(pluginsDir, f)));
      if (defs.some((d) => d.id === def.id)) throw new Error(`duplicate provider id "${def.id}"`);
      defs.push(def);
    } catch (e: any) {
      errors.push({ file: f, error: String(e?.message ?? e) });
    }
  }
  return { defs, errors };
}

export function providerInfos(r: Registry): ProviderInfo[] {
  return r.defs.map(({ id, name, fields }) => ({ id, name, fields }));
}
