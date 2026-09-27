// Preload — pont minimal et sûr entre la fenêtre ChatDeck et le main.
// Expose uniquement ce qui est nécessaire, jamais nodeIntegration.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('chatdeck', {
  /** Ouvre une seconde instance indépendante (--multi) depuis le menu ⌘K. */
  launchInstance: () => ipcRenderer.invoke('chatdeck:launch-instance'),
})
