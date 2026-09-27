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
import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const WORKSPACES_ROOT = path.join(homedir(), '.chatdeck', 'workspaces')
/** Racine du projet (pour lancer une 2ᵈ instance : npm run app:multi). */
const projectRoot = path.resolve(import.meta.dirname ?? '.')
const MAX_FILE_BYTES = 1_000_000
const MAX_TREE_ENTRIES = 500
const MAX_RUN_OUTPUT = 200_000
const RUN_TIMEOUT_MS = 60_000
const CONV_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i
type OsProfile = 'mac' | 'windows' | 'linux'

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

/** Résout un chemin utilisateur DANS le workspace (anti path-traversal). */
function safeResolve(convId: string, sub: string): { base: string; target: string } | null {
  if (!CONV_ID_RE.test(convId)) return null
  const base = path.join(WORKSPACES_ROOT, convId)
  const rel = (sub ?? '').replace(/^[/\\]+/, '')
  const target = path.resolve(base, rel)
  if (target !== base && !target.startsWith(base + path.sep)) return null
  return { base, target }
}

/** Crée le workspace + fichiers d'amorçage (sans écraser) + profil OS demandé. */
async function seedWorkspace(convId: string, os?: OsProfile): Promise<number> {
  const g = safeResolve(convId, '')
  if (!g) throw new Error('id de conversation invalide')
  await mkdir(path.join(g.base, 'src'), { recursive: true })
  let written = 0
  const seeds: Record<string, string> = { ...SEED_FILES, ...(os ? OS_FILES[os] : {}) }
  for (const [p, content] of Object.entries(seeds)) {
    const t = safeResolve(convId, p)
    if (!t) continue
    if (!existsSync(t.target)) {
      await mkdir(path.dirname(t.target), { recursive: true })
      await writeFile(t.target, content, 'utf8')
      written++
    }
  }
  return written
}

/** Profil OS courant d'un workspace (par défaut : celui de la machine hôte). */
function osOf(convId: string): OsProfile {
  const g = safeResolve(convId, '')
  if (g) {
    try {
      const v = readFileSync(path.join(g.base, '.chatdeck', 'os.txt'), 'utf8').trim()
      if (v === 'mac' || v === 'windows' || v === 'linux') return v
    } catch {
      /* pas encore fixé */
    }
  }
  return process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux'
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

/** Plugin Vite : monte les endpoints /api/sandbox. */
export function sandboxServer(): Plugin {
  return {
    name: 'chatdeck-sandbox-server',
    configureServer(server) {
      server.middlewares.use('/api/sandbox', (req, res) => {
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

            const guard = safeResolve(convId, '')
            if (!guard) return json(res, 400, { error: 'id de conversation invalide' })
            const { base } = guard

            // suppression du workspace entier
            if (!action && req.method === 'DELETE') {
              if (existsSync(base)) await rm(base, { recursive: true })
              return json(res, 200, { ok: true })
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
              const created = await seedWorkspace(convId, os)
              if (os) {
                await mkdir(path.join(base, '.chatdeck'), { recursive: true })
                await writeFile(path.join(base, '.chatdeck', 'os.txt'), os, 'utf8')
              }
              return json(res, 200, { ok: true, created, root: base, os: osOf(convId) })
            }

            // os : lit (GET) ou choisit (POST) le profil OS sécurisé du workspace
            if (action === 'os') {
              if (req.method === 'GET') return json(res, 200, { os: osOf(convId) })
              if (req.method === 'POST') {
                const body = JSON.parse(await readBody(req)) as { os?: string }
                const os = body.os
                if (os !== 'mac' && os !== 'windows' && os !== 'linux') return json(res, 400, { error: 'os invalide (mac|windows|linux)' })
                if (!existsSync(base)) await seedWorkspace(convId, os)
                await mkdir(path.join(base, '.chatdeck'), { recursive: true })
                await writeFile(path.join(base, '.chatdeck', 'os.txt'), os, 'utf8')
                // Le changement d'environnement doit être TOTAL : on retire les
                // fichiers platform/ des AUTRES profils avant d'écrire celui-ci,
                // sinon l'ancien profil (ex. windows) traîne sous mac/linux.
                const otherOses = (['mac', 'windows', 'linux'] as OsProfile[]).filter((o) => o !== os)
                for (const o of otherOses) {
                  for (const p of Object.keys(OS_FILES[o])) {
                    const t = safeResolve(convId, p)
                    if (t && existsSync(t.target)) await rm(t.target, { force: true })
                  }
                }
                // écrit les fichiers du profil s'ils manquent
                for (const [p, content] of Object.entries(OS_FILES[os])) {
                  const t = safeResolve(convId, p)
                  if (t && !existsSync(t.target)) {
                    await mkdir(path.dirname(t.target), { recursive: true })
                    await writeFile(t.target, content, 'utf8')
                  }
                }
                return json(res, 200, { ok: true, os, note: 'profil actif : platform/ purgé des autres OS ; chroot/AES-256 simulés, exécutions bornées par la liste blanche du terminal' })
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
              if (!existsSync(base)) await seedWorkspace(convId)
              runCommand(res, convId, cmd)
              return
            }

            return json(res, 404, { error: 'route inconnue' })
          } catch (e) {
            return json(res, 500, { error: (e as Error).message })
          }
        })()
      })
    },
  }
}

/**
 * Plugin Vite : endpoints /api/deck pour le panneau Skills & Agents du hub.
 *
 *   GET  /api/deck/cards            → liste des fiches .CD (library + ./.cd + ~/.chatdeck)
 *   GET  /api/deck/card?id=…        → contenu complet d'une fiche (frontmatter + corps)
 *   POST /api/deck/cards            → crée une fiche {name, kind, dir?} (équivalent deck cd --new)
 *
 * Lecture seule sur promptdeck/library (artefact généré) ; les créations vont
 * dans ./.cd/skills|agents du projet. Aucune exécution, aucun accès réseau.
 */
export function deckServer(): Plugin {
  type Card = { id: string; kind: 'skill' | 'agent'; source: 'library' | 'project' | 'global'; path: string; description: string }
  const parseFrontmatter = (src: string): { name: string; description: string; kind: string } => {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src)
    const pick = (k: string): string => {
      const v = m?.[1].match(new RegExp(`^${k}:(.*)$`, 'm'))
      return (v?.[1] ?? '').trim().replace(/^["']|["']$/g, '')
    }
    return { name: pick('name'), description: pick('description'), kind: pick('kind') || 'skill' }
  }

  return {
    name: 'chatdeck-deck-server',
    configureServer(server) {
      server.middlewares.use('/api/deck', (req, res) => {
        void (async () => {
          const url = (req.url ?? '').replace(/^\//, '')
          const [pathPart, queryPart] = url.split('?')
          const query = new URLSearchParams(queryPart ?? '')

          try {
            const roots: { dir: string; source: Card['source'] }[] = [
              { dir: path.join(process.cwd(), 'promptdeck', 'library'), source: 'library' },
              { dir: path.join(process.cwd(), '.cd'), source: 'project' },
              { dir: path.join(homedir(), '.chatdeck'), source: 'global' },
            ]

            // Liste des fiches
            if ((pathPart === 'cards' || pathPart === '') && req.method === 'GET') {
              const cards: Card[] = []
              const seen = new Set<string>()
              for (const { dir, source } of roots) {
                for (const kindDir of ['skills', 'agents']) {
                  const full = path.join(dir, kindDir)
                  if (!existsSync(full)) continue
                  for (const f of await readdir(full)) {
                    if (!f.endsWith('.md') && !f.endsWith('.cd')) continue
                    const p = path.join(full, f)
                    try {
                      const fm = parseFrontmatter(await readFile(p, 'utf8'))
                      if (!fm.name || seen.has(fm.name)) continue
                      seen.add(fm.name)
                      cards.push({ id: fm.name, kind: fm.kind === 'agent' ? 'agent' : 'skill', source, path: p, description: fm.description })
                    } catch {
                      /* fiche illisible : ignorée */
                    }
                  }
                }
              }
              cards.sort((a, b) => a.id.localeCompare(b.id))
              return json(res, 200, { cards })
            }

            // Contenu d'une fiche
            if (pathPart === 'card' && req.method === 'GET') {
              const id = query.get('id') ?? ''
              if (!id || /[\\/\0]/.test(id)) return json(res, 400, { error: 'id invalide' })
              for (const { dir, source } of roots) {
                for (const kindDir of ['skills', 'agents']) {
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
              for (const kindDir of ['skills', 'agents']) {
                for (const ext of ['.cd', '.md']) {
                  const p = path.join(process.cwd(), '.cd', kindDir, `${id}${ext}`)
                  if (existsSync(p)) {
                    await writeFile(p, content, 'utf8')
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
              const kind = body.kind === 'agent' ? 'agents' : 'skills'
              const dir = path.join(process.cwd(), '.cd', kind)
              const file = path.join(dir, `${slug}.cd`)
              if (existsSync(file)) return json(res, 409, { error: `existe déjà : .cd/${kind}/${slug}.cd` })
              await mkdir(dir, { recursive: true })
              await writeFile(
                file,
                `---\nname: ${slug}\ndescription: ${body.description ?? 'Décris ici QUAND utiliser cette fiche (déclencheurs concrets).'}\nkind: ${kind === 'agents' ? 'agent' : 'skill'}\ntools: [read, list, bash]\n---\n\n# ${slug}\n\n## Quand\n\n## Procédure\n\n1. \n\n## Vérification\n\n`,
                'utf8',
              )
              return json(res, 200, { ok: true, path: `.cd/${kind}/${slug}.cd` })
            }

            return json(res, 404, { error: 'route deck inconnue' })
          } catch (e) {
            return json(res, 500, { error: (e as Error).message })
          }
        })()
      })
    },
  }
}
