// 渲染层：纯脚本（module:none 输出），类型与 core 冗余声明，无运行时依赖
interface AccountConfig { alias: string; accessKeyId: string; secretAccessKey: string; region?: string; }
interface WidgetConfig { refreshIntervalSec: number; accounts: AccountConfig[]; }
interface Tier { name: string; utilization: number; resetsAt?: string | null; }
interface UsageResult { ok: boolean; plan?: string; tiers: Tier[]; error?: string; queriedAt: number; alias: string; }
interface WidgetState { config: WidgetConfig; usage: UsageResult[]; updating: boolean; }
interface ArkAPI {
  getState(): Promise<WidgetState>;
  getConfigPath(): Promise<string>;
  refresh(): Promise<WidgetState>;
  saveConfig(cfg: unknown): Promise<WidgetState>;
  deleteConfig(): Promise<WidgetState>;
  showConfigFolder(): Promise<void>;
  quit(): Promise<void>;
  onUsageUpdate(cb: (s: WidgetState) => void): () => void;
  onOpenSettings(cb: () => void): () => void;
}
declare const arkAPI: ArkAPI;

let state: WidgetState | null = null;
let editingIndex = -1;

const $ = (id: string) => document.getElementById(id) as HTMLElement;

// 与头部一致的 24px 视窗线性图标（lucide 风格，运行时按 9-10px 缩放）
const ALERT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
const PENCIL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
const TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function maskAk(ak: string): string {
  return ak.length > 8 ? ak.slice(0, 4) + '…' + ak.slice(-4) : '***';
}

// 自适应重置倒计时：<1h mm:ss，<24h hh:mm:ss，>=24h Xd Yh
function fmtReset(ms: number): string {
  if (ms <= 0) return '-';
  const s = Math.floor(ms / 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  if (s >= 3600) return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  return `${p(Math.floor(s / 60))}:${p(s % 60)}`;
}

// ── DeepSeek 时段（北京时间）：高峰 9-12、14-18，其余空闲 ──
const DS_TRANSITIONS: { t: number; peak: boolean }[] = [
  { t: 9 * 3600, peak: true }, { t: 12 * 3600, peak: false },
  { t: 14 * 3600, peak: true }, { t: 18 * 3600, peak: false },
  { t: 24 * 3600 + 9 * 3600, peak: true }, // 次日 9:00
];

function beijingSecs(): number {
  // 显式换算 UTC+8，不依赖系统时区
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
    statusEl.textContent = inPeak ? '高峰' : '空闲';
    statusEl.className = 'ds-status ' + (inPeak ? 'peak' : 'idle');
  }
  const nextEl = document.getElementById('dsNext');
  if (nextEl) {
    const next = DS_TRANSITIONS.find((tr) => tr.t > secs);
    nextEl.textContent = next ? (next.peak ? '→ 高峰 ' : '→ 空闲 ') + fmtReset((next.t - secs) * 1000) : '';
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
      for (const t of u.tiers) {
        const cls = t.utilization < 70 ? 'g' : t.utilization < 90 ? 'o' : 'r';
        const row = document.createElement('div');
        row.className = 'tier-row';
        const name = document.createElement('span');
        name.className = 'tier-name';
        name.textContent = t.name;
        const bar = document.createElement('span');
        bar.className = 'tier-bar';
        const fill = document.createElement('span');
        fill.className = 'tier-bar-fill ' + cls;
        fill.style.width = Math.min(100, Math.max(0, t.utilization)) + '%';
        bar.appendChild(fill);
        const pct = document.createElement('span');
        pct.className = 'tier-pct ' + cls;
        pct.textContent = Math.round(t.utilization * 10) / 10 + '%';
        const resetSpan = document.createElement('span');
        resetSpan.className = 'tier-reset';
        if (t.resetsAt) {
          const ms = Date.parse(t.resetsAt) - Date.now();
          if (ms > 0) { resetSpan.dataset.reset = t.resetsAt; resetSpan.textContent = fmtReset(ms); }
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
      err.innerHTML = ALERT_SVG + '<span>' + escapeHtml(u.error || '查询失败') + '</span>';
      panel.appendChild(err);
    }
    box.appendChild(panel);
  });
}

function openSettings() {
  if (!state) return;
  editingIndex = -1;
  (document.getElementById('intervalInput') as HTMLInputElement).value = String(state.config.refreshIntervalSec);
  (document.getElementById('fAlias') as HTMLInputElement).value = '';
  (document.getElementById('fAk') as HTMLInputElement).value = '';
  (document.getElementById('fSk') as HTMLInputElement).value = '';
  (document.getElementById('fRegion') as HTMLInputElement).value = '';
  (document.getElementById('addBtn') as HTMLButtonElement).textContent = '添加';
  (document.getElementById('cancelEditBtn') as HTMLElement).classList.add('hidden');
  renderAccountList();
  $('settingsModal').classList.remove('hidden');
  void arkAPI.getConfigPath().then((p) => { (document.getElementById('cfgPath') as HTMLElement).textContent = '配置文件：' + p; });
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
    name.textContent = a.alias;
    const ak = document.createElement('span');
    ak.className = 'ak';
    ak.textContent = maskAk(a.accessKeyId);
    const edit = document.createElement('button');
    edit.className = 'mini-btn';
    edit.title = '编辑';
    edit.innerHTML = PENCIL_SVG;
    edit.onclick = () => {
      editingIndex = i;
      (document.getElementById('fAlias') as HTMLInputElement).value = a.alias;
      (document.getElementById('fAk') as HTMLInputElement).value = a.accessKeyId;
      (document.getElementById('fSk') as HTMLInputElement).value = a.secretAccessKey;
      (document.getElementById('fRegion') as HTMLInputElement).value = a.region || '';
      (document.getElementById('addBtn') as HTMLButtonElement).textContent = '保存修改';
      (document.getElementById('cancelEditBtn') as HTMLElement).classList.remove('hidden');
    };
    const del = document.createElement('button');
    del.className = 'mini-btn del';
    del.title = '删除';
    del.innerHTML = TRASH_SVG;
    del.onclick = () => {
      if (!state) return;
      if (!confirm(`删除账号「${a.alias}」？`)) return;
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
    if (state) await saveState({ refreshIntervalSec: intervalValue(), accounts: state.config.accounts });
  };
  $('addBtn').onclick = async () => {
    const alias = (document.getElementById('fAlias') as HTMLInputElement).value.trim();
    const ak = (document.getElementById('fAk') as HTMLInputElement).value.trim();
    const sk = (document.getElementById('fSk') as HTMLInputElement).value;
    if (!alias || !ak || !sk) { alert('别名、AccessKey ID、SecretAccessKey 均不能为空'); return; }
    const region = (document.getElementById('fRegion') as HTMLInputElement).value.trim() || undefined;
    const accounts = [...(state?.config.accounts ?? [])];
    const account: AccountConfig = { alias, accessKeyId: ak, secretAccessKey: sk, region };
    if (editingIndex >= 0 && editingIndex < accounts.length) accounts[editingIndex] = account;
    else accounts.push(account);
    editingIndex = -1;
    (document.getElementById('addBtn') as HTMLButtonElement).textContent = '添加';
    (document.getElementById('cancelEditBtn') as HTMLElement).classList.add('hidden');
    (document.getElementById('fAlias') as HTMLInputElement).value = '';
    (document.getElementById('fAk') as HTMLInputElement).value = '';
    (document.getElementById('fSk') as HTMLInputElement).value = '';
    (document.getElementById('fRegion') as HTMLInputElement).value = '';
    await saveState({ refreshIntervalSec: intervalValue(), accounts });
  };
  $('cancelEditBtn').onclick = () => {
    editingIndex = -1;
    (document.getElementById('addBtn') as HTMLButtonElement).textContent = '添加';
    (document.getElementById('cancelEditBtn') as HTMLElement).classList.add('hidden');
  };
  $('showFolderBtn').onclick = () => { void arkAPI.showConfigFolder(); };
  $('deleteAllBtn').onclick = async () => {
    if (!confirm('删除全部配置（所有账号）？')) return;
    state = await arkAPI.deleteConfig();
    render();
    renderAccountList();
  };
  updateDsTimeline();
  arkAPI.onUsageUpdate((s) => { state = s; render(); });
  void arkAPI.getState().then((s) => { state = s; render(); bind2(); });
}

// 1 秒走秒：按 data-reset 属性刷新每档倒计时
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
