import { describe, expect, it } from 'vitest'
import { conversationCost, formatCost, messagesUsage } from './cost'
import type { Conversation, Msg } from './store'

const msg = (role: Msg['role'], content: string, usage?: { prompt: number; completion: number }): Msg => ({
  role,
  content,
  ts: 0,
  usage,
})

const conv = (messages: Msg[], providerId = 'openrouter', model = 'openai/gpt-4.1-mini'): Conversation => ({
  id: 'c1',
  title: 't',
  providerId,
  model,
  messages,
  createdAt: 0,
})

describe('formatCost', () => {
  it('formate en USD avec 4 décimales max', () => {
    expect(formatCost(0.0123)).toMatch(/0,0123/)
  })
  it('affiche <0,0001 $ pour les micro-montants non nuls', () => {
    expect(formatCost(0.000005)).toBe('<0,0001 $')
  })
  it('affiche — pour un coût inconnu', () => {
    expect(formatCost(null)).toBe('—')
  })
})

describe('conversationCost', () => {
  it('additionne les usages réels quand présents', () => {
    const c = conv([msg('user', 'x', { prompt: 10, completion: 0 }), msg('assistant', 'y', { prompt: 0, completion: 20 })])
    const r = conversationCost(c, [], () => null)
    expect(r.promptTokens).toBe(10)
    expect(r.completionTokens).toBe(20)
  })

  it('estime ~4 caractères/token sans usage réel', () => {
    const c = conv([msg('user', 'x'.repeat(40)), msg('assistant', 'y'.repeat(80))])
    const r = conversationCost(c, [], () => null)
    expect(r.promptTokens).toBe(10)
    expect(r.completionTokens).toBe(20)
  })

  it('calcule le coût avec les prix du catalogue (looked up)', () => {
    const c = conv([msg('user', 'x', { prompt: 1000, completion: 0 }), msg('assistant', 'y', { prompt: 0, completion: 500 })])
    const r = conversationCost(c, [], (m) => (m === 'openai/gpt-4.1-mini' ? { prompt: 1e-6, completion: 2e-6 } : null))
    expect(r.cost).toBeCloseTo(1000 * 1e-6 + 500 * 2e-6, 12)
    expect(r.realPricing).toBe(true)
  })

  it('replie sur le tarif indicatif du fournisseur (estimation marquée)', () => {
    const c = conv([msg('user', 'x', { prompt: 1000, completion: 0 }), msg('assistant', 'y', { prompt: 0, completion: 1000 })], 'mistral')
    const r = conversationCost(c, [], () => null)
    expect(r.cost).toBeCloseTo(1000 * 2e-6 + 1000 * 6e-6, 12)
    expect(r.realPricing).toBe(false)
  })

  it('coût null pour un fournisseur sans tarif connu', () => {
    const c = conv([msg('user', 'x')], 'custom:abc')
    const r = conversationCost(c, [], () => null)
    expect(r.cost).toBeNull()
  })
})

describe('messagesUsage', () => {
  it('renvoie null si aucun usage réel', () => {
    expect(messagesUsage([msg('user', 'a'), msg('assistant', 'b')])).toBeNull()
  })
  it('agrège les usages réels', () => {
    expect(messagesUsage([msg('user', 'a', { prompt: 5, completion: 0 }), msg('assistant', 'b', { prompt: 0, completion: 7 })])).toEqual({
      prompt: 5,
      completion: 7,
    })
  })
})
