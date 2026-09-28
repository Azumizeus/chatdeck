// Cascade de providers du méga-pack (skill llm-provider-cascade) adaptée à ChatDeck.
// Ordre officiel : omniroute → freellm → groq → cerebras → mistral → cohere →
//                  gemini → openrouter → anthropic.
// Clés résolues comme dans llm-cascade.py : env → auth.json (opencode) →
// keys.local.json (chatdeck, dossier projet OU ~/.chatdeck). Santé cachée 10 min.
// Endpoints — plugin Vite (dev) ET serveur autonome (app packagée) :
//   GET  /api/cascade-check                    → santé de chaque maillon
//   POST /api/cascade {messages, provider?}    → réponse + trace (provider, bascules)
//   POST /api/cascade/stream {messages}        → streaming SSE token par token
//
// Implémentation : `cascadeApiMount(req, res)` branché sur un chemin qui commence
// par /api/cascade — partagé par le plugin Vite ci-dessous et par ChatDeckApi
// (sandbox-server.ts --serve). En packagé, sans ce montage, le fallback SPA
// renvoyait index.html et le panneau Cascade affichait « Unexpected token '<' ».

import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

type CascadeDef = { id: string; base: string; model: string; needsKey: boolean }
type Health = { at: number; up: boolean; ms?: number; key?: string }

const CASCADE: CascadeDef[] = [
  { id: 'omniroute', base: 'http://127.0.0.1:20128/v1/chat/completions', model: 'auto/best-fast', needsKey: false },
  { id: 'freellm', base: 'http://127.0.0.1:8000/v1/chat/completions', model: 'auto', needsKey: false },
  { id: 'groq', base: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-20b', needsKey: true },
  { id: 'cerebras', base: 'https://api.cerebras.ai/v1/chat/completions', model: 'gpt-oss-120b', needsKey: true },
  { id: 'mistral', base: 'https://api.mistral.ai/v1/chat/completions', model: 'mistral-small-latest', needsKey: true },
  { id: 'cohere', base: 'https://api.cohere.com/compatibility/v1/chat/completions', model: 'command-r-plus-08-2024', needsKey: true },
  { id: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-flash-latest', needsKey: true },
  { id: 'openrouter', base: 'https://openrouter.ai/api/v1/chat/completions', model: 'meta-llama/llama-3.3-70b-instruct', needsKey: true },
  { id: 'anthropic', base: 'https://api.anthropic.com/v1/messages', model: 'claude-haiku-4-20250514', needsKey: true },
]

const ENV_KEYS: Record<string, string[]> = {
  groq: ['GROQ_API_KEY'],
  cerebras: ['CEREBRAS_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  cohere: ['COHERE_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  freellm: ['FREELLMAPI_API_KEY'],
}

const AUTH_ALIASES: Record<string, string[]> = {
  freellm: ['freellm', 'freellmapi'],
  mistral: ['mistral', 'mistral-direct'],
  cerebras: ['cerebras', 'cerebras-direct'],
  cohere: ['cohere', 'cohere-direct'],
  gemini: ['gemini', 'google', 'google-direct'],
  groq: ['groq'],
  openrouter: ['openrouter'],
  anthropic: ['anthropic'],
  omniroute: ['omniroute'],
}

/** Dossiers candidats pour keys.local.json : dossier projet (dev) puis ~/.chatdeck (packagé). */
function keysLocalCandidates(): string[] {
  return [path.join(process.cwd(), 'keys.local.json'), path.join(homedir(), '.chatdeck', 'keys.local.json')]
}

/** Résolution de clé : env → auth.json d'opencode → keys.local.json (chatdeck). */
function resolveKey(id: string): string | null {
  for (const n of ENV_KEYS[id] ?? []) {
    const v = process.env[n]
    if (v) return v
  }
  try {
    const auth = JSON.parse(readFileSync(path.join(homedir(), '.local/share/opencode/auth.json'), 'utf8')) as Record<string, { key?: string; api_key?: string }>
    for (const n of AUTH_ALIASES[id] ?? []) {
      const k = auth[n]?.key || auth[n]?.api_key
      if (k) return k
    }
  } catch { /* auth.json absent */ }
  for (const f of keysLocalCandidates()) {
    if (!existsSync(f)) continue
    try {
      const kl = JSON.parse(readFileSync(f, 'utf8')) as Record<string, string>
      const hit = kl[`${id}-direct`] ?? kl[id]
      if (hit) return hit
    } catch { /* fichier suivant */ }
  }
  return null
}

type Msg = { role: 'system' | 'user' | 'assistant'; content: string }

const json = (res: ServerResponse, code: number, body: unknown): void => {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** Une tentative : renvoie le texte si OK, sinon lève avec le code HTTP. */
async function attempt(def: CascadeDef, key: string | null, messages: Msg[]): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key) {
    if (def.id === 'anthropic') {
      headers['x-api-key'] = key
      headers['anthropic-version'] = '2023-06-01'
    } else {
      headers.Authorization = `Bearer ${key}`
    }
  }
  const body =
    def.id === 'anthropic'
      ? { model: def.model, max_tokens: 2048, messages: messages.filter((m) => m.role !== 'system') }
      : { model: def.model, messages, max_tokens: 2048, stream: false }
  const r = await fetch(def.base, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j = (await r.json()) as Record<string, unknown>
  if (def.id === 'anthropic') {
    const blocks = j.content as { type: string; text?: string }[] | undefined
    return (blocks ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('') || ''
  }
  const choices = j.choices as { message?: { content?: string } }[] | undefined
  return choices?.[0]?.message?.content ?? ''
}

/** Cascade complète : renvoie la réponse + la trace. */
async function cascade(messages: Msg[], start?: string): Promise<{ text: string; provider: string; latencyMs: number; switches: string[]; attempts: { id: string; error: string }[] }> {
  const t0 = Date.now()
  let order = CASCADE
  if (start) {
    const i = CASCADE.findIndex((c) => c.id === start)
    if (i > 0) order = [CASCADE[i], ...CASCADE.filter((_, k) => k !== i)]
  }
  const attempts: { id: string; error: string }[] = []
  for (const def of order) {
    const key = def.needsKey ? resolveKey(def.id) : null
    if (def.needsKey && !key) {
      attempts.push({ id: def.id, error: 'pas de clé' })
      continue
    }
    try {
      const text = await attempt(def, key, messages)
      if (text.trim()) return { text, provider: def.id, latencyMs: Date.now() - t0, switches: attempts.map((a) => a.id), attempts }
      attempts.push({ id: def.id, error: 'réponse vide' })
    } catch (e) {
      attempts.push({ id: def.id, error: (e as Error).message })
    }
  }
  throw new Error(`aucun provider n'a répondu : ${attempts.map((a) => `${a.id}(${a.error})`).join(', ')}`)
}

/** Streaming SSE : essaie chaque maillon ; le premier qui répond OK streame. */
async function cascadeStream(messages: Msg[], res: ServerResponse, start?: string): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Connection', 'keep-alive')
  let order = CASCADE
  if (start) {
    const i = CASCADE.findIndex((c) => c.id === start)
    if (i > 0) order = [CASCADE[i], ...CASCADE.filter((_, k) => k !== i)]
  }
  for (const def of order) {
    const key = def.needsKey ? resolveKey(def.id) : null
    if (def.needsKey && !key) continue
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' }
      if (key) headers.Authorization = `Bearer ${key}`
      const up = await fetch(def.base, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: def.model, messages, max_tokens: 2048, stream: true }),
        signal: AbortSignal.timeout(120_000),
      })
      if (!up.ok || !up.body) throw new Error(`HTTP ${up.status}`)
      res.write(`event: meta\ndata: ${JSON.stringify({ provider: def.id })}\n\n`)
      const reader = up.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') {
            res.write('data: [DONE]\n\n')
            res.end()
            return
          }
          try {
            const j = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
            const delta = j.choices?.[0]?.delta?.content
            if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`)
          } catch { /* ligne partielle */ }
        }
      }
      res.write('data: [DONE]\n\n')
      res.end()
      return
    } catch { /* maillon suivant */ }
  }
  res.write(`event: error\ndata: ${JSON.stringify({ error: 'aucun provider disponible' })}\n\n`)
  res.end()
}

const healthCache = new Map<string, Health>()
const HEALTH_TTL = 600_000 // 10 min

/** GET /api/cascade-check : santé de chaque maillon (cache 10 min). */
async function cascadeCheckApi(res: ServerResponse): Promise<void> {
  const now = Date.now()
  const entries = await Promise.all(
    CASCADE.map(async (def) => {
      const hit = healthCache.get(def.id)
      if (hit && now - hit.at < HEALTH_TTL) return [def.id, hit] as const
      const t0 = Date.now()
      let up = false
      const key = def.needsKey ? resolveKey(def.id) : null
      try {
        const headers: Record<string, string> = {}
        if (key) headers.Authorization = `Bearer ${key}`
        const base = def.base.replace(/\/chat\/completions$/, '/models')
        const r = await fetch(base, { headers, signal: AbortSignal.timeout(8000) })
        up = r.status < 500
      } catch { up = false }
      const h: Health = { at: now, up, ms: Date.now() - t0, key: key ? 'oui' : def.needsKey ? 'non' : 'n/a' }
      healthCache.set(def.id, h)
      return [def.id, h] as const
    }),
  )
  json(res, 200, { providers: Object.fromEntries(entries) })
}

/* ─────────── Montage partagé (plugin Vite + serveur autonome) ─────────── */

/**
 * Branche req.url (chemin contenant /api/cascade…) vers le bon endpoint.
 * Appelé par le plugin Vite (req.url relatif au mount, ex. '' ou '/stream')
 * et par ChatDeckApi (req.url complet, ex. '/api/cascade-check').
 */
export function cascadeApiMount(req: IncomingMessage, res: ServerResponse): void {
  void (async () => {
    const p = (req.url ?? '/').split('?')[0] ?? '/'
    const isCheck = p.includes('cascade-check')
    const isStream = p.endsWith('/stream')
    const isRoot = !isCheck && !isStream && (p === '' || p === '/' || /cascade$/.test(p))
    try {
      if (req.method === 'GET' && (isCheck || isRoot)) {
        // GET /api/cascade ≡ health-check (commodité)
        return await cascadeCheckApi(res)
      }
      if (req.method === 'POST' && isCheck) return await cascadeCheckApi(res)
      const body = JSON.parse(await readBody(req)) as { messages?: Msg[]; provider?: string }
      const messages = body.messages ?? []
      if (!messages.length) return json(res, 400, { error: 'messages requis' })
      if (req.method === 'POST' && isStream) return await cascadeStream(messages, res, body.provider)
      if (req.method === 'POST') return json(res, 200, await cascade(messages, body.provider))
      return json(res, 405, { error: `méthode ${req.method} non supportée` })
    } catch (e) {
      return json(res, 502, { error: (e as Error).message })
    }
  })()
}

/** Plugin Vite (dev) : mêmes handlers que le serveur autonome. */
export function cascadeServer(): Plugin {
  return {
    name: 'chatdeck-cascade-server',
    configureServer(server) {
      server.middlewares.use('/api/cascade-check', (_req, res) => {
        void cascadeCheckApi(res)
      })
      server.middlewares.use('/api/cascade', (req, res) => cascadeApiMount(req, res))
    },
  }
}
