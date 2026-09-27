// Processus principal Electron — ChatDeck.
//
// Sert le build dist/ (ou le serveur Vite en dev), ouvre une fenêtre cadre,
// et gère le multi-instances : par défaut ChatDeck est « single instance »
// avec focus sur la fenêtre existante ; --multi (ou CHATDECK_MULTI=1)
// autorise plusieurs instances indépendantes (localStorage séparés par
// partition dédiée).
import { app, BrowserWindow, shell, ipcMain, screen } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

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

  /* Géométrie de fenêtre persistée (chatdeck-window.json) : position/taille
   * réouvertes au lancement, re-clampées à l'écran courant (écran changé,
   * fenêtre fermée sur un moniteur débranché…). Les instances --multi partagent
   * le fichier : tant pis, la dernière fermée gagne — pas critique. */
  const stateFile = () => {
    try {
      return path.join(app.getPath('userData'), 'chatdeck-window.json')
    } catch {
      return null // app pas prêt (jamais le cas dans createWindow)
    }
  }
  const loadWinState = () => {
    const f = stateFile()
    if (!f) return null
    try {
      const s = JSON.parse(readFileSync(f, 'utf8'))
      if (typeof s.x === 'number' && typeof s.y === 'number' && typeof s.width === 'number' && typeof s.height === 'number') return s
    } catch {}
    return null
  }
  const saveWinState = (win) => {
    const f = stateFile()
    if (!f || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
    try {
      writeFileSync(f, JSON.stringify(win.getNormalBounds()))
    } catch {}
  }

  const createWindow = () => {
    const st = loadWinState()
    const work = screen.getPrimaryDisplay().workArea
    const win = new BrowserWindow({
      // Bounds persistés re-clampés dans la zone de travail (jamais hors écran) ;
      // sinon défaut : 1280×840 centré-haut.
      width: Math.min(st?.width ?? 1280, work.width),
      height: Math.min(st?.height ?? 840, work.height),
      x: st ? Math.max(work.x, Math.min(st.x, work.x + work.width - 200)) : undefined,
      y: st ? Math.max(work.y, Math.min(st.y, work.y + work.height - 100)) : undefined,
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
    // Sauvegarde de la géométrie (débounce léger) + à la fermeture.
    const persist = () => saveWinState(win)
    win.on('resize', persist)
    win.on('move', persist)
    win.on('close', persist)

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
