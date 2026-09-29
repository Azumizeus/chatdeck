// Serveur de sandbox ChatDeck — un /workspace réel par conversation sur le disque.
//
// Racine : ~/.chatdeck/workspaces/<conversation-id>/
// Le navigateur n'y accède QUE via les endpoints /api/sandbox (plugin Vite, dev) :
//   GET    /api/sandbox/status                  → racine, N workspaces, tailles
//   POST   /api/sandbox/launch-instance         → ouvre une 2ᵈ instance ChatDeck (--multi)
//   POST   /api/sandbox/:convId/bootstrap       → crée le workspace + fichiers d'amorçage
//   GET    /api/sandbox/:convId/tree            → arborescence JSON
//   GET    /api/sandbox/:convId/file?path=…     → contenu d'un fichier (cap 1 Mo)
//   PUT    /api/sandbox/:convId/file            → écrit {path, content}
//   DELETE /api/sandbox/:convId/file?path=…     → supprime fichier ou dossier
//   POST   /api/sandbox/:convId/mkdir           → crée {path}
//   GET    /api/sandbox/:convId/exec?cmd=…      → commandes en liste blanche (lecture seule)
//   POST   /api/sandbox/:convId/run             → terminal : process enfant borné, sortie streamée
//   DELETE /api/sandbox/:convId                 → supprime tout le workspace
//
// Terminal : pas de shell (spawn direct du binaire), arguments sans '..' ni chemin
// absolu, cwd = workspace, timeout 60 s, sortie plafonnée. Les scripts node/npm
// s'exécutent avec les droits de l'utilisateur — c'est le PC de l'utilisateur.
//
// Sécurité : ids stricts ([a-z0-9_-]), chemins résolus et confinés au workspace,
// taille de fichier plafonnée, rien en dehors de la racine.

import type { Plugin } from 'vite'
import { cascadeApiMount } from './cascade-server'
import { PROVIDER_IDS, providerProxyMount } from './provider-proxy-server'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const WORKSPACES_ROOT = path.join(homedir(), '.chatdeck', 'workspaces')
/**
 * Serveurs MCP stdio (façon Claude Desktop) : commande locale lancée par l'app,
 * parlant JSON-RPC sur stdin/stdout. Déclarés dans ~/.chatdeck/mcp-servers.local.json :
 *   [{ "name": "filesystem", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] }]
 * Le process démarre paresseusement au premier appel ; tools/list est mis en
 * cache 60 s ; tools/call transmet l'invocation. Aucune saisie utilisateur dans
 * la commande (liste blanche du fichier local, gitigné).
 */
interface McpServerCfg {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  enabled?: boolean
  /** Délai max par appel MCP (ms). Défaut 25 s ; cognee exige 120 s (init ~31 s + extraction). */
  timeoutMs?: number
}
function mcpServers(): McpServerCfg[] {
  try {
    const v = JSON.parse(readFileSync(path.join(homedir(), '.chatdeck', 'mcp-servers.local.json'), 'utf8')) as McpServerCfg[]
    return Array.isArray(v) ? v.filter((s) => s && typeof s.name === 'string' && typeof s.command === 'string') : []
  } catch {
    return []
  }
}
const mcpProcs = new Map<
  string,
  {
    child: import('node:child_process').ChildProcess
    buf: string
    /** Réponses appariées PAR ID JSON-RPC (jamais par ordre d'arrivée). */
    pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>
    id: number
    /** Handshake MCP terminé : les requêtes user attendent la fin d'initialize
     *  (browser-use IGNORE tout ce qui arrive avant sa réponse d'init). */
    ready: Promise<void>
  }
>()
function mcpRpc(name: string, method: string, params: unknown, timeoutMs = 25_000): Promise<unknown> {
  const cfg = mcpServers().find((s) => s.name === name && s.enabled !== false)
  if (!cfg) return Promise.reject(new Error(`serveur MCP « ${name} » inconnu ou désactivé (~/.chatdeck/mcp-servers.local.json)`))
  // Timeout par serveur (timeoutMs du fichier local) — cognee démarre en ~31 s.
  const effTimeout = cfg.timeoutMs && cfg.timeoutMs > 0 ? cfg.timeoutMs : timeoutMs
  let entry = mcpProcs.get(name)
  let needInit = false
  if (!entry || !entry.child.stdin || entry.child.killed) {
    const child = spawn(cfg.command, cfg.args ?? [], {
      env: { ...process.env, ...(cfg.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    // Un binaire MCP absent (ex. npx hors PATH sous launchd) ne doit JAMAIS
    // tuer le serveur dev : sans ce handler, l'event 'error' est non géré et
    // fait planter tout Vite en cours de run (tests e2e morts en série).
    child.on('error', (e: Error) => {
      mcpProcs.delete(name)
      console.error(`[mcp:${name}] spawn impossible : ${e.message}`)
    })
    entry = { child, buf: '', pending: new Map(), id: 0, ready: Promise.resolve() }
    mcpProcs.set(name, entry)
    needInit = true
    child.stdout!.on('data', (d: Buffer) => {
      entry!.buf += String(d)
      let nl: number
      while ((nl = entry!.buf.indexOf('\n')) >= 0) {
        const line = entry!.buf.slice(0, nl).trim()
        entry!.buf = entry!.buf.slice(nl + 1)
        if (!line) continue
        try {
          const j = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } }
          // Appariement par id : la réponse retrouve son demandeur, quel que soit l'ordre.
          const rid = typeof j.id === 'number' ? j.id : undefined
          const p = rid !== undefined ? entry!.pending.get(rid) : undefined
          if (p && rid !== undefined) {
            entry!.pending.delete(rid)
            clearTimeout(p.timer)
            if (j.error) p.reject(new Error(j.error.message ?? 'erreur MCP'))
            else p.resolve(j.result)
          }
          // notifications du serveur et lignes non appariées : ignorées
        } catch {
          /* ligne non-JSON (bannière…) : ignorée */
        }
      }
    })
    child.stderr!.on('data', () => {/* journal MCP ignoré */})
    child.on('exit', () => {
      for (const [, p] of entry!.pending) {
        clearTimeout(p.timer)
        p.reject(new Error(`MCP ${name} : process terminé`))
      }
      entry!.pending.clear()
      mcpProcs.delete(name)
    })
  }
  const e = entry
  return new Promise((resolve, reject) => {
    const id = ++e.id
    const timer = setTimeout(() => {
      e.pending.delete(id)
      reject(new Error(`MCP ${name} : délai dépassé (${method})`))
    }, effTimeout)
    e.pending.set(id, { resolve, reject, timer })
    const write = (obj: unknown): boolean => e.child.stdin!.write(`${JSON.stringify(obj)}\n`)
    // Handshake obligatoire du protocole MCP au premier appel d'un process neuf :
    // initialize → (réponse appariée par id) → notifications/initialized.
    // IMPORTANT : certains serveurs (browser-use) IGNORENT toute requête qui
    // arrive avant la fin de leur initialize — les requêtes user attendent
    // donc la fin du handshake (e.ready) avant d'être écrites.
    if (needInit) {
      e.ready = new Promise<void>((resolveReady) => {
        const initId = ++e.id
        const initTimer = setTimeout(() => {
          e.pending.delete(initId)
          resolveReady() // on n'enferme pas les requêtes suivantes pour toujours
        }, effTimeout)
        e.pending.set(initId, {
          resolve: () => {
            write({ jsonrpc: '2.0', method: 'notifications/initialized' })
            resolveReady()
          },
          reject: () => resolveReady(),
          timer: initTimer,
        })
        write({
          jsonrpc: '2.0',
          id: initId,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'ChatDeck', version: '0.4.7' },
          },
        })
      })
    }
    void e.ready.then(() => {
      if (!e.child.stdin || e.child.killed) return
      write({ jsonrpc: '2.0', id, method, params })
    })
  })
}
const MCP_TOOLS_TTL = 60_000
const mcpToolsCache = new Map<string, { at: number; tools: { name: string; description?: string }[] }>()
/** Racine du projet : imposée par main.mjs en packagé (CHATDECK_PROJECT_ROOT,
 *  copie asar.unpacked) ; sinon déduite du dossier courant (dev, bundle local). */
const here = path.resolve(import.meta.dirname ?? '.')
const projectRoot = process.env.CHATDECK_PROJECT_ROOT ?? (existsSync(path.join(here, 'package.json')) ? here : path.resolve(here, '..'))
/** Dans l'app packagée, ce qui est asarUnpack vit dans app.asar.unpacked/ —
 *  or notre process API est un Node PUR (ELECTRON_RUN_AS_NODE) qui ne lit pas
 *  l'asar : on réécrit le chemin vers la copie décompressée. */
const asarAware = (p: string): string => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
/** Bibliothèque de fiches PromptDeck (packagée : copie décompressée). */
const promptdeckDir = asarAware(path.join(projectRoot, 'promptdeck'))
/** Registre des dossiers Mac autorisés en lecture (projects.local.json, gitigné,
 *  écrit par PUT /api/sandbox/projects/:id/folders — jamais par le client direct). */
const FOLDERS_FILE = path.join(homedir(), '.chatdeck', 'projects-folders.local.json')
function allowedFolders(): string[] {
  try {
    const v = JSON.parse(readFileSync(FOLDERS_FILE, 'utf8')) as unknown
    return Array.isArray(v) ? (v as string[]).filter((s) => typeof s === 'string' && s.startsWith('/') && s.length < 500).slice(0, 20) : []
  } catch {
    return []
  }
}
function setAllowedFolders(list: string[]): void {
  mkdirSync(path.dirname(FOLDERS_FILE), { recursive: true })
  writeFileSync(FOLDERS_FILE, JSON.stringify(list.slice(0, 20), null, 2))
}
const MAX_FILE_BYTES = 1_000_000
const MAX_TREE_ENTRIES = 500
const MAX_RUN_OUTPUT = 200_000
const RUN_TIMEOUT_MS = 60_000
const CONV_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i
type OsProfile = 'mac' | 'windows' | 'linux'
const OSES: OsProfile[] = ['mac', 'windows', 'linux']

/**
 * Un espace réel PAR OS : workspaces/<conv>@@<os> (mac, windows, linux côte à
 * côte, rien ne se purge). Le workspace « actif » est celui de l'OS courant :
 * c'est lui (et lui seul) que voient l'arbre, le terminal, l'écriture de fichiers
 * et les agents — rebasculer d'OS est instantané et NE PERD RIEN.
 */
const osWorkspace = (convId: string, os: OsProfile): string => path.join(WORKSPACES_ROOT, `${convId}@@${os}`)

/** Profil OS courant d'une conversation (défaut : celui de la machine hôte). */
function osOf(convId: string): OsProfile {
  try {
    const v = readFileSync(path.join(WORKSPACES_ROOT, convId, '.chatdeck', 'os.txt'), 'utf8').trim()
    if (v === 'mac' || v === 'windows' || v === 'linux') return v
  } catch {
    /* pas encore fixé */
  }
  return process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux'
}

function setOsOf(convId: string, os: OsProfile): void {
  const dir = path.join(WORKSPACES_ROOT, convId, '.chatdeck')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'os.txt'), os, 'utf8')
}

/** Racine du workspace ACTIF de la conversation : base conv, ou <conv>@@<os> si l'OS courant n'est pas celui de l'hôte. */
function activeBase(convId: string): string {
  const os = osOf(convId)
  const hostOs: OsProfile = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux'
  return os === hostOs ? path.join(WORKSPACES_ROOT, convId) : osWorkspace(convId, os)
}

/** Fichiers d'amorçage spécifiques au profil OS « sécurisé » (Secure AI Multi-OS). */
const OS_FILES: Record<OsProfile, Record<string, string>> = {
  mac: {
    'platform/Info.plist': `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>ChatDeck Sandbox</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>SandboxProfile</key><string>chroot+AES-256+reseau-isole</string>
</dict></plist>
`,
  },
  windows: {
    'platform/app.config.json': `{
  "framework": "net8.0",
  "runtimeIdentifier": "win-x64",
  "sandbox": { "chroot": true, "encryption": "AES-256", "network": "isolated" }
}
`,
  },
  linux: {
    'platform/Dockerfile': `# Profil sandbox Linux — réseau isolé, système de fichiers borné
FROM node:22-alpine
WORKDIR /workspace
COPY . .
RUN npm install --omit=dev || true
CMD ["node", "src/main.js"]
`,
  },
}

/** Fichiers d'amorçage écrits au bootstrap (jamais écrasés s'ils existent). */
const SEED_FILES: Record<string, string> = {
  'README.md': `# Workspace ChatDeck

Sandbox de cette conversation. Les agents (Nexus, Seeker) y lisent et écrivent des fichiers.

- \`NOTES.md\` : notes libres, brief, décisions
- \`src/\` : code produit par les agents
- Tout est local : ~/.chatdeck/workspaces/${'{'}id${'}'}/
`,
  'NOTES.md': `# Notes

Brief initial de la conversation (à compléter par l'orchestrateur) :

- Objectif :
- Contraintes :
- Prochaines étapes :
`,
  'src/main.js': `// Point d'entrée du workspace — les agents écrivent ici.
export function main() {
  console.log('Sandbox ChatDeck prête.')
}
`,
  'package.json': `{
  "name": "chatdeck-workspace",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "start": "node src/main.js"
  }
}
`,
}

/** Binaires autorisés dans le terminal (spawn direct, sans shell). */
const RUN_BINARIES = new Set(['node', 'npm', 'npx', 'ls', 'cat', 'pwd', 'echo', 'mkdir', 'touch', 'rm', 'cp', 'mv', 'git'])

function json(res: import('node:http').ServerResponse, code: number, data: unknown): void {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

/** Résout un chemin utilisateur DANS une base (anti path-traversal). */
function safeResolveIn(base: string, sub: string): { base: string; target: string } | null {
  const rel = (sub ?? '').replace(/^[/\\]+/, '')
  const target = path.resolve(base, rel)
  if (target !== base && !target.startsWith(base + path.sep)) return null
  return { base, target }
}

/** Résout un chemin utilisateur DANS le workspace ACTIF de la conversation. */
function safeResolve(convId: string, sub: string): { base: string; target: string } | null {
  if (!CONV_ID_RE.test(convId)) return null
  return safeResolveIn(activeBase(convId), sub)
}

/** Crée les fichiers d'amorçage dans la base donnée (jamais écrasés) + profil OS optionnel. */
async function seedWorkspace(base: string, os?: OsProfile): Promise<number> {
  await mkdir(path.join(base, 'src'), { recursive: true })
  let written = 0
  const seeds: Record<string, string> = { ...SEED_FILES, ...(os ? OS_FILES[os] : {}) }
  for (const [p, content] of Object.entries(seeds)) {
    const t = safeResolveIn(base, p)
    if (!t) continue
    if (!existsSync(t.target)) {
      await mkdir(path.dirname(t.target), { recursive: true })
      await writeFile(t.target, content, 'utf8')
      written++
    }
  }
  return written
}



interface TreeNode {
  name: string
  type: 'file' | 'dir'
  size?: number
  children?: TreeNode[]
}

/** Arborescence récursive bornée (profondeur 6, 500 entrées max, node_modules/.git ignorés). */
async function walk(dir: string, depth: number, budget: { n: number }): Promise<TreeNode[] | null> {
  if (depth > 6 || budget.n <= 0) return null
  let entries: import('node:fs').Dirent[]
  try {
    entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
  const out: TreeNode[] = []
  for (const e of entries) {
    if (budget.n <= 0) break
    if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.DS')) continue
    budget.n--
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      out.push({ name: e.name, type: 'dir', children: (await walk(full, depth + 1, budget)) ?? undefined })
    } else if (e.isFile()) {
      let size: number | undefined
      try {
        size = (await stat(full)).size
      } catch {
        /* ignore */
      }
      out.push({ name: e.name, type: 'file', size })
    }
  }
  return out
}

/**
 * Coffrets Obsidian connus (registre officiel ~/.config/obsidian, lecture seule).
 * Le chemin est résolu CÔTÉ SERVEUR : le client ne passe jamais un chemin arbitraire.
 */
function obsidianVaults(): { name: string; path: string }[] {
  try {
    const reg = readFileSync(path.join(homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json'), 'utf8')
    const j = JSON.parse(reg) as { vaults?: Record<string, { path?: string }> }
    const seen = new Map<string, number>()
    return Object.values(j.vaults ?? {})
      .filter((v): v is { path: string } => typeof v.path === 'string' && Boolean(v.path))
      .map((v) => {
        // Noms uniques : deux coffrets peuvent porter le même basename
        const n = (seen.get(path.basename(v.path)) ?? 0) + 1
        seen.set(path.basename(v.path), n)
        return { name: n > 1 ? `${path.basename(v.path)} ·${n}` : path.basename(v.path), path: v.path }
      })
  } catch {
    return []
  }
}

/** Liste bornée des fichiers .md d'un dossier (récursif, 200 fichiers / 30 000 entrées max).
 *  Les chemins sont relatifs à la racine passée (root), pas au sous-dossier courant. */
async function listMd(
  root: string,
  dir: string,
  budget: { n: number },
  out: { path: string; size: number }[] = [],
): Promise<{ path: string; size: number }[]> {
  if (budget.n <= 0 || out.length >= 200) return out
  budget.n--
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= 200 || budget.n <= 0) break
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '.obsidian' || e.name === 'node_modules' || e.name.startsWith('.')) continue
      await listMd(root, full, budget, out)
    } else if (e.isFile() && e.name.endsWith('.md')) {
      let size = 0
      try {
        size = (await stat(full)).size
      } catch {
        /* ignore */
      }
      out.push({ path: path.relative(root, full), size })
    }
  }
  return out
}

/** Taille et nombre de fichiers d'un workspace (borné). */
async function measure(dir: string): Promise<{ sizeBytes: number; files: number }> {
  let size = 0
  let files = 0
  const stack = [dir]
  while (stack.length && files < 2000) {
    const cur = stack.pop()!
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (files >= 2000) break
      const full = path.join(cur, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git') continue
        stack.push(full)
      } else {
        files++
        try {
          size += (await stat(full)).size
        } catch {
          /* ignore */
        }
      }
    }
  }
  return { sizeBytes: size, files }
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c: Uint8Array) => {
      data += c
      if (data.length > MAX_FILE_BYTES * 2) reject(new Error('corps trop volumineux'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

/** Commandes exécutables dans la sandbox — liste blanche stricte, lecture seule. */
async function sandboxExec(convId: string, cmd: string): Promise<{ out: string }> {
  const trimmed = cmd.trim()
  const r = safeResolve(convId, '')
  if (!r) throw new Error('id de conversation invalide')
  const { base } = r

  const ls = /^ls(?:\s+(?<p>[\w./-]+))?$/.exec(trimmed)
  if (ls) {
    const t = safeResolve(convId, ls.groups?.p ?? '')
    if (!t) throw new Error('chemin invalide')
    const entries = await readdir(t.target, { withFileTypes: true }).catch(() => [])
    const lines = entries
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    return { out: lines.length ? lines.join('\n') : '(vide)' }
  }

  const cat = /^cat\s+(?<p>[\w./-]+)$/.exec(trimmed)
  if (cat) {
    const t = safeResolve(convId, cat.groups?.p ?? '')
    if (!t) throw new Error('chemin invalide')
    const content = await readFile(t.target, 'utf8').catch(() => {
      throw new Error(`fichier introuvable : ${cat.groups?.p}`)
    })
    return { out: content.length > 20_000 ? content.slice(0, 20_000) + '\n… (tronqué)' : content }
  }

  if (trimmed === 'pwd') return { out: base }
  if (trimmed === 'node -v' || trimmed === 'node --version') {
    return { out: process.version }
  }
  if (/^(git (status|log|diff)|npm (test|run .+)|node src\/.+)\b/.test(trimmed)) {
    throw new Error(`« ${trimmed} » : passe par le terminal du workspace (bouton ⌨︎) pour l'exécution réelle.`)
  }
  throw new Error('Commande non autorisée. Autorisées : ls [chemin], cat <fichier>, pwd, node -v')
}

/**
 * Terminal réel : spawn direct (sans shell), arguments confinés, cwd = workspace,
 * timeout 60 s, sortie (stdout+stderr) streamée brute dans la réponse.
 */
function runCommand(res: import('node:http').ServerResponse, convId: string, cmd: string): void {
  const parts = cmd.trim().split(/\s+/).filter(Boolean)
  const bin = parts[0] ?? ''
  if (!RUN_BINARIES.has(bin)) {
    return json(res, 400, {
      error: `« ${bin || '(vide)'} » n'est pas autorisé. Autorisés : ${[...RUN_BINARIES].join(', ')}`,
    })
  }
  for (const a of parts.slice(1)) {
    if (a.includes('..') || a.startsWith('/')) {
      return json(res, 400, { error: `argument interdit : ${a} (chemins relatifs au workspace uniquement)` })
    }
  }
  const g = safeResolve(convId, '')
  if (!g) return json(res, 400, { error: 'id de conversation invalide' })

  res.statusCode = 200
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  const child = spawn(bin, parts.slice(1), {
    cwd: g.base,
    env: { ...process.env, NO_COLOR: '1' },
  })
  let bytes = 0
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, RUN_TIMEOUT_MS)

  const push = (c: Buffer): void => {
    bytes += c.length
    if (bytes <= MAX_RUN_OUTPUT) res.write(c)
    else if (bytes - c.length < MAX_RUN_OUTPUT) res.write('\n… (sortie tronquée)')
  }
  child.stdout.on('data', push)
  child.stderr.on('data', push)
  child.on('error', (e) => {
    clearTimeout(timer)
    res.write(`\n[erreur] ${e.message}\n`)
    res.end()
  })
  child.on('close', (code, signal) => {
    clearTimeout(timer)
    if (timedOut || signal === 'SIGKILL') res.write(`\n[timeout : process tué après ${RUN_TIMEOUT_MS / 1000} s]\n`)
    else res.write(`\n[code de sortie ${code ?? '?'}]\n`)
    res.end()
  })
}

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void

/** Handler /api/sandbox partagé : plugin Vite (dev) ET serveur autonome (app packagée). */
const sandboxHandler: RequestHandler = (req, res) => {
  void (async () => {
          const url = (req.url ?? '').replace(/^\//, '')
          const [pathPart, queryPart] = url.split('?')
          const query = new URLSearchParams(queryPart ?? '')
          const [convId, action] = (pathPart ?? '').split('/')

          try {
            // /api/sandbox/status (ou racine) : racine, nombre, tailles, détail par workspace
            if (!convId || convId === 'status') {
              if (req.method === 'GET') {
                const dirs = existsSync(WORKSPACES_ROOT)
                  ? (await readdir(WORKSPACES_ROOT, { withFileTypes: true })).filter((d) => d.isDirectory())
                  : []
                const workspaces = await Promise.all(
                  dirs.slice(0, 100).map(async (d) => {
                    const m = await measure(path.join(WORKSPACES_ROOT, d.name))
                    let mtime = 0
                    try {
                      mtime = (await stat(path.join(WORKSPACES_ROOT, d.name))).mtimeMs
                    } catch {
                      /* ignore */
                    }
                    return { id: d.name, ...m, mtime }
                  }),
                )
                const totalBytes = workspaces.reduce((a, w) => a + w.sizeBytes, 0)
                return json(res, 200, { root: WORKSPACES_ROOT, count: dirs.length, totalBytes, workspaces })
              }
              return json(res, 404, { error: 'route inconnue' })
            }

            /* ── Hygiène de la racine (anti-accumulation) ── */
            // POST /api/sandbox/cleanup  {maxAgeDays?:number}
            //  · supprime les espaces dont la conversation n'existe plus/plus ouverte
            //    (id introuvable dans le corps de la requête : orphelins détectés côté client)
            //  · supprime les workspaces vides (0 fichier utile) et <id>@@os sans base
            //  · borné : jamais les p-* de projets (manuels), jamais > 500 dossiers
            if (convId === 'cleanup' && req.method === 'POST') {
              const body = JSON.parse(await readBody(req) || '{}') as { orphans?: string[]; maxAgeDays?: number }
              const maxAge = Math.max(1, Math.min(365, Math.floor(body.maxAgeDays ?? 30)))
              const cutoff = Date.now() - maxAge * 86_400_000
              let removed = 0
              let bytes = 0
              const dirs = existsSync(WORKSPACES_ROOT)
                ? (await readdir(WORKSPACES_ROOT, { withFileTypes: true })).filter((d) => d.isDirectory()).slice(0, 500)
                : []
              const orphanSet = new Set((body.orphans ?? []).filter((s) => CONV_ID_RE.test(s)))
              for (const d of dirs) {
                // Les workspaces PROJET (p-*) ne sont jamais nettoyés automatiquement :
                // ils regroupent plusieurs conversations et se gèrent manuellement.
                if (d.name.startsWith('p-')) continue
                // orphelins explicites (conversations supprimées) : base + @@os
                const baseId = d.name.split('@@')[0]
                const isOrphan = orphanSet.has(baseId)
                let old = false
                try {
                  old = (await stat(path.join(WORKSPACES_ROOT, d.name))).mtimeMs < cutoff
                } catch {
                  continue
                }
                if (!isOrphan && !old) continue
                try {
                  const m = await measure(path.join(WORKSPACES_ROOT, d.name))
                  await rm(path.join(WORKSPACES_ROOT, d.name), { recursive: true })
                  removed++
                  bytes += m.sizeBytes
                } catch {
                  /* suppression ratée : on continue */
                }
              }
              return json(res, 200, { ok: true, removed, bytesFreed: bytes, maxAgeDays: maxAge })
            }

            const guard = safeResolve(convId, '')
            if (!guard) return json(res, 400, { error: 'id de conversation invalide' })
            const { base } = guard

            // suppression du workspace entier : base + espaces @@os + projets
            // p-* rattachés — une suppression laisse DERRIÈRE elle une racine
            // propre (sinon accumulation invisible : 158 workspaces orphelins).
            if (!action && req.method === 'DELETE') {
              let removed = 0
              const targets = [
                path.join(WORKSPACES_ROOT, convId),
                ...OSES.map((o) => osWorkspace(convId, o)),
              ]
              // espaces projet rattachés à cette conversation ( projectId ≠ convId )
              const all = existsSync(WORKSPACES_ROOT)
                ? (await readdir(WORKSPACES_ROOT, { withFileTypes: true })).map((d) => d.name)
                : []
              for (const name of all) {
                if (name === convId || name.startsWith(`${convId}@@`)) targets.push(path.join(WORKSPACES_ROOT, name))
              }
              for (const t of targets) {
                if (existsSync(t)) {
                  await rm(t, { recursive: true })
                  removed++
                }
              }
              return json(res, 200, { ok: true, removed })
            }

            // tree
            if (action === 'tree' && req.method === 'GET') {
              if (!existsSync(base)) return json(res, 200, { exists: false, tree: [] })
              const budget = { n: MAX_TREE_ENTRIES }
              return json(res, 200, { exists: true, tree: await walk(base, 0, budget) })
            }

            // file : GET (lecture), PUT (écriture), DELETE (suppression)
            if (action === 'file') {
              if (req.method === 'GET') {
                const t = safeResolve(convId, query.get('path') ?? '')
                if (!t) return json(res, 400, { error: 'chemin invalide' })
                const info = await stat(t.target).catch(() => null)
                if (!info?.isFile()) return json(res, 404, { error: 'fichier introuvable' })
                if (info.size > MAX_FILE_BYTES) return json(res, 413, { error: 'fichier trop volumineux (> 1 Mo)' })
                const content = await readFile(t.target, 'utf8')
                return json(res, 200, { path: query.get('path'), content, size: info.size })
              }
              if (req.method === 'PUT') {
                const body = JSON.parse(await readBody(req)) as { path?: string; content?: string }
                const t = safeResolve(convId, body.path ?? '')
                if (!t || typeof body.content !== 'string') return json(res, 400, { error: 'requête invalide' })
                if (Buffer.byteLength(body.content) > MAX_FILE_BYTES) return json(res, 413, { error: 'contenu > 1 Mo' })
                await mkdir(path.dirname(t.target), { recursive: true })
                await writeFile(t.target, body.content, 'utf8')
                return json(res, 200, { ok: true })
              }
              if (req.method === 'DELETE') {
                const t = safeResolve(convId, query.get('path') ?? '')
                if (!t || t.target === base) return json(res, 400, { error: 'suppression interdite' })
                await rm(t.target, { recursive: true })
                return json(res, 200, { ok: true })
              }
            }

            // mkdir
            if (action === 'mkdir' && req.method === 'POST') {
              const body = JSON.parse(await readBody(req)) as { path?: string }
              const t = safeResolve(convId, body.path ?? '')
              if (!t) return json(res, 400, { error: 'chemin invalide' })
              await mkdir(t.target, { recursive: true })
              return json(res, 200, { ok: true })
            }

            // exec : commandes en liste blanche (lecture seule, pour les agents)
            if (action === 'exec' && req.method === 'GET') {
              const cmd = query.get('cmd') ?? ''
              try {
                return json(res, 200, await sandboxExec(convId, cmd))
              } catch (e) {
                return json(res, 400, { error: (e as Error).message })
              }
            }

            // health par conversation (utilisé par le panneau Fichiers)
            if (action === 'health' && req.method === 'GET') {
              const m = existsSync(base) ? await measure(base) : { sizeBytes: 0, files: 0 }
              return json(res, 200, { exists: existsSync(base), ...m })
            }

            // Obsidian : coffrets connus (route à un segment : convId porte le nom)
            if (req.method === 'GET' && (action === 'obsidian-vaults' || convId === 'obsidian-vaults')) {
              return json(res, 200, { vaults: obsidianVaults() })
            }

            // Obsidian : notes d'un coffret (chemin résolu CÔTÉ SERVEUR par nom de coffret)
            if (req.method === 'GET' && (action === 'obsidian-notes' || convId === 'obsidian-notes')) {
              const vault = obsidianVaults().find((v) => v.name === query.get('vault'))
              if (!vault) return json(res, 404, { error: 'coffret inconnu' })
              return json(res, 200, { vault: vault.name, path: vault.path, notes: await listMd(vault.path, vault.path, { n: 30_000 }) })
            }

            // Obsidian : contenu d'une note (fichier .md de l'un des coffrets enregistrés)
            if (req.method === 'GET' && (action === 'obsidian-read' || convId === 'obsidian-read')) {
              const vault = obsidianVaults().find((v) => v.name === query.get('vault'))
              const note = query.get('note') ?? ''
              if (!vault) return json(res, 404, { error: 'coffret inconnu' })
              const t = path.resolve(vault.path, note)
              if (!t.startsWith(vault.path + path.sep) || !note.endsWith('.md')) {
                return json(res, 400, { error: 'chemin de note invalide' })
              }
              const content = await readFile(t, 'utf8')
              return json(res, 200, { content: content.length > MAX_FILE_BYTES ? content.slice(0, MAX_FILE_BYTES) : content })
            }

            // PromptDeck : arborescence du MEGA PACK (agents + skills, lecture seule)
            if (req.method === 'GET' && (action === 'promptdeck' || convId === 'promptdeck')) {
              const base = process.env.PROMPTDECK_HOME ?? path.join(homedir(), 'Desktop', 'Skill Install')
              if (!existsSync(base)) return json(res, 404, { error: 'PromptDeck introuvable (PROMPTDECK_HOME non défini ?)' })
              const budget = { n: 6_000 }
              const walk2 = async (dir: string, depth: number): Promise<TreeNode[]> => {
                if (depth > 3) return []
                const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
                const out: TreeNode[] = []
                for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
                  if (budget.n-- <= 0) break
                  if (e.name.startsWith('.') || e.name === 'node_modules') continue
                  const full = path.join(dir, e.name)
                  if (e.isDirectory()) out.push({ name: e.name, type: 'dir', children: await walk2(full, depth + 1) })
                  else out.push({ name: e.name, type: 'file' })
                  if (out.length >= 300) break
                    }
                return out
              }
              const tree = await walk2(base, 0)
              return json(res, 200, { path: base, tree })
            }

            // bootstrap : crée le workspace + amorçage (+ profil OS optionnel ?os=mac|windows|linux)
            if (action === 'bootstrap' && req.method === 'POST') {
              const osParam = query.get('os')
              const os = osParam === 'mac' || osParam === 'windows' || osParam === 'linux' ? osParam : undefined
              const created = await seedWorkspace(base, os)
              if (os) {
                await mkdir(path.join(base, '.chatdeck'), { recursive: true })
                await writeFile(path.join(base, '.chatdeck', 'os.txt'), os, 'utf8')
              }
              return json(res, 200, { ok: true, created, root: base, os: osOf(convId) })
            }

            // os : lit (GET) ou choisit (POST) le profil OS de la conversation.
            // Chaque OS a son VRAI espace (<conv>@@<os>) : rien ne se purge, le
            // workspace « actif » est celui de l'OS courant — rebasculer est
            // instantané et ne perd RIEN. Le fichier platform/ du profil actif
            // est (re)créé ici s'il manque (invariant arborescence).
            if (action === 'os') {
              if (req.method === 'GET') return json(res, 200, { os: osOf(convId) })
              if (req.method === 'POST') {
                const body = JSON.parse(await readBody(req)) as { os?: string }
                const os = body.os
                if (os !== 'mac' && os !== 'windows' && os !== 'linux') return json(res, 400, { error: 'os invalide (mac|windows|linux)' })
                setOsOf(convId, os)
                const osBase = osWorkspace(convId, os)
                if (!existsSync(osBase)) await seedWorkspace(osBase, os)
                const pf = safeResolve(convId, Object.keys(OS_FILES[os])[0] ?? '')
                if (pf && !existsSync(pf.target)) {
                  await mkdir(path.dirname(pf.target), { recursive: true })
                  await writeFile(pf.target, Object.values(OS_FILES[os])[0], 'utf8')
                }
                return json(res, 200, {
                  ok: true,
                  os,
                  note: `espace « ${convId}@@${os} » actif — chaque OS (mac/windows/linux) garde son espace côte à côte, rien n'est purgé ; exécutions bornées par la liste blanche du terminal`,
                })
              }
            }

            // serve : sert un fichier du workspace pour la preview live (texte/html/css/js/json/svg/md)
            if (action === 'serve' && req.method === 'GET') {
              const rel = query.get('path') ?? 'index.html'
              const t = safeResolve(convId, rel)
              if (!t) return json(res, 400, { error: 'chemin invalide' })
              const info = await stat(t.target).catch(() => null)
              if (!info?.isFile()) return json(res, 404, { error: 'fichier introuvable' })
              if (info.size > MAX_FILE_BYTES) return json(res, 413, { error: 'fichier trop volumineux' })
              const ext = path.extname(t.target).toLowerCase()
              const mime: Record<string, string> = {
                '.html': 'text/html; charset=utf-8',
                '.css': 'text/css; charset=utf-8',
                '.js': 'text/javascript; charset=utf-8',
                '.mjs': 'text/javascript; charset=utf-8',
                '.json': 'application/json; charset=utf-8',
                '.svg': 'image/svg+xml',
                '.md': 'text/plain; charset=utf-8',
                '.txt': 'text/plain; charset=utf-8',
              }
              res.setHeader('Content-Type', mime[ext] ?? 'text/plain; charset=utf-8')
              res.setHeader('X-Content-Type-Options', 'nosniff')
              res.end(await readFile(t.target, 'utf8'))
              return
            }

            // launch-instance : « + instance » de la palette ⌘K (mode web/dev).
            // Spawn détaché d'une 2ᵈ instance Electron indépendante (--multi).
            // Sécurité : aucun argument utilisateur — commande fixe du projet,
            // aucune donnée transmise au process enfant.
            // (Route au niveau convId : /api/sandbox/launch-instance.)
            if (convId === 'launch-instance' && req.method === 'POST') {
              if (process.platform !== 'darwin') {
                return json(res, 501, { ok: false, error: 'supporté sur macOS pour l\'instant (ouvrez un 2ᵈ terminal : npm run app:multi)' })
              }
              try {
                const { spawn } = await import('node:child_process')
                const child = spawn('npx', ['electron', '.', '--multi'], {
                  cwd: projectRoot,
                  detached: true,
                  stdio: 'ignore',
                  env: { ...process.env },
                })
                child.unref()
                return json(res, 200, { ok: true, pid: child.pid })
              } catch (e) {
                return json(res, 500, { ok: false, error: (e as Error).message })
              }
            }

            /* ── Projets : workspace dédié p-<id> + dossiers Mac autorisés ── */
            // POST /api/sandbox/projects/:id/bootstrap → seed du workspace projet
            // GET  /api/sandbox/projects/:id/file?path=… → lecture CONFINÉE : workspace projet
            //   d'abord, puis dossiers Mac autorisés (lecture seule, cap 1 Mo, texte)
            // GET  /api/sandbox/projects/:id/tree → arborescence projet + dossiers Mac
            // PUT  /api/sandbox/projects/:id/folders → {folders:[…]} (dossiers du Mac)
            // (Le routeur découpe convId/action : convId='projects', action=<id>,
            //  le sous-action est le 3ᵉ segment du chemin.)
            if (convId === 'projects') {
              const projectId = action ?? ''
              const subAction = (pathPart.split('/').slice(2).join('/') || '').replace(/^\//, '')
              if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(projectId)) return json(res, 400, { error: 'id de projet invalide' })
              const pbase = path.join(WORKSPACES_ROOT, `p-${projectId}`)
              if (subAction === 'bootstrap' && req.method === 'POST') {
                await mkdir(path.join(pbase, 'src'), { recursive: true })
                await writeFile(
                  path.join(pbase, 'NOTES.md'),
                  `# Projet ${projectId}\n\nWorkspace partagé par les conversations de ce projet.\n`,
                  'utf8',
                )
                return json(res, 200, { ok: true, base: pbase })
              }
              if (subAction === 'folders' && req.method === 'PUT') {
                // Liste de dossiers du Mac (chemins absolus) — validation stricte :
                // existant, dossier, pas de symlink qui remonte trop loin (on confine
                // par realpath au moment de la lecture).
                const body = JSON.parse(await readBody(req)) as { folders?: unknown }
                const list = Array.isArray(body.folders)
                  ? (body.folders as unknown[])
                      .filter((s): s is string => typeof s === 'string')
                      .map((s) => s.trim().replace(/^~(?=\/|$)/, homedir()))
                      .filter(Boolean)
                      .slice(0, 20)
                  : []
                for (const f of list) {
                  if (!path.isAbsolute(f)) return json(res, 400, { error: `chemin relatif interdit : ${f}` })
                  if (!existsSync(f)) return json(res, 400, { error: `dossier inexistant : ${f}` })
                  if (!(await stat(f)).isDirectory()) return json(res, 400, { error: `pas un dossier : ${f}` })
                }
                setAllowedFolders(list)
                return json(res, 200, { ok: true, folders: list })
              }
              if (subAction === 'file' && req.method === 'GET') {
                const rel = query.get('path') ?? ''
                // 1) fichier du workspace projet (prioritaire)
                const t = safeResolve(`p-${projectId}`, rel)
                if (t && existsSync(t.target) && (await stat(t.target)).isFile()) {
                  const info = await stat(t.target)
                  if (info.size > MAX_FILE_BYTES) return json(res, 413, { error: 'fichier trop volumineux (> 1 Mo)' })
                  return json(res, 200, { path: rel, content: await readFile(t.target, 'utf8'), scope: 'workspace' })
                }
                // 2) dossier Mac autorisé : /ABS//rel → lecture seule, texte, borné
                for (const folder of allowedFolders()) {
                  const real = realpathSync.native(folder)
                  const target = path.resolve(folder, rel.replace(/^[/\\]+/, ''))
                  const realTarget = realpathSync.native(target)
                  if (realTarget !== real && !realTarget.startsWith(real + path.sep)) continue // hors dossier autorisé
                  const info = await stat(realTarget).catch(() => null)
                  if (!info?.isFile()) continue
                  if (info.size > MAX_FILE_BYTES) return json(res, 413, { error: 'fichier trop volumineux (> 1 Mo)' })
                  const content = await readFile(realTarget, 'utf8')
                  return json(res, 200, { path: rel, content, scope: folder })
                }
                return json(res, 404, { error: `fichier introuvable ni dans le workspace projet ni dans les ${allowedFolders().length} dossier(s) Mac autorisé(s)` })
              }
              // Écriture DANS LE WORKSPACE PROJET uniquement (p-<id>) — jamais
              // dans les dossiers Mac autorisés (lecture seule). L'appel passe
              // par la gate de permissions de l'app (toolPerms.ask). Suit le
              // format de l'outil write_file : {path, content}.
              if (subAction === 'file' && req.method === 'PUT') {
                const body = JSON.parse(await readBody(req)) as { path?: string; content?: string }
                const t = safeResolve(`p-${projectId}`, body.path ?? '')
                if (!t || typeof body.content !== 'string') return json(res, 400, { error: 'requête invalide' })
                if (Buffer.byteLength(body.content) > MAX_FILE_BYTES) return json(res, 413, { error: 'contenu > 1 Mo' })
                await mkdir(path.dirname(t.target), { recursive: true })
                await writeFile(t.target, body.content, 'utf8')
                return json(res, 200, { ok: true, path: body.path, base: pbase })
              }
              if (subAction === 'tree' && req.method === 'GET') {
                const budget = { n: MAX_TREE_ENTRIES }
                const tree = (existsSync(pbase) ? await walk(pbase, 0, budget) : null) ?? []
                const folders = allowedFolders().map((f) => ({ name: `Mac : ${f}`, type: 'dir' as const }))
                return json(res, 200, { exists: existsSync(pbase), tree: [...tree, ...folders] })
              }
              return json(res, 404, { error: 'route projet inconnue' })
            }

            // git-commit : endpoint sécurisé pour les agents — git add -A + commit.
            // Garde-fous : id de conversation valide, message non vide borné, pas de
            // branche/répo externe (flags figés), exécution via spawn sans shell.
            // git-undo : checkpoint avant tour d'agent + revert (inspiré de /undo OpenCode).
            //   POST {op:'checkpoint'} → commit auto (comme git-commit, silencieux si rien à committer)
            //   POST {op:'revert', steps?:N} → git reset --hard HEAD~N (défaut 1) + clean untracked
            if (action === 'git-undo' && req.method === 'POST') {
              const body = JSON.parse(await readBody(req) || '{}') as { op?: string; steps?: number }
              if (!existsSync(base)) return json(res, 400, { error: 'workspace inexistant (bootstrap d\'abord)' })
              const { execFile } = await import('node:child_process')
              const opt = { cwd: base, timeout: 15_000, env: { ...process.env, GIT_AUTHOR_NAME: 'Nexus (ChatDeck)', GIT_AUTHOR_EMAIL: 'nexus@chatdeck.local', GIT_COMMITTER_NAME: 'Nexus (ChatDeck)', GIT_COMMITTER_EMAIL: 'nexus@chatdeck.local' } }
              const run = (args: string[]): Promise<string> =>
                new Promise((resolve, reject) => {
                  execFile('git', args, opt, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message))) : resolve(stdout)))
                })
              try {
                if (!existsSync(path.join(base, '.git'))) await run(['init', '-q'])
                const op = body.op ?? 'checkpoint'
                if (op === 'checkpoint') {
                  await run(['add', '-A'])
                  const empty = await run(['diff', '--cached', '--quiet']).then(
                    () => true,
                    () => false,
                  )
                  if (empty) return json(res, 200, { ok: true, hash: null, note: 'rien à committer' })
                  const hash = await run(['commit', '-q', '-m', (body as { message?: string }).message?.slice(0, 200) || 'checkpoint (avant tour agent)']).then(
                    () => run(['rev-parse', '--short', 'HEAD']),
                  )
                  return json(res, 200, { ok: true, hash: hash.trim() })
                }
                if (op === 'revert') {
                  const steps = Math.max(1, Math.min(10, Math.floor(body.steps ?? 1)))
                  // On ne revert que les checkpoints « checkpoint (avant tour agent) » —
                  // jamais les commits de l'utilisateur. Reset vers le commit checkpoint
                  // lui-même (l'état AVANT le travail de l'agent) : marche même en racine.
                  const lines = (await run(['log', '--pretty=%h|%s', '-30'])).split('\n').filter(Boolean)
                  const cks = lines.filter((l) => /checkpoint \(avant tour agent\)/.test(l)).map((l) => l.split('|')[0])
                  const n = Math.min(steps, cks.length)
                  if (!n) return json(res, 200, { ok: false, note: 'aucun checkpoint agent à annuler' })
                  await run(['reset', '--hard', cks[n - 1]])
                  await run(['clean', '-fd'])
                  return json(res, 200, { ok: true, reverted: n })
                }
                return json(res, 400, { error: 'op invalide (checkpoint|revert)' })
              } catch (e) {
                return json(res, 500, { error: (e as Error).message })
              }
            }

            if (action === 'git-commit' && req.method === 'POST') {
              const body = JSON.parse(await readBody(req)) as { message?: string }
              const message = (body.message ?? '').trim().slice(0, 200)
              if (!message) return json(res, 400, { error: 'message de commit vide' })
              if (!existsSync(base)) return json(res, 400, { error: 'workspace inexistant (bootstrap d\'abord)' })
              const { execFile } = await import('node:child_process')
              const opt = { cwd: base, timeout: 15_000, env: { ...process.env, GIT_AUTHOR_NAME: 'Nexus (ChatDeck)', GIT_AUTHOR_EMAIL: 'nexus@chatdeck.local', GIT_COMMITTER_NAME: 'Nexus (ChatDeck)', GIT_COMMITTER_EMAIL: 'nexus@chatdeck.local' } }
              const run = (args: string[]): Promise<string> =>
                new Promise((resolve, reject) => {
                  execFile('git', args, opt, (err, stdout, stderr) => {
                    if (err) reject(new Error(String(stderr || err.message).slice(0, 300)))
                    else resolve(String(stdout))
                  })
                })
              try {
                if (!existsSync(path.join(base, '.git'))) await run(['init'])
                // Identité locale du workspace (une fois) — n'écrase pas le git global
                await run(['config', 'user.name', 'Nexus (ChatDeck)']).catch(() => {})
                await run(['config', 'user.email', 'nexus@chatdeck.local']).catch(() => {})
                await run(['add', '-A'])
                // Rien à committer ? On le dit proprement (pas une erreur)
                const st = await run(['status', '--porcelain'])
                if (!st.trim()) return json(res, 200, { ok: true, hash: null, subject: message, files: 0, note: 'rien à committer' })
                const out = await run(['commit', '-m', message])
                // Hash fiable même sur le root commit (« [main (root-commit) abc1234] »)
                const hash = (await run(['rev-parse', '--short', 'HEAD'])).trim() || null
                const files = Number((/\d+ files? changed/.exec(out) ?? ['0'])[0].split(' ')[0]) || 0
                return json(res, 200, { ok: true, hash, subject: message, files })
              } catch (e) {
                return json(res, 400, { error: (e as Error).message })
              }
            }

            // git : arbre des commits + status (git log/status read-only, cwd = workspace)
            if (action === 'git' && req.method === 'GET') {
              const { execFile } = await import('node:child_process')
              const { promisify } = await import('node:util')
              const run = promisify(execFile)
              if (!existsSync(path.join(base, '.git'))) {
                return json(res, 200, { repo: false, log: [], status: null })
                }
              const opt = { cwd: base, maxBuffer: 1024 * 1024 }
              const log = await run('git', ['log', '--oneline', '-30', '--date=short', '--pretty=%h|%ad|%s'], opt)
                .then((x) => x.stdout.trim().split('\n').filter(Boolean).map((l) => {
                  const [hash, date, ...rest] = l.split('|')
                  return { hash, date, subject: rest.join('|') }
                }))
                .catch(() => [])
              const status = await run('git', ['status', '--porcelain'], opt)
                .then((x) => x.stdout.split('\n').filter(Boolean).slice(0, 50))
                .catch(() => [])
              return json(res, 200, { repo: true, log, status })
            }

            // git-diff : diff borné d'un commit (?hash=abc1234, défaut HEAD) — lecture seule
            if (action === 'git-diff' && req.method === 'GET') {
              if (!existsSync(path.join(base, '.git'))) return json(res, 400, { error: 'pas de dépôt Git' })
              const hash = (query.get('hash') ?? 'HEAD').replace(/[^\w.-]/g, '').slice(0, 40) || 'HEAD'
              const { execFile } = await import('node:child_process')
              const { promisify } = await import('node:util')
              const run = promisify(execFile)
              const opt = { cwd: base, maxBuffer: 1024 * 1024, timeout: 10_000 }
              try {
                // Fichiers touchés + stats par fichier
                const numstat = await run('git', ['show', '--numstat', '--pretty=format:', hash], opt)
                  .then((x) => x.stdout)
                  .catch(() => '')
                const files = numstat
                  .split('\n')
                  .map((l) => l.trim())
                  .filter(Boolean)
                  .slice(0, 50)
                  .map((l) => {
                    const [add, del, ...p] = l.split('\t')
                    return { path: p.join('\t'), add: Number(add) || 0, del: Number(del) || 0 }
                  })
                // Diff brut plafonné (60 ko)
                const diff = await run('git', ['show', '--format=', '--patch', hash], opt)
                  .then((x) => (x.stdout.length > 60_000 ? x.stdout.slice(0, 60_000) + '\n… (diff tronqué)' : x.stdout))
                  .catch((e) => `diff indisponible : ${(e as Error).message}`)
                return json(res, 200, { hash, files, diff })
              } catch (e) {
                return json(res, 400, { error: (e as Error).message })
              }
            }

            // webfetch : explorateur du modèle — récupère une page/texte (http(s), borné)
            if (action === 'webfetch' && req.method === 'GET') {
              const raw = query.get('url') ?? ''
              let target: URL
              try {
                target = new URL(raw)
              } catch {
                return json(res, 400, { error: 'URL invalide' })
              }
              if (target.protocol !== 'http:' && target.protocol !== 'https:') return json(res, 400, { error: 'protocole interdit' })
              if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(target.hostname)) {
                return json(res, 400, { error: 'accès local interdit' })
              }
              try {
                const r = await fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(15_000) })
                const ct = r.headers.get('content-type') ?? ''
                const text = (await r.text()).slice(0, 200_000)
                return json(res, 200, { status: r.status, contentType: ct, url: r.url, text })
              } catch (e) {
                return json(res, 502, { error: `téléchargement impossible : ${(e as Error).message}` })
              }
            }

            // run : terminal réel (spawn borné, sortie streamée)
            if (action === 'run' && req.method === 'POST') {
              const body = JSON.parse(await readBody(req)) as { cmd?: string }
              const cmd = (body.cmd ?? '').trim()
              if (!cmd) return json(res, 400, { error: 'commande vide' })
              if (!existsSync(base)) await seedWorkspace(base)
              runCommand(res, convId, cmd)
              return
            }

            /* ── Connecteurs MCP stdio ── */
            // GET /api/sandbox/mcp-config → liste des serveurs déclarés (noms + état)
            // GET /api/sandbox/mcp/<serveur>/tools → tools/list (cache 60 s)
            // POST /api/sandbox/mcp/<serveur>/call {tool,args} → tools/call
            if (convId === 'mcp-config' && req.method === 'GET') {
              return json(res, 200, { servers: mcpServers().map((s) => ({ name: s.name, enabled: s.enabled !== false })) })
            }
            if (convId === 'mcp' || action === 'mcp') {
              // Deux formes : /api/sandbox/mcp?server=X (query) et
              // /api/sandbox/mcp/<serveur>/tools|call (segments REST).
              // pathPart est RELATIF au montage /api/sandbox : ici
              // ['mcp', serveur?, 'tools'|'call'?] — la destructuration
              // [convId, action] perd le 3ᵉ segment, on reconstitue.
              const rest = pathPart.split('/').filter(Boolean)
              const srv = convId === 'mcp'
                ? (query.get('server') ?? (rest[1] && rest[1] !== 'tools' && rest[1] !== 'call' ? rest[1] : ''))
                : convId
              // sub = la partie route : 'tools' | 'call' (mcp + serveur retirés)
              const sub = rest.filter((s) => s !== 'mcp' && s !== srv).join('/')
              if (!srv) return json(res, 400, { error: 'nom de serveur MCP requis' })
              try {
                if (sub === 'tools' || sub === 'tools/list') {
                  const hit = mcpToolsCache.get(srv)
                  if (hit && Date.now() - hit.at < MCP_TOOLS_TTL) return json(res, 200, { server: srv, tools: hit.tools })
                  const r = (await mcpRpc(srv, 'tools/list', {})) as { tools?: { name: string; description?: string }[] }
                  const tools = r.tools ?? []
                  mcpToolsCache.set(srv, { at: Date.now(), tools })
                  return json(res, 200, { server: srv, tools })
                }
                if (sub === 'call' && req.method === 'POST') {
                  const body = JSON.parse(await readBody(req)) as { tool?: string; args?: Record<string, unknown> }
                  if (!body.tool) return json(res, 400, { error: 'tool requis' })
                  const r = await mcpRpc(srv, 'tools/call', { name: body.tool, arguments: body.args ?? {} })
                  return json(res, 200, { server: srv, result: r })
                }
                return json(res, 404, { error: 'route MCP inconnue (tools|call)' })
              } catch (e) {
                return json(res, 502, { error: (e as Error).message })
              }
            }

            /* ── Connecteurs locaux (level « connecteur » du hub) ── */
            // GET /api/sandbox/connectors/<convId>/tree|file|deck|deck-search|clock
            if (convId === 'connectors' || action === 'connectors') {
              const sub = convId === 'connectors' ? (action ?? '') : (pathPart.split('/').slice(2).join('/') || '')
              const rid = convId === 'connectors' ? (query.get('conv') ?? '') : convId
              if (sub === 'tree' && rid) {
                const t = safeResolve(rid, '')
                if (!t) return json(res, 400, { error: 'id de conversation invalide' })
                const budget = { n: MAX_TREE_ENTRIES }
                const tree = (existsSync(t.base) ? await walk(t.base, 0, budget) : null) ?? []
                return json(res, 200, { connector: 'workspace', tree })
              }
              if (sub === 'file' && rid) {
                const t = safeResolve(rid, query.get('path') ?? '')
                if (!t) return json(res, 400, { error: 'chemin invalide' })
                const info = await stat(t.target).catch(() => null)
                if (!info?.isFile()) return json(res, 404, { error: 'fichier introuvable' })
                if (info.size > MAX_FILE_BYTES) return json(res, 413, { error: 'fichier trop volumineux (> 1 Mo)' })
                return json(res, 200, { connector: 'workspace', path: query.get('path'), content: await readFile(t.target, 'utf8') })
              }
              if (sub === 'deck') {
                const script = path.join(promptdeckDir, 'search.mjs')
                const q = (query.get('q') ?? '').trim()
                if (!q) return json(res, 400, { error: 'q requis' })
                if (!existsSync(script)) return json(res, 404, { error: 'search.mjs introuvable' })
                const { execFile } = await import('node:child_process')
                const { promisify } = await import('node:util')
                const { stdout } = await promisify(execFile)(process.execPath, [script, q, '--max', query.get('max') ?? '6'], { cwd: projectRoot, timeout: 20_000, maxBuffer: 2 * 1024 * 1024 })
                return json(res, 200, { connector: 'deck', output: stdout.slice(0, 20_000) })
              }
              if (sub === 'clock') {
                const now = new Date()
                return json(res, 200, { connector: 'horloge', iso: now.toISOString(), local: now.toString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone })
              }
              // web : connecteur web NATIF de l'agent — historique des web_search,
              // favoris et cache des pages fetchées (~/.chatdeck/web.local.json).
              // GET  …/web?conv=<id>              → {history, favorites, cache(index)}
              // POST …/web {op:'search', query}    → enregistre la recherche
              // POST …/web {op:'favorite', url, title, add} → gère les favoris
              // POST …/web {op:'cache', url, title, text}   → stocke une page (10 ko)
              if (sub === 'web') {
                const WEB_FILE = path.join(homedir(), '.chatdeck', 'web.local.json')
                interface WebEntry { q?: string; url?: string; title?: string; at: number }
                interface WebStore { history: WebEntry[]; favorites: WebEntry[]; cache: Record<string, { title: string; text: string; at: number }> }
                const load = (): WebStore => {
                  try {
                    return JSON.parse(readFileSync(WEB_FILE, 'utf8')) as WebStore
                  } catch {
                    return { history: [], favorites: [], cache: {} }
                  }
                }
                if (req.method === 'GET') {
                  const s = load()
                  return json(res, 200, {
                    connector: 'web',
                    history: s.history.slice(-50).reverse(),
                    favorites: s.favorites,
                    cache: Object.fromEntries(Object.entries(s.cache).map(([u, v]) => [u, { title: v.title, at: v.at, chars: v.text.length }])),
                  })
                }
                if (req.method === 'POST') {
                  const body = JSON.parse(await readBody(req) || '{}') as { op?: string; query?: string; url?: string; title?: string; text?: string; add?: boolean }
                  const s = load()
                  const at = Date.now()
                  if (body.op === 'search' && body.query) {
                    s.history.push({ q: body.query.slice(0, 300), at })
                    s.history = s.history.slice(-200)
                  } else if (body.op === 'favorite' && body.url) {
                    s.favorites = s.favorites.filter((f) => f.url !== body.url)
                    if (body.add !== false) s.favorites.push({ url: body.url.slice(0, 2000), title: (body.title ?? body.url).slice(0, 300), at })
                  } else if (body.op === 'cache' && body.url && body.text) {
                    s.cache[body.url.slice(0, 2000)] = { title: (body.title ?? body.url).slice(0, 300), text: body.text.slice(0, 10_000), at }
                    const keys = Object.keys(s.cache)
                    if (keys.length > 100) for (const k of keys.slice(0, keys.length - 100)) delete s.cache[k]
                  } else {
                    return json(res, 400, { error: 'op attendue : search | favorite | cache' })
                  }
                  try {
                    writeFileSync(WEB_FILE, JSON.stringify(s))
                  } catch { /* disque plein etc. : on ignore */ }
                  return json(res, 200, { ok: true })
                }
              }
              return json(res, 404, { error: 'connecteur inconnu (tree|file|deck|clock|web)' })
            }

            return json(res, 404, { error: 'route inconnue' })
          } catch (e) {
            return json(res, 500, { error: (e as Error).message })
          }
        })()
}

/** Plugin Vite (dev uniquement) : monte le handler partagé sur /api/sandbox. */
export function sandboxServer(): Plugin {
  return {
    name: 'chatdeck-sandbox-server',
    configureServer(server) {
      server.middlewares.use('/api/sandbox', sandboxHandler)
    },
  }
}

/*
 * Endpoints /api/deck pour le panneau Skills & Agents du hub :
 *
 *   GET  /api/deck/cards            → liste des fiches .CD (library + ./.cd + ~/.chatdeck)
 *   GET  /api/deck/card?id=…        → contenu complet d'une fiche (frontmatter + corps)
 *   POST /api/deck/cards            → crée une fiche {name, kind, dir?} (équivalent deck cd --new)
 *
 * Lecture seule sur promptdeck/library (artefact généré) ; les créations vont
 * dans ./.cd/skills|agents du projet. Aucune exécution, aucun accès réseau.
 */
type Card = { id: string; kind: 'skill' | 'agent' | 'outil'; source: 'library' | 'project' | 'global'; path: string; description: string }
const parseFrontmatter = (src: string): { name: string; description: string; kind: string } => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src)
  const pick = (k: string): string => {
    const v = m?.[1].match(new RegExp(`^${k}:(.*)$`, 'm'))
    return (v?.[1] ?? '').trim().replace(/^["']|["']$/g, '')
  }
  return { name: pick('name'), description: pick('description'), kind: pick('kind') || 'skill' }
}

/** Cache de la liste des fiches : le GET relisait ~640 fichiers à chaque
 * appel (> 30 s sous forte charge machine). Signature = mtimes des dossiers
 * de fiches ; invalidation explicite après création/édition. */
let cardsCache: { dirMtimes: string; cards: Card[] } | null = null
const invalidateCardsCache = (): void => {
  cardsCache = null
}

/** Handler /api/deck partagé : plugin Vite (dev) ET serveur autonome (app packagée). */
const deckHandler: RequestHandler = (req, res) => {
  void (async () => {
          const url = (req.url ?? '').replace(/^\//, '')
          const [pathPart, queryPart] = url.split('?')
          const query = new URLSearchParams(queryPart ?? '')

          try {
            const roots: { dir: string; source: Card['source'] }[] = [
              { dir: path.join(promptdeckDir, 'library'), source: 'library' },
              { dir: asarAware(path.join(projectRoot, '.cd')), source: 'project' },
              { dir: path.join(homedir(), '.chatdeck'), source: 'global' },
            ]
            /** Dossiers de fiches par catégorie : skills/, agents/ et outils/. */
            const kindDirs = ['skills', 'agents', 'outils'] as const

            // Liste des fiches (mise en cache — voir cardsCache ci-dessus).
            // ?fresh=1 : saute le cache (bouton ⟳ du panneau).
            if ((pathPart === 'cards' || pathPart === '') && req.method === 'GET') {
              const mtimes = await Promise.all(
                roots.flatMap(({ dir }) =>
                  kindDirs.map(async (kindDir) => {
                    const full = path.join(dir, kindDir)
                    return existsSync(full) ? String((await stat(full)).mtimeMs) : '-'
                  }),
                ),
              )
              const sig = mtimes.join('|')
              if (!query.has('fresh') && cardsCache && cardsCache.dirMtimes === sig) return json(res, 200, { cards: cardsCache.cards })
              const cards: Card[] = []
              const seen = new Set<string>()
              for (const { dir, source } of roots) {
                for (const kindDir of kindDirs) {
                  const full = path.join(dir, kindDir)
                  if (!existsSync(full)) continue
                  for (const f of await readdir(full)) {
                    if (!f.endsWith('.md') && !f.endsWith('.cd')) continue
                    const p = path.join(full, f)
                    try {
                      const fm = parseFrontmatter(await readFile(p, 'utf8'))
                      if (!fm.name || seen.has(fm.name)) continue
                      seen.add(fm.name)
                      cards.push({ id: fm.name, kind: fm.kind === 'agent' ? 'agent' : fm.kind === 'outil' ? 'outil' : 'skill', source, path: p, description: fm.description })
                    } catch {
                      /* fiche illisible : ignorée */
                    }
                  }
                }
              }
              cards.sort((a, b) => a.id.localeCompare(b.id))
              cardsCache = { dirMtimes: sig, cards }
              return json(res, 200, { cards })
            }

            // Contenu d'une fiche
            if (pathPart === 'card' && req.method === 'GET') {
              const id = query.get('id') ?? ''
              if (!id || /[\\/\0]/.test(id)) return json(res, 400, { error: 'id invalide' })
              for (const { dir, source } of roots) {
                for (const kindDir of kindDirs) {
                  for (const ext of ['.cd', '.md']) {
                    const p = path.join(dir, kindDir, `${id}${ext}`)
                    if (existsSync(p)) return json(res, 200, { id, source, content: await readFile(p, 'utf8') })
                  }
                }
              }
              return json(res, 404, { error: `fiche inconnue : ${id}` })
            }

            // Édition : remplace le corps d'une fiche du PROJET (.cd/ uniquement,
            // le pack promptdeck reste intouchable). Le frontmatter est préservé
            // si l'utilisateur n'en fournit pas.
            if (pathPart === 'card' && req.method === 'PUT') {
              const body = JSON.parse(await readBody(req)) as { id?: string; content?: string }
              const id = body.id ?? ''
              const content = body.content ?? ''
              if (!id || /[\\/\0]/.test(id)) return json(res, 400, { error: 'id invalide' })
              if (content.length > 200_000) return json(res, 413, { error: 'fiche trop volumineuse' })
              if (/^---\r?\n[\s\S]*?\r?\n---/.test(content) === false) return json(res, 400, { error: 'frontmatter requis (name/description/kind)' })
              for (const kindDir of kindDirs) {
                for (const ext of ['.cd', '.md']) {
                  const p = path.join(asarAware(path.join(projectRoot, '.cd')), kindDir, `${id}${ext}`)
                  if (existsSync(p)) {
                    await writeFile(p, content, 'utf8')
                    invalidateCardsCache()
                    return json(res, 200, { ok: true, path: `.cd/${kindDir}/${id}${ext}` })
                  }
                }
              }
              return json(res, 404, { error: 'fiche projet introuvable (les fiches du pack ne sont pas éditables — copie-la d\'abord)' })
            }

            // Création (équivalent deck cd --new)
            if (pathPart === 'cards' && req.method === 'POST') {
              const body = JSON.parse(await readBody(req)) as { name?: string; kind?: string; description?: string }
              const slug = String(body.name ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-')
              if (!slug || slug === '-') return json(res, 400, { error: 'nom invalide (a-z, 0-9, tirets)' })
              const kind = body.kind === 'agent' ? 'agents' : body.kind === 'outil' ? 'outils' : 'skills'
              const kindVal = body.kind === 'agent' ? 'agent' : body.kind === 'outil' ? 'outil' : 'skill'
              const dir = path.join(asarAware(path.join(projectRoot, '.cd')), kind)
              const file = path.join(dir, `${slug}.cd`)
              if (existsSync(file)) return json(res, 409, { error: `existe déjà : .cd/${kind}/${slug}.cd` })
              await mkdir(dir, { recursive: true })
              await writeFile(
                file,
                `---\nname: ${slug}\ndescription: ${body.description ?? 'Décris ici QUAND utiliser cette fiche (déclencheurs concrets).'}\nkind: ${kindVal}\ntools: [read, list, bash]\n---\n\n# ${slug}\n\n## Quand\n\n## Procédure\n\n1. \n\n## Vérification\n\n`,
                'utf8',
              )
              invalidateCardsCache()
              return json(res, 200, { ok: true, path: `.cd/${kind}/${slug}.cd` })
            }

            // Recherche bibliothèque (outil agent deck_search) : délègue au moteur
            // officiel promptdeck/search.mjs (bilingue FR/EN), sortie brute.
            if (pathPart === 'search' && req.method === 'GET') {
              const q = (query.get('q') ?? '').trim().slice(0, 500)
              if (!q) return json(res, 400, { error: 'requête vide' })
              const max = Math.min(12, Math.max(1, Math.floor(Number(query.get('max')) || 6)))
              const script = path.join(promptdeckDir, 'search.mjs')
              if (!existsSync(script)) return json(res, 404, { error: 'promptdeck/search.mjs introuvable (pack non installé ?)' })
              const { execFile } = await import('node:child_process')
              const { promisify } = await import('node:util')
              try {
                const { stdout } = await promisify(execFile)(process.execPath, [script, q, '--max', String(max)], {
                  cwd: projectRoot,
                  timeout: 20_000,
                  maxBuffer: 2 * 1024 * 1024,
                })
                return json(res, 200, { ok: true, query: q, output: stdout.slice(0, 20_000) })
              } catch (e) {
                return json(res, 500, { error: `recherche impossible : ${(e as Error).message}` })
              }
            }

            return json(res, 404, { error: 'route deck inconnue' })
          } catch (e) {
            return json(res, 500, { error: (e as Error).message })
          }
        })()
}

/** Plugin Vite (dev uniquement) : monte le handler partagé sur /api/deck. */
export function deckServer(): Plugin {
  return {
    name: 'chatdeck-deck-server',
    configureServer(server) {
      server.middlewares.use('/api/deck', deckHandler)
    },
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Serveur API autonome (mode `--serve`) — pour l'APP PACKAGÉE (Electron).
 *
 * En dev, les endpoints /api/* vivent dans le dev server Vite (plugins ci-
 * dessus). Une fois packagée, il n'y a plus de Vite : Electron spawn donc
 * `node --experimental-strip-types sandbox-server.ts --serve` qui expose
 * LES MÊMES routes sur http://127.0.0.1:<port>. main.mjs séquestre le port
 * via CHATDECK_API_PORT et charge http://127.0.0.1:<port> au lieu de file://.
 *──────────────────────────────────────────────────────────────────────── */
class ChatDeckApi {
  private server: import('node:http').Server | null = null

  start(port = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        void (async () => {
          const url = (req.url ?? '/').replace(/^\//, '')
          const [pathPart, queryPart] = url.split('?')
          const seg = (pathPart ?? '').split('/')
          const key = seg[0] ?? ''
          try {
            if (key === 'health') {
              // Réponse immédiate — même forme que le plugin dev (providers détaillés omis).
              return json(res, 200, { ok: true, server: 'standalone', providers: {}, allUp: true })
            }
            if (key === 'keys.local') {
              // Le foyer des données de l'app : ~/.chatdeck/keys.local.json.
              // (projectRoot pointe sur app.asar.unpacked en packagé — le fichier
              // n'y est pas : les clés vivaient dans le dossier projet en dev.)
              for (const f of [path.join(homedir(), '.chatdeck', 'keys.local.json'), path.join(projectRoot, 'keys.local.json')]) {
                try {
                  return json(res, 200, JSON.parse(readFileSync(f, 'utf8')))
                } catch {
                  /* fichier suivant */
                }
              }
              return json(res, 404, {})
            }
            if (key === 'api' && seg[1] === 'health') {
              return json(res, 200, { ok: true, server: 'standalone', providers: {}, allUp: true })
            }
            // Dé-légué aux MÊMES handlers que le dev : on reconstruit une req.url
            // relative au point de montage /api/sandbox (ou /api/deck).
            if (key === 'api' && (seg[1] === 'sandbox' || seg[1] === 'deck')) {
              const mount = seg[1]
              const sub = seg.slice(2).join('/')
              const handler = mount === 'sandbox' ? sandboxHandler : deckHandler
              req.url = `/${sub}${queryPart ? `?${queryPart}` : ''}`
              return handler(req, res)
            }
            // Cascade du méga-pack : MÊMES handlers que le plugin Vite (dev).
            // Sans ce montage, l'app packagée renvoyait le fallback SPA (index.html)
            // et le panneau Cascade affichait « Unexpected token '<' ».
            if (key === 'api' && (seg[1] === 'cascade' || seg[1] === 'cascade-check')) {
              req.url = `/${seg.slice(2).join('/')}${queryPart ? `?${queryPart}` : ''}`
              return cascadeApiMount(req, res)
            }
            // Proxy fournisseurs intégrés (les 6, via PROVIDER_IDS partagé —
            // la liste en dur à 4 laissait groq/xai sans proxy en app :
            // fallback SPA → « réponse vide », même bug que 0.4.9).
            if (key === 'api' && (PROVIDER_IDS as readonly string[]).includes(seg[1] ?? '')) {
              req.url = `/${seg.slice(1).join('/')}${queryPart ? `?${queryPart}` : ''}`
              return providerProxyMount(req, res)
            }
            // UI : sert dist/ (build Vite) — l'app packagée charge http://127.0.0.1:<port>/.
            const distDir = path.join(projectRoot, 'dist')
            const rel = pathPart === '' || pathPart === undefined ? 'index.html' : decodeURIComponent(pathPart)
            const file = path.resolve(distDir, rel)
            if (file === distDir || file.startsWith(distDir + path.sep)) {
              const mime: Record<string, string> = {
                '.html': 'text/html; charset=utf-8',
                '.js': 'text/javascript; charset=utf-8',
                '.mjs': 'text/javascript; charset=utf-8',
                '.css': 'text/css; charset=utf-8',
                '.json': 'application/json; charset=utf-8',
                '.svg': 'image/svg+xml',
                '.png': 'image/png',
                '.ico': 'image/x-icon',
                '.woff2': 'font/woff2',
              }
              const ext = path.extname(file).toLowerCase()
              try {
                const data = readFileSync(file)
                res.statusCode = 200
                res.setHeader('Content-Type', mime[ext] ?? 'application/octet-stream')
                res.end(data)
                return
              } catch {
                // fallback SPA : toute route inconnue renvoie index.html
                try {
                  res.setHeader('Content-Type', 'text/html; charset=utf-8')
                  res.end(readFileSync(path.join(distDir, 'index.html')))
                  return
                } catch {
                  /* dist/ absent : 404 ci-dessous */
                }
              }
            }
            return json(res, 404, { error: `route inconnue : /${pathPart ?? ''}` })
          } catch (e) {
            return json(res, 500, { error: (e as Error).message })
          }
        })()
      })
      this.server.on('error', (e) => reject(e))
      this.server.listen(port, '127.0.0.1', () => {
        const addr = this.server?.address()
        resolve(typeof addr === 'object' && addr ? addr.port : port)
      })
    })
  }

  stop(): void {
    this.server?.close()
  }
}

/** Démarrage autonome : `node sandbox-server.ts --serve [--port N]`.
 *  Port par défaut : CHATDECK_API_PORT (main.mjs), sinon 0 = choisi par l'OS. */
if (process.argv.includes('--serve')) {
  const portArgv = process.argv.includes('--port') ? Number(process.argv[process.argv.indexOf('--port') + 1]) : NaN
  const port = Number.isFinite(portArgv) && portArgv > 0 ? portArgv : Number(process.env.CHATDECK_API_PORT ?? 0) || 0
  const api = new ChatDeckApi()
  api
    .start(port)
    .then((p) => {
      console.log(`[chatdeck-api] http://127.0.0.1:${p}`)
    })
    .catch((e) => {
      console.error('[chatdeck-api] impossible de démarrer :', e)
      process.exit(1)
    })
}
