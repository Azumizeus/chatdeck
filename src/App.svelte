<script lang="ts">
  // ChatDeck — orchestrateur « IDE premium » : châssis macOS, onglets, panneaux
  // dockables, popouts synchronisés, palette ⌘K, incognito, import/export.
  import { streamChat, isCustom, providerOf, type ProviderId } from './lib/llm'
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
  import CommandPalette from './lib/components/CommandPalette.svelte'
  import type { Command } from './lib/components/CommandPalette.svelte'

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

  async function sendTo(convId: string, text: string): Promise<void> {
    if (streaming) return
    const conv = conversations.find((c) => c.id === convId)
    if (!conv) return
    const apiKey = keyOf(conv.providerId)
    if (!apiKey) {
      layout.toggleSettings() // ouvre le panneau réglages si replié
      return
    }
    const user: Msg = { role: 'user', content: text, ts: Date.now() }
    const assistant: Msg = { role: 'assistant', content: '', ts: Date.now() }
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

    const history: { role: 'user' | 'assistant' | 'system'; content: string }[] = conv.messages
      .filter((m) => !m.error && m.content)
      .map((mm) => ({ role: mm.role, content: mm.content }))
    history.push({ role: 'user', content: text })
    if (settings.system.trim()) history.unshift({ role: 'system', content: settings.system.trim() })

    const patchLive = (patch: (m: Msg) => Msg): void => {
      conversations = conversations.map((c) =>
        c.id === convId ? { ...c, messages: c.messages.map((m) => (m.ts === live.ts && m.role === live.role ? patch(m) : m)) } : c,
      )
    }

    try {
      await streamChat({
        providerId: conv.providerId,
        apiKey,
        model: conv.model,
        messages: history,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        signal: controller.signal,
        customs,
        onDelta: (d) => {
          patchLive((m) => ({ ...m, content: m.content + d }))
          scrollDown()
        },
      })
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
        patchLive(() => ({ role: 'assistant', content: err.message || String(e), ts: Date.now(), error: true }))
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

  function stop(): void {
    activeAbort?.abort()
  }

  let activeAbort: AbortController | null = null

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
    } else if (mod && e.key === '\\') {
      e.preventDefault()
      layout.toggleSidebar()
    } else if (e.key === 'Escape') {
      showPalette = false
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
  ])

  const SUGGESTIONS = [
    'Explique-moi Svelte 5 en 5 phrases.',
    'Écris une fonction debounce en TypeScript.',
    'Résume les différences entre Ollama et OpenRouter.',
  ]
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app">
  <WindowFrame
    title="ChatDeck — IDE premium"
    onMinimize={() => layout.toggleSidebar()}
    onMaximize={() => document.documentElement.requestFullscreen?.().catch(() => {})}
    onClose={() => window.close()}
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
                <ChatMessage msg={m} />
              {/each}
            {/if}
          </div>
          <Composer
            {streaming}
            providerId={current.providerId}
            model={current.model}
            {customs}
            onSend={send}
            onStop={stop}
            onProvider={setProvider}
            onModel={setModel}
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
