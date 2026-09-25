// Serveur de sandbox ChatDeck — un /workspace réel par conversation sur le disque.
//
// Racine : ~/.chatdeck/workspaces/<conversation-id>/
// Le navigateur n'y accède QUE via les endpoints /api/sandbox (plugin Vite, dev) :
//   GET  /api/sandbox/status                  → racine + nombre de workspaces
//   POST /api/sandbox/:convId/bootstrap       → crée le workspace + fichiers d'amorçage
//   GET  /api/sandbox/:convId/tree            → arborescence JSON
//   GET  /api/sandbox/:convId/file?path=…     → contenu d'un fichier (cap 1 Mo)
//   PUT  /api/sandbox/:convId/file            → écrit {path, content}
//   POST /api/sandbox/:convId/mkdir           → crée {path}
//   DELETE /api/sandbox/:convId/file?path=…   → supprime fichier ou dossier vide
//   GET  /api/sandbox/:convId/exec?cmd=…      → commandes en liste blanche (ls, cat, …)
//
// Sécurité : ids stricts ([a-z0-9_-]), chemins résolus et confinés au workspace,
// taille de fichier plafonnée, commandes en liste blanche, rien en dehors de la racine.

import type { Plugin } from 'vite'
import { mkdir, readdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const WORKSPACES_ROOT = path.join(homedir(), '.chatdeck', 'workspaces')
const MAX_FILE_BYTES = 1_000_000
const MAX_TREE_ENTRIES = 500
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
    entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
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
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    return { out: await promisify(execFile)('node', ['--version']).then((x) => x.stdout.trim()) }
  }
  if (trimmed === 'npm -v' || trimmed === 'npm --version') {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    return { out: await promisify(execFile)('npm', ['--version']).then((x) => x.stdout.trim()) }
  }
  if (/^(git (status|log|diff)|npm (test|run .+)|node src\/.+)\b/.test(trimmed)) {
    throw new Error(`« ${trimmed} » est volontairement désactivé dans la sandbox (lecture seule).`)
  }
  throw new Error('Commande non autorisée. Autorisées : ls [chemin], cat <fichier>, pwd, node -v, npm -v')
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
            if (!convId) {
              // /api/sandbox/status
              if (req.method === 'GET') {
                const dirs = existsSync(WORKSPACES_ROOT)
                  ? (await readdir(WORKSPACES_ROOT, { withFileTypes: true })).filter((d) => d.isDirectory())
                  : []
                return json(res, 200, { root: WORKSPACES_ROOT, count: dirs.length })
              }
              return json(res, 404, { error: 'route inconnue' })
            }

            const guard = safeResolve(convId, '')
            if (!guard) return json(res, 400, { error: 'id de conversation invalide' })
            const { base } = guard

            // bootstrap : crée le workspace + fichiers d'amorçage (sans écraser)
            if (action === 'bootstrap' && req.method === 'POST') {
              await mkdir(path.join(base, 'src'), { recursive: true })
              let written = 0
              for (const [p, content] of Object.entries(SEED_FILES)) {
                const t = safeResolve(convId, p)
                if (!t) continue
                if (!existsSync(t.target)) {
                  await writeFile(t.target, content, 'utf8')
                  written++
                }
              }
              return json(res, 200, { ok: true, created: written, root: base })
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

            // exec : commandes en liste blanche
            if (action === 'exec' && req.method === 'GET') {
              const cmd = query.get('cmd') ?? ''
              try {
                return json(res, 200, await sandboxExec(convId, cmd))
              } catch (e) {
                return json(res, 400, { error: (e as Error).message })
              }
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
