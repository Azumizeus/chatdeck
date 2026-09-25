import type { ProviderId } from './llm'

export interface Msg {
  role: 'user' | 'assistant'
  content: string
  ts: number
  error?: boolean
}

export interface Conversation {
  id: string
  title: string
  providerId: ProviderId
  model: string
  messages: Msg[]
  createdAt: number
}

export interface Keys {
  openrouter: string
  nvidia: string
  cohere: string
  mistral: string
}

export type Settings = {
  temperature: number
  maxTokens: number
  system: string
}

const CONVS_KEY = 'chatdeck.conversations.v1'
const KEYS_KEY = 'chatdeck.keys.v1'
const SET_KEY = 'chatdeck.settings.v1'

export const emptyKeys = (): Keys => ({ openrouter: '', nvidia: '', cohere: '', mistral: '' })
export const defaultSettings = (): Settings => ({
  temperature: 0.7,
  maxTokens: 2048,
  system: '',
})

export function loadConversations(): Conversation[] {
  try {
    const v = JSON.parse(localStorage.getItem(CONVS_KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function saveConversations(list: Conversation[]): void {
  try {
    localStorage.setItem(CONVS_KEY, JSON.stringify(list))
  } catch {
    /* quota */
  }
}

export function loadKeys(): Keys {
  try {
    return { ...emptyKeys(), ...JSON.parse(localStorage.getItem(KEYS_KEY) ?? '{}') }
  } catch {
    return emptyKeys()
  }
}

export function saveKeys(k: Keys): void {
  localStorage.setItem(KEYS_KEY, JSON.stringify(k))
}

export function loadSettings(): Settings {
  try {
    return { ...defaultSettings(), ...JSON.parse(localStorage.getItem(SET_KEY) ?? '{}') }
  } catch {
    return defaultSettings()
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(SET_KEY, JSON.stringify(s))
}

export function newConversation(providerId: ProviderId, model: string): Conversation {
  return {
    id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title: 'Nouvelle conversation',
    providerId,
    model,
    messages: [],
    createdAt: Date.now(),
  }
}
