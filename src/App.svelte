<script lang="ts">
  // ChatDeck — orchestrateur « IDE premium » : châssis macOS, onglets, panneaux
  // dockables, popouts synchronisés, palette ⌘K, incognito, import/export.
  import { streamChat, isCustom, providerOf, type ProviderId, type WireMsg } from './lib/llm'
  import { AGENTS, toolsFor, systemPromptFor, execTool, REPORT_TOOL, type AgentId, type ToolCall } from './lib/agents'
  import FilesPanel from './lib/components/FilesPanel.svelte'
  import {
    loadConversations,
    saveConversations,
    loadKeys,
    saveKeys,
    loadSettings,
    saveSettings,
    loadCustomProviders,
    saveCustomProviders,
    loadIncognitoId,
    saveIncognitoId,
    newConversation,
    newIncognitoConversation,
    validateImport,
    buildExport,
    downloadJson,
    type Conversation,
    type CustomProvider,
    type Keys,
    type Msg,
    type Settings,
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
  import TaskbarPill from './lib/components/TaskbarPill.svelte'
  import CommandPalette from './lib/components/CommandPalette.svelte'
  import SearchPanel from './lib/components/SearchPanel.svelte'
  import type { Command } from './lib/components/CommandPalette.svelte'
  import { snapCycle, zoneRect } from './lib/float.svelte'
  import type { Edge } from './lib/float.svelte'
  import type { PaneGeometry } from './lib/store'

  /* ---------- état ---------- */

  let conversations = $state<Conversation[]>(loadConversations())
  let currentId = $state<string | null>(loadIncognitoId())
  let keys = $state<Keys>(loadKeys())
  let settings = $state<Settings>(loadSettings())
  let customs = $state<CustomProvider[]>(loadCustomProviders())
  let streaming = $state(false)
  let streamingId = $state<string | null>(null)
  let latencyMs = $state<number | null>(null)
  let showPalette = $state(false)
  let showFiles = $state(false)
  let showSearch = $state(false)
  /** ts du message à surligner (saut depuis la recherche) */
  let flashTs = $state<number | null>(null)
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

  function scrollDown(): void {
    requestAnimationFrame(() => scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' }))
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
    if (streaming && streamingId === id) return
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
    if (!current || streaming) return
    conversations = conversations.map((c) =>
      c.id === current.id ? { ...c, providerId: pid, model: providerOf(pid, customs).models[0].id } : c,
    )
  }

  function setModel(m: string): void {
    if (!current || streaming) return
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
        let content = `**${AGENTS[m.agent ?? 'nexus'].name} —** ${m.content}`
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
    if (!current || streaming) return
    conversations = conversations.map((c) => (c.id === current.id ? { ...c, agents: list } : c))
  }

  async function sendTo(convId: string, text: string): Promise<void> {
    if (streaming) return
    const conv = conversations.find((c) => c.id === convId)
    if (!conv) return
    const apiKey = keyOf(conv.providerId)
    if (!apiKey) {
      layout.toggleSettings() // ouvre le panneau réglages si replié
      return
    }
    const multi = Boolean(conv.agents?.length)

    // Bootstrap de la sandbox au premier message d'un fil agents (~/.chatdeck/workspaces/<id>)
    if (multi && !conv.sandboxReady) {
      conversations = conversations.map((c) => (c.id === convId ? { ...c, sandboxReady: true } : c))
      try {
        await fetch(`/api/sandbox/${convId}/bootstrap`, { method: 'POST' })
      } catch {
        /* sandbox indisponible : les outils renverront une erreur lisible */
      }
    }

    const user: Msg = { role: 'user', content: text, ts: Date.now() }
    const assistant: Msg = { role: 'assistant', content: '', ts: Date.now(), ...(multi ? { agent: 'nexus' as const } : {}) }
    conversations = conversations.map((c) =>
      c.id === convId ? { ...c, messages: [...c.messages, user, assistant], open: true } : c,
    )
    if (conv.title === 'Nouvelle conversation' || conv.title === '👻 Conversation incognito') {
      conversations = conversations.map((c) => (c.id === convId ? { ...c, title: text.slice(0, 46) } : c))
    }
    scrollDown()

    const live = conversations.find((c) => c.id === convId)!.messages.slice(-1)[0]
    streaming = true
    streamingId = convId
    const controller = new AbortController()
    activeAbort = controller
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
    const systemWire: WireMsg = {
      role: 'system',
      content: multi ? systemPromptFor('nexus', settings.system) : settings.system.trim(),
    }
    const baseMessages: WireMsg[] = systemWire.content ? [systemWire, ...wires] : wires

    /** Un tour d'agent : stream + exécution des outils, jusqu'à réponse finale ou délégation. */
    async function runTurns(agent: AgentId, delegationTask?: string): Promise<{ delegation?: string; report?: string }> {
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
            agent === 'seeker'
              ? [{ role: 'system', content: systemPromptFor('seeker', settings.system, delegationTask ? { task: delegationTask } : undefined) }, ...wires, ...extra]
              : [...baseMessages, ...extra],
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          signal: controller.signal,
          customs,
          tools: agent === 'seeker' ? [...toolsFor('seeker'), REPORT_TOOL] : toolsFor('nexus'),
          onDelta: (d) => {
            phaseContent += d
            patchLive((m) => ({ ...m, content: m.content + d }))
            scrollDown()
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
          // Réponse finale en texte — pour Seeker, ce texte vaut rapport s'il n'a pas appelé l'outil
          return agent === 'seeker' && phaseContent.trim() ? { report: phaseContent } : {}
        }

        wires.push({
          role: 'assistant',
          content: phaseContent || null,
          tool_calls: callList.map((c) => ({
            id: c.id,
            type: 'function' as const,
            function: { name: c.name, arguments: JSON.stringify(c.args) },
          })),
        })
        let delegation: string | undefined
        let report: string | undefined
        for (const call of callList) {
          let result: string
          if (call.name === 'delegate_to_seeker') {
            delegation = String(call.args.task ?? '')
            result = 'Mission transmise à Seeker. Elle travaillera et te rendra un rapport.'
          } else if (call.name === 'report_to_nexus') {
            report = String(call.args.report ?? '')
            result = 'Rapport reçu par Nexus.'
          } else {
            try {
              result = await execTool(convId, call)
            } catch (e) {
              result = `Erreur outil : ${(e as Error).message}`
            }
            const detail = result.slice(0, 80)
            patchLive((m) => ({ ...m, toolEvents: [...(m.toolEvents ?? []), { tool: call.name, detail }] }))
          }
          wires.push({ role: 'tool', tool_call_id: call.id, content: result })
        }
        if (delegation || report) return { delegation, report }
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
        // Nexus pilote ; s'il délègue, Seeker explore puis rend rapport, et Nexus conclut
        const r1 = await runTurns('nexus')
        if (r1.delegation) {
          const r2 = await runTurns('seeker', r1.delegation)
          if (r2.report) await runTurns('nexus')
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
            scrollDown()
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
      streaming = false
      streamingId = null
      if (activeAbort === controller) activeAbort = null
      scrollDown()
    }
  }

  function send(text: string): void {
    if (!currentId) return
    const convId = currentId
    void sendTo(convId, text)
  }

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

  function stop(): void {
    activeAbort?.abort()
  }

  let activeAbort: AbortController | null = null

  /* ---------- fenêtre flottante / pill ---------- */

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

  /* ---------- palette ---------- */

  const commands = $derived<Command[]>([
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
    { id: 'files', label: showFiles ? 'Fermer le panneau Fichiers (sandbox)' : 'Ouvrir le panneau Fichiers (sandbox)', run: () => (showFiles = !showFiles) },
    { id: 'search', label: 'Rechercher dans toutes les conversations', hint: '⌘⇧F', run: () => (showSearch = true) },
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

{#if layout.appMode === 'pill'}
  <TaskbarPill
    conv={current}
    {streaming}
    tokens={current?.messages.filter((m) => m.role === 'assistant').at(-1)?.usage?.completion ?? 0}
    {customs}
    onRestore={() => layout.setAppMode('floating')}
  />
{:else if layout.appMode === 'floating'}
  <FloatingWindow
    geo={layout.appGeo}
    title="ChatDeck — IDE premium"
    onGeo={floatWith}
    onSnap={floatSnap}
    onRestore={restoreDocked}
    onMinimize={togglePill}
  >
    <div class="shell">
      {#if !layout.layout.sidebarCollapsed}
        <div class="dock-left" style="width: {layout.layout.sidebarWidth}px">
          <Sidebar
            {conversations}
            {currentId}
            {customs}
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
        <button class="rail" onclick={() => layout.toggleSidebar()} title="Afficher le panneau latéral (⌘\)">»</button>
      {/if}

      <main class="main">
        <TabBar
          {conversations}
          {currentId}
          {streamingId}
          {customs}
          onSelect={selectChat}
          onClose={closeTab}
          onNew={() => newChat()}
          onReorder={reorderTabs}
        />
        {#if current}
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
                </div>
              {/each}
            {/if}
          </div>
          <Composer
            {streaming}
            providerId={current.providerId}
            model={current.model}
            {customs}
            agents={current.agents ?? []}
            onSend={send}
            onStop={stop}
            onProvider={setProvider}
            onModel={setModel}
            onAgents={setAgents}
          />
        {/if}
      </main>

      {#if !layout.layout.settingsCollapsed}
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
          />
          <div class="splitter" role="separator" aria-orientation="vertical"
            onpointerdown={(e) => startSettingsResize(e)}
            ondblclick={() => layout.setSettingsWidth(400)}
          ></div>
        </div>
      {/if}
    </div>
    <StatusBar conv={current} {streaming} {latencyMs} {customs} />
  </FloatingWindow>
{:else}
  <div class="app">
    <WindowFrame
      title="ChatDeck — IDE premium"
      onMinimize={togglePill}
      onMaximize={() => document.documentElement.requestFullscreen?.().catch(() => {})}
      onClose={restoreDocked}
    >
    <div class="shell">
      {#if !layout.layout.sidebarCollapsed}
        <div class="dock-left" style="width: {layout.layout.sidebarWidth}px">
          <Sidebar
            {conversations}
            {currentId}
            {customs}
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
        <button class="rail" onclick={() => layout.toggleSidebar()} title="Afficher le panneau latéral (⌘\)">»</button>
      {/if}

      <main class="main">
        <TabBar
          {conversations}
          {currentId}
          {streamingId}
          {customs}
          onSelect={selectChat}
          onClose={closeTab}
          onNew={() => newChat()}
          onReorder={reorderTabs}
        />
        {#if current}
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
                </div>
              {/each}
            {/if}
          </div>
          <Composer
            {streaming}
            providerId={current.providerId}
            model={current.model}
            {customs}
            agents={current.agents ?? []}
            onSend={send}
            onStop={stop}
            onProvider={setProvider}
            onModel={setModel}
            onAgents={setAgents}
          />
        {/if}
      </main>

      {#if !layout.layout.settingsCollapsed}
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
          />
          <div class="splitter" role="separator" aria-orientation="vertical"
            onpointerdown={(e) => startSettingsResize(e)}
            ondblclick={() => layout.setSettingsWidth(400)}
          ></div>
        </div>
      {/if}
    </div>
    </WindowFrame>

    <StatusBar conv={current} {streaming} {latencyMs} {customs} />
  </div>
{/if}

{#if showSearch}
  <SearchPanel {conversations} onOpen={jumpTo} onClose={() => (showSearch = false)} />
{/if}

{#if showFiles && current}
  <FilesPanel convId={current.id} enabled={Boolean(current.agents?.length)} onClose={() => (showFiles = false)} />
{/if}

{#if showPalette}
  <CommandPalette {commands} onClose={() => (showPalette = false)} />
{/if}

<style>
  .app {
    height: 100%;
    display: flex;
    flex-direction: column;
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
</style>
