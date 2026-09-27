// Processus principal Electron — ChatDeck.
//
// Sert le build dist/ (ou le serveur Vite en dev), ouvre une fenêtre cadre,
// et gère le multi-instances : par défaut ChatDeck est « single instance »
// avec focus sur la fenêtre existante ; --multi (ou CHATDECK_MULTI=1)
// autorise plusieurs instances indépendantes (localStorage séparés par
// partition dédiée).
import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { spawn } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Icône Dock en dev (packaged : c'est celle de l'app, dans le DMG).
const devIcon = path.join(__dirname, '../build/icon.png')

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
      icon: devIcon,
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(__dirname, 'preload.cjs'),
      },
    })

    // Les liens externes vont au navigateur, jamais dans la fenêtre app.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http')) void shell.openExternal(url)
      return { action: 'deny' }
    })

    // « + instance » : l'UI demande une seconde instance indépendante.
    // On relance le même exécutable avec --multi (partition localStorage
    // dédiée), détaché de ce process. Sous macOS packaged, on passe par
    // `open -na` pour dupliquer proprement l'app signée.
    ipcMain.handle('chatdeck:launch-instance', () => {
      try {
        let child
        if (process.platform === 'darwin' && app.isPackaged) {
          child = spawn('open', ['-na', 'ChatDeck', '--args', '--multi'], {
            detached: true,
            stdio: 'ignore',
          })
        } else {
          child = spawn(process.execPath, [path.join(__dirname, '..'), '--multi'], {
            detached: true,
            stdio: 'ignore',
            env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
          })
        }
        child.unref()
        return { ok: true, pid: child.pid }
      } catch (e) {
        return { ok: false, error: String(e?.message ?? e) }
      }
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
