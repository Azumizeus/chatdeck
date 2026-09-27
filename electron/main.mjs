// Processus principal Electron — ChatDeck.
//
// Sert le build dist/ (ou le serveur Vite en dev), ouvre une fenêtre cadre,
// et gère le multi-instances : par défaut ChatDeck est « single instance »
// avec focus sur la fenêtre existante ; --multi (ou CHATDECK_MULTI=1)
// autorise plusieurs instances indépendantes (localStorage séparés par
// partition dédiée).
import { app, BrowserWindow, shell, ipcMain, screen, dialog } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

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

  const createWindow = async () => {
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

    // Les liens externes vont au navigateur ; les popouts internes (mêmes
    // origines http(s) ou file:// de l'app) s'ouvrent en VRAIES fenêtres OS —
    // sinon les « sortir en fenêtre » de ChatDeck restent collés à l'app.
    win.webContents.setWindowOpenHandler(({ url }) => {
      const sameOrigin = (u) => {
        try {
          const a = new URL(u)
          return (a.protocol === 'http:' || a.protocol === 'https:' || a.protocol === 'file:')
        } catch {
          return false
        }
      }
      if (sameOrigin(url)) return { action: 'allow', overrideBrowserWindowOptions: {
        width: 760,
        height: 640,
        backgroundColor: '#0d0f14',
        titleBarStyle: 'hiddenInset',
      } }
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
      // App packagée : l'UI est servie par notre serveur API local (sandbox +
      // deck + clés). Le file:// est interdit (chemins absolus /assets cassés,
      // aucun endpoint /api, fetch('…') bloqué par CORS — source de l'écran noir).
      const port = await ensureApiServer()
      // Port tracé sur disque (debug/support : curl http://127.0.0.1:<port>/api/health)
      try {
        writeFileSync(path.join(app.getPath('userData'), 'chatdeck-port.txt'), String(port))
      } catch {}
      await win.loadURL(`http://127.0.0.1:${port}/`)
    }
  }

  /* Serveur API local (mode packagé) : spawn de electron/api-server.mjs —
   * bundle ESM de sandbox-server.ts (esbuild, script `npm run build:api`)
   * exécuté avec le Node embarqué d'Electron (ELECTRON_RUN_AS_NODE=1).
   * Équitable avec le dev : MÊMES routes /api/sandbox + /api/deck. Port choisi
   * par l'OS (0) puis transmis via CHATDECK_API_PORT (séquestre, pas de scan).
   * Le process enfant meurt avec nous et sur 'quit'. */
  let apiProc = null
  let apiPortPromise = null
  const ensureApiServer = () => {
    if (apiPortPromise) return apiPortPromise
    apiPortPromise = new Promise((resolve, reject) => {
      // En packagé, api-server.mjs vit dans l'asar — or le process enfant est un
      // Node PUR (ELECTRON_RUN_AS_NODE) qui ne lit pas l'asar. Deux issues :
      //  1) copie asarUnpack (builds futurs) → app.asar.unpacked/electron/
      //  2) sinon : extraction de l'asar vers un fichier temp (Electron, lui,
      //     sait lire l'asar) — le bundle est un artefact autonome.
      const inAsar = path.join(__dirname, 'api-server.mjs')
      const unpacked = inAsar.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
      let script = unpacked
      if (!existsSync(script) && __dirname.includes('app.asar')) {
        // Bundlé dans l'asar : le process enfant est un Node PUR qui ne sait pas
        // le lire — on l'extrait vers un fichier temp (Electron, lui, sait lire
        // l'asar ; le bundle est un artefact autonome).
        try {
          script = path.join(app.getPath('temp'), 'chatdeck-api-server.mjs')
          writeFileSync(script, readFileSync(inAsar))
        } catch (e) {
          return reject(new Error(`api-server.mjs illisible : ${e?.message ?? e}`))
        }
      } else if (!existsSync(script)) {
        script = inAsar // dev : fichier réel electron/api-server.mjs
      }
      apiProc = spawn(process.execPath, [script, '--serve'], {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          CHATDECK_API_PORT: '0',
          // Racine des données UI/bibliothèque : la copie décompressée de l'asar
          // (dist/ + promptdeck/ y vivent) — le Node enfant ne lit pas l'asar.
          CHATDECK_PROJECT_ROOT: app.isPackaged
            ? path.join(process.resourcesPath, 'app.asar.unpacked')
            : path.join(__dirname, '..'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let out = ''
      const onData = (d) => {
        out += String(d)
        const m = /\[chatdeck-api\] http:\/\/127\.0\.0\.1:(\d+)/.exec(out)
        if (m) {
          cleanup()
          resolve(Number(m[1]))
        }
      }
      const cleanup = () => {
        apiProc?.stdout?.off('data', onData)
        apiProc?.stderr?.off('data', onData)
      }
      apiProc.stdout?.on('data', onData)
      apiProc.stderr?.on('data', onData)
      apiProc.on('exit', (code) => {
        if (out.length === 0 || !/chatdeck-api/.test(out)) reject(new Error(`serveur API mort (code ${code}) : ${out.slice(0, 300)}`))
      })
      setTimeout(() => reject(new Error(`serveur API silencieux : ${out.slice(0, 300)}`)), 15_000)
    })
    return apiPortPromise
  }
  app.on('quit', () => {
    try {
      apiProc?.kill()
    } catch {}
  })

  // Clés : ChatDeck les lit dans keys.local.json via les proxys locaux ;
  // en dev c'est le serveur Vite, en packagé c'est le serveur API autonome.
  app.whenReady().then(() => {
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
    createWindow().catch((e) => {
      // Jamais d'écran noir silencieux : l'erreur est montrée à l'utilisateur.
      dialog.showErrorBox('ChatDeck — démarrage impossible', String(e?.message ?? e))
      app.quit()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
