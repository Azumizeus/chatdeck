// Fournisseurs LLM — tous exposent une API compatible OpenAI (chat/completions + stream).

import type { CustomProvider } from './store'

/** Identifiant de fournisseur : les 4 intégrés, ou « custom:xyz » pour les fournisseurs personnalisés. */
export type ProviderId = 'openrouter' | 'nvidia' | 'cohere' | 'mistral' | (string & {})

export interface ModelInfo {
  id: string
  label: string
}

export interface Provider {
  id: ProviderId
  label: string
  /** Chemin local proxifié par Vite en dev (zéro CORS). */
  base: string
  /** Base API chez le fournisseur (ajoutée après le préfixe proxifié). */
  path: string
  docs: string
  models: ModelInfo[]
  /** Couleur de pastille (CSS) */
  color: string
  custom?: false
}

/** Vue normalisée d'un fournisseur personnalisé. */
export interface CustomProviderView extends Omit<Provider, 'custom'> {
  custom: true
  provider: CustomProvider
}

export const PROVIDERS: Provider[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    base: '/api/openrouter',
    path: '/api/v1',
    docs: '458 modèles — GPT, Claude, Llama, Grok…',
    color: '#4f8cff',
    models: [
      { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini (rapide)' },
      { id: 'openai/gpt-4.1', label: 'GPT-4.1' },
      { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
    ],
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    base: '/api/nvidia',
    path: '/v1',
    docs: 'Nemotron en direct (lightning parfois saturé)',
    color: '#76b900',
    models: [
      { id: 'nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super 120B' },
      { id: 'nvidia/nemotron-3.5-lightning-30b-a3b', label: 'Nemotron 3.5 Lightning 30B' },
    ],
  },
  {
    id: 'cohere',
    label: 'Cohere',
    base: '/api/cohere',
    path: '/compatibility/v1',
    docs: 'Command A / R+ (rapide, validé <2 s)',
    color: '#d18ee2',
    models: [
      { id: 'command-a-03-2025', label: 'Command A' },
      { id: 'command-r-plus-08-2024', label: 'Command R+' },
    ],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    base: '/api/mistral',
    path: '/v1',
    docs: 'Souvent en rate limit sur ta clé (429)',
    color: '#ff7000',
    models: [
      { id: 'mistral-large-latest', label: 'Mistral Large' },
      { id: 'codestral-latest', label: 'Codestral' },
    ],
  },
]

export function isCustom(pid: ProviderId | undefined): boolean {
  return typeof pid === 'string' && pid.startsWith('custom:')
}

export function customView(p: CustomProvider): CustomProviderView {
  return {
    id: p.id,
    label: p.name,
    base: `/api/custom/${p.id}`,
    path: '',
    docs: p.baseUrl,
    color: '#7c5cff',
    models: p.models.map((m) => ({ id: m.id, label: m.label || m.id })),
    custom: true,
    provider: p,
  }
}

/** Registre combiné : fournisseurs intégrés + personnalisés. */
export function allProviders(customs: CustomProvider[]): (Provider | CustomProviderView)[] {
  return [...PROVIDERS, ...customs.map(customView)]
}

export function providerOf(id: ProviderId, customs: CustomProvider[] = []): Provider | CustomProviderView {
  const c = customs.find((x) => x.id === id)
  if (c) return customView(c)
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]
}

export function findModel(pid: ProviderId, modelId: string, customs: CustomProvider[] = []): ModelInfo {
  const p = providerOf(pid, customs)
  return p.models.find((m) => m.id === modelId) ?? { id: modelId, label: modelId }
}

export interface ChatMsg {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/** Appel d'outil au format wire OpenAI (accumulé pendant le stream). */
export interface ToolCallOut {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** Message au format wire : texte, ou tool_calls / résultat d'outil. */
export interface WireMsg {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | null
  tool_calls?: ToolCallOut[]
  tool_call_id?: string
}

export interface StreamOpts {
  providerId: ProviderId
  apiKey: string
  model: string
  messages: WireMsg[]
  temperature: number
  maxTokens: number
  signal: AbortSignal
  onDelta: (text: string) => void
  /** Usage réel renvoyé par l'API (chunk final, si disponible) */
  onUsage?: (usage: { prompt: number; completion: number }) => void
  /** Outils exposés au modèle (function calling) — déclenche onToolCalls au lieu de terminer */
  tools?: { type: 'function'; function: { name: string; description: string; parameters: unknown } }[]
  /** Appelé quand le modèle demande des outils (finish_reason = tool_calls) */
  onToolCalls?: (calls: { id: string; name: string; args: Record<string, unknown> }[]) => void
  /** Fournisseurs personnalisés (pour résoudre base/path) */
  customs?: CustomProvider[]
}

/** Lance un chat en streaming. Renvoie le texte complet. Lève une Error lisible sinon. */
export async function streamChat(opts: StreamOpts): Promise<string> {
  const p = providerOf(opts.providerId, opts.customs)
  let res: Response
  try {
    res = await fetch(`${p.base}${p.path}/chat/completions`, {
      method: 'POST',
      signal: opts.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
        // OpenRouter apprécie, les autres ignorent :
        'HTTP-Referer': 'http://localhost:5199',
        'X-Title': 'ChatDeck',
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        stream: true,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        // OpenRouter inclut l'usage réel dans le chunk final quand on le demande
        ...(opts.providerId === 'openrouter' ? { stream_options: { include_usage: true } } : {}),
        ...(opts.tools?.length ? { tools: opts.tools } : {}),
      }),
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new Error(`Réseau injoignable (${p.label})`)
  }

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '')
    let detail = body.slice(0, 300)
    try {
      const j = JSON.parse(body)
      detail = j.error?.message ?? j.detail ?? detail
    } catch {
      /* texte brut */
    }
    if (res.status === 401) throw new Error(`Clé API refusée par ${p.label}`)
    if (res.status === 429) throw new Error(`${p.label} : rate limit (429) — réessaie plus tard`)
    throw new Error(`${p.label} [${res.status}] : ${detail}`)
  }

  // Lecture SSE ligne par ligne
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let full = ''
  // Accumulation des tool_calls (les fragments arrivent indexés, arguments en morceaux)
  const toolAcc = new Map<number, { id: string; name: string; args: string }>()
  let finishReason: string | null = null
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const j = JSON.parse(data)
        const choice = j.choices?.[0]
        const delta: string | undefined = choice?.delta?.content
        if (delta) {
          full += delta
          opts.onDelta(delta)
        }
        const tcs = choice?.delta?.tool_calls as
          | { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
          | undefined
        if (Array.isArray(tcs)) {
          for (const tc of tcs) {
            const ix = Number(tc.index ?? 0)
            const cur = toolAcc.get(ix) ?? { id: '', name: '', args: '' }
            if (tc.id) cur.id = tc.id
            if (tc.function?.name) cur.name = tc.function.name
            if (tc.function?.arguments) cur.args += tc.function.arguments
            toolAcc.set(ix, cur)
          }
        }
        if (choice?.finish_reason) finishReason = String(choice.finish_reason)
        const u = (j.usage ?? choice?.usage) as
          | { prompt_tokens?: unknown; completion_tokens?: unknown }
          | undefined
        if (u && opts.onUsage) {
          const prompt = Number(u.prompt_tokens)
          const completion = Number(u.completion_tokens)
          if (Number.isFinite(prompt) && Number.isFinite(completion))
            opts.onUsage({ prompt, completion })
        }
        const err = j.error?.message
        if (err) throw new Error(`${p.label} : ${err}`)
      } catch (e) {
        if (e instanceof SyntaxError) continue // fragment JSON partiel : on ignore
        throw e
      }
    }
  }
  // Le modèle demande des outils : on livre les appels assemblés au lieu de terminer
  if (finishReason === 'tool_calls' && toolAcc.size && opts.onToolCalls) {
    const calls = [...toolAcc.values()].map((c) => {
      let args: Record<string, unknown> = {}
      try {
        args = c.args ? (JSON.parse(c.args) as Record<string, unknown>) : {}
      } catch {
        args = { _raw: c.args }
      }
      return { id: c.id, name: c.name, args }
    })
    opts.onToolCalls(calls)
    return full
  }
  if (!full.trim() && !opts.signal.aborted) {
    throw new Error(`${p.label} : réponse vide (modèle saturé ou indisponible ?)`)
  }
  return full
}

/** Prix d'un modèle via le catalogue OpenRouter en cache (null si inconnu). */
export function priceLookup(modelId: string): ModelPrice | null {
  const m = catalogCache?.models.find((x) => x.id === modelId)
  if (!m || m.promptPrice === undefined || m.completionPrice === undefined) return null
  return { prompt: m.promptPrice, completion: m.completionPrice }
}

/* ---------- catalogue OpenRouter (458 modèles) ---------- */

export interface CatalogModel {
  id: string
  label: string
  context?: number
  /** Prix USD par token (OpenRouter) */
  promptPrice?: number
  completionPrice?: number
}

/** Prix USD par token d'un modèle. */
export interface ModelPrice {
  prompt: number
  completion: number
}

interface OpenRouterModelRaw {
  id?: unknown
  name?: unknown
  context_length?: unknown
  pricing?: { prompt?: unknown; completion?: unknown }
}

/**
 * Récupère le catalogue complet d'OpenRouter (proxifié). Repli : liste courte intégrée.
 * Cache module-level 10 min pour éviter de re-télécharger 458 modèles à chaque focus.
 */
let catalogCache: { at: number; models: CatalogModel[] } | null = null

export async function fetchOpenRouterCatalog(): Promise<CatalogModel[]> {
  if (catalogCache && Date.now() - catalogCache.at < 10 * 60_000) return catalogCache.models
  try {
    const r = await fetch('/api/openrouter/api/v1/models')
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = (await r.json()) as { data?: OpenRouterModelRaw[] }
    const models: CatalogModel[] = (j.data ?? [])
      .filter((m): m is OpenRouterModelRaw & { id: string } => typeof m?.id === 'string')
      .map((m) => {
        const promptPrice = Number(m.pricing?.prompt)
        const completionPrice = Number(m.pricing?.completion)
        return {
          id: m.id,
          label: typeof m.name === 'string' && m.name ? m.name : m.id,
          context: typeof m.context_length === 'number' ? m.context_length : undefined,
          promptPrice: Number.isFinite(promptPrice) && promptPrice >= 0 ? promptPrice : undefined,
          completionPrice: Number.isFinite(completionPrice) && completionPrice >= 0 ? completionPrice : undefined,
        }
      })
      .sort((a, b) => a.id.localeCompare(b.id))
    if (!models.length) throw new Error('catalogue vide')
    catalogCache = { at: Date.now(), models }
    return models
  } catch {
    // Repli : la liste courte intégrée
    return PROVIDERS[0].models.map((m) => ({ id: m.id, label: m.label }))
  }
}
