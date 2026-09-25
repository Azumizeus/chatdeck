// Estimation de coût par conversation : prix réels du catalogue OpenRouter quand
// disponibles, sinon repli sur des tarifs indicatifs par fournisseur.

import type { Conversation, CustomProvider, Msg } from './store'

/** Tokens réels attachés à une réponse (usage renvoyé par l'API). */
export interface Usage {
  prompt: number
  completion: number
}

export interface ConvCost {
  promptTokens: number
  completionTokens: number
  /** USD ; null si le prix du modèle est inconnu */
  cost: number | null
  /** true si le coût vient des prix réels du catalogue (sinon estimation indicative) */
  realPricing: boolean
}

/** Tarifs indicatifs USD / token (fallback si le catalogue ne connaît pas le modèle). */
const FALLBACK: Record<string, { prompt: number; completion: number }> = {
  openrouter: { prompt: 0.4e-6, completion: 1.2e-6 },
  nvidia: { prompt: 0, completion: 0 },
  cohere: { prompt: 2.5e-6, completion: 10e-6 },
  mistral: { prompt: 2e-6, completion: 6e-6 },
}

const fmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 })

/** Formate un coût USD (« 0,0123 $ », « <0,0001 $ », « — » si inconnu). */
export function formatCost(usd: number | null): string {
  if (usd === null) return '—'
  if (usd > 0 && usd < 0.0001) return '<0,0001 $'
  return fmt.format(usd)
}

/**
 * Calcule tokens et coût d'une conversation.
 * - tokens : usage réel par message quand disponible, sinon estimation ~4 caractères/token
 * - prix   : catalogue OpenRouter (priceLookup) sinon tarifs indicatifs du fournisseur
 */
export function conversationCost(
  conv: Conversation,
  customs: CustomProvider[],
  lookup: (modelId: string) => { prompt: number; completion: number } | null,
): ConvCost {
  let promptTokens = 0
  let completionTokens = 0
  for (const m of conv.messages) {
    const u = m.usage
    if (u) {
      promptTokens += u.prompt
      completionTokens += u.completion
    } else {
      const est = Math.ceil(m.content.length / 4)
      if (m.role === 'user') promptTokens += est
      else completionTokens += est
    }
  }

  const price = lookup(conv.model)
  const fallback = FALLBACK[isCustomProvider(conv.providerId, customs) ? '' : conv.providerId]
  const p = price ?? fallback ?? null
  const cost = p ? promptTokens * p.prompt + completionTokens * p.completion : null
  return { promptTokens, completionTokens, cost, realPricing: price !== null }
}

function isCustomProvider(pid: string, customs: CustomProvider[]): boolean {
  return pid.startsWith('custom:') || customs.some((c) => c.id === pid)
}

/** Convertit une liste de messages en usage agrégé (utilisé par la barre d'état). */
export function messagesUsage(messages: Msg[]): Usage | null {
  let prompt = 0
  let completion = 0
  let any = false
  for (const m of messages) {
    if (m.usage) {
      any = true
      prompt += m.usage.prompt
      completion += m.usage.completion
    }
  }
  return any ? { prompt, completion } : null
}
