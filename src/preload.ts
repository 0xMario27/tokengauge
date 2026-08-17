import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('arkAPI', {
  getState: () => ipcRenderer.invoke('get-state'),
  getConfigPath: () => ipcRenderer.invoke('get-config-path'),
  refresh: () => ipcRenderer.invoke('refresh'),
  saveConfig: (cfg: unknown) => ipcRenderer.invoke('save-config', cfg),
  deleteConfig: () => ipcRenderer.invoke('delete-config'),
  showConfigFolder: () => ipcRenderer.invoke('show-config-folder'),
  onOpenSettings: (cb: () => void) => {
    const h = () => cb();
    ipcRenderer.on('open-settings', h);
    return () => { ipcRenderer.removeListener('open-settings', h); };
  },
  quit: () => ipcRenderer.invoke('quit'),
  onUsageUpdate: (cb: (state: unknown) => void) => {
    const h = (_e: unknown, s: unknown) => cb(s);
    ipcRenderer.on('usage-update', h);
    return () => { ipcRenderer.removeListener('usage-update', h); };
  },
});
