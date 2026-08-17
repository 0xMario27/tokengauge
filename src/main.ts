import { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage, screen } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { loadConfig, saveConfig, normalizeConfig, DEFAULT_CONFIG, WidgetConfig } from './core/config';
import { UsageResult } from './core/provider';
import { loadRegistry, providerInfos, Registry } from './core/registry';

// gauge 模板图标：由 scripts/gen-tray-icon.js 生成 scripts/tray-icon.png，运行时直接读文件（避免 base64 转录出错）

const WIDTH = 280;
const HEIGHT = 380;

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let config: WidgetConfig = loadConfig(path.join(app.getPath('userData'), 'config.json'));
let usage: (UsageResult & { alias: string })[] = [];
let updating = false;
let pollTimer: NodeJS.Timeout | null = null;
let registry: Registry = { defs: [], errors: [] };

function configPath(): string { return path.join(app.getPath('userData'), 'config.json'); }
function pluginsDir(): string { return path.join(app.getPath('userData'), 'providers'); }
function windowStatePath(): string { return path.join(app.getPath('userData'), 'window-state.json'); }

function statePayload() {
  return { config, usage, updating, providers: providerInfos(registry), providerErrors: registry.errors };
}

function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send('usage-update', statePayload());
}

async function refreshAll() {
  if (updating) return;
  updating = true;
  broadcast();
  const results = await Promise.allSettled(
    config.accounts.map(async (a) => {
      const def = registry.defs.find((d) => d.id === a.provider);
      if (!def) {
        return { alias: a.alias, ok: false, tiers: [], error: `Unknown provider "${a.provider}"`, queriedAt: Date.now() } as UsageResult & { alias: string };
      }
      const r = await def.query(a.credentials);
      return { alias: a.alias, ...r };
    }),
  );
  usage = results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { alias: config.accounts[i]?.alias ?? `#${i}`, ok: false, tiers: [], error: String(r.reason), queriedAt: Date.now() },
  );
  updating = false;
  broadcast();
}

function schedulePoll() {
  if (pollTimer) clearInterval(pollTimer);
  if (config.refreshIntervalSec > 0) {
    pollTimer = setInterval(() => { void refreshAll(); }, config.refreshIntervalSec * 1000);
  }
}

function loadWindowBounds(): { x: number; y: number } {
  try {
    const s = JSON.parse(fs.readFileSync(windowStatePath(), 'utf8'));
    if (typeof s.x === 'number' && typeof s.y === 'number') {
      // 校验位置落在某个可见显示器的工作区内（防外接屏拔掉后窗口跑到屏幕外）
      const visible = screen.getAllDisplays().some((d) => {
        const wa = d.workArea;
        return s.x >= wa.x && s.x < wa.x + wa.width && s.y >= wa.y && s.y < wa.y + wa.height;
      });
      if (visible) return { x: s.x, y: s.y };
    }
  } catch { /* 默认位置 */ }
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - WIDTH - 24, y: wa.y + 72 };
}

function createWindow() {
  const { x, y } = loadWindowBounds();
  win = new BrowserWindow({
    x, y, width: WIDTH, height: HEIGHT,
    frame: false, transparent: true, alwaysOnTop: true, resizable: false,
    skipTaskbar: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  // 像便签一样在所有桌面/全屏空间都可见
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.on('did-finish-load', () => {
    if (isSmoke) {
      console.log('SMOKE_OK: window loaded');
      setTimeout(() => app.quit(), 500);
    }
  });
  win.webContents.on('console-message', (_e: Electron.Event, level: number, message: string) => {
    console.log(`[renderer:${level}] ${message}`);
  });
  void win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
  let lastSave = 0;
  win.on('move', () => {
    const now = Date.now();
    if (now - lastSave < 300 || !win) return;
    lastSave = now;
    try {
      const [wx, wy] = win.getPosition();
      fs.mkdirSync(path.dirname(windowStatePath()), { recursive: true });
      fs.writeFileSync(windowStatePath(), JSON.stringify({ x: wx, y: wy }));
    } catch { /* 忽略 */ }
  });
  win.on('closed', () => { win = null; });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '../scripts/tray-icon.png'));
  icon.setTemplateImage(true); // macOS 深浅色菜单栏自动反色
  if (isSmoke) console.log('TRAY_ICON size=', icon.getSize().width, 'empty=', icon.isEmpty());
  tray = new Tray(icon);
  tray.setToolTip('TokenGauge');
  // 左键：任何时候直接显示窗口；右键：弹出菜单（不用 setContextMenu，否则左键也会弹菜单）
  tray.on('click', () => { if (win) { win.show(); win.focus(); } });
  const menu = Menu.buildFromTemplate([
    { label: '设置…', click: () => { if (win) { win.show(); win.webContents.send('open-settings'); } } },
    { label: '立即刷新', click: () => void refreshAll() },
    { type: 'separator' },
    { label: '隐藏', click: () => { win?.hide(); } },
    { label: '退出', click: () => app.quit() },
  ]);
  tray.on('right-click', () => tray?.popUpContextMenu(menu));
}

function registerIpc() {
  ipcMain.handle('get-state', () => statePayload());
  ipcMain.handle('get-config-path', () => configPath());
  ipcMain.handle('refresh', async () => { await refreshAll(); return statePayload(); });
  ipcMain.handle('save-config', (_e, cfg: unknown) => {
    config = normalizeConfig(cfg);
    saveConfig(configPath(), config);
    schedulePoll();
    void refreshAll();
    return statePayload();
  });
  ipcMain.handle('delete-config', () => {
    config = { ...DEFAULT_CONFIG };
    saveConfig(configPath(), config);
    usage = [];
    schedulePoll();
    broadcast();
    return statePayload();
  });
  ipcMain.handle('show-config-folder', () => { shell.showItemInFolder(configPath()); });
  ipcMain.handle('open-plugins-folder', () => { void shell.openPath(pluginsDir()); });
  ipcMain.handle('quit', () => app.quit());
}

// --smoke：启动后自动退出，用于验证应用可正常引导（无账号配置时不发网络请求）
const isSmoke = process.argv.includes('--smoke');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
  app.whenReady().then(() => {
    if (process.platform === 'darwin') app.setActivationPolicy('accessory'); // 无 Dock 图标，纯托盘常驻
    registry = loadRegistry(pluginsDir(), path.join(__dirname, '../providers/example.js'));
    registerIpc();
    createWindow();
    createTray();
    schedulePoll();
    void refreshAll();
  });
  // 窗口关闭/隐藏后应用常驻托盘，不退出
  app.on('window-all-closed', () => { /* keep running */ });
  app.on('before-quit', () => { if (pollTimer) clearInterval(pollTimer); });
}
