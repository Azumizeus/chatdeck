#!/usr/bin/env node
// dev:bg — lance Vite en tâche de fond détachée (survit à la fermeture du terminal
// et aux redémarrages de session). Usage : npm run dev:bg [start|stop|status|log]
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, unlinkSync, appendFileSync, openSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PID_FILE = path.join(ROOT, '.vite-dev.pid')
const LOG_FILE = path.join(ROOT, 'vite-dev.log')
const PORT = Number(process.env.CHATDECK_PORT || 5199)

function runningPid() {
  try {
    const pid = Number(readFileSync(PID_FILE, 'utf8').trim())
    process.kill(pid, 0) // signal 0 = check d'existence
    return pid
  } catch {
    return null
  }
}

function start() {
  const alive = runningPid()
  if (alive) {
    console.log(`Déjà lancé (pid ${alive}) — http://localhost:${PORT}/ · stop : npm run dev:bg:stop`)
    return
  }
  if (existsSync(PID_FILE)) unlinkSync(PID_FILE) // pid file périmée
  const out = openSync(LOG_FILE, 'w')
  const child = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    detached: true, // nouvelle session : survit à la mort du parent
    stdio: ['ignore', out, out],
    env: { ...process.env },
  })
  writeFileSync(PID_FILE, String(child.pid))
  child.unref()
  console.log(`Vite lancé en tâche de fond (pid ${child.pid}) — log : ${LOG_FILE}`)
  console.log(`→ http://localhost:${PORT}/ · arrêter : npm run dev:bg:stop · état : npm run dev:bg:status`)
}

function stop() {
  const pid = runningPid()
  if (!pid) {
    console.log('Pas de serveur en tâche de fond.')
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE)
    return
  }
  try {
    // Tue le groupe de process (vite + esbuild) : -pid = groupe détaché
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* déjà mort */
    }
  }
  unlinkSync(PID_FILE)
  console.log(`Serveur arrêté (pid ${pid}).`)
}

function status() {
  const pid = runningPid()
  if (pid) console.log(`En marche (pid ${pid}) — http://localhost:${PORT}/ — log : ${LOG_FILE}`)
  else console.log('Arrêté.')
}

function log() {
  if (!existsSync(LOG_FILE)) {
    console.log('(pas de log)')
    return
  }
  const lines = readFileSync(LOG_FILE, 'utf8').split('\n')
  console.log(lines.slice(-40).join('\n'))
}

const cmd = process.argv[2] ?? 'start'
if (cmd === 'start') start()
else if (cmd === 'stop') stop()
else if (cmd === 'status') status()
else if (cmd === 'log') log()
else {
  console.log('Usage : npm run dev:bg [start|stop|status|log]')
  process.exit(1)
}
