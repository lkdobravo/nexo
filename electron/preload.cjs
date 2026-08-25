const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('nexoDesktop', {
  engine: 'electron',
  isDesktop: true,
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  close: () => ipcRenderer.invoke('window:close'),
  hide: () => ipcRenderer.invoke('window:hide'),
  show: () => ipcRenderer.invoke('window:show'),
  quit: () => ipcRenderer.invoke('app:quit'),
  applyUpdate: () => ipcRenderer.invoke('app:apply-update'),
  downloadAndInstallUpdate: (opts) => ipcRenderer.invoke('app:download-install-update', opts),
  setFullscreen: (enabled) => ipcRenderer.invoke('window:set-fullscreen', enabled),
  getAutostart: () => ipcRenderer.invoke('autostart:get'),
  setAutostart: (enabled) => ipcRenderer.invoke('autostart:set', enabled),
  getMinimizeToBackground: () => ipcRenderer.invoke('desktop:get-minimize-bg'),
  setMinimizeToBackground: (enabled) => ipcRenderer.invoke('desktop:set-minimize-bg', enabled),
  info: () => ipcRenderer.invoke('desktop:info'),
  listCaptureSources: () => ipcRenderer.invoke('desktop:list-capture-sources'),
  prepareCapture: (sourceId) => ipcRenderer.invoke('desktop:prepare-capture', sourceId),
})
