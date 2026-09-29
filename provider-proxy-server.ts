// Proxy fournisseurs intégrés (openrouter/nvidia/cohere/mistral) — partagé
// plugin Vite (dev) + serveur autonome (app packagée).
//
// BUG corrigé (0.4.9) : en dev, `server.proxy` de Vite proxifiait /api/openrouter
// vers https://openrouter.ai ; mais ce mécanisme n'existe pas dans l'api-server
// autonome de l'app packagée → le POST tombait sur le fallback SPA (index HTML),
// lu comme du SSE sans aucun `data:` → « OpenRouter : réponse vide (modèle
// saturé ou indisponible ?) ». Même mécanique que customProxy() : re-émission
// fetch (SSE inclus, duplex half).
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

const TARGETS: Record<string, string> = {
  openrouter: 'https://openrouter.ai',
  nvidia: 'https://integrate.api.nvidia.com',
  cohere: 'https://api.cohere.ai',
  mistral: 'https://api.mistral.ai',
}

/**
 * Branche une req dont l'URL commence par /api/<fournisseur> vers la cible.
 * Appelé par le plugin Vite (req.url relatif : /openrouter/…) et par
 * ChatDeckApi (req.url complet : /api/openrouter/…). SSE/streams inclus.
 */
export function providerProxyMount(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? ''
  const m = url.match(/^\/?(api\/)?([a-z]+)(\/.*)$/)
  if (!m) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'proxy fournisseurs : chemin inconnu' }))
    return
  }
  const [, , id, rest] = m
  const target = TARGETS[id]
  if (!target) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: `fournisseur « ${id} » inconnu du proxy` }))
    return
  }
  const headers = { ...req.headers }
  delete headers.host
  delete headers.connection
  const body: Uint8Array[] = []
  req.on('data', (c: Uint8Array) => body.push(c))
  req.on('end', () => {
    fetch(target + rest, {
      method: req.method,
      headers: headers as Record<string, string>,
      body: body.length ? Buffer.concat(body) : undefined,
      duplex: 'half', // requis par undici pour les requêtes streamées
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
      .catch((e: Error) => {
        res.statusCode = 502
        res.end(JSON.stringify({ error: `Proxy ${id} : ${e.message}` }))
      })
  })
}

/** Plugin Vite (dev) : remplace server.proxy pour les 4 fournisseurs intégrés. */
export function providerProxyServer(): Plugin {
  return {
    name: 'chatdeck-provider-proxy',
    configureServer(server) {
      server.middlewares.use('/api', (req, res, next) => {
        const url = req.url ?? ''
        const id = url.split('/')[1]
        if (!id || !TARGETS[id]) return next()
        // req.url est relatif au mount /api → /openrouter/…
        return providerProxyMount(req, res)
      })
    },
  }
}
