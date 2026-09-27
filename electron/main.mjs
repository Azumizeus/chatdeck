// Processus principal Electron — ChatDeck.
//
// Sert le build dist/ (ou le serveur Vite en dev), ouvre une fenêtre cadre,
// et gère le multi-instances : par défaut ChatDeck est « single instance »
// avec focus sur la fenêtre existante ; --multi (ou CHATDECK_MULTI=1)
// autorise plusieurs instances indépendantes (localStorage séparés par
// partition dédiée).
import { app, BrowserWindow, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const MULTI = process.argv.includes('--multi') || process.env.CHATDECK_MULTI === '1'

// Une seule instance sauf demande explicite : le 2ᵉ lancement focus la 1ʳᵉ.
if (!MULTI && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  if (!MULTI) {
    app.on('second-instance', () => {
      const [win] = BrowserWindow.getAllWindows()
      if (win) {
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    })
  }

  const PARTITION = MULTI ? `persist:chatdeck-${process.pid}` : 'persist:chatdeck'

  const createWindow = () => {
    const win = new BrowserWindow({
      width: 1280,
      height: 840,
      minWidth: 780,
      minHeight: 560,
      title: 'ChatDeck',
      backgroundColor: '#0d0f14',
      titleBarStyle: 'hiddenInset',
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    // Les liens externes vont au navigateur, jamais dans la fenêtre app.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http')) void shell.openExternal(url)
      return { action: 'deny' }
    })

    const devUrl = process.env.CHATDECK_DEV_URL
    if (devUrl) {
      void win.loadURL(devUrl)
    } else {
      void win.loadFile(path.join(__dirname, '../dist/index.html'))
    }
  }

  // Clés : ChatDeck les lit dans keys.local.json via les proxys locaux ;
  // en dev on attend le serveur Vite, en prod on servira le proxy dédié.
  app.whenReady().then(() => {
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
    createWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
