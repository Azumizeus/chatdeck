<script lang="ts">
  // ChatDeck — orchestrateur « IDE premium » : châssis macOS, onglets, panneaux
  // dockables, popouts synchronisés, palette ⌘K, incognito, import/export.
  import { streamChat, isCustom, providerOf, type ProviderId, type WireMsg } from './lib/llm'
  import { AGENTS, toolsFor, systemPromptFor, execTool, reportToolFor, condenseHistory, type AgentId, type ToolCall } from './lib/agents'
  import FilesPanel from './lib/components/FilesPanel.svelte'
  import GraphPanel from './lib/components/GraphPanel.svelte'
  import NetworkBanner from './lib/components/NetworkBanner.svelte'
  import MessageActions from './lib/components/MessageActions.svelte'
  import WelcomeTour from './lib/components/WelcomeTour.svelte'
  import { net } from './lib/net.svelte'
  import {
    loadConversations,
    saveConversations,
    loadKeys,
    saveKeys,
    loadSettings,
    saveSettings,
    loadCustomProviders,
    saveCustomProviders,
    loadDeckState,
    loadIncognitoId,
    saveIncognitoId,
    loadHubGeometry,
    saveHubGeometry,
    loadHubSession,
    saveHubSession,
    loadProjects,
    saveProjects,
    newProject,
    appendToolLog,
    newConversation,
    newIncognitoConversation,
    newCollabConversation,
    tourDone,
    markTourDone,
    validateImport,
    buildExport,
    downloadJson,
    type Conversation,
    type CustomProvider,
    type Keys,
    type Msg,
    type Project,
    type Settings,
    BUILTIN_CONNECTORS,
  } from './lib/store'
  import { layout, type PanelId } from './lib/layout.svelte'
  import Sidebar from './lib/components/Sidebar.svelte'
  import ChatMessage from './lib/components/ChatMessage.svelte'
  import Composer from './lib/components/Composer.svelte'
  import SettingsPanel from './lib/components/SettingsPanel.svelte'
  import TabBar from './lib/components/TabBar.svelte'
  import StatusBar from './lib/components/StatusBar.svelte'
  import WindowFrame from './lib/components/WindowFrame.svelte'
  import FloatingWindow from './lib/components/FloatingWindow.svelte'
  import HubWindow from './lib/components/HubWindow.svelte'
  import DeckPanel from './lib/components/DeckPanel.svelte'
  import ConnectorsPanel from './lib/components/ConnectorsPanel.svelte'
  import CleanupBanner from './lib/components/CleanupBanner.svelte'
  import CascadePanel from './lib/components/CascadePanel.svelte'
  import type { HubTab } from './lib/store'
  import TaskbarPill from './lib/components/TaskbarPill.svelte'
  import CommandPalette from './lib/components/CommandPalette.svelte'
  import SearchPanel from './lib/components/SearchPanel.svelte'
  import Toolbar from './lib/components/Toolbar.svelte'
  import TerminalPanel from './lib/components/TerminalPanel.svelte'
  import PreviewPanel from './lib/components/PreviewPanel.svelte'
  import type { Command } from './lib/components/CommandPalette.svelte'
  import { snapCycle, zoneRect } from './lib/float.svelte'
  import type { Edge } from './lib/float.svelte'
  import type { PaneGeometry } from './lib/store'

  /* ---------- état ---------- */

  let conversations = $state<Conversation[]>(loadConversations())
  let projects = $state<Project[]>(loadProjects())
  let currentId = $state<string | null>(loadIncognitoId())
  let keys = $state<Keys>(loadKeys())
  let settings = $state<Settings>(loadSettings())
  let customs = $state<CustomProvider[]>(loadCustomProviders())
  /** Conversations en cours de streaming (streams concurrents : mode duel) */
  let streamingIds = $state<Set<string>>(new Set())
  const anyStreaming = $derived(streamingIds.size > 0)
  let latencyMs = $state<number | null>(null)
  let showPalette = $state(false)
  let showFiles = $state(false)
  let showGraph = $state(false)
  // Fenêtre outils (hub) : regroupe Graphify/Fichiers/Terminal/Preview/Réglages
  // dans une fenêtre déployable — le chat reste visible derrière.
  // Rouvert au lancement sur l'onglet actif de la session précédente (VS Code style).
  const hubSession = loadHubSession()
  let showHub = $state(hubSession.open)
  // svelte-ignore state_referenced_locally (valeur initiale voulue : dernier onglet de la session précédente)
  let hubTab = $state<HubTab>(hubSession.tab ?? settings.hubDefault ?? 'graph')
  // Persistance de l'état du hub (ouvert/onglet) à chaque changement.
  $effect(() => {
    saveHubSession({ open: showHub, tab: hubTab })
  })
  /** Semi-nettoyage sandbox : vérifié À CHAQUE LANCEMENT de l'app — la bannière
   *  ne s'affiche que s'il y a quelque chose à nettoyer (check local instantané)
   *  et ne supprime JAMAIS sans validation humaine. */
  let showCleanup = $state(true)
  /** Popout dédié au panneau deck (fenêtre window.open, état via localStorage) */
  let deckPopout = $state<Window | null>(null)
  let showSearch = $state(false)
  /** Mode d'emploi interactif : 1ʳᵉ visite (réglage showTour actif et jamais complété) */
  let showTour = $state(false)
  $effect(() => {
    if (settings.showTour && !tourDone()) showTour = true
  })

  /** Actions de la visite guidée : ouvre le panneau correspondant. */
  function tourAction(cmd: string): void {
    if (cmd === 'agents') setAgents(current?.agents?.length ? [] : ['nexus', 'seeker'])
    else if (cmd === 'duel') toggleDuel()
    else if (cmd === 'files') showFiles = true
    else if (cmd === 'graph') showGraph = true
    else if (cmd === 'net') void net.probe()
  }

  /** Ouvre la fenêtre outils sur un onglet (s'il fait partie du réglage hubTabs). */
  function openHub(tab: HubTab): void {
    if (!(settings.hubTabs ?? []).includes(tab)) return
    if (showHub && hubTab === tab) {
      showHub = false
      return
    }
    hubTab = tab
    showHub = true
    // Hub replié en bande fine ? On le re-déploie (événement écouté par HubWindow).
    window.dispatchEvent(new Event('chatdeck-hub-expand'))
    // Le hub est une fenêtre outils LATÉRALE : si sa géométrie chevauche la
    // fenêtre app (mode flottant) ou sort du viewport, on l'amarrе dans la
    // zone libre à droite de l'app (mesurée dans le DOM) — jamais devant le chat.
    const fw = document.querySelector<HTMLElement>('.float-win')
    const ar = fw?.getBoundingClientRect()
    const app = ar ? { x: ar.x, y: ar.y, w: ar.width, h: ar.height } : layout.appMode === 'floating' ? layout.appGeo : null
    const vw = window.innerWidth
    const vh = window.innerHeight
    const ax = app ? app.x : 0
    const freeLeft = ax
    const freeRight = vw - (app ? app.x + app.w : vw)
    const g = loadHubGeometry()
    const overlaps =
      app && g.x < ax + app.w && g.x + g.w > ax && g.y < app.y + app.h && g.y + g.h > app.y
    const outside = g.x + g.w > vw || g.x < 0 || g.y + g.h > vh
    if (overlaps || outside) {
      // Priorité à la zone droite dès qu'elle peut accueillir un hub utile ;
      // sinon zone gauche ; sinon (aucune zone libre) le hub se pose à DROITE
      // du viewport en réduisant l'app — la fenêtre outils reste latérale.
      const MIN = 300
      const useRight = freeRight >= MIN
      const useLeft = !useRight && freeLeft >= MIN
      const w = Math.min(g.w || 460, Math.max(300, useRight ? freeRight - 16 : useLeft ? freeLeft - 16 : 460))
      const x = useRight
        ? Math.min(vw - w - 8, app ? app.x + app.w + Math.max(0, freeRight - w - 12) : vw - w - 12)
        : useLeft
          ? Math.max(8, freeLeft - w - 12)
          : Math.max(8, vw - w - 12)
      saveHubGeometry({
        w,
        h: Math.min(Math.max(g.h || 520, 320), vh - 24),
        x,
        y: Math.max(56, Math.min(g.y || 64, vh - 120)),
      })
      // Aucune zone libre : on rétrécit l'app pour laisser la place au hub.
      if (!useRight && !useLeft && app) {
        layout.setAppGeo({ ...app, w: Math.max(640, vw - w - 24) })
      }
    }
  }

  /** Onglets cochés dans les réglages (ordre canonique conservé). */
  const hubInView = $derived((settings.hubTabs ?? []).slice())
  /** Onglet réellement affiché : retombe sur le premier visible si le réglage change pendant l'ouverture. */
  const hubActive = $derived(hubInView.includes(hubTab) ? hubTab : (hubInView[0] ?? 'graph'))
  // L'onglet actif est mémorisé entre les sessions (hubDefault mis à jour au switch)
  $effect(() => {
    if (showHub && hubActive !== settings.hubDefault) settings = { ...settings, hubDefault: hubActive }
  })

  /** Ouvre (ou focus) le popout dédié au panneau deck. */
  function popoutDeck(): void {
    if (deckPopout && !deckPopout.closed) {
      deckPopout.focus()
      return
    }
    deckPopout = window.open('/#popout=deck', 'chatdeck-deck', 'popup=yes,width=620,height=680,left=160,top=100')
  }

  /** Détache un onglet du hub en fenêtre dédiée (drag hors de la barre, comme un IDE). */
  function detachHubTab(t: HubTab): void {
    if (t === 'files' || t === 'terminal' || t === 'preview') {
      // Ces panneaux dépendent d'une conversation : on garde le hub pour eux.
      return
    }
    if (t === 'deck') popoutDeck()
    else window.open(`/#popout=${t}`, `chatdeck-${t}`, 'popup=yes,width=760,height=620,left=180,top=120')
    if (hubActive === t) showHub = false
  }
  let showTerminal = $state(false)
  let showPreview = $state(false)
  /** Conversations épinglées à l'ouverture des panneaux (duel inclus) */
  let terminalConvId = $state<string | null>(null)
  let filesConvId = $state<string | null>(null)
  let previewConvId = $state<string | null>(null)
  /** Verdict du duel : synthèse par un 3ᵉ modèle (ou débat en 2 tours avant verdict) */
  let verdict = $state<{ text: string } | null>(null)
  /** Commit auto en cours (sandbox courante) */
  let commitBusy = $state(false)
  let arbitreBusy = $state(false)
  let arbitreModel = $state('anthropic/claude-sonnet-4')
  let arbitreAbort: AbortController | null = null
  /** ts du message à surligner (saut depuis la recherche) */
  let flashTs = $state<number | null>(null)
  /** Réinitialise le fil jusqu'au message donné (régénération / suppression) */
  function truncateAfter(convId: string, ts: number): void {
    conversations = conversations.map((c) =>
      c.id === convId ? { ...c, messages: c.messages.filter((m) => m.ts < ts) } : c,
    )
  }

  /** Régénère la dernière réponse : supprime la bulle assistant et renvoie le prompt. */
  function regenerate(convId: string, ts: number): void {
    if (streamingIds.has(convId)) return
    const conv = conversations.find((c) => c.id === convId)
    if (!conv) return
    const lastUser = [...conv.messages].reverse().find((m) => m.role === 'user')
    if (!lastUser) return
    truncateAfter(convId, lastUser.ts + 1)
    void sendTo(convId, lastUser.content)
  }

  /** Supprime un message (et les suivants du même tour) — simple et explicite. */
  function deleteFrom(convId: string, ts: number): void {
    if (streamingIds.has(convId)) return
    truncateAfter(convId, ts)
  }
  let scroller: HTMLDivElement | undefined = $state()
  const current = $derived(conversations.find((c) => c.id === currentId) ?? null)

  // Garde-fou d'initialisation : la conversation restaurée doit exister + préchargement des clés dev
  $effect.root(() => {
    if (!currentId || !conversations.find((c) => c.id === currentId)) {
      const c = newConversation('openrouter', providerOf('openrouter').models[0].id)
      conversations = [c, ...conversations]
      currentId = c.id
    }
    // Clés dev (keys.local.json, gitignore) servies par le plugin Vite — jamais bundlées
    fetch('/keys.local')
      .then((r) => (r.ok ? r.json() : {}))
      .then((k: Partial<Keys>) => {
        const filled = Object.fromEntries(
          Object.entries(k).filter(([, v]) => typeof v === 'string' && v),
        ) as Partial<Keys>
        if (Object.keys(filled).length) keys = { ...keys, ...filled }
      })
      .catch(() => {})
  })

  // Sondes réseau : /api/health + proxy OpenRouter, 1×/min (bannière + StatusBar)
  $effect(() => net.start())

  /* ---------- effets : persistance, thème ---------- */

  $effect(() => {
    saveConversations(conversations)
    layout.broadcast('state-saved')
  })
  $effect(() => saveKeys(keys))
  $effect(() => saveSettings(settings))
  $effect(() => saveCustomProviders(customs))

  // Thème + taille de police + reduce-motion sur <html>
  $effect(() => {
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)')
    const apply = (): void => {
      const theme = settings.theme === 'auto' ? (prefersLight.matches ? 'light' : 'dark') : settings.theme
      document.documentElement.dataset.theme = theme
      document.documentElement.style.setProperty('--app-font-size', `${settings.fontSize}px`)
      if (settings.fontFamily) document.documentElement.style.setProperty('--app-font-family', settings.fontFamily)
      else document.documentElement.style.removeProperty('--app-font-family')
      document.documentElement.classList.toggle('reduce-motion', settings.reduceMotion)
      layout.broadcastTheme(theme)
    }
    apply()
    prefersLight.addEventListener('change', apply)
    return () => prefersLight.removeEventListener('change', apply)
  })

  // Réception des messages des popouts
  $effect(() => {
    const ch = layout.channel
    if (!ch) return
    const handler = (e: MessageEvent): void => {
      const msg = e.data as { type: string; payload?: unknown }
      if (msg.type === 'popout-geometry') {
        const { panel, geo } = msg.payload as { panel: PanelId; geo: { x: number; y: number; w: number; h: number } }
        layout.savePopoutGeometry(panel, geo)
      }
      if (msg.type === 'popout-send') {
        const { conversationId, text } = msg.payload as { conversationId: string; text: string }
        void sendTo(conversationId, text)
      }
    }
    ch.addEventListener('message', handler)
    return () => ch.removeEventListener('message', handler)
  })

  // Pousser la conversation active au popout chat quand il s'ouvre
  $effect(() => {
    if (layout.popouts.chat) layout.broadcastConversation(currentId, 'chat')
  })

  /* ---------- utilitaires ---------- */

  function scrollDown(convId?: string): void {
    // En mode duel, on scrolle la colonne du fil concerné ; sinon le fil principal
    const el = convId ? document.querySelector<HTMLDivElement>(`.duel-col[data-conv="${convId}"] .messages`) : null
    const target = el ?? scroller
    requestAnimationFrame(() => target?.scrollTo({ top: target.scrollHeight, behavior: 'auto' }))
  }

  function keyOf(pid: ProviderId): string {
    return isCustom(pid) ? (keys.custom[pid] ?? '') : (keys[pid as keyof Keys] as string)
  }

  /* ---------- conversations ---------- */

  function newChat(incognito = false): void {
    const c = incognito
      ? newIncognitoConversation('openrouter', providerOf('openrouter').models[0].id)
      : newConversation('openrouter', providerOf('openrouter').models[0].id)
    conversations = [c, ...conversations]
    currentId = c.id
    if (incognito) saveIncognitoId(c.id)
  }

  function selectChat(id: string): void {
    currentId = id
    if (conversations.find((c) => c.id === id)?.incognito) saveIncognitoId(id)
  }

  function closeTab(id: string): void {
    const c = conversations.find((x) => x.id === id)
    if (!c) return
    if (c.incognito) {
      conversations = conversations.filter((x) => x.id !== id)
      if (currentId === id) {
        const next = conversations[0]
        if (next) selectChat(next.id)
        else newChat(true)
      }
      return
    }
    conversations = conversations.map((x) => (x.id === id ? { ...x, open: false } : x))
    if (currentId === id) {
      const rest = conversations.filter((x) => x.open !== false)
      if (rest.length) currentId = rest[0].id
      else {
        conversations = conversations.map((x) => ({ ...x, open: x.id === conversations[0].id }))
        currentId = conversations[0].id
      }
    }
  }

  function deleteChat(id: string): void {
    if (streamingIds.has(id)) return
    conversations = conversations.filter((c) => c.id !== id)
    if (currentId === id) {
      if (conversations.length) currentId = conversations[0].id
      else newChat()
    }
  }

  function reorderTabs(dragId: string, overId: string): void {
    const list = [...conversations]
    const from = list.findIndex((c) => c.id === dragId)
    const to = list.findIndex((c) => c.id === overId)
    if (from < 0 || to < 0) return
    const [moved] = list.splice(from, 1)
    list.splice(to, 0, moved)
    conversations = list
  }

  function mergeIncognito(): void {
    const ghosts = conversations.filter((c) => c.incognito)
    if (!ghosts.length) return
    if (!confirm(`Fusionner ${ghosts.length} conversation(s) incognito dans l'historique persistant ?`)) return
    conversations = conversations.map((c) =>
      c.incognito ? { ...c, incognito: false, title: c.title.replace(/^👻\s*/, '') || 'Sans titre' } : c,
    )
    saveIncognitoId(null)
  }

  function setProvider(pid: ProviderId): void {
    if (!current || streamingIds.has(current.id)) return
    conversations = conversations.map((c) =>
      c.id === current.id ? { ...c, providerId: pid, model: providerOf(pid, customs).models[0].id } : c,
    )
  }

  function setModel(m: string): void {
    if (!current || streamingIds.has(current.id)) return
    conversations = conversations.map((c) => (c.id === current.id ? { ...c, model: m } : c))
  }

  /* ---------- splitters (pointer events natifs) ---------- */

  function startSidebarResize(e: PointerEvent): void {
    e.preventDefault()
    const startX = e.clientX
    const startW = layout.layout.sidebarWidth
    const move = (ev: PointerEvent): void => layout.setSidebarWidth(startW + (ev.clientX - startX))
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function startSettingsResize(e: PointerEvent): void {
    e.preventDefault()
    const startX = e.clientX
    const startW = layout.layout.settingsWidth
    const move = (ev: PointerEvent): void => layout.setSettingsWidth(startW + (startX - ev.clientX))
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* ---------- streaming ---------- */

  /** Rounds d'outils max par tour d'agent (garde-fou anti-boucle). */
  const MAX_TOOL_ROUNDS = 6

  /** Historique wire d'un fil multi-agents : préfixe agent + traces sandbox. */
  function multiWires(conv: Conversation, text: string): WireMsg[] {
    const wires: WireMsg[] = []
    for (const m of conv.messages) {
      if (m.error || !m.content) continue
      if (m.role === 'assistant') {
        let content = `**${AGENTS[m.agent ?? 'nexus']?.name ?? 'Nexus'} —** ${m.content}`
        for (const t of m.toolEvents ?? []) content += `\n_[sandbox:${t.tool}] ${t.detail}_`
        wires.push({ role: 'assistant', content })
      } else {
        wires.push({ role: 'user', content: m.content })
      }
    }
    wires.push({ role: 'user', content: text })
    return wires
  }

  function setAgents(list: AgentId[]): void {
    if (current) setAgentsFor(current.id, list)
  }

  function setAgentsFor(convId: string, list: AgentId[]): void {
    if (streamingIds.has(convId)) return
    conversations = conversations.map((c) => (c.id === convId ? { ...c, agents: list } : c))
  }

  async function sendTo(convId: string, text: string): Promise<void> {
    if (streamingIds.has(convId)) return
    const conv = conversations.find((c) => c.id === convId)
    if (!conv) return
    const apiKey = keyOf(conv.providerId)
    // Le message est TOUJOURS ajouté au fil (bug : il disparaissait + ouverture
    // silencieuse des réglages quand la clé manquait). Sans clé : bulle d'erreur
    // explicite dans la conversation + réglages ouverts pour la saisir.
    const multi = Boolean(conv.agents?.length)
    const appliedCards = conversations.find((c) => c.id === convId)?.cardsActive ?? loadDeckState().active
    const user: Msg = { role: 'user', content: text, ts: Date.now(), ...(appliedCards.length ? { cards: [...appliedCards] } : {}) }
    const assistant: Msg = {
      role: 'assistant',
      content: '',
      ts: Date.now(),
      ...(multi ? { agent: 'nexus' as const } : {}),
      // Le modèle qui répond, affiché au-dessus de sa bulle
      model: conv.model,
      providerLabel: providerOf(conv.providerId, customs).label,
    }
    conversations = conversations.map((c) =>
      c.id === convId ? { ...c, messages: [...c.messages, user, assistant], open: true } : c,
    )
    if (conv.title === 'Nouvelle conversation' || conv.title === '👻 Conversation incognito') {
      conversations = conversations.map((c) => (c.id === convId ? { ...c, title: text.slice(0, 46) } : c))
    }
    scrollDown(convId)
    if (!apiKey) {
      const label = providerOf(conv.providerId, customs).label
      const errTs = assistant.ts
      conversations = conversations.map((c) =>
        c.id === convId
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.ts === errTs && m.role === 'assistant'
                  ? { ...m, content: `**Clé API manquante pour ${label}.** Ouvre ⚙︎ Réglages (⌘,) et colle ta clé — ton message est conservé ci-dessus : renvoie-le ensuite.`, error: true }
                  : m,
              ),
            }
          : c,
      )
      // OUVRE les réglages sans jamais les refermer (toggle = double appel = panneau refermé).
      if (layout.layout.settingsCollapsed) layout.toggleSettings()
      return
    }

    // Bootstrap de la sandbox au premier message d'un fil agents (~/.chatdeck/workspaces/<id>)
    if (multi && !conv.sandboxReady) {
      conversations = conversations.map((c) => (c.id === convId ? { ...c, sandboxReady: true } : c))
      try {
        await fetch(`/api/sandbox/${convId}/bootstrap`, { method: 'POST' })
      } catch {
        /* sandbox indisponible : les outils renverront une erreur lisible */
      }
    }

    const live = conversations.find((c) => c.id === convId)!.messages.slice(-1)[0]
    streamingIds = new Set([...streamingIds, convId])
    const controller = new AbortController()
    aborts.set(convId, controller)
    const started = performance.now()

    const patchLive = (patch: (m: Msg) => Msg): void => {
      conversations = conversations.map((c) =>
        c.id === convId ? { ...c, messages: c.messages.map((m) => (m.ts === live.ts && m.role === live.role ? patch(m) : m)) } : c,
      )
    }
    const convProvider = conv.providerId
    const convModel = conv.model

    // Historique wire : multi-agents (préfixes) ou chat simple
    const wires: WireMsg[] = multi
      ? multiWires(conv, text)
      : [
          ...conv.messages.filter((m) => !m.error && m.content).map((mm) => ({ role: mm.role, content: mm.content })),
          { role: 'user' as const, content: text },
        ]
    // @fichier (inspiré d'OpenCode) : chaque @chemin mentionné attache un extrait
    // du fichier de la sandbox au prompt (lecture asynchrone bornée).
    const atRefs = [...new Set([...text.matchAll(/@([\w./-]+)/g)].map((m) => m[1]).filter((p) => /\.[\w]+$/.test(p)))].slice(0, 5)
    let atBlock = ''
    const atMissed: string[] = []
    if (atRefs.length) {
      const excerpts = await Promise.all(
        atRefs.map(async (p) => {
          try {
            const r = await fetch(`/api/sandbox/${convId}/file?path=${encodeURIComponent(p)}`)
            if (!r.ok) {
              atMissed.push(p)
              return null
            }
            const j = (await r.json()) as { content?: string }
            const body = (j.content ?? '').slice(0, 4000)
            if (!body) {
              atMissed.push(p)
              return null
            }
            return `@${p} :\n\n\`\`\`\n${body}${(j.content ?? '').length > 4000 ? '\n…' : ''}\n\`\`\``
          } catch {
            atMissed.push(p)
            return null
          }
        }),
      )
      const found = excerpts.filter(Boolean) as string[]
      if (found.length) atBlock = `Fichiers sandbox référencés (@) :\n\n${found.join('\n\n')}`
      // Jamais silencieux : si un @fichier n'a pas pu être joint, l'utilisateur
      // le sait (fichier absent, workspace non créé, hors sandbox).
      if (atMissed.length) {
        atBlock += `${atBlock ? '\n\n' : ''}(Fichiers introuvables dans la sandbox : ${atMissed.map((p) => `@${p}`).join(', ')}.)`
      }
    }
    // Mode Plan (inspiré d'OpenCode) : lecture seule, l'agent propose sans modifier
    const readOnly = conv.planMode ?? false
    const cardsBlock = activeCardsSystem(convId, text)
    // Projet lié : règles du projet injectées, outils projet (workspace partagé
    // + dossiers Mac autorisés) disponibles pour les agents.
    const project = projectOf(conv.projectId)
    if (project && multi) {
      try {
        await fetch(`/api/sandbox/projects/${project.id}/bootstrap`, { method: 'POST' })
      } catch {
        /* le workspace projet se créera au prochain tour */
      }
    }
    const projectBlock = project?.instructions
      ? `## Règles du projet « ${project.name} »\n\n${project.instructions}`
      : ''
    const systemWire: WireMsg = {
      role: 'system',
      content: multi
        ? systemPromptFor('nexus', [settings.system, cardsBlock, atBlock, projectBlock].filter(Boolean).join('\n\n'), undefined, readOnly, project)
        : [settings.system.trim(), cardsBlock, atBlock, projectBlock].filter(Boolean).join('\n\n'),
    }
    const baseMessagesPre: WireMsg[] = systemWire.content ? [systemWire, ...wires] : wires
    // Condenseur de contexte (OpenHands) : au-delà du seuil, l'historique ancien
    // est remplacé par un résumé LLM (échec → historique intégral, jamais cassé).
    const baseMessages = await condenseHistory(baseMessagesPre, {
      providerId: convProvider,
      model: settings.condenseModel || convModel,
      apiKey,
      customs,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      threshold: settings.condenseThreshold,
    })
    /** Le condenseur a-t-il remplacé l'historique ancien par un résumé ? (pastille) */
    const condensed = baseMessages !== baseMessagesPre
    if (condensed) patchLive((m) => ({ ...m, condensed: true }))

    /** Un tour d'agent : stream + exécution des outils, jusqu'à réponse finale ou délégation. */
    async function runTurns(
      agent: AgentId,
      delegationTask?: string,
      delegationFrom?: AgentId,
    ): Promise<{ delegation?: string; delegationTo?: AgentId; report?: string }> {
      if (!AGENTS[agent]) return {}
      // Checkpoint sandbox avant que l'agent n'agisse (/undo inspiré d'OpenCode) :
      // uniquement en mode agents (sandbox disque) et pas en Mode Plan (n'écrit pas).
      if (!readOnly && (conv?.agents?.length ?? multi)) {
        void fetch(`/api/sandbox/${convId}/git-undo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'checkpoint' }),
        }).catch(() => {})
      }
      patchLive((m) => ({ ...m, agent })) // le badge suit l'agent qui parle
      const pending: { calls: ToolCall[] | null } = { calls: null }
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        let phaseContent = ''
        // Rappel au dernier round : le modèle doit conclure en texte, plus d'appels d'outils
        const nudge: WireMsg | null =
          round === MAX_TOOL_ROUNDS - 1
            ? { role: 'user', content: '(Système) Dernier round autorisé : ne fais plus aucun appel d’outil, donne ta réponse finale en texte.' }
            : null
        const extra: WireMsg[] = nudge ? [nudge] : []
        await streamChat({
          providerId: convProvider,
          apiKey,
          model: convModel,
          messages:
            agent !== 'nexus'
              ? [
                  { role: 'system', content: systemPromptFor(agent, [settings.system, cardsBlock, projectBlock].filter(Boolean).join('\n\n'), delegationTask ? { task: delegationTask, from: delegationFrom } : undefined, readOnly, project, activeConnectors) },
                  ...wires,
                  ...extra,
                ]
              : [...baseMessages, ...extra],
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          signal: controller.signal,
          customs,
          // En délégation, l'agent de travail reçoit aussi son outil de rapport
          tools: delegationTask ? [...toolsFor(agent, readOnly, project?.id, activeConnectors), reportToolFor(agent)] : toolsFor(agent, readOnly, project?.id, activeConnectors),
          onDelta: (d) => {
            phaseContent += d
            patchLive((m) => ({ ...m, content: m.content + d }))
            scrollDown(convId)
          },
          onUsage: (u) => {
            patchLive((m) => ({ ...m, usage: u }))
          },
          onToolCalls: (c) => {
            pending.calls = c
          },
        })
        const callList = pending.calls
        pending.calls = null
        if (!callList?.length) {
          // Réponse finale en texte — en délégation, ce texte vaut rapport si l'outil n'a pas été appelé
          return delegationTask && phaseContent.trim() ? { report: phaseContent } : {}
        }
        if (agent !== 'nexus' && agent !== 'seeker' && agent !== 'deck') return {}

        wires.push({
          role: 'assistant',
          content: phaseContent || null,
          tool_calls: callList.map((c) => ({
            id: `${c.id}`, // id stringifié : sûr pour tout provider
            type: 'function' as const,
            function: { name: c.name, arguments: JSON.stringify(c.args) },
          })),
        })
        let delegation: string | undefined
        let delegationTo: AgentId | undefined
        let report: string | undefined
        for (const call of callList) {
          let result: string
          if (call.name === 'delegate_to_seeker' || call.name === 'delegate_to_deck' || call.name === 'delegate_to_nexus') {
            delegation = String(call.args.task ?? '')
            delegationTo = call.name === 'delegate_to_seeker' ? 'seeker' : call.name === 'delegate_to_deck' ? 'deck' : 'nexus'
            result = `Mission transmise à ${AGENTS[delegationTo].name}. Il/elle travaillera et rendra un rapport.`
          } else if (call.name === 'report_to_nexus' || call.name === 'report_to_deck') {
            report = String(call.args.report ?? '')
            result = 'Rapport reçu.'
          } else {
            // Permissions par outil (OpenCode) : deny → refus immédiat,
            // ask → l'utilisateur autorise/refuse dans le fil avant l'exécution.
            // write_project_file est TOUJOURS confirmé (défaut ask) : l'agent
            // écrit dans le dossier projet partagé, pas seulement la sandbox.
            const perm = call.name === 'write_project_file' ? (settings.toolPerms?.[call.name] ?? 'ask') : (settings.toolPerms?.[call.name] ?? 'allow')
            if (perm === 'deny') {
              result = `❌ refusé : l'outil ${call.name} est interdit par les réglages (permissions).`
            } else if (perm === 'ask') {
              const answer = await askToolPerm(call.name, call.args)
              if (!answer) result = `❌ refusé par l'utilisateur : ${call.name} n'a pas été exécuté.`
              else if (permAnswer === 'always') {
                settings.toolPerms = { ...(settings.toolPerms ?? {}), [call.name]: 'allow' }
                result = await runToolSafe(convId, call)
              } else result = await runToolSafe(convId, call)
            } else {
              result = await runToolSafe(convId, call)
            }
            const detail = result.slice(0, 80)
            patchLive((m) => ({ ...m, toolEvents: [...(m.toolEvents ?? []), { tool: call.name, detail }] }))
            appendToolLog({ conv: convId, ts: Date.now(), agent, tool: call.name, detail: result.slice(0, 160), ok: !result.startsWith('❌') && !result.startsWith('Erreur') })
          }
          wires.push({ role: 'tool', tool_call_id: call.id, content: result })
        }
        if (delegation || report) return { delegation, delegationTo, report }
      }
      // Rounds épuisés sans texte final : récap honnête des actions sandbox
      patchLive((m) =>
        m.content.trim()
          ? m
          : {
              ...m,
              content: `*(${(m.toolEvents ?? []).length} actions effectuées dans la sandbox — redemande un résumé pour le détail.)*`,
            },
      )
      return {}
    }

    try {
      if (multi) {
        /**
         * Orchestration délégation bidirectionnelle : Nexus ⇄ Seeker, Nexus ⇄ PromptDeck.
         * Boucle générique : l'agent courant travaille → s'il délègue à un agent ACTIF,
         * l'agent délégué prend le relais (avec mission + émetteur) → rapport retour →
         * l'émetteur conclut. Garde-fou : 6 délégations max par tour utilisateur.
         */
        const active = new Set(conv.agents ?? [])
        const r1 = await runTurns('nexus')
        // Mode collaboratif : PromptDeck bosse en parallèle de la 1ʳᵉ réponse de Nexus
        if (active.has('deck')) await runTurns('deck')

        let handoff = r1.delegation ? { to: r1.delegationTo ?? 'seeker', task: r1.delegation, from: 'nexus' as AgentId } : null
        let hops = 0
        while (handoff && hops < 6) {
          hops++
          if (!active.has(handoff.to)) {
            wires.push({ role: 'user', content: `(Système) ${AGENTS[handoff.to].name} n'est pas activé dans ce fil — traite la mission toi-même : « ${handoff.task} »` })
            await runTurns(handoff.from)
            break
          }
          const r = await runTurns(handoff.to, handoff.task, handoff.from)
          if (r.report) {
            // Rapport retour → l'émetteur conclut
            wires.push({ role: 'user', content: `(${AGENTS[handoff.to].name} a rendu son rapport à ${AGENTS[handoff.from].name})\n${r.report.slice(0, 4000)}` })
            await runTurns(handoff.from)
            handoff = null
          } else if (r.delegation) {
            // L'agent délégué re-délègue (ex. deck → nexus)
            handoff = { to: r.delegationTo ?? 'nexus', task: r.delegation, from: handoff.to }
          } else {
            handoff = null
          }
        }
        if (handoff && hops >= 6) {
          wires.push({ role: 'user', content: '(Système) Trop de délégations enchaînées — conclus directement.' })
          await runTurns('nexus')
        }
      } else {
        await streamChat({
          providerId: conv.providerId,
          apiKey,
          model: conv.model,
          messages: baseMessages,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          signal: controller.signal,
          customs,
          onDelta: (d) => {
            patchLive((m) => ({ ...m, content: m.content + d }))
            scrollDown(convId)
          },
          onUsage: (u) => {
            patchLive((m) => ({ ...m, usage: u }))
          },
        })
      }
      latencyMs = Math.round(performance.now() - started)
    } catch (e) {
      const err = e as Error
      if (err.name === 'AbortError') {
        // Bulle vide → on la retire ; sinon on marque l'arrêt
        const msgs = conversations.find((c) => c.id === convId)?.messages ?? []
        const last = msgs[msgs.length - 1]
        if (last && last.role === 'assistant' && !last.content) {
          conversations = conversations.map((c) => (c.id === convId ? { ...c, messages: msgs.slice(0, -1) } : c))
        } else {
          patchLive((m) => ({ ...m, content: m.content + '\n\n*_(arrêté)_*' }))
        }
      } else {
        patchLive((m) => ({
          ...m,
          error: true,
          content: m.content ? m.content + `\n\n**Erreur :** ${err.message || String(e)}` : err.message || String(e),
        }))
      }
    } finally {
      streamingIds = new Set([...streamingIds].filter((x) => x !== convId))
      aborts.delete(convId)
      scrollDown(convId)
    }
  }

  function send(text: string): void {
    if (!currentId) return
    const convId = currentId
    void sendTo(convId, text)
  }

  /** Commandes / tapées dans le composer (exécutées localement, jamais au LLM). */
  async function runSlash(cmd: string, cid: string): Promise<boolean> {
    const c = conversations.find((x) => x.id === cid)
    switch (cmd) {
      case '/undo':
        await undoSandbox(cid)
        return true
      case '/plan':
        togglePlanMode(cid)
        return true
      case '/agents':
        setAgents(c?.agents?.length ? [] : ['nexus', 'seeker'])
        return true
      case '/fichiers':
        openHub('files')
        return true
      case '/terminal':
        openHub('terminal')
        return true
      default:
        // Commande inconnue : le texte partira au modèle tel quel.
        return false
    }
  }

  /**
   * Fiches .CD activées pour UN fil (priorité) ou globalement (repli), plus
   * les MICROAGENTS (inspirés d'OpenHands) : fiches à `triggers:` (mots-clés
   * frontmatter) activées automatiquement quand le message les contient.
   */
  function activeCardsSystem(convId: string | null, userText = ''): string {
    const st = loadDeckState()
    const ids = (convId ? conversations.find((x) => x.id === convId)?.cardsActive : undefined) ?? st.active
    // Microagents : scan des fiches en cache pour un champ triggers: (liste CSV)
    const lower = userText.toLowerCase()
    const micro: string[] = []
    if (userText.trim().length >= 3) {
      for (const [id, raw] of Object.entries(st.cache)) {
        if (ids.includes(id)) continue // déjà active explicitement
        const m = /^---\r?\n[\s\S]*?\r?\n---/.exec(raw)
        const tr = m?.[0].match(/^triggers:(.*)$/m)
        if (!tr) continue
        const words = tr[1].split(/[,;]/).map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 3)
        if (words.some((w) => lower.includes(w))) micro.push(id)
      }
      if (micro.length) {
        const uniq = [...new Set([...ids, ...micro])]
        // En mode par-fil : on mémorise l'activation pour ce fil (l'utilisateur la voit)
        if (convId && conversations.find((x) => x.id === convId)?.cardsActive) {
          conversations = conversations.map((c) => (c.id === convId ? { ...c, cardsActive: uniq } : c))
        }
      }
    }
    const all = [...new Set([...ids, ...micro])]
    if (!all.length) return ''
    const loaded = all
      .map((id) => st.cache[id])
      .filter(Boolean)
      .map((raw) => raw!.slice(0, 6000))
    if (!loaded.length) return ''
    const autoNote = micro.length ? `\n\n(fiches déclenchées automatiquement par mots-clés : ${micro.join(', ')})` : ''
    return `Fiches de méthode activées par l'utilisateur — suis leurs instructions :\n\n${loaded.join('\n\n---\n\n')}${autoNote}`
  }

  /** Toggle d'une fiche activée pour le fil courant (pastille 🃏 du composer). */
  function toggleCardForConv(convId: string, id: string): void {
    conversations = conversations.map((c) => {
      if (c.id !== convId) return c
      const cur = c.cardsActive ?? loadDeckState().active
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
      return { ...c, cardsActive: next }
    })
  }

  /** Toggle Mode Plan (lecture seule) pour le fil courant. */
  function togglePlanMode(convId: string): void {
    conversations = conversations.map((c) => (c.id === convId ? { ...c, planMode: !(c.planMode ?? false) } : c))
  }

  /** /undo : revert des checkpoints agent dans la sandbox du fil. */
  async function undoSandbox(convId: string): Promise<void> {
    try {
      const r = await fetch(`/api/sandbox/${convId}/git-undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'revert', steps: 1 }),
      })
      const j = (await r.json()) as { ok?: boolean; reverted?: number; note?: string; error?: string }
      const note = j.error ? `❌ ${j.error}` : j.ok ? `↩ ${j.reverted} checkpoint(s) annulé(s)` : j.note ?? 'rien à annuler'
      conversations = conversations.map((c) =>
        c.id === convId
          ? { ...c, messages: [...c.messages, { role: 'assistant', content: `_(sandbox)_ ${note}`, ts: Date.now() } as Msg] }
          : c,
      )
    } catch (e) {
      conversations = conversations.map((c) =>
        c.id === convId
          ? { ...c, messages: [...c.messages, { role: 'assistant', content: `_(sandbox)_ erreur : ${(e as Error).message}`, ts: Date.now() } as Msg] }
          : c,
      )
    }
  }

  /** Fiches proposées dans la pastille 🃏 : actives globalement + cache (accès instantané). */
  const cardsOffer = $derived.by(() => {
    const st = loadDeckState()
    const ids = [...new Set([...st.active, ...Object.keys(st.cache)])].slice(0, 40)
    return ids.map((id) => ({ id, label: id }))
  })

  /** Saut depuis la recherche : ouvre le fil, scrolle au message et le flashe. */
  function jumpTo(convId: string, ts: number): void {
    selectChat(convId)
    flashTs = ts
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document.querySelector(`[data-ts="${ts}"]`)?.scrollIntoView({ block: 'center', behavior: 'auto' })
      }),
    )
    setTimeout(() => (flashTs = null), 1800)
  }

  /** Stoppe le stream d'une conversation (courante par défaut). */
  function stop(id?: string): void {
    aborts.get(id ?? currentId ?? '')?.abort()
  }

  const aborts = new Map<string, AbortController>()

  /* ---------- fenêtre flottante / pill ---------- */

  // appGeo héritée d'un écran plus grand (autre navigateur, écran débranché) :
  // on la ramène dans le viewport au montage, sinon la fenêtre déborde et le
  // reste de la page apparaît noir à droite/en bas.
  $effect(() => {
    if (layout.appMode !== 'floating') return
    const g = layout.appGeo
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (g.x + g.w > vw - 4 || g.y + g.h > vh - 4 || g.x < 0 || g.y < 0) {
      layout.setAppGeo({
        w: Math.min(g.w, Math.max(640, vw - 16)),
        h: Math.min(g.h, Math.max(480, vh - 16)),
        x: Math.max(0, Math.min(g.x, Math.max(0, vw - Math.min(g.w, vw - 16)) - 4)),
        y: Math.max(0, Math.min(g.y, Math.max(0, vh - Math.min(g.h, vh - 16)) - 4)),
      })
    }
  })

  function floatWith(geo: PaneGeometry): void {
    layout.setAppGeo(geo)
    layout.setAppMode('floating')
  }

  function floatSnap(rect: PaneGeometry, _edge: Edge): void {
    // Snap moitié/quarter/plein écran : applique le rect cible et reste flottant
    layout.setAppGeo(rect)
    layout.setAppMode('floating')
  }

  function restoreDocked(): void {
    layout.setAppMode('docked')
  }

  function togglePill(): void {
    layout.setAppMode(layout.appMode === 'pill' ? 'floating' : 'pill')
  }

  /* ---------- mode duel ---------- */

  function toggleDuel(): void {
    if (layout.duel) {
      layout.stopDuel()
      return
    }
    if (!current) return
    const other = conversations.find((c) => c.id !== current.id)
    if (other) layout.startDuel(current.id, other.id)
    else {
      const c = newConversation(current.providerId, current.model)
      conversations = [c, ...conversations]
      layout.startDuel(current.id, c.id)
    }
  }

  /**
   * Mode collaboratif : PromptDeck rejoint le duel en parallèle de Nexus et partage
   * le workspace de la conversation hôte (colonne gauche). Les fichiers des deux
   * agents fusionnent dans la même sandbox (préfixes nexus-/deck-).
   */
  function startCollab(): void {
    if (!current || streamingIds.has(current.id)) return
    const hostId = current.id
    // Le duo existe déjà ? On ne duplique pas
    if (conversations.some((c) => c.collabOf === hostId)) {
      const partner = conversations.find((c) => c.collabOf === hostId)!
      if (!layout.duel) layout.startDuel(hostId, partner.id)
      currentId = partner.id
      return
    }
    // Bootstrap garanti du workspace hôte avant le démarrage du partenaire
    void fetch(`/api/sandbox/${hostId}/bootstrap`, { method: 'POST' }).catch(() => {})
    const partner = newCollabConversation(current.providerId, current.model, hostId)
    conversations = [partner, ...conversations]
    if (!layout.duel) layout.startDuel(hostId, partner.id)
    currentId = partner.id
  }

  function startDuelResize(e: PointerEvent): void {
    e.preventDefault()
    const move = (ev: PointerEvent): void =>
      layout.setDuelSplit((ev.clientX / window.innerWidth) * 100)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** Duel : même texte envoyé simultanément aux deux conversations. */
  function sendBoth(text: string): void {
    const d = layout.duel
    if (!d) return
    void sendTo(d.left, text)
    void sendTo(d.right, text)
  }

  function toggleTerminal(): void {
    // Terminal : dock outils à droite (comme Réglages) quand le hub est fermé ;
    // sous le composer sinon (comportement historique conservé).
    if (showHub) {
      openHub('terminal')
      return
    }
    if (!showTerminal) terminalConvId = currentId
    showTerminal = !showTerminal
    dockTool = showTerminal ? 'terminal' : null
  }

  /** Exécution d'outil avec erreur capturée (utilisé par la gate de permissions).
   *  Les outils projet (read_project_file / list_project_tree) routent vers le
   *  workspace dédié p-<projectId> + dossiers Mac autorisés. */
  async function runToolSafe(convId: string, call: ToolCall): Promise<string> {
    try {
      if (call.name === 'write_project_file' || call.name === 'read_project_file' || call.name === 'list_project_tree') {
        const projectId = String(call.args.project ?? current?.projectId ?? '')
        return await execTool(`p-${projectId}`, call)
      }
      return await execTool(convId, call)
    } catch (e) {
      return `Erreur outil : ${(e as Error).message}`
    }
  }

  /** Cibles des panneaux hub (calculées une fois, utilisables dans le template). */
  const filesFid = $derived(filesConvId ?? currentId)
  const filesConv = $derived(filesFid ? conversations.find((x) => x.id === filesFid) : undefined)

  /** Connecteurs actifs : intégrés (toujours) + HTTP déclarés dans les réglages. */
  const activeConnectors = $derived.by(() => {
    const http = (settings.connectors ?? []).filter((c) => c.enabled !== false && c.name && c.baseUrl)
    return {
      builtin: BUILTIN_CONNECTORS.map((b) => ({ name: b.name, desc: b.desc })),
      http: http.map((h) => ({ name: h.name })),
    }
  })

  /** Réponse de la demande de permission outil en cours ('allow' | 'always' | 'deny'). */
  let permAnswer: 'allow' | 'always' | 'deny' | null = null
  /** Demande pending affichée dans le fil (message outil + boutons). */
  let pendingPerm = $state<{ name: string; args: Record<string, unknown>; resolve: (a: 'allow' | 'always' | 'deny') => void } | null>(null)

  /** Pause le tour d'agent et demande à l'utilisateur d'autoriser l'outil. */
  function askToolPerm(name: string, args: Record<string, unknown>): Promise<'allow' | 'always' | 'deny'> {
    return new Promise((resolve) => {
      pendingPerm = { name, args, resolve }
    })
  }

  function answerPerm(a: 'allow' | 'always' | 'deny'): void {
    permAnswer = a
    pendingPerm?.resolve(a)
    pendingPerm = null
  }

  /** Dock outils à droite (comme Réglages) : un seul panneau actif à la fois. */
  type DockTool = 'files' | 'terminal' | 'preview' | 'cascade' | null
  let dockTool = $state<DockTool>(null)
  function toggleToolDock(tool: Exclude<DockTool, null>, convId?: string): void {
    if (tool === 'files') filesConvId = convId ?? currentId
    if (tool === 'terminal') terminalConvId = convId ?? currentId
    if (tool === 'preview') previewConvId = convId ?? currentId
    // Si le hub est ouvert, il prend l'onglet correspondant (comportement IDE) ;
    // sinon le panneau se dock à droite du chat, comme Réglages.
    // (« cascade » n'existe pas comme onglet hub : il reste toujours en dock.)
    if (showHub && tool !== 'cascade') {
      openHub(tool)
      return
    }
    dockTool = dockTool === tool ? null : tool
    if (tool === 'files') showFiles = dockTool === 'files'
    if (tool === 'terminal') showTerminal = dockTool === 'terminal'
    if (tool === 'preview') showPreview = dockTool === 'preview'
  }

  /** Fichiers : hub s'il est ouvert, sinon dock outils à droite. */
  function toggleFiles(convId?: string): void {
    toggleToolDock('files', convId)
  }
  /** Preview : hub s'il est ouvert, sinon dock outils à droite. */
  function togglePreview(convId?: string): void {
    toggleToolDock('preview', convId)
  }

  /** Commit auto : git add -A + commit de la sandbox via l'endpoint sécurisé. */
  async function autoCommit(convId: string): Promise<void> {
    if (commitBusy) return
    commitBusy = true
    try {
      const r = await fetch(`/api/sandbox/${convId}/git-commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `Travail agents — ${new Date().toLocaleString('fr-FR')}` }),
      })
      const j = (await r.json()) as { ok?: boolean; hash?: string | null; error?: string; note?: string }
      if (j.error) alert(`Commit refusé : ${j.error}`)
      else if (j.hash === null) alert('Rien à committer — le workspace est déjà à jour.')
      else alert(`✅ Commit ${j.hash} créé dans la sandbox (visible dans l'arbre ⑂).`)
    } catch (e) {
      alert(`Commit impossible : ${(e as Error).message}`)
    } finally {
      commitBusy = false
    }
  }

  /**
   * Synthèse du duel : un 3ᵉ modèle compare et tranche.
   * Mode « débat en 2 tours » : A et B répliquent au verdict, puis l'arbitre re-juge.
   */
  async function arbitrate(): Promise<void> {
    const d = layout.duel
    if (!d || arbitreBusy) return
    const l = conversations.find((c) => c.id === d.left)
    const r = conversations.find((c) => c.id === d.right)
    if (!l || !r) return
    const apiKey = keys.openrouter
    if (!apiKey) {
      alert('Une clé OpenRouter est requise pour l’arbitre (⚙︎ Réglages).')
      return
    }
    const lastUser = (c: Conversation): string => [...c.messages].reverse().find((m) => m.role === 'user')?.content ?? '(question partagée)'
    const lastAnswer = (c: Conversation): string =>
      [...c.messages].reverse().find((m) => m.role === 'assistant' && m.content)?.content ?? '(pas de réponse)'
    const SYS =
      'Tu es l’arbitre neutre d’un duel de modèles. Compare objectivement les deux réponses à la même question : exactitude, complétude, clarté. Termine par une ligne « Verdict : A » ou « Verdict : B » ou « Verdict : égalité » suivie d’une courte justification. Réponds en français.'
    verdict = { text: '' }
    arbitreBusy = true
    const controller = new AbortController()
    arbitreAbort = controller
    const question = lastUser(l)
    const answerL = lastAnswer(l)
    const answerR = lastAnswer(r)
    const callArbitre = async (userContent: string): Promise<string> => {
      let out = ''
      await streamChat({
        providerId: 'openrouter',
        apiKey,
        model: arbitreModel,
        temperature: 0.2,
        maxTokens: 1200,
        signal: controller.signal,
        messages: [
          { role: 'system', content: SYS },
          { role: 'user', content: userContent },
        ],
        onDelta: (t) => {
          out += t
          verdict = { text: (verdict?.text ?? '') + t }
        },
      })
      return out
    }
    try {
      // Tour 1 : verdict initial A vs B
      const round1 = await callArbitre(`Question :
${question}

— Réponse A (gauche, modèle ${l.model}) :
${answerL.slice(0, 4000)}

— Réponse B (droite, modèle ${r.model}) :
${answerR.slice(0, 4000)}`)
      if (!settings.arbitreDebate) return

      // Débat : tour 2 — chaque modèle réplique au verdict, puis re-verdict final
      verdict = { text: (verdict?.text ?? '') + '\n\n——— Débat — tour 2 ———\n' }
      const rebuttal = async (side: 'A' | 'B', conv: Conversation, own: string, other: string): Promise<string> => {
        let text = ''
        await streamChat({
          providerId: conv.providerId,
          apiKey: keyOf(conv.providerId),
          model: conv.model,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          signal: controller.signal,
          customs,
          messages: [
            {
              role: 'system',
              content: `Tu défends ta réponse dans un débat. L'arbitre a rendu ce verdict provisoire :\n« ${round1.slice(0, 2500)} »\nRéponds en UNE seule réplique concise (max ~150 mots) : corrige les erreurs qu'il t'attribue, renforce tes points solides, reste factuel. Réponds en français.`,
            },
            {
              role: 'user',
              content: `Question :
${question}

— Ta réponse ${side} :
${own.slice(0, 3000)}

— Réponse adverse :
${other.slice(0, 3000)}`,
            },
          ],
          onDelta: (t) => {
            text += t
            verdict = { text: (verdict?.text ?? '') + t }
          },
        })
        return text
      }
      const repA = await rebuttal('A', l, answerL, answerR)
      verdict = { text: (verdict?.text ?? '') + '\n\n——— Réplique de B ———\n' }
      const repB = await rebuttal('B', r, answerR, answerL)

      // Verdict final définitif
      verdict = { text: (verdict?.text ?? '') + '\n\n——— Verdict final ———\n' }
      await callArbitre(`Question :
${question}

— Réponse A :
${answerL.slice(0, 2500)}

— Réponse B :
${answerR.slice(0, 2500)}

— Réplique de A au verdict provisoire :
${repA.slice(0, 2500)}

— Réplique de B au verdict provisoire :
${repB.slice(0, 2500)}

Rends le verdict DÉFINITIF en tenant compte des répliques : « Verdict : A », « Verdict : B » ou « Verdict : égalité » + justification courte.`)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') verdict = { text: `Erreur : ${(e as Error).message}` }
    } finally {
      arbitreBusy = false
    }
  }

  function stopArbitre(): void {
    arbitreAbort?.abort()
  }

  /** Fait avancer le cycle de snap au clavier/palette : quarters → moitiés → plein écran → retour. */
  function cycleSnap(): void {
    const cycle = snapCycle('left')
    if (layout.appMode !== 'floating') {
      floatWith(zoneRect(cycle[0], window.innerWidth, window.innerHeight))
      return
    }
    const cur = layout.appGeo
    const vw = window.innerWidth
    const vh = window.innerHeight
    const ix = cycle.findIndex((e) => {
      const r = zoneRect(e, vw, vh)
      return Math.abs(r.x - cur.x) < 12 && Math.abs(r.y - cur.y) < 12 && Math.abs(r.w - cur.w) < 12 && Math.abs(r.h - cur.h) < 12
    })
    const next = cycle[(ix + 1) % cycle.length]
    layout.setAppGeo(zoneRect(next, vw, vh))
    layout.setAppMode('floating')
  }

  /* ---------- popouts ---------- */

  async function popout(panel: 'chat' | 'settings'): Promise<void> {
    const ok = await layout.openPopout(panel, panel === 'chat' ? currentId : null)
    if (!ok) alert('Le navigateur a bloqué la fenêtre popout — autorise les popups pour ce site.')
  }

  /* ---------- import / export ---------- */

  function exportCurrent(): void {
    if (!current) return
    downloadJson(`chatdeck-${current.title.slice(0, 24).replace(/[^\w-]+/g, '_') || 'conversation'}.json`, buildExport([current], customs))
  }
  function exportAll(): void {
    downloadJson(`chatdeck-export-${new Date().toISOString().slice(0, 10)}.json`, buildExport(conversations, customs))
  }
  async function importFile(file: File): Promise<void> {
    const raw = await file.text()
    const { conversations: imported, error } = validateImport(raw)
    if (error) {
      alert(`Import impossible : ${error}`)
      return
    }
    const known = new Set(conversations.map((c) => c.id))
    const fresh = imported.filter((c) => !known.has(c.id))
    if (!fresh.length) {
      alert('Rien à importer (conversations déjà présentes).')
      return
    }
    if (!confirm(`Importer ${fresh.length} conversation(s) ?`)) return
    conversations = [...fresh.map((c) => ({ ...c, open: true })), ...conversations]
  }

  /* ---------- clavier global ---------- */

  function onKeydown(e: KeyboardEvent): void {
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      showPalette = !showPalette
    } else if (mod && e.key.toLowerCase() === 'n') {
      e.preventDefault()
      newChat(e.shiftKey)
    } else if (mod && e.key.toLowerCase() === 'w') {
      e.preventDefault()
      if (currentId) closeTab(currentId)
    } else if (mod && e.key.toLowerCase() === 'e') {
      e.preventDefault()
      exportCurrent()
    } else if (mod && e.key.toLowerCase() === 'i') {
      e.preventDefault()
      document.querySelector<HTMLInputElement>('input[type=file]')?.click()
    } else if (mod && e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      void popout('chat')
    } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      showSearch = !showSearch
    } else if (mod && e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault()
      cycleSnap()
    } else if (mod && e.key === '\\') {
      e.preventDefault()
      layout.toggleSidebar()
    } else if (e.key === 'Escape') {
      showPalette = false
      showSearch = false
    }
  }

  /* ---------- projets (sandbox partagée + dossiers Mac + règles) ---------- */

  function createProject(name: string): void {
    const p = newProject(name)
    projects = [...projects, p]
    saveProjects(projects)
  }
  function deleteProject(id: string): void {
    // Les conversations liées sont détachées (jamais supprimées)
    projects = projects.filter((p) => p.id !== id)
    conversations = conversations.map((c) => (c.projectId === id ? { ...c, projectId: undefined } : c))
    saveConversations(conversations)
    saveProjects(projects)
  }
  function updateProject(id: string, patch: Partial<Project>): void {
    projects = projects.map((p) => (p.id === id ? { ...p, ...patch } : p))
    saveProjects(projects)
  }
  function attachToProject(convId: string, projectId: string | null): void {
    conversations = conversations.map((c) => (c.id === convId ? { ...c, projectId: projectId ?? undefined } : c))
    projects = projects.map((p) => ({ ...p, conversations: p.conversations.filter((x) => x !== convId) }))
    if (projectId) projects = projects.map((p) => (p.id === projectId ? { ...p, conversations: [...p.conversations, convId] } : p))
    saveConversations(conversations)
    saveProjects(projects)
  }
  const projectOf = (id: string | undefined): Project | undefined => (id ? projects.find((p) => p.id === id) : undefined)

  /** Dossiers Mac autorisés : GET via /api/sandbox/projects-folders (registre disque). */
  async function setProjectFolders(id: string, folders: string[]): Promise<string | null> {
    try {
      const r = await fetch(`/api/sandbox/projects/${id}/folders`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folders }),
      })
      const j = (await r.json()) as { ok?: boolean; error?: string }
      if (j.error) return j.error
      updateProject(id, { folders })
      return null
    } catch (e) {
      return (e as Error).message
    }
  }

  /* ---------- palette ---------- */

  /** Notification éphémère (coin bas) — sert au retour de « + instance ». */
  let notice = $state('')
  let noticeTimer: ReturnType<typeof setTimeout> | null = null
  function notify(msg: string): void {
    notice = msg
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => (notice = ''), 5000)
  }

  /** « + instance » : IPC Electron d'abord, sinon endpoint web (npm run app:multi). */
  async function launchInstance(): Promise<void> {
    try {
      const bridge = (window as { chatdeck?: { launchInstance?: () => Promise<{ ok: boolean; error?: string }> } }).chatdeck
      if (bridge?.launchInstance) {
        const r = await bridge.launchInstance()
        if (!r.ok) throw new Error(r.error ?? 'échec IPC')
        notify('⚡ Nouvelle instance ChatDeck lancée')
        return
      }
      const r = await fetch('/api/sandbox/launch-instance', { method: 'POST' })
      const j = (await r.json()) as { ok: boolean; error?: string }
      if (!j.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      notify('⚡ Nouvelle instance ChatDeck lancée')
    } catch (e) {
      notify(`+ instance : ${(e as Error).message}`)
    }
  }

  const commands = $derived<Command[]>([
    { id: 'new-instance', label: '+ instance', hint: '⚡ 2ᵈ ChatDeck indépendante', run: () => void launchInstance() },
    { id: 'new', label: 'Nouvelle conversation', hint: '⌘N', run: () => newChat() },
    { id: 'incognito', label: 'Nouvelle conversation incognito 👻', hint: '⌘⇧N', run: () => newChat(true) },
    { id: 'theme', label: `Basculer en thème ${settings.theme === 'dark' ? 'clair' : 'sombre'}`, run: () => (settings = { ...settings, theme: settings.theme === 'dark' ? 'light' : 'dark' }) },
    { id: 'popout-chat', label: 'Sortir la conversation en fenêtre', hint: '⌘⌥F', run: () => void popout('chat') },
    { id: 'popout-settings', label: 'Sortir les réglages en fenêtre', run: () => void popout('settings') },
    { id: 'sidebar', label: 'Afficher/masquer le panneau latéral', hint: '⌘\\', run: () => layout.toggleSidebar() },
    { id: 'settings', label: 'Réglages', hint: '⌘,', run: () => layout.toggleSettings() },
    { id: 'export', label: 'Exporter la conversation courante', hint: '⌘E', run: exportCurrent },
    { id: 'export-all', label: 'Exporter toutes les conversations', run: exportAll },
    { id: 'import', label: 'Importer un JSON', hint: '⌘I', run: () => document.querySelector<HTMLInputElement>('input[type=file]')?.click() },
    { id: 'merge', label: 'Fusionner les conversations incognito', run: mergeIncognito },
    { id: 'reset-layout', label: 'Réinitialiser la disposition des panneaux', run: () => layout.reset() },
    { id: 'agents', label: current?.agents?.length ? 'Désactiver les agents Nexus & Seeker' : 'Activer les agents Nexus & Seeker (sandbox)', run: () => setAgents(current?.agents?.length ? [] : ['nexus', 'seeker']) },
    { id: 'collab', label: 'Collaboration : Nexus + PromptDeck en parallèle (workspace partagé)', run: startCollab },
    { id: 'files', label: showFiles ? 'Fermer le panneau Fichiers (sandbox)' : 'Ouvrir le panneau Fichiers (sandbox)', run: () => (showFiles = !showFiles) },
    { id: 'graph', label: 'Graphe Graphify (fenêtre outils)', run: () => openHub('graph') },
    { id: 'commit', label: 'Commit auto de la sandbox (git add + commit)', run: () => currentId && void autoCommit(currentId) },
    { id: 'search', label: 'Rechercher dans toutes les conversations', hint: '⌘⇧F', run: () => (showSearch = true) },
    { id: 'hub', label: showHub ? 'Fermer la fenêtre outils' : 'Fenêtre outils : Graphify, Fichiers, Terminal, Preview, Réglages', run: () => openHub(hubTab) },
    { id: 'tour', label: "Mode d'emploi interactif (visite guidée)", run: () => (showTour = true) },
    { id: 'duel', label: layout.duel ? 'Quitter le mode duel' : 'Mode duel : deux conversations côte à côte', run: toggleDuel },
    { id: 'debate', label: `Arbitre : débat en 2 tours ${settings.arbitreDebate ? '✓ (désactiver)' : '(activer)'}`, run: () => (settings = { ...settings, arbitreDebate: !settings.arbitreDebate }) },
    { id: 'float', label: 'Fenêtre flottante', run: () => floatWith(layout.appGeo) },
    { id: 'snap', label: 'Snap : zone suivante (quarter → moitié → plein écran)', hint: '⌘⌥S', run: cycleSnap },
    { id: 'pill', label: layout.appMode === 'pill' ? 'Restaurer depuis la barre de tâches' : 'Réduire en barre de tâches (pill)', run: togglePill },
  ])

  const SUGGESTIONS = [
    'Explique-moi Svelte 5 en 5 phrases.',
    'Écris une fonction debounce en TypeScript.',
    'Résume les différences entre Ollama et OpenRouter.',
  ]
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet ideShell()}
  <Toolbar
    conv={current}
    streaming={anyStreaming}
    duelActive={Boolean(layout.duel)}
    agentsActive={Boolean(current?.agents?.length)}
    filesOpen={showFiles}
    terminalOpen={showTerminal}
    previewOpen={showPreview}
    graphOpen={showGraph}
    onToggleAgents={() => setAgents(current?.agents?.length ? [] : ['nexus', 'seeker'])}
    onToggleDuel={toggleDuel}
    onToggleFiles={() => toggleFiles()}
    onToggleTerminal={toggleTerminal}
    onTogglePreview={() => togglePreview()}
    onToggleGraph={() => openHub('graph')}
    onToggleHub={() => openHub(hubTab)}
    hubOpen={showHub}
    onSearch={() => (showSearch = true)}
    onSettings={() => layout.toggleSettings()}
  />
  <div class="shell">
    {#if !layout.layout.sidebarCollapsed}
      <div class="dock-left" style="width: {layout.layout.sidebarWidth}px">
        <Sidebar
          {conversations}
          {currentId}
          {customs}
          {projects}
          onCreateProject={createProject}
          onDeleteProject={deleteProject}
          onUpdateProject={updateProject}
          onAttachProject={attachToProject}
          onSetProjectFolders={setProjectFolders}
          onNew={() => newChat()}
          onNewIncognito={() => newChat(true)}
          onSelect={selectChat}
          onDelete={deleteChat}
          onMergeIncognito={mergeIncognito}
          onExportAll={exportAll}
          onExportCurrent={exportCurrent}
          onImport={(f) => void importFile(f)}
        />
        <div class="splitter" role="separator" aria-orientation="vertical"
          onpointerdown={(e) => startSidebarResize(e)}
          ondblclick={() => layout.setSidebarWidth(248)}
        ></div>
      </div>
    {:else}
      <button class="rail" onclick={() => layout.toggleSidebar()} title="Afficher le panneau latéral (⌘\\)">»</button>
    {/if}

    <main class="main">
      <TabBar
        {conversations}
        {currentId}
        {streamingIds}
        {customs}
        onSelect={selectChat}
        onClose={closeTab}
        onNew={() => newChat()}
        onReorder={reorderTabs}
      />
      {#if current}
        <NetworkBanner />
        {#if showCleanup}
          <CleanupBanner onDone={() => (showCleanup = false)} />
        {/if}
        <div class="messages" bind:this={scroller}>
          {#if current.messages.length === 0}
            <div class="hero">
              <div class="logo">⚡</div>
              <h1>ChatDeck</h1>
              <p>Chat LLM léger — {providerOf(current.providerId, customs).label} · <code class="mono">{current.model}</code></p>
              <div class="chips">
                {#each SUGGESTIONS as s}
                  <button class="chip" onclick={() => send(s)}>{s}</button>
                {/each}
              </div>
            </div>
          {:else}
            {#each current.messages as m, i (i)}
              <div class="msg" class:flash={flashTs === m.ts} data-ts={m.ts}>
                <ChatMessage msg={m} />
                <MessageActions
                  msg={m}
                  isLast={i === current.messages.length - 1}
                  streaming={streamingIds.has(current.id)}
                  cardsApplied={m.cards ?? []}
                  canUndo={Boolean(current.agents?.length) && !(current.planMode ?? false)}
                  onUndo={() => void undoSandbox(current.id)}
                  onRegenerate={() => regenerate(current.id, m.ts)}
                  onUseAsPrompt={(t) => send(t)}
                  onDelete={() => deleteFrom(current.id, m.ts)}
                />
              </div>
            {/each}
          {/if}
        </div>
        <Composer
          streaming={streamingIds.has(current.id)}
          convId={current.id}
          providerId={current.providerId}
          model={current.model}
          {customs}
          agents={current.agents ?? []}
          agentsActive={Boolean(current.agents?.length)}
          cards={cardsOffer}
          cardsActive={current.cardsActive ?? []}
          onToggleCard={(id) => toggleCardForConv(current.id, id)}
          planMode={current.planMode ?? false}
          onTogglePlan={() => togglePlanMode(current.id)}
          onSend={send}
          onStop={stop}
          onProvider={setProvider}
          onModel={setModel}
          onAgents={setAgents}
          onSlash={(cmd) => void runSlash(cmd, current.id)}
        />
        {#if showTerminal && terminalConvId === current.id && (!showHub || hubActive !== 'terminal') && dockTool !== 'terminal'}
          <div class="term-docked">
            <TerminalPanel convId={terminalConvId} onClose={() => (showTerminal = false)} />
          </div>
        {/if}
      {/if}
    </main>

    {#if !layout.layout.settingsCollapsed && !(showHub && hubActive === 'settings')}
      <div class="dock-right" style="width: {layout.layout.settingsWidth}px">
        <SettingsPanel
          {keys}
          {settings}
          {customs}
          onKeys={(k) => (keys = k)}
          onSettings={(s) => (settings = s)}
          onAddCustom={() => {
            const id = `custom:${Math.random().toString(36).slice(2, 7)}`
            customs = [...customs, { id, name: 'Nouveau fournisseur', baseUrl: '', keyHeader: 'Authorization', models: [] }]
          }}
          onUpdateCustom={(p) => (customs = customs.map((x) => (x.id === p.id ? p : x)))}
          onRemoveCustom={(id) => (customs = customs.filter((x) => x.id !== id))}
          onClose={() => layout.toggleSettings()}
          onPopout={() => void popout('settings')}
          onSendNote={send}
          onReplayTour={() => (showTour = true)}
        />
        <div class="splitter" role="separator" aria-orientation="vertical"
          onpointerdown={(e) => startSettingsResize(e)}
          ondblclick={() => layout.setSettingsWidth(400)}
        ></div>
      </div>
    {/if}

    <!-- Dock outils à droite (comme Réglages) : Fichiers / Terminal / Preview,
         quand le hub est fermé et que l'outil est demandé depuis la toolbar. -->
    {#if dockTool && !showHub && (dockTool !== 'terminal' || hubActive !== 'terminal')}
      <div class="dock-right dock-tools" style="width: {Math.max(300, Math.min(560, layout.layout.settingsWidth))}px">
        {#if dockTool === 'files'}
          {#if filesFid && filesConv}
            <FilesPanel convId={filesFid} enabled={Boolean(filesConv.agents?.length)} onClose={() => { dockTool = null; showFiles = false }} />
          {:else}
            <p class="hub-empty">Aucune conversation — crée-en une pour voir ses fichiers.</p>
          {/if}
        {:else if dockTool === 'terminal'}
          {#if terminalConvId}
            <TerminalPanel convId={terminalConvId} onClose={() => { dockTool = null; showTerminal = false }} />
          {:else}
            <p class="hub-empty">Aucune conversation pour le terminal.</p>
          {/if}
        {:else if dockTool === 'preview' && (previewConvId ?? currentId)}
          <PreviewPanel convId={previewConvId ?? currentId!} onClose={() => { dockTool = null; showPreview = false }} />
        {:else if dockTool === 'cascade'}
          <CascadePanel onClose={() => (dockTool = null)} />
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

<!-- Une colonne de conversation, réutilisée pour les deux côtés du duel -->
{#snippet convPane(convId: string)}
  {@const c = conversations.find((x) => x.id === convId)}
  {#if c}
    <Toolbar
      variant="perConv"
      conv={c}
      streaming={streamingIds.has(convId)}
      duelActive={false}
      agentsActive={Boolean(c.agents?.length)}
      filesOpen={showFiles && filesConvId === convId}
      terminalOpen={showTerminal && terminalConvId === convId}
      onToggleAgents={() => setAgentsFor(convId, c.agents?.length ? [] : ['nexus', 'seeker'])}
      onToggleDuel={() => {}}
      onToggleFiles={() => toggleFiles(convId)}
      onToggleTerminal={() => { terminalConvId = convId; showTerminal = !showTerminal }}
      onSearch={() => (showSearch = true)}
      onSettings={() => layout.toggleSettings()}
    />
    <div class="col-head">
      <span class="dot" style="background:{providerOf(c.providerId, customs).color}"></span>
      <span class="col-title">{c.incognito ? '👻 ' : ''}{c.title}</span>
      <span class="mono col-model">{c.model}</span>
      <button class="mini" onclick={() => stop(convId)} disabled={!streamingIds.has(convId)} title="Arrêter">■</button>
    </div>
    <div class="messages">
      {#each c.messages as m, i (i)}
        <div class="msg" class:flash={flashTs === m.ts} data-ts={m.ts}>
          <ChatMessage msg={m} />
          {#if !m.error}
            <MessageActions
              msg={m}
              isLast={i === c.messages.length - 1}
              streaming={streamingIds.has(convId)}
              cardsApplied={m.cards ?? []}
              onRegenerate={() => regenerate(convId, m.ts)}
              onUseAsPrompt={(t) => void sendTo(convId, t)}
              onDelete={() => deleteFrom(convId, m.ts)}
            />
          {/if}
        </div>
      {/each}
    </div>
    {#if pendingPerm}
      <div class="perm-ask" role="alertdialog" aria-label="Permission outil">
        <span class="perm-ico">🔐</span>
        <span class="perm-txt">L'agent demande à exécuter <code>{pendingPerm.name}</code>{Object.keys(pendingPerm.args).length ? ` (${Object.entries(pendingPerm.args).map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`).join(', ')})` : ''}</span>
        <button class="perm-btn allow" onclick={() => answerPerm('allow')}>Autoriser</button>
        <button class="perm-btn always" onclick={() => answerPerm('always')}>Toujours</button>
        <button class="perm-btn deny" onclick={() => answerPerm('deny')}>Refuser</button>
      </div>
    {/if}
    <Composer
      streaming={streamingIds.has(convId)}
      convId={convId}
      providerId={c.providerId}
      model={c.model}
      {customs}
      agents={c.agents ?? []}
      cards={cardsOffer}
      cardsActive={c.cardsActive ?? []}
      onToggleCard={(id) => toggleCardForConv(convId, id)}
      planMode={c.planMode ?? false}
      onTogglePlan={() => togglePlanMode(convId)}
      onSend={(t) => void sendTo(convId, t)}
      onStop={() => stop(convId)}
      onProvider={setProvider}
      onModel={setModel}
      onAgents={(l) => setAgentsFor(convId, l)}
      onSendBoth={sendBoth}
    />
    {#if showTerminal && terminalConvId === convId && (!showHub || hubActive !== 'terminal') && dockTool !== 'terminal'}
      <div class="term-docked">
        <TerminalPanel convId={terminalConvId} onClose={() => (showTerminal = false)} />
      </div>
    {/if}
  {/if}
{/snippet}

{#if layout.appMode === 'pill'}
  <TaskbarPill
    conv={current}
    streaming={anyStreaming}
    tokens={current?.messages.filter((m) => m.role === 'assistant').at(-1)?.usage?.completion ?? 0}
    {customs}
    agentsActive={Boolean(current?.agents?.length)}
    filesOpen={showFiles}
    terminalOpen={showTerminal}
    previewOpen={showPreview}
    onRestore={() => layout.setAppMode('floating')}
    onToggleAgents={() => setAgents(current?.agents?.length ? [] : ['nexus', 'seeker'])}
    onToggleFiles={() => toggleFiles()}
    onToggleTerminal={toggleTerminal}
    onTogglePreview={() => togglePreview()}
    onSettings={() => layout.toggleSettings()}
  />
{:else if layout.duel}
  <div class="app">
    <WindowFrame
      title="ChatDeck — duel"
      onMinimize={togglePill}
      onMaximize={() => document.documentElement.requestFullscreen?.().catch(() => {})}
      onClose={() => layout.stopDuel()}
    >
      <Toolbar
        conv={current}
        streaming={anyStreaming}
        duelActive={Boolean(layout.duel)}
        agentsActive={Boolean(current?.agents?.length)}
        filesOpen={showFiles}
        terminalOpen={showTerminal}
        graphOpen={showGraph}
        onToggleAgents={() => setAgents(current?.agents?.length ? [] : ['nexus', 'seeker'])}
        onToggleDuel={toggleDuel}
        onToggleFiles={() => (showFiles = !showFiles)}
        onToggleTerminal={toggleTerminal}
        onToggleGraph={() => openHub('graph')}
        onSearch={() => (showSearch = true)}
        onSettings={() => layout.toggleSettings()}
      />
      <!-- Bannières réseau + nettoyage sandbox visibles AUSSI en duel :
           le duel court-circuite ideShell, les bannières y étaient perdues. -->
      <NetworkBanner />
      {#if showCleanup}
        <CleanupBanner onDone={() => (showCleanup = false)} />
      {/if}
      <div class="shell">
        <div class="duel-col" data-conv={layout.duel.left} style="width:{layout.duelSplit}%">
          {@render convPane(layout.duel.left)}
        </div>
        <div class="splitter duel-split" role="separator" aria-orientation="vertical"
          onpointerdown={startDuelResize}
          ondblclick={() => layout.setDuelSplit(50)}
        ></div>
        <div class="duel-col" data-conv={layout.duel.right} style="width:{100 - layout.duelSplit}%">
          {@render convPane(layout.duel.right)}
        </div>
      </div>
      <div class="verdictbar">
        <select bind:value={arbitreModel} title="Modèle arbitre">
          <option value="anthropic/claude-sonnet-4">Arbitre : Claude Sonnet 4</option>
          <option value="openai/gpt-4.1">Arbitre : GPT-4.1</option>
          <option value="google/gemini-2.5-flash">Arbitre : Gemini 2.5 Flash</option>
        </select>
        <label class="debate" title="A et B répliquent au verdict, puis l'arbitre tranche définitivement">
          <input type="checkbox" bind:checked={settings.arbitreDebate} /> débat 2 tours
        </label>
        {#if arbitreBusy}
          <button class="ghost" onclick={stopArbitre}>■ arrêter</button>
        {:else}
          <button class="ghost" onclick={() => void arbitrate()} disabled={!layout.duel.left || !layout.duel.right}>
            ⚖︎ {settings.arbitreDebate ? 'Débat' : 'Synthèse'}
          </button>
        {/if}
        <button class="ghost" onclick={startCollab} title="Collaboratif : Nexus + PromptDeck en parallèle, workspace partagé">🃏 Collab</button>
        <button class="ghost" onclick={() => void autoCommit(layout.duel!.left)} disabled={commitBusy} title="git add + commit de la sandbox via l'endpoint sécurisé">
          {commitBusy ? '…' : '⑂ commit auto'}
        </button>
        <button class="ghost" class:active={showGraph} onclick={() => openHub('graph')} title="Graphe des conversations et workspaces (fenêtre outils)">🕸</button>
      </div>
      {#if verdict}
        <div class="verdict">
          <header class="vhead">
            <strong>⚖︎ Arbitrage — {arbitreModel}{settings.arbitreDebate ? ' · débat 2 tours' : ''}</strong>
            <button class="mini" onclick={() => (verdict = null)} title="Fermer">×</button>
          </header>
          <div class="vbody">{verdict.text}<span class="cursor">{arbitreBusy ? '▍' : ''}</span></div>
        </div>
      {/if}
    </WindowFrame>

    <StatusBar conv={current} streaming={anyStreaming} {latencyMs} {customs} onCascade={() => { dockTool = dockTool === 'cascade' ? null : 'cascade' }} />
    {#if notice}
      <div class="notice" role="status">{notice}</div>
    {/if}
  </div>
{:else if layout.appMode === 'floating'}
  <FloatingWindow
      geo={layout.appGeo}
      title="ChatDeck — IDE premium"
      onGeo={floatWith}
      onSnap={floatSnap}
      onRestore={restoreDocked}
      onMinimize={togglePill}
    >
    {@render ideShell()}
    <StatusBar conv={current} streaming={anyStreaming} {latencyMs} {customs} onCascade={() => { dockTool = dockTool === 'cascade' ? null : 'cascade' }} />
  </FloatingWindow>
{:else}
  <div class="app">
    <WindowFrame
      title="ChatDeck — IDE premium"
      onMinimize={togglePill}
      onMaximize={() => document.documentElement.requestFullscreen?.().catch(() => {})}
      onClose={restoreDocked}
    >
    {@render ideShell()}
    </WindowFrame>

    <StatusBar conv={current} streaming={anyStreaming} {latencyMs} {customs} onCascade={() => { dockTool = dockTool === 'cascade' ? null : 'cascade' }} />
  </div>
{/if}

{#if showSearch}
  <SearchPanel {conversations} onOpen={jumpTo} onClose={() => (showSearch = false)} />
{/if}

{#if showGraph && showHub && hubInView.includes('graph')}
  <!-- Graphify : rendu DANS le hub (fenêtre déplaçable), jamais en overlay devant le chat -->
{/if}

{#if showFiles && showHub && hubInView.includes('files') && (filesConvId ?? currentId)}
  <!-- Fichiers : idem, dans le hub -->
{/if}

{#if showHub && hubInView.length}
  <HubWindow
    tabs={hubInView}
    active={hubActive}
    onTab={(t) => (hubTab = t)}
    onClose={() => (showHub = false)}
    onDetach={detachHubTab}
  >
    <!-- Panneaux GARDÉS MONTÉS (display:none) : changer d'onglet est instantané
         — pas de refetch d'arbre, pas de re-init terminal/preview à chaque clic. -->
    <div hidden={hubActive !== 'graph'}>
      <GraphPanel {conversations} onOpen={(id) => selectChat(id)} onClose={() => (showHub = false)} />
    </div>
    <div hidden={hubActive !== 'files'}>
      {#if filesFid && filesConv}
        <FilesPanel convId={filesFid} enabled={Boolean(filesConv.agents?.length)} onClose={() => (showHub = false)} />
      {:else}
        <p class="hub-empty">Aucune conversation — crée-en une pour voir ses fichiers.</p>
      {/if}
    </div>
    <div hidden={hubActive !== 'terminal' || dockTool === 'terminal'}>
      {#if terminalConvId}
        <TerminalPanel convId={terminalConvId} onClose={() => (showHub = false)} />
      {:else}
        <p class="hub-empty">Aucune conversation pour le terminal.</p>
      {/if}
    </div>
    <div hidden={hubActive !== 'preview'}>
      {#if previewConvId ?? currentId}
        <PreviewPanel convId={previewConvId ?? currentId!} onClose={() => (showHub = false)} />
      {:else}
        <p class="hub-empty">Aucune conversation pour la preview.</p>
      {/if}
    </div>
    <div hidden={hubActive !== 'settings'} class="hub-settings">
      <SettingsPanel
        {keys}
        {settings}
        {customs}
        onKeys={(k) => (keys = k)}
        onSettings={(s) => (settings = s)}
        onAddCustom={() => {
          const id = `custom:${Math.random().toString(36).slice(2, 7)}`
          customs = [...customs, { id, name: 'Nouveau fournisseur', baseUrl: '', keyHeader: 'Authorization', models: [] }]
        }}
        onUpdateCustom={(p) => (customs = customs.map((x) => (x.id === p.id ? p : x)))}
        onRemoveCustom={(id) => (customs = customs.filter((x) => x.id !== id))}
        onClose={() => (showHub = false)}
        onSendNote={send}
        onReplayTour={() => (showTour = true)}
      />
    </div>
    <div hidden={hubActive !== 'deck'}>
      <DeckPanel onClose={() => (showHub = false)} onPopout={popoutDeck} />
    </div>
    <div hidden={hubActive !== 'connecteurs'}>
      <ConnectorsPanel
        connectors={settings.connectors ?? []}
        onConnectors={(list) => (settings = { ...settings, connectors: list })}
        onClose={() => (showHub = false)}
      />
    </div>
  </HubWindow>
{/if}

{#if showPalette}
  <CommandPalette {commands} onClose={() => (showPalette = false)} />
{/if}

{#if showTour}
  <WelcomeTour
    onClose={() => {
      showTour = false
      markTourDone()
    }}
    onAction={tourAction}
  />
{/if}

<style>
  .app {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .hub-empty {
    margin: auto;
    color: var(--muted, var(--fg));
    opacity: 0.7;
    font-size: 13px;
  }
  .hub-settings {
    display: flex;
    min-height: 0;
    flex: 1;
  }
  /* Notification éphémère (retour « + instance ») — coin bas droit */
  .notice {
    position: fixed;
    right: 16px;
    bottom: 44px;
    z-index: 95;
    max-width: 380px;
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--panel) 92%, transparent);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
    font-size: 13px;
  }
  /* Terminal docké sous le composer : le panneau (fixed chez lui) s'y déplie.
   * La règle :global(.hubbed) du hub l'ancre aussi quand il vit dans le hub. */
  .term-docked {
    position: relative;
    flex-shrink: 0;
    display: flex;
  }
  .term-docked :global(.term) {
    position: static;
    width: 100%;
    max-width: none;
    /* hauteur pilotée par la poignée du panneau (style inline), bornée ici */
    max-height: 720px;
    border: none;
    border-top: 1px solid var(--border);
    border-radius: 0;
    box-shadow: none;
  }
  .app > :global(.frame) {
    flex: 1;
    min-height: 0;
  }
  .shell {
    flex: 1;
    display: flex;
    min-height: 0;
    min-width: 0;
  }
  .dock-left,
  .dock-right {
    flex-shrink: 0;
    display: flex;
    min-height: 0;
    position: relative;
  }
  /* Les panneaux invités du dock outils sont fixed chez eux → on les ancre
     en absolute DANS le dock (même mécanique que .hubbed du hub). */
  .dock-tools :global(.hubbed),
  .dock-tools :global(aside) {
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    border-radius: 0 !important;
  }
  .splitter {
    width: 5px;
    margin: 0 -2px;
    cursor: col-resize;
    z-index: 5;
    flex-shrink: 0;
  }
  .splitter:hover {
    background: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .rail {
    width: 26px;
    flex-shrink: 0;
    color: var(--muted);
    border-right: 1px solid var(--border);
    font-size: 14px;
  }
  .rail:hover {
    color: var(--text);
    background: var(--panel2);
  }
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 22px 26px 10px;
  }
  .msg.flash {
    animation: flash-hl 1.6s ease;
    border-radius: 10px;
  }
  @keyframes flash-hl {
    0%,
    30% {
      background: color-mix(in srgb, var(--accent) 22%, transparent);
    }
    100% {
      background: transparent;
    }
  }
  .hero {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    text-align: center;
  }
  .logo {
    font-size: 54px;
  }
  .hero h1 {
    margin: 0;
    font-size: 30px;
    letter-spacing: 0.5px;
  }
  .hero p {
    color: var(--muted);
    margin: 0 0 18px;
  }
  .mono {
    font-family: var(--mono);
  }
  .chips {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(420px, 90%);
  }
  .chip {
    border: 1px solid var(--border);
    background: var(--panel);
    border-radius: 10px;
    padding: 10px 14px;
    color: var(--muted);
    transition: 0.15s;
  }
  .chip:hover {
    color: var(--text);
    border-color: var(--accent);
  }
  /* mode duel */
  .duel-col {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border-right: 1px solid var(--border);
  }
  .duel-col:last-child {
    border-right: none;
  }
  .col-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--panel) 60%, transparent);
  }
  .col-head .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .col-title {
    font-size: 12.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }
  .col-model {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
  }
  .mini {
    font-size: 11px;
    padding: 1px 7px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--muted);
    background: none;
  }
  .mini:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--accent);
  }
  .mini:disabled {
    opacity: 0.4;
  }
  .duel-col .messages {
    padding: 14px 16px 6px;
  }
  .duel-col :global(.composer) {
    padding: 6px 14px 12px;
  }
  .duel-split {
    width: 5px;
    margin: 0 -2px;
    cursor: col-resize;
    z-index: 5;
    flex-shrink: 0;
  }
  .duel-split:hover {
    background: color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .verdictbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }
  .verdictbar select {
    font-size: 12.5px;
    flex: 1;
    max-width: 260px;
  }
  .verdictbar .ghost {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 5px 12px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .verdictbar .ghost:hover:not(:disabled),
  .verdictbar .ghost.active {
    color: var(--text);
    border-color: var(--accent);
  }
  .verdictbar .debate {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
    cursor: pointer;
  }
  .verdictbar .debate input {
    accent-color: var(--accent);
  }
  .verdict {
    height: 34%;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border);
    background: color-mix(in srgb, var(--accent) 6%, var(--bg));
    flex-shrink: 0;
  }
  .vhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    font-size: 12.5px;
  }
  .vhead .mini {
    font-size: 12px;
    padding: 1px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--muted);
  }
  .vbody {
    flex: 1;
    overflow-y: auto;
    padding: 4px 14px 12px;
    font-size: 13.5px;
    line-height: 1.55;
    white-space: pre-wrap;
  }
  .cursor {
    color: var(--accent);
    animation: vblink 1s steps(2) infinite;
  }
  @keyframes vblink {
    50% {
      opacity: 0;
    }
  }

  /* Demande de permission outil (permissions par outil, inspiré d'OpenCode) */
  .perm-ask {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 14px 6px;
    padding: 8px 12px;
    border: 1px solid #f59e0b55;
    border-radius: 10px;
    background: #f59e0b14;
    font-size: 12.5px;
    color: #fcd34d;
  }
  .perm-ask code {
    color: #fbbf24;
    background: #f59e0b1c;
    padding: 1px 5px;
    border-radius: 5px;
    font-size: 11.5px;
  }
  .perm-txt {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .perm-btn {
    border: 1px solid #ffffff22;
    background: #ffffff10;
    color: #e8e8f0;
    border-radius: 7px;
    padding: 3px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .perm-btn.allow {
    border-color: #27c93f66;
    color: #7ee88f;
  }
  .perm-btn.always {
    border-color: #818cf866;
    color: #a5b4fc;
  }
  .perm-btn.deny {
    border-color: #ff6b6b66;
    color: #ff9b9b;
  }
  .perm-btn:hover {
    background: #ffffff1c;
  }
</style>
