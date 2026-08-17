// ── Provider registry: built-ins + user plugins (userData/providers/*.js) ──
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ProviderDef, ProviderInfo } from './provider';
import { volcengineProvider } from './providers/volcengine';

export interface Registry {
  defs: ProviderDef[];
  errors: { file: string; error: string }[];
}

/** Validate plugin shape (module.exports or export default both work) */
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
 * Load the registry. Creates the plugins dir on first run and copies the example plugin from source.
 * Failed loads / duplicate ids are recorded in errors without affecting other plugins or built-ins.
 */
export function loadRegistry(pluginsDir: string, exampleSrc?: string): Registry {
  if (!fs.existsSync(pluginsDir)) {
    fs.mkdirSync(pluginsDir, { recursive: true });
    if (exampleSrc && fs.existsSync(exampleSrc)) {
      try { fs.copyFileSync(exampleSrc, path.join(pluginsDir, path.basename(exampleSrc))); } catch { /* ignore */ }
    }
  }
  const defs: ProviderDef[] = [volcengineProvider];
  const errors: Registry['errors'] = [];
  const files = fs.readdirSync(pluginsDir).filter((f) => f.endsWith('.js')).sort();
  for (const f of files) {
    try {
      // Plugins run in the main process, equivalent to code the user wrote (VS Code extension trust model)
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
