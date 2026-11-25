// Exposes the few desktop-only features to the page as window.desktop (see src/desktop.ts).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  info: () => ipcRenderer.invoke('desktop:info'),
  update: () => ipcRenderer.invoke('desktop:update'),
});
