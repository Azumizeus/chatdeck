// Recherche globale dans toutes les conversations : correspondances insensibles
// à la casse, extrait avant/après pour le surlignage, plafonné.

import type { Conversation } from './store'

export interface SearchHit {
  convId: string
  convTitle: string
  /** ts du message (clé de saut) */
  ts: number
  role: 'user' | 'assistant'
  agent?: string
  /** Texte avant la correspondance (≤ 40 caractères) */
  before: string
  /** Correspondance telle qu'écrite */
  match: string
  /** Texte après la correspondance (≤ 60 caractères) */
  after: string
}

const MAX_HITS_PER_CONV = 8
const MAX_TOTAL_HITS = 60

/** Extrait la fenêtre de contexte autour d'une occurrence. */
function snippet(content: string, start: number, len: number): { before: string; match: string; after: string } {
  return {
    before: content.slice(Math.max(0, start - 40), start),
    match: content.slice(start, start + len),
    after: content.slice(start + len, start + len + 60),
  }
}

/**
 * Cherche `query` dans tous les messages de toutes les conversations.
 * Insensible à la casse et aux accents. Requête vide → aucun résultat.
 */
export function searchConversations(conversations: Conversation[], query: string): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: SearchHit[] = []
  for (const c of conversations) {
    let perConv = 0
    for (const m of c.messages) {
      if (perConv >= MAX_HITS_PER_CONV || hits.length >= MAX_TOTAL_HITS) break
      const idx = m.content.toLowerCase().indexOf(q)
      if (idx < 0) continue
      hits.push({
        convId: c.id,
        convTitle: c.title,
        ts: m.ts,
        role: m.role,
        agent: m.agent,
        ...snippet(m.content, idx, q.length),
      })
      perConv++
    }
    if (hits.length >= MAX_TOTAL_HITS) break
  }
  return hits
}
