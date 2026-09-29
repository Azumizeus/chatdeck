import { defineConfig, type Plugin } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sandboxServer, deckServer } from './sandbox-server'
import { providerProxyServer } from './provider-proxy-server'
import { cascadeServer } from './cascade-server'

const root = fileURLToPath(new URL('.', import.meta.url))

/** Cibles des 4 fournisseurs intégrés (sonde health + proxy partagé). */
const PROVIDER_TARGETS: Record<string, string> = {
  openrouter: 'https://openrouter.ai',
  nvidia: 'https://integrate.api.nvidia.com',
  cohere: 'https://api.cohere.ai',
  mistral: 'https://api.mistral.ai',
}

/** Sert keys.local.json en dev (gitignore) pour précharger les clés — jamais bundlé. */
function localKeys(): Plugin {
  return {
    name: 'chatdeck-local-keys',
    configureServer(server) {
      server.middlewares.use('/keys.local', (_req, res) => {
        try {
          const raw = readFileSync(resolve(root, 'keys.local.json'), 'utf8')
          res.setHeader('Content-Type', 'application/json')
          res.end(raw)
        } catch {
          res.statusCode = 404
          res.end('{}')
        }
      })
    },
  }
}


/**
 * /api/health : état réseau de l'app + des 4 fournisseurs (HEAD/GET courts, 5 s max).
 * Répond vite même si un fournisseur est hors ligne — chaque test a son propre timeout.
 */
function healthEndpoint(): Plugin {
  type Health = { up: boolean; status?: number; ms: number; error?: string }
  const cache = new Map<string, { at: number; data: Health }>()
  const TTL = 10_000
  const probe = async (url: string): Promise<Health> => {
    const attempt = async (): Promise<Health> => {
      const t0 = Date.now()
      try {
        const r = await fetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
          headers: { 'user-agent': 'chatdeck-health' },
        })
        return { up: r.status < 500, status: r.status, ms: Date.now() - t0 }
      } catch (e) {
        return { up: false, ms: Date.now() - t0, error: (e as Error).name === 'TimeoutError' ? 'timeout' : (e as Error).message }
      }
    }
    // Anti-clignotement : la PREMIÈRE sonde après un boot échoue souvent en
    // timeout (cold start DNS/TLS du process, ~8 s) alors que le réseau va
    // bien — on retente immédiatement un timeout pour ne pas empoisonner le
    // cache 10 s avec un « up:false » faux (boucle « aucun provider »).
    const first = await attempt()
    if (first.up || first.error !== 'timeout') return first
    const second = await attempt()
    return { ...second, ms: (first.ms ?? 0) + (second.ms ?? 0) }
  }
  return {
    name: 'chatdeck-health',
    configureServer(server) {
      server.middlewares.use('/api/health', (_req, res) => {
        void (async () => {
          const now = Date.now()
          const entries = await Promise.all(
            Object.entries(PROVIDER_TARGETS).map(async ([id, base]) => {
              const hit = cache.get(id)
              let data: Health
              if (hit && now - hit.at < TTL) data = hit.data
              else {
                data = await probe(`${base}/api/v1/models`)
                cache.set(id, { at: now, data })
              }
              return [id, data] as const
            }),
          )
          const providers = Object.fromEntries(entries)
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(
            JSON.stringify({
              ok: true,
              server: true,
              providers,
              allUp: Object.values(providers).every((p) => p.up),
            }),
          )
        })().catch((e) => {
          res.statusCode = 500
          res.end(JSON.stringify({ ok: false, error: (e as Error).message }))
        })
      })
    },
  }
}

/**
 * Proxy générique des fournisseurs personnalisés : /api/custom/<id>/<chemin> est
 * redirigé vers la base URL enregistrée par l'utilisateur (custom-providers.local.json
 * ou localStorage dupliqué dans le fichier). SSE inclus.
 */
function customProxy(): Plugin {
  type CustomDef = { id: string; baseUrl: string }
  let customs: CustomDef[] = []
  try {
    customs = JSON.parse(readFileSync(resolve(root, 'custom-providers.local.json'), 'utf8')) as CustomDef[]
  } catch {
    customs = []
  }
  return {
    name: 'chatdeck-custom-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        const m = url.match(/^\/api\/custom\/([^/]+)(\/.*)$/)
        if (!m) return next()
        const [, id, rest] = m
        const def = customs.find((c) => c.id === id)
        if (!def) {
          res.statusCode = 404
          res.end(`Fournisseur custom « ${id} » inconnu du proxy (custom-providers.local.json)`)
          return
        }
        // Re-émet la requête vers le fournisseur (fetch Node, SSE inclus)
        const target = def.baseUrl.replace(/\/$/, '') + rest
        const headers = { ...req.headers }
        delete headers.host
        delete headers.connection
        const body: Uint8Array[] = []
        req.on('data', (c: Uint8Array) => body.push(c))
        req.on('end', () => {
          fetch(target, {
            method: req.method,
            headers: headers as Record<string, string>,
            body: body.length ? Buffer.concat(body) : undefined,
            duplex: 'half', // flux en half-duplex (requis par undici pour les requêtes streamées)
          } as RequestInit & { duplex?: string })
            .then((up) => {
              res.statusCode = up.status
              up.headers.forEach((v, k) => {
                if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(k.toLowerCase()))
                  res.setHeader(k, v)
              })
              if (!up.body) {
                res.end()
                return
              }
              const reader = up.body.getReader()
              const pump = (): void => {
                reader
                  .read()
                  .then(({ done, value }) => {
                    if (done) res.end()
                    else {
                      res.write(value)
                      pump()
                    }
                  })
                  .catch(() => res.end())
              }
              pump()
            })
            .catch((e) => {
              res.statusCode = 502
              res.end(`Proxy custom : ${e.message}`)
            })
        })
      })
    },
  }
}

/**
 * Passerelle connecteurs (façon MCP) : POST /api/connector/{nom} {path} est
 * transmis vers la base URL du connecteur déclaré (localStorage dupliqué dans
 * custom-connectors.local.json, gitigné). La clé d'auth reste sur la machine ;
 * seules http(s) et un host explicite sont autorisés (pas de localhost).
 */
function connectorGateway(): Plugin {
  type Connector = { name: string; baseUrl: string; keyHeader?: string; key?: string; enabled?: boolean }
  let connectors: Connector[] = []
  try {
    connectors = JSON.parse(readFileSync(resolve(root, 'custom-connectors.local.json'), 'utf8')) as Connector[]
  } catch {
    connectors = []
  }
  return {
    name: 'chatdeck-connector-gateway',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        const m = url.match(/^\/api\/connector\/([^/]+)(\/.*)?$/)
        if (!m) return next()
        const name = decodeURIComponent(m[1])
        const rest = m[2] ?? '/'
        const def = connectors.find((c) => c.name === name && c.enabled !== false)
        if (!def) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: `connecteur « ${name} » inconnu ou désactivé (custom-connectors.local.json)` }))
          return
        }
        if (!/^https?:\/\//.test(def.baseUrl)) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'baseUrl http(s) requise' }))
          return
        }
        const target = def.baseUrl.replace(/\/$/, '') + rest
        const headers: Record<string, string> = { accept: 'application/json, text/*;q=0.9' }
        if (def.keyHeader && def.key) {
          headers[def.keyHeader] = def.keyHeader.toLowerCase() === 'authorization' ? `Bearer ${def.key}` : def.key
        }
        const chunks: Uint8Array[] = []
        req.on('data', (c: Uint8Array) => chunks.push(c))
        req.on('end', () => {
          const body = Buffer.concat(chunks)
          fetch(target, {
            method: req.method === 'POST' ? 'POST' : 'GET',
            headers,
            body: req.method === 'POST' && body.length ? body : undefined,
            signal: AbortSignal.timeout(20_000),
          })
            .then(async (up) => {
              res.statusCode = up.status
              res.setHeader('Content-Type', up.headers.get('content-type') ?? 'application/json; charset=utf-8')
              const text = (await up.text()).slice(0, 400_000)
              res.end(text)
            })
            .catch((e) => {
              res.statusCode = 502
              res.end(JSON.stringify({ error: `connecteur « ${name} » : ${e.message}` }))
            })
        })
      })
    },
  }
}

export default defineConfig({
  // providerProxyServer remplace server.proxy (0.4.9) : MÊME mécanique dans le
  // serveur autonome de l'app packagée (sinon « réponse vide » au chat).
  plugins: [svelte(), localKeys(), customProxy(), connectorGateway(), providerProxyServer(), sandboxServer(), deckServer(), cascadeServer(), healthEndpoint()],
  server: {
    port: 5199,
    strictPort: true,
  },
  // Vitest : environnement DOM léger pour les tests du store (localStorage)
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
})
