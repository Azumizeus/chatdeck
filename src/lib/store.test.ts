import { describe, expect, it, beforeEach } from 'vitest'
import {
  emptyKeys,
  defaultSettings,
  loadConversations,
  saveConversations,
  loadKeys,
  saveKeys,
  loadSettings,
  saveSettings,
  newConversation,
  type Conversation,
} from './store'

beforeEach(() => {
  localStorage.clear()
})

describe('clés API', () => {
  it('loadKeys renvoie des clés vides quand rien n’est stocké', () => {
    expect(loadKeys()).toEqual(emptyKeys())
  })

  it('saveKeys puis loadKeys font un aller-retour fidèle', () => {
    const k = { openrouter: 'sk-or-1', nvidia: 'nvapi-2', cohere: 'c-3', mistral: 'm-4', custom: {} }
    saveKeys(k)
    expect(loadKeys()).toEqual(k)
  })

  it('un JSON corrompu retombe sur emptyKeys sans lever', () => {
    localStorage.setItem('chatdeck.keys.v1', '{oops')
    expect(loadKeys()).toEqual(emptyKeys())
  })

  it('les champs inconnus du JSON stocké sont préservés (compatibilité ascendante)', () => {
    localStorage.setItem('chatdeck.keys.v1', JSON.stringify({ openrouter: 'abc', future: 'x' }))
    expect(loadKeys()).toEqual({ ...emptyKeys(), openrouter: 'abc', future: 'x' })
  })
})

describe('réglages', () => {
  it('loadSettings renvoie les réglages par défaut à froid', () => {
    expect(loadSettings()).toEqual(defaultSettings())
  })

  it('un stockage partiel est complété par les défauts', () => {
    localStorage.setItem('chatdeck.settings.v1', JSON.stringify({ temperature: 0.2 }))
    expect(loadSettings()).toEqual({ ...defaultSettings(), temperature: 0.2 })
  })

  it('saveSettings persiste les valeurs', () => {
    const s = { ...defaultSettings(), system: 'Réponds en français' }
    saveSettings(s)
    expect(loadSettings()).toEqual(s)
  })
})

describe('conversations', () => {
  it('loadConversations renvoie [] à froid', () => {
    expect(loadConversations()).toEqual([])
  })

  it('un stockage non-tableau est rejeté sans lever', () => {
    localStorage.setItem('chatdeck.conversations.v1', '{"a":1}')
    expect(loadConversations()).toEqual([])
  })

  const conv: Conversation = {
    id: 'c1',
    title: 'Test',
    providerId: 'openrouter',
    model: 'openai/gpt-4.1-mini',
    messages: [{ role: 'user', content: 'Bonjour', ts: 1 }],
    createdAt: 1,
  }

  it('saveConversations puis loadConversations font un aller-retour fidèle (avec normalisation)', () => {
    saveConversations([conv])
    expect(loadConversations()).toEqual([{ ...conv, open: false, incognito: false }])
  })

  it('les conversations incognito ne sont jamais écrites dans localStorage', () => {
    saveConversations([{ ...conv, incognito: true }])
    expect(loadConversations()).toEqual([])
  })

  it('newConversation génère un id unique et un titre par défaut', () => {
    const a = newConversation('openrouter', 'openai/gpt-4.1-mini')
    const b = newConversation('cohere', 'command-a-03-2025')
    expect(a.id).not.toBe(b.id)
    expect(a.title).toBe('Nouvelle conversation')
    expect(a.providerId).toBe('openrouter')
    expect(a.model).toBe('openai/gpt-4.1-mini')
    expect(a.messages).toEqual([])
  })
})
