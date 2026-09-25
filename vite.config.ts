import { defineConfig, type Plugin } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sandboxServer } from './sandbox-server'

const root = fileURLToPath(new URL('.', import.meta.url))

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

/** Proxy par fournisseur : le navigateur ne parle qu'à localhost → aucun souci CORS, SSE inclus. */
const apiProxy = (target: string) => ({
  target,
  changeOrigin: true,
  rewrite: (p: string) => p.replace(/^\/api\/[a-z]+/, ''),
})

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

export default defineConfig({
  plugins: [svelte(), localKeys(), customProxy(), sandboxServer()],
  server: {
    port: 5199,
    strictPort: true,
    proxy: {
      '/api/openrouter': apiProxy('https://openrouter.ai'),
      '/api/nvidia': apiProxy('https://integrate.api.nvidia.com'),
      '/api/cohere': apiProxy('https://api.cohere.ai'),
      '/api/mistral': apiProxy('https://api.mistral.ai'),
    },
  },
  // Vitest : environnement DOM léger pour les tests du store (localStorage)
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
})
