// Renderer: plain script (module:none output); types re-declared from core, no runtime deps
interface FieldDef { key: string; label: string; type?: 'text' | 'password'; placeholder?: string; optional?: boolean; }
interface ProviderInfo { id: string; name: string; fields: FieldDef[]; }
interface AccountConfig { provider: string; alias: string; credentials: Record<string, string>; }
interface WidgetConfig { refreshIntervalSec: number; accounts: AccountConfig[]; locale?: 'zh' | 'en'; }
interface Tier { name: string; utilization: number; resetsAt?: string | null; }
interface UsageResult { ok: boolean; plan?: string; tiers: Tier[]; error?: string; queriedAt: number; alias: string; }
interface WidgetState { config: WidgetConfig; usage: UsageResult[]; updating: boolean; providers: ProviderInfo[]; providerErrors: { file: string; error: string }[]; }
interface ArkAPI {
  getState(): Promise<WidgetState>;
  getConfigPath(): Promise<string>;
  refresh(): Promise<WidgetState>;
  saveConfig(cfg: unknown): Promise<WidgetState>;
  deleteConfig(): Promise<WidgetState>;
  showConfigFolder(): Promise<void>;
  openPluginsFolder(): Promise<void>;
  quit(): Promise<void>;
  onUsageUpdate(cb: (s: WidgetState) => void): () => void;
  onOpenSettings(cb: () => void): () => void;
}
declare const arkAPI: ArkAPI;

let state: WidgetState | null = null;
let editingIndex = -1;

const $ = (id: string) => document.getElementById(id) as HTMLElement;

// 24px stroke linear icons matching the header (lucide style, scaled to 9-10px at runtime)
const ALERT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
const PENCIL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
const TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';

// ── i18n: zh/en dictionaries; effective locale = config override or system language ──
type Locale = 'zh' | 'en';
const STRINGS: Record<Locale, Record<string, string>> = {
  en: {
    settings: 'Settings', refresh: 'Refresh', interval: 'Auto interval (s)', language: 'Language', auto: 'Auto (system)',
    accounts: 'Accounts', addEdit: 'Add / Edit', add: 'Add', save: 'Save', cancelEdit: 'Cancel',
    edit: 'Edit', delete: 'Delete', done: 'Done', configBtn: 'Config file', pluginsBtn: 'Plugins folder',
    deleteAllBtn: 'Delete all', aliasPh: 'Alias (e.g. primary)', optional: ' (optional)',
    aliasRequired: 'Alias is required', fieldRequired: ' is required', deleteAcc: 'Delete account "{alias}"?',
    deleteAllConfirm: 'Delete all configuration (all accounts)?', queryFailed: 'Query failed',
    configPath: 'Config: ', pluginFailed: 'Plugin load failed: ', pluginNotLoaded: ' (plugin not loaded)',
    emptyL1: 'No accounts yet', emptyL2: 'Click the tray icon · Settings', dragTitle: 'Drag to move',
    peak: 'Peak', idle: 'Idle', toPeak: '-> peak ', toIdle: '-> idle ', dsName: 'DeepSeek hours',
  },
  zh: {
    settings: '设置', refresh: '刷新', interval: '自动间隔（秒）', language: '语言', auto: '跟随系统',
    accounts: '账号', addEdit: '添加 / 编辑', add: '添加', save: '保存修改', cancelEdit: '取消编辑',
    edit: '编辑', delete: '删除', done: '完成', configBtn: '配置文件', pluginsBtn: '插件目录',
    deleteAllBtn: '全部删除', aliasPh: '别名（如：主力）', optional: '（可选）',
    aliasRequired: '别名不能为空', fieldRequired: ' 不能为空', deleteAcc: '删除账号「{alias}」？',
    deleteAllConfirm: '删除全部配置（所有账号）？', queryFailed: '查询失败',
    configPath: '配置文件：', pluginFailed: '插件加载失败：', pluginNotLoaded: '（插件未加载）',
    emptyL1: '暂无账号', emptyL2: '点菜单栏图标 · 设置', dragTitle: '拖动移动',
    peak: '高峰', idle: '空闲', toPeak: '-> 高峰 ', toIdle: '-> 空闲 ', dsName: 'DeepSeek 时段',
  },
};
// Known tier display names -> zh (unknown/plugin-provided names pass through unchanged)
const TIER_ZH: Record<string, string> = { '5h': '5小时', '7d': '7天', Monthly: '每月' };

function effectiveLocale(): Locale {
  const cfg = state?.config.locale;
  if (cfg === 'zh' || cfg === 'en') return cfg;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function t(key: string): string {
  return STRINGS[effectiveLocale()][key] ?? STRINGS.en[key] ?? key;
}

function tierLabel(name: string): string {
  return effectiveLocale() === 'zh' ? TIER_ZH[name] ?? name : name;
}

/** Apply locale to static elements (data-i18n / data-i18n-ph / data-i18n-title) + <html lang> */
function applyStaticI18n(): void {
  document.documentElement.lang = effectiveLocale() === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n!); });
  document.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh!); });
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle!); });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function maskAk(ak: string): string {
  return ak.length > 8 ? ak.slice(0, 4) + '…' + ak.slice(-4) : '***';
}

function providerName(id: string): string {
  return state?.providers.find((p) => p.id === id)?.name ?? id;
}

function providerFields(id: string): FieldDef[] {
  return state?.providers.find((p) => p.id === id)?.fields ?? [];
}

/** Render credential inputs dynamically from the selected provider's fields; prefilled when editCreds is given */
function renderFormFields(providerId: string, editCreds?: Record<string, string>): void {
  const box = $('fFields');
  box.innerHTML = '';
  for (const f of providerFields(providerId)) {
    const input = document.createElement('input');
    input.dataset.credKey = f.key;
    input.dataset.optional = f.optional ? '1' : '';
    if (f.type === 'password') input.type = 'password';
    input.placeholder = f.label + (f.optional ? t('optional') : '') + (f.placeholder ? ' · ' + f.placeholder : '');
    if (editCreds && typeof editCreds[f.key] === 'string') input.value = editCreds[f.key];
    box.appendChild(input);
  }
}

/** Collect credentials from the dynamic form (trimmed; empty optional fields are omitted) */
function collectCreds(): Record<string, string> {
  const creds: Record<string, string> = {};
  const inputs = document.querySelectorAll('#fFields input[data-cred-key]');
  for (let i = 0; i < inputs.length; i++) {
    const el = inputs[i] as HTMLInputElement;
    const v = el.value.trim();
    if (v !== '' || el.dataset.optional !== '1') {
      if (v === '') throw new Error((el.placeholder || 'Field') + t('fieldRequired'));
      creds[el.dataset.credKey!] = v;
    }
  }
  return creds;
}

function renderProviderSelect(selected: string): void {
  const sel = $('fProvider') as HTMLSelectElement;
  sel.innerHTML = '';
  for (const p of state?.providers ?? []) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
  // Account whose plugin is unloaded: keep the original value selectable so editing does not silently rewrite the provider
  if (selected && !sel.querySelector(`option[value="${CSS.escape(selected)}"]`)) {
    const ghost = document.createElement('option');
    ghost.value = selected;
    ghost.textContent = providerName(selected) + t('pluginNotLoaded');
    sel.appendChild(ghost);
  }
  sel.value = selected;
}

// Adaptive reset countdown: <1h mm:ss, <24h hh:mm:ss, >=24h Xd Yh
function fmtReset(ms: number): string {
  if (ms <= 0) return '-';
  const s = Math.floor(ms / 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  if (s >= 3600) return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  return `${p(Math.floor(s / 60))}:${p(s % 60)}`;
}

// ── DeepSeek hours (Beijing time): peak 9-12 & 14-18, otherwise idle ──
const DS_TRANSITIONS: { t: number; peak: boolean }[] = [
  { t: 9 * 3600, peak: true }, { t: 12 * 3600, peak: false },
  { t: 14 * 3600, peak: true }, { t: 18 * 3600, peak: false },
  { t: 24 * 3600 + 9 * 3600, peak: true }, // next day 9:00
];

function beijingSecs(): number {
  // Explicitly convert to UTC+8, independent of the system timezone
  const d = new Date(Date.now() + (new Date().getTimezoneOffset() + 480) * 60000);
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

function dsInPeak(secs: number): boolean {
  return (secs >= 9 * 3600 && secs < 12 * 3600) || (secs >= 14 * 3600 && secs < 18 * 3600);
}

function updateDsTimeline(): void {
  const secs = beijingSecs();
  const nowEl = document.getElementById('dsNow');
  if (nowEl) nowEl.style.left = ((secs / 86400) * 100).toFixed(3) + '%';
  const inPeak = dsInPeak(secs);
  const statusEl = document.getElementById('dsStatus');
  if (statusEl) {
    statusEl.textContent = inPeak ? t('peak') : t('idle');
    statusEl.className = 'ds-status ' + (inPeak ? 'peak' : 'idle');
  }
  const nextEl = document.getElementById('dsNext');
  if (nextEl) {
    const next = DS_TRANSITIONS.find((tr) => tr.t > secs);
    nextEl.textContent = next ? (next.peak ? t('toPeak') : t('toIdle')) + fmtReset((next.t - secs) * 1000) : '';
  }
}

function render() {
  if (!state) return;
  const box = $('accounts');
  $('empty').classList.toggle('hidden', state.config.accounts.length > 0);
  box.innerHTML = '';
  state.usage.forEach((u) => {
    const panel = document.createElement('div');
    panel.className = u.ok ? 'panel' : 'panel panel-err';
    const head = document.createElement('div');
    head.className = 'head';
    const alias = document.createElement('span');
    alias.className = 'alias';
    alias.textContent = u.alias;
    head.appendChild(alias);
    if (u.ok) {
      if (u.plan) {
        const plan = document.createElement('span');
        plan.className = 'plan';
        plan.textContent = u.plan;
        head.appendChild(plan);
      }
      panel.appendChild(head);
      const tiers = document.createElement('div');
      tiers.className = 'tiers';
      for (const tier of u.tiers) {
        const cls = tier.utilization < 70 ? 'g' : tier.utilization < 90 ? 'o' : 'r';
        const row = document.createElement('div');
        row.className = 'tier-row';
        const name = document.createElement('span');
        name.className = 'tier-name';
        name.textContent = tierLabel(tier.name);
        const bar = document.createElement('span');
        bar.className = 'tier-bar';
        const fill = document.createElement('span');
        fill.className = 'tier-bar-fill ' + cls;
        fill.style.width = Math.min(100, Math.max(0, tier.utilization)) + '%';
        bar.appendChild(fill);
        const pct = document.createElement('span');
        pct.className = 'tier-pct ' + cls;
        pct.textContent = Math.round(tier.utilization * 10) / 10 + '%';
        const resetSpan = document.createElement('span');
        resetSpan.className = 'tier-reset';
        if (tier.resetsAt) {
          const ms = Date.parse(tier.resetsAt) - Date.now();
          if (ms > 0) { resetSpan.dataset.reset = tier.resetsAt; resetSpan.textContent = fmtReset(ms); }
          else resetSpan.textContent = '-';
        }
        row.append(name, bar, pct, resetSpan);
        tiers.appendChild(row);
      }
      panel.appendChild(tiers);
    } else {
      panel.appendChild(head);
      const err = document.createElement('div');
      err.className = 'err';
      err.innerHTML = ALERT_SVG + '<span>' + escapeHtml(u.error || t('queryFailed')) + '</span>';
      panel.appendChild(err);
    }
    box.appendChild(panel);
  });
}

function openSettings() {
  if (!state) return;
  editingIndex = -1;
  (document.getElementById('intervalInput') as HTMLInputElement).value = String(state.config.refreshIntervalSec);
  (document.getElementById('localeSelect') as HTMLSelectElement).value = state.config.locale ?? 'auto';
  (document.getElementById('fAlias') as HTMLInputElement).value = '';
  (document.getElementById('addBtn') as HTMLButtonElement).textContent = t('add');
  (document.getElementById('cancelEditBtn') as HTMLElement).classList.add('hidden');
  renderProviderSelect(state.providers[0]?.id ?? '');
  renderFormFields(state.providers[0]?.id ?? '');
  renderAccountList();
  renderPluginErrors();
  $('settingsModal').classList.remove('hidden');
  void arkAPI.getConfigPath().then((p) => { (document.getElementById('cfgPath') as HTMLElement).textContent = t('configPath') + p; });
}

function renderPluginErrors(): void {
  const el = $('pluginErrors');
  const errs = state?.providerErrors ?? [];
  el.classList.toggle('hidden', errs.length === 0);
  el.textContent = errs.length ? t('pluginFailed') + errs.map((e) => e.file + ' (' + e.error + ')').join('; ') : '';
}

function renderAccountList() {
  if (!state) return;
  const list = $('accountList');
  list.innerHTML = '';
  state.config.accounts.forEach((a, i) => {
    const row = document.createElement('div');
    row.className = 'acc-row';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = a.alias + ' · ' + providerName(a.provider);
    const ak = document.createElement('span');
    ak.className = 'ak';
    ak.textContent = maskAk(Object.values(a.credentials)[0] ?? '');
    const edit = document.createElement('button');
    edit.className = 'mini-btn';
    edit.title = t('edit');
    edit.innerHTML = PENCIL_SVG;
    edit.onclick = () => {
      editingIndex = i;
      (document.getElementById('fAlias') as HTMLInputElement).value = a.alias;
      renderProviderSelect(a.provider);
      renderFormFields(a.provider, a.credentials);
      (document.getElementById('addBtn') as HTMLButtonElement).textContent = t('save');
      (document.getElementById('cancelEditBtn') as HTMLElement).classList.remove('hidden');
    };
    const del = document.createElement('button');
    del.className = 'mini-btn del';
    del.title = t('delete');
    del.innerHTML = TRASH_SVG;
    del.onclick = () => {
      if (!state) return;
      if (!confirm(t('deleteAcc').replace('{alias}', a.alias))) return;
      const accounts = state.config.accounts.filter((_, j) => j !== i);
      void saveState({ ...state.config, accounts });
    };
    row.append(name, ak, edit, del);
    list.appendChild(row);
  });
}

function intervalValue(): number {
  return Number((document.getElementById('intervalInput') as HTMLInputElement).value) || 30;
}

function localeValue(): 'zh' | 'en' | undefined {
  const v = (document.getElementById('localeSelect') as HTMLSelectElement).value;
  return v === 'zh' || v === 'en' ? v : undefined;
}

async function saveState(cfg: WidgetConfig) {
  state = await arkAPI.saveConfig(cfg);
  render();
  renderAccountList();
}

function bind() {
  $('empty').addEventListener('click', () => openSettings());
  arkAPI.onOpenSettings(() => openSettings());
  $('modalCloseBtn').onclick = async () => {
    $('settingsModal').classList.add('hidden');
    if (state) await saveState({ refreshIntervalSec: intervalValue(), locale: localeValue(), accounts: state.config.accounts });
  };
  $('fProvider').addEventListener('change', () => {
    renderFormFields(($('fProvider') as HTMLSelectElement).value);
  });
  $('addBtn').onclick = async () => {
    const alias = (document.getElementById('fAlias') as HTMLInputElement).value.trim();
    const provider = ($('fProvider') as HTMLSelectElement).value;
    if (!alias) { alert(t('aliasRequired')); return; }
    let creds: Record<string, string>;
    try { creds = collectCreds(); } catch (e) { alert(String((e as Error).message)); return; }
    const accounts = [...(state?.config.accounts ?? [])];
    // When editing an account whose plugin is unloaded and the form yields no fields, keep the original credentials (prevents normalize from dropping the account)
    const orig = editingIndex >= 0 ? accounts[editingIndex] : undefined;
    if (editingIndex >= 0 && orig && orig.provider === provider && Object.keys(creds).length === 0 && Object.keys(orig.credentials).length > 0) {
      creds = orig.credentials;
    }
    const account: AccountConfig = { provider, alias, credentials: creds };
    if (editingIndex >= 0 && editingIndex < accounts.length) accounts[editingIndex] = account;
    else accounts.push(account);
    editingIndex = -1;
    (document.getElementById('addBtn') as HTMLButtonElement).textContent = t('add');
    (document.getElementById('cancelEditBtn') as HTMLElement).classList.add('hidden');
    (document.getElementById('fAlias') as HTMLInputElement).value = '';
    renderFormFields(provider);
    await saveState({ refreshIntervalSec: intervalValue(), locale: localeValue(), accounts });
  };
  $('cancelEditBtn').onclick = () => {
    editingIndex = -1;
    (document.getElementById('addBtn') as HTMLButtonElement).textContent = t('add');
    (document.getElementById('cancelEditBtn') as HTMLElement).classList.add('hidden');
    renderFormFields(($('fProvider') as HTMLSelectElement).value);
  };
  // Locale switch: persist + re-apply static texts; rendered lists and tray menu follow via save broadcast
  $('localeSelect').addEventListener('change', async () => {
    if (!state) return;
    state = await arkAPI.saveConfig({ ...state.config, locale: localeValue() });
    applyStaticI18n();
    render();
    renderAccountList();
    renderPluginErrors();
    (document.getElementById('addBtn') as HTMLButtonElement).textContent = editingIndex >= 0 ? t('save') : t('add');
  });
  $('openPluginsBtn').onclick = () => { void arkAPI.openPluginsFolder(); };
  $('showFolderBtn').onclick = () => { void arkAPI.showConfigFolder(); };
  $('deleteAllBtn').onclick = async () => {
    if (!confirm(t('deleteAllConfirm'))) return;
    state = await arkAPI.deleteConfig();
    render();
    renderAccountList();
  };
  updateDsTimeline();
  arkAPI.onUsageUpdate((s) => { state = s; render(); });
  void arkAPI.getState().then((s) => { state = s; applyStaticI18n(); render(); bind2(); });
}

// Tick every second: refresh per-tier countdowns from data-reset attributes
function bind2() {
  setInterval(() => {
    updateDsTimeline();
    const els = document.querySelectorAll('[data-reset]');
    for (let i = 0; i < els.length; i++) {
      const el = els[i] as HTMLElement;
      const at = el.dataset.reset;
      if (!at) continue;
      const ms = Date.parse(at) - Date.now();
      el.textContent = ms > 0 ? fmtReset(ms) : '-';
    }
  }, 1000);
}

bind();
