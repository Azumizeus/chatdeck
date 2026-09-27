// Types partagés de la refonte « IDE premium »

import type { ProviderId } from './llm'
import type { AgentId } from './agents'

export interface Msg {
  role: 'user' | 'assistant'
  content: string
  ts: number
  error?: boolean
  /** Usage réel renvoyé par l'API (chunk final SSE, si fourni) */
  usage?: { prompt: number; completion: number }
  /** Agent émetteur (si la conversation est multi-agents) */
  agent?: AgentId
  /** Traces d'outils exécutés pendant le tour (sandbox) */
  toolEvents?: { tool: string; detail: string }[]
  /** Fiches .CD injectées dans le prompt de ce message (badge 🃏) */
  cards?: string[]
  /** Le prompt de ce message a été condensé (résumé de l'historique ancien) */
  condensed?: boolean
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
  /** Agents activés dans ce fil (multi-agents Nexus/Seeker/PromptDeck) */
  agents?: AgentId[]
  /** Sandbox workspace déjà bootstrappée sur le disque */
  sandboxReady?: boolean
  /** Mode collaboratif duel : les 2 agents partagent le workspace de la colonne de gauche */
  collabOf?: string
  /** Fiches .CD activées POUR CE FIL (ids) ; absent = fallback sur la sélection globale */
  cardsActive?: string[]
  /** Mode Plan (inspiré d'OpenCode) : agents en lecture seule pour ce fil */
  planMode?: boolean
  /** Projet rattaché : sandbox partagée p-<id> + règles + dossiers Mac autorisés */
  projectId?: string
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
  /** Famille de typographie (« system » par défaut, voir FONTS des réglages) */
  fontFamily?: string
  /** Réduire les animations (aussi forcé si prefers-reduced-motion) */
  reduceMotion: boolean
  /** Arbitre : mode débat en 2 tours (répliques A/B avant verdict) */
  arbitreDebate?: boolean
  /** Mode d'emploi interactif : afficher la visite guidée au lancement */
  showTour?: boolean
  /** Onglets affichés dans la fenêtre hub (outils) ; [] = bouton hub masqué */
  hubTabs?: HubTab[]
  /** Onglet hub actif à l'ouverture (si présent dans hubTabs) */
  hubDefault?: HubTab
  /** Permissions par outil (inspiré d'OpenCode) : 'allow' | 'ask' | 'deny'. Défaut : allow. */
  toolPerms?: Record<string, 'allow' | 'ask' | 'deny'>
  /** Condenseur de contexte : seuil (messages) et modèle de résumé. 0 = désactivé. */
  condenseThreshold?: number
  condenseModel?: string
}

/** Outils soumis aux permissions (les lectures restent toujours libres). */
export const PERM_TOOLS = ['write_file', 'git_commit', 'switch_os', 'run_command'] as const

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

/* ── Projets (inspiré Claude Desktop) : sandbox par projet + dossiers Mac + règles ── */

/** Un projet ChatDeck : un workspace dédié partagé par ses conversations. */
export interface Project {
  id: string
  name: string
  /** Consignes du projet (injectées au prompt de chaque conversation liée) */
  instructions: string
  /** Dossiers du Mac autorisés en lecture par les agents (ex. ~/projects/chatdeck) */
  folders: string[]
  /** Conversations rattachées au projet */
  conversations: string[]
  createdAt: number
}

const PROJECTS_KEY = 'chatdeck.projects.v1'

export function loadProjects(): Project[] {
  return readJson<Project[]>(PROJECTS_KEY, [])
}

export function saveProjects(list: Project[]): void {
  writeJson(PROJECTS_KEY, list)
}

export function newProject(name: string): Project {
  return {
    id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name: name.trim() || 'Projet sans nom',
    instructions: '',
    folders: [],
    conversations: [],
    createdAt: Date.now(),
  }
}

/** Mode d'affichage de la fenêtre principale. */
export type AppMode = 'docked' | 'floating' | 'pill'

/** Layout dockable persisté : largeurs, collapses, géométries des popouts. */
export interface Layout {
  sidebarWidth: number
  sidebarCollapsed: boolean
  settingsWidth: number
  settingsCollapsed: boolean
  /** Popouts persistés : panneau → géométrie de la fenêtre secondaire */
  popouts: Record<string, PaneGeometry>
  /** Mode de la fenêtre principale (ancrée, flottante, réduite en pill) */
  appMode?: AppMode
  /** Géométrie de la fenêtre flottante */
  appGeo?: PaneGeometry
  /** Mode duel : ids des conversations gauche/droite */
  duel?: { left: string; right: string } | null
  /** Part de la moitié gauche du duel, en % (20–80) */
  duelSplit?: number
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

/** Construit une conversation collaborante liée au workspace d'un hôte (mode duel partagé). */
export function newCollabConversation(
  providerId: Conversation['providerId'],
  model: string,
  hostId: string,
): Conversation {
  const c = newConversation(providerId, model)
  c.agents = ['deck']
  c.collabOf = hostId
  c.sandboxReady = true // workspace déjà bootstrappé par l'hôte
  return c
}

/* ---------- graphe Graphify : positions persistées ---------- */
const GRAPH_KEY = 'chatdeck.graph.v1'

export interface GraphLayout {
  /** Positions {x,y} par id de nœud (conversation / agent:xxx:conv / ws:conv) */
  pos: Record<string, { x: number; y: number }>
  /** Mode de rangement : auto (calculé) ou manual (positions libres) */
  mode: 'auto' | 'manual'
}

export const defaultGraphLayout = (): GraphLayout => ({ pos: {}, mode: 'auto' })

export function loadGraphLayout(): GraphLayout {
  return readJson<GraphLayout>(GRAPH_KEY, defaultGraphLayout())
}

export function saveGraphLayout(g: GraphLayout): void {
  writeJson(GRAPH_KEY, g)
}

/* ── Hub : fenêtre outils déployable (Graphify, Fichiers, Terminal, Preview, Réglages) ── */

/** Onglets affichables dans le hub, dans l'ordre des boutons. */
export type HubTab = 'graph' | 'files' | 'terminal' | 'preview' | 'settings' | 'deck'
export const HUB_TABS: { id: HubTab; label: string; icon: string }[] = [
  { id: 'graph', label: 'Graphify', icon: '🕸' },
  { id: 'files', label: 'Fichiers', icon: '📁' },
  { id: 'terminal', label: 'Terminal', icon: '⌨︎' },
  { id: 'preview', label: 'Preview', icon: '👁' },
  { id: 'settings', label: 'Réglages', icon: '⚙︎' },
  { id: 'deck', label: 'Skills & Agents', icon: '🃏' },
]

/** Géométrie du hub, persistée entre sessions (même schéma que le flottant). */
export interface HubGeometry {
  x: number
  y: number
  w: number
  h: number
  /** Replié en bande fine (double-clic sur la barre de titre) ? */
  collapsed?: boolean
  /** Largeur d'origine à restaurer au re-déploiement. */
  expandedW?: number
}

export function defaultHubGeometry(): HubGeometry {
  const vw = typeof window === 'undefined' ? 1280 : window.innerWidth
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight
  // Défaut : amarré À DROITE de la zone de chat (sidebar 260 + marge), jamais
  // centré devant le fil — c'est une fenêtre « outils », pas une modale.
  const w = Math.min(560, Math.max(400, Math.round(vw * 0.36)))
  const h = Math.min(680, Math.max(380, Math.round(vh * 0.7)))
  const x = Math.max(vw - w - 20, 24)
  const y = Math.max(64, Math.round((vh - h) * 0.18))
  return { x, y, w, h }
}

const HUB_KEY = 'chatdeck.hub.v1'

export function loadHubGeometry(): HubGeometry {
  return readJson<HubGeometry>(HUB_KEY, defaultHubGeometry())
}

export function saveHubGeometry(g: HubGeometry): void {
  writeJson(HUB_KEY, g)
}

/** Hauteur du terminal docké (px), mémorisée entre les sessions. */
const TERM_KEY = 'chatdeck.term.v1'

export function loadTermHeight(defaultH = 260): number {
  const v = readJson<number>(TERM_KEY, defaultH)
  return typeof v === 'number' && v >= 120 && v <= 720 ? v : defaultH
}

export function saveTermHeight(h: number): void {
  writeJson(TERM_KEY, Math.max(120, Math.min(720, Math.round(h))))
}

/* ── Fiches .CD (skills & agents) : état activé + cache des contenus ──
 *
 * Le panneau deck (hub / popout) gère quels fiches sont ACTIVÉES ; au moment
 * d'envoyer un message, l'app lit cet état et injecte les fiches dans le
 * prompt système (même mécanisme que `deck run`). Le cache des contenus est
 * rempli par le panneau au moment de l'activation — ainsi send() reste
 * synchrone et fonctionne hors-ligne tant que les fiches n'ont pas changé.
 */
export interface DeckState {
  /** Ids des fiches activées (name du frontmatter) */
  active: string[]
  /** Contenu (frontmatter inclus) par id, rempli à l'activation */
  cache: Record<string, string>
}

export function defaultDeckState(): DeckState {
  return { active: [], cache: {} }
}

/* ── Journal des exécutions d'outils (par conversation) ──
 *
 * Chaque appel d'outil (y compris refus de permission et condensations) est
 * journalisé en mémoire + localStorage : « qui a fait quoi, quand, résultat ».
 * Consulté par le panneau Fichiers (onglet ⌘ Journal). Volume borné.
 */
export interface ToolLogEntry {
  conv: string
  ts: number
  agent: AgentId | null
  tool: string
  detail: string
  ok: boolean
}

const TOOLLOG_KEY = 'chatdeck.toollog.v1'
const TOOLLOG_MAX = 300

export function loadToolLog(): ToolLogEntry[] {
  return readJson<ToolLogEntry[]>(TOOLLOG_KEY, [])
}

export function appendToolLog(entry: ToolLogEntry): void {
  const all = [...loadToolLog(), entry].slice(-TOOLLOG_MAX)
  writeJson(TOOLLOG_KEY, all)
}

const CARDS_KEY = 'chatdeck.cards.v1'

export function loadDeckState(): DeckState {
  const s = readJson<DeckState>(CARDS_KEY, defaultDeckState())
  if (!Array.isArray(s.active)) s.active = []
  if (!s.cache || typeof s.cache !== 'object') s.cache = {}
  return s
}

export function saveDeckState(s: DeckState): void {
  writeJson(CARDS_KEY, s)
}

/** Le tour n'a-t-il déjà été complété une fois ? (indépendant du réglage) */
export function tourDone(): boolean {
  try {
    return localStorage.getItem('chatdeck.tour.done') === '1'
  } catch {
    return false
  }
}

export function markTourDone(): void {
  try {
    localStorage.setItem('chatdeck.tour.done', '1')
  } catch {
    /* ignore */
  }
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
  arbitreDebate: false,
  showTour: true,
  hubTabs: ['graph', 'files', 'terminal', 'preview', 'settings', 'deck'],
  hubDefault: 'graph',
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
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
        ts: m.ts ?? 0,
        usage:
          m.usage && Number.isFinite(m.usage?.prompt) && Number.isFinite(m.usage?.completion)
            ? { prompt: m.usage.prompt, completion: m.usage.completion }
            : undefined,
        agent: m.agent === 'nexus' || m.agent === 'seeker' ? m.agent : undefined,
        toolEvents: Array.isArray(m.toolEvents)
          ? m.toolEvents
              .filter((t) => t && typeof t.tool === 'string' && typeof t.detail === 'string')
              .map((t) => ({ tool: t.tool, detail: t.detail }))
              .slice(0, 20)
          : undefined,
      })),
    open: false,
    incognito: Boolean(c.incognito),
    agents: Array.isArray(c.agents)
      ? c.agents.filter((a): a is AgentId => a === 'nexus' || a === 'seeker' || a === 'deck')
      : undefined,
    sandboxReady: c.sandboxReady ? true : undefined,
    collabOf: typeof c.collabOf === 'string' ? c.collabOf : undefined,
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
  const s = readJson<Settings>(SET_KEY, defaultSettings())
  // Normalisation des réglages ajoutés après coup : les anciens localStorage
  // (d'avant le hub) n'ont pas hubTabs → le bouton Outils resterait muet.
  if (!Array.isArray(s.hubTabs)) s.hubTabs = defaultSettings().hubTabs
  return s
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
