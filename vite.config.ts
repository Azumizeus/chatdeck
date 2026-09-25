import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

export default defineConfig({
  plugins: [svelte(), localKeys()],
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
})
