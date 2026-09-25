import { describe, expect, it, vi, afterEach } from 'vitest'
import { streamChat, providerOf, findModel, PROVIDERS } from './llm'

/** Fabrique une Response avec un body en streaming texte. */
function sseResponse(chunks: string[], init?: ResponseInit): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder()
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' }, ...init })
}

/** Renvoie les deltas reçus, en mockant fetch pour servir `res`. */
async function collect(res: Response, opts: Partial<Parameters<typeof streamChat>[0]> = {}) {
  const deltas: string[] = []
  const fetchMock = vi.fn().mockResolvedValue(res)
  vi.stubGlobal('fetch', fetchMock)
  try {
    const full = await streamChat({
      providerId: 'openrouter',
      apiKey: 'k',
      model: 'm',
      messages: [{ role: 'user', content: 'salut' }],
      temperature: 0.7,
      maxTokens: 128,
      signal: new AbortController().signal,
      onDelta: (d) => deltas.push(d),
      ...opts,
    })
    return { full, deltas }
  } finally {
    vi.unstubAllGlobals()
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const delta = (t: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`

describe('streamChat — parsing SSE', () => {
  it('assemble les deltas et renvoie le texte complet', async () => {
    const { full, deltas } = await collect(sseResponse([delta('Bon'), delta('jour')]))
    expect(full).toBe('Bonjour')
    expect(deltas).toEqual(['Bon', 'jour'])
  })

  it('ignore les lignes non-data et la sentinelle [DONE]', async () => {
    const body = [
      ': ping\n\n',
      'event: keepalive\n\n',
      delta('a'),
      'data: [DONE]\n\n',
      delta('b'),
    ].join('')
    const { full } = await collect(sseResponse([body]))
    expect(full).toBe('ab')
  })

  it('ignore une ligne data au JSON invalide sans casser le flux', async () => {
    const { full } = await collect(sseResponse(['data: {broken\n\n', delta('ok')]))
    expect(full).toBe('ok')
  })

  it('reconstitue une data scindée entre deux chunks (ligne tamponnée)', async () => {
    const whole = delta('scindé')
    const cut = whole.indexOf('"content"')
    const { full } = await collect(sseResponse([whole.slice(0, cut), whole.slice(cut)]))
    expect(full).toBe('scindé')
  })

  it('un abort est propagé tel quel (pas d’erreur réseau générique)', async () => {
    const ctrl = new AbortController()
    const fetchMock = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(
        streamChat({
          providerId: 'openrouter',
          apiKey: 'k',
          model: 'm',
          messages: [],
          temperature: 0,
          maxTokens: 1,
          signal: ctrl.signal,
          onDelta: () => {},
        }),
      ).rejects.toMatchObject({ name: 'AbortError' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('échec réseau → message lisible avec le libellé du fournisseur', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))
    try {
      await expect(
        streamChat({
          providerId: 'cohere',
          apiKey: 'k',
          model: 'm',
          messages: [],
          temperature: 0,
          maxTokens: 1,
          signal: new AbortController().signal,
          onDelta: () => {},
        }),
      ).rejects.toThrow('Réseau injoignable (Cohere)')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('401 → message « clé API refusée »', async () => {
    await expect(collect(new Response('unauthorized', { status: 401 }))).rejects.toThrow(
      'Clé API refusée par OpenRouter',
    )
  })

  it('429 → message « rate limit »', async () => {
    await expect(collect(new Response('slow down', { status: 429 }))).rejects.toThrow('rate limit (429)')
  })

  it('les messages d’erreur SSE sont remontés', async () => {
    const body = `data: ${JSON.stringify({ error: { message: 'quota dépassé' } })}\n\n`
    await expect(collect(sseResponse([body]))).rejects.toThrow('OpenRouter : quota dépassé')
  })

  it('réponse 200 sans contenu → « réponse vide »', async () => {
    await expect(collect(sseResponse(['data: [DONE]\n\n']))).rejects.toThrow('réponse vide')
  })
})

describe('registre des fournisseurs', () => {
  it('les 4 fournisseurs sont présents avec leurs modèles', () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(['openrouter', 'nvidia', 'cohere', 'mistral'])
    for (const p of PROVIDERS) expect(p.models.length).toBeGreaterThan(0)
  })

  it('providerOf retombe sur OpenRouter pour un id inconnu', () => {
    expect(providerOf('inconnu' as never).id).toBe('openrouter')
  })

  it('findModel fabrique un libellé de repli pour un modèle inconnu', () => {
    expect(findModel('openrouter', 'custom/modelexotique')).toEqual({
      id: 'custom/modelexotique',
      label: 'custom/modelexotique',
    })
  })
})
