// Types partagés de la refonte « IDE premium »

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
  providerId: ProviderId | `custom:${string}`
  model: string
  messages: Msg[]
  createdAt: number
  /** Onglet ouvert dans la barre d'onglets */
  open?: boolean
  /** Conversation éphémère (jamais persistée) */
  incognito?: boolean
}

export interface Keys {
  openrouter: string
  nvidia: string
  cohere: string
  mistral: string
  /** Clés des fournisseurs personnalisés, indexées par identifiant (« custom:xyz ») */
  custom: Record<string, string>
}

export type Theme = 'dark' | 'light' | 'auto'

export interface Settings {
  temperature: number
  maxTokens: number
  system: string
  theme: Theme
  /** Taille de police de base en px (12–18) */
  fontSize: number
  /** Réduire les animations (aussi forcé si prefers-reduced-motion) */
  reduceMotion: boolean
}

/** Fournisseur personnalisé OpenAI-compatible (proxifié via /api/custom/:id). */
export interface CustomProvider {
  id: string // « custom:xyz »
  name: string
  baseUrl: string // ex. https://api.exemple.com/v1
  keyHeader: string // en-tête d'auth, ex. Authorization, X-Api-Key
  models: { id: string; label?: string }[]
}

export interface PaneGeometry {
  x: number
  y: number
  w: number
  h: number
}

/** Layout dockable persisté : largeurs, collapses, géométries des popouts. */
export interface Layout {
  sidebarWidth: number
  sidebarCollapsed: boolean
  settingsWidth: number
  settingsCollapsed: boolean
  /** Popouts persistés : panneau → géométrie de la fenêtre secondaire */
  popouts: Record<string, PaneGeometry>
}

export const MIN_SIDEBAR = 180
export const MAX_SIDEBAR = 460
export const MIN_SETTINGS = 300
export const MAX_SETTINGS = 560

export const DEFAULT_LAYOUT: Layout = {
  sidebarWidth: 248,
  sidebarCollapsed: false,
  settingsWidth: 400,
  settingsCollapsed: true,
  popouts: {},
}

/** Schéma d'export/import JSON. */
export interface ExportSchema {
  version: 1
  exportedAt: number
  conversations: Conversation[]
  customProviders?: CustomProvider[]
  settings?: Settings
}

const CONVS_KEY = 'chatdeck.conversations.v1'
const KEYS_KEY = 'chatdeck.keys.v1'
const SET_KEY = 'chatdeck.settings.v1'
const LAYOUT_KEY = 'chatdeck.layout.v1'
const CUSTOMS_KEY = 'chatdeck.customproviders.v1'
const INCOG_KEY = 'chatdeck.incognito.id'

export const emptyKeys = (): Keys => ({ openrouter: '', nvidia: '', cohere: '', mistral: '', custom: {} })
export const defaultSettings = (): Settings => ({
  temperature: 0.7,
  maxTokens: 2048,
  system: '',
  theme: 'dark',
  fontSize: 15,
  reduceMotion: false,
})

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? { ...fallback, ...(JSON.parse(v) as object) } as T : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota dépassé : on ignore */
  }
}

/** Sanitize léger d'une conversation importée/chargée (jamais de perte silencieuse). */
function sanitizeConversation(c: Conversation): Conversation | null {
  if (typeof c?.id !== 'string' || !Array.isArray(c?.messages)) return null
  return {
    id: c.id,
    title: typeof c.title === 'string' && c.title.trim() ? c.title : 'Sans titre',
    providerId: (c.providerId ?? 'openrouter') as Conversation['providerId'],
    model: typeof c.model === 'string' ? c.model : '',
    createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
    messages: c.messages
      .filter((m) => typeof m?.content === 'string')
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content, ts: m.ts ?? 0 })),
    open: false,
    incognito: Boolean(c.incognito),
  }
}

export function loadConversations(): Conversation[] {
  try {
    const v = JSON.parse(localStorage.getItem(CONVS_KEY) ?? '[]')
    if (!Array.isArray(v)) return []
    return v.map((c) => sanitizeConversation(c as Conversation)).filter((c): c is Conversation => c !== null)
  } catch {
    return []
  }
}

export function saveConversations(list: Conversation[]): void {
  // Les conversations incognito ne quittent jamais la mémoire du navigateur.
  writeJson(
    CONVS_KEY,
    list.filter((c) => !c.incognito),
  )
}

export function loadKeys(): Keys {
  return readJson<Keys>(KEYS_KEY, emptyKeys())
}

export function saveKeys(k: Keys): void {
  writeJson(KEYS_KEY, k)
}

export function loadSettings(): Settings {
  return readJson<Settings>(SET_KEY, defaultSettings())
}

export function saveSettings(s: Settings): void {
  writeJson(SET_KEY, s)
}

export function loadLayout(): Layout {
  const l = readJson<Layout>(LAYOUT_KEY, DEFAULT_LAYOUT)
  return { ...DEFAULT_LAYOUT, ...l, popouts: { ...(l.popouts ?? {}) } }
}

export function saveLayout(l: Layout): void {
  writeJson(LAYOUT_KEY, l)
}

export function resetLayout(): Layout {
  try {
    localStorage.removeItem(LAYOUT_KEY)
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_LAYOUT }
}

export function loadCustomProviders(): CustomProvider[] {
  try {
    const v = JSON.parse(localStorage.getItem(CUSTOMS_KEY) ?? '[]')
    if (!Array.isArray(v)) return []
    return v
      .filter((p): p is CustomProvider => typeof p?.id === 'string' && typeof p?.baseUrl === 'string')
      .map((p) => ({
        id: p.id,
        name: p.name || p.id,
        baseUrl: p.baseUrl,
        keyHeader: p.keyHeader || 'Authorization',
        models: Array.isArray(p.models)
          ? p.models.filter((m) => typeof m?.id === 'string').map((m) => ({ id: m.id, label: m.label }))
          : [],
      }))
  } catch {
    return []
  }
}

export function saveCustomProviders(list: CustomProvider[]): void {
  writeJson(CUSTOMS_KEY, list)
}

export function newConversation(providerId: Conversation['providerId'], model: string): Conversation {
  return {
    id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title: 'Nouvelle conversation',
    providerId,
    model,
    messages: [],
    createdAt: Date.now(),
    open: true,
  }
}

export function newIncognitoConversation(providerId: Conversation['providerId'], model: string): Conversation {
  const c = newConversation(providerId, model)
  c.incognito = true
  c.title = '👻 Conversation incognito'
  return c
}

/* ---------- incognito ---------- */

export function loadIncognitoId(): string | null {
  try {
    return sessionStorage.getItem(INCOG_KEY)
  } catch {
    return null
  }
}

export function saveIncognitoId(id: string | null): void {
  try {
    if (id) sessionStorage.setItem(INCOG_KEY, id)
    else sessionStorage.removeItem(INCOG_KEY)
  } catch {
    /* ignore */
  }
}

/* ---------- import / export ---------- */

/** Valide un JSON d'export ; renvoie un aperçu ou une erreur lisible. */
export function validateImport(raw: string): { conversations: Conversation[]; error?: string } {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { conversations: [], error: 'JSON invalide' }
  }
  const obj = data as Partial<ExportSchema>
  if (!Array.isArray(obj.conversations)) return { conversations: [], error: 'Schéma invalide : « conversations » manquant' }
  const conversations = obj.conversations
    .map((c) => sanitizeConversation(c as Conversation))
    .filter((c): c is Conversation => c !== null)
  return { conversations }
}

/* ---------- export ---------- */

export function buildExport(list: Conversation[], customs: CustomProvider[] = []): ExportSchema {
  return { version: 1, exportedAt: Date.now(), conversations: list, customProviders: customs }
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
