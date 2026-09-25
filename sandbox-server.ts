// Serveur de sandbox ChatDeck — un /workspace réel par conversation sur le disque.
//
// Racine : ~/.chatdeck/workspaces/<conversation-id>/
// Le navigateur n'y accède QUE via les endpoints /api/sandbox (plugin Vite, dev) :
//   GET    /api/sandbox/status                  → racine, N workspaces, tailles
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
const MAX_FILE_BYTES = 1_000_000
const MAX_TREE_ENTRIES = 500
const MAX_RUN_OUTPUT = 200_000
const RUN_TIMEOUT_MS = 60_000
const CONV_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i

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

/** Crée le workspace + fichiers d'amorçage (sans écraser l'existant). */
async function seedWorkspace(convId: string): Promise<number> {
  const g = safeResolve(convId, '')
  if (!g) throw new Error('id de conversation invalide')
  await mkdir(path.join(g.base, 'src'), { recursive: true })
  let written = 0
  for (const [p, content] of Object.entries(SEED_FILES)) {
    const t = safeResolve(convId, p)
    if (!t) continue
    if (!existsSync(t.target)) {
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

            // bootstrap : crée le workspace + fichiers d'amorçage (sans écraser)
            if (action === 'bootstrap' && req.method === 'POST') {
              const created = await seedWorkspace(convId)
              return json(res, 200, { ok: true, created, root: base })
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
