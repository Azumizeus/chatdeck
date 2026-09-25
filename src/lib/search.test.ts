import { describe, expect, it } from 'vitest'
import { searchConversations } from './search'
import type { Conversation } from './store'

function conv(id: string, title: string, messages: { role: 'user' | 'assistant'; content: string }[]): Conversation {
  return {
    id,
    title,
    providerId: 'openrouter',
    model: 'm',
    createdAt: 1,
    messages: messages.map((m, i) => ({ ...m, ts: i + 1 })),
  }
}

describe('searchConversations', () => {
  const convs = [
    conv('a', 'Svelte', [
      { role: 'user', content: 'Explique-moi Svelte 5 en détail' },
      { role: 'assistant', content: 'Svelte 5 utilise les runes : $state, $derived, $effect.' },
    ]),
    conv('b', 'TypeScript', [{ role: 'user', content: 'Écris une fonction debounce en TypeScript' }]),
    conv('c', 'Vide', []),
  ]

  it('la requête vide ne renvoie rien', () => {
    expect(searchConversations(convs, '')).toEqual([])
    expect(searchConversations(convs, '   ')).toEqual([])
  })

  it('trouve les correspondances dans le bon fil avec le bon extrait', () => {
    const hits = searchConversations(convs, 'runes')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ convId: 'a', convTitle: 'Svelte', role: 'assistant', match: 'runes' })
    expect(hits[0].after.startsWith(' :')).toBe(true)
  })

  it('est insensible à la casse mais rend la correspondance telle qu\u2019écrite', () => {
    const hits = searchConversations(convs, 'SVELTE')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].match).toBe('Svelte')
  })

  it('traverse plusieurs conversations', () => {
    const hits = searchConversations(convs, 'en')
    expect(new Set(hits.map((h) => h.convId)).size).toBeGreaterThan(1)
  })

  it('plafonne les résultats par conversation', () => {
    const many = conv('d', 'Spam', Array.from({ length: 30 }, (_, i) => ({
      role: 'assistant' as const,
      content: `ligne ${i} avec cible ici`,
    })))
    const hits = searchConversations([many], 'cible')
    expect(hits).toHaveLength(8)
  })

  it('ne renvoie rien quand aucune correspondance', () => {
    expect(searchConversations(convs, 'inexistant')).toEqual([])
  })

  it('passe l\u2019agent émetteur au résultat', () => {
    const avecAgent = conv('e', 'Agents', [{ role: 'assistant', content: 'Nexus a écrit au workspace' }])
    avecAgent.messages[0].agent = 'nexus'
    const hits = searchConversations([avecAgent], 'workspace')
    expect(hits[0].agent).toBe('nexus')
  })
})
