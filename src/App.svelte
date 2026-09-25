<script lang="ts">
  import { streamChat, providerOf, type ProviderId } from './lib/llm'
  import {
    loadConversations,
    saveConversations,
    loadKeys,
    saveKeys,
    loadSettings,
    saveSettings,
    newConversation,
    emptyKeys,
    type Conversation,
    type Keys,
    type Msg,
    type Settings,
  } from './lib/store'
  import Sidebar from './lib/components/Sidebar.svelte'
  import ChatMessage from './lib/components/ChatMessage.svelte'
  import Composer from './lib/components/Composer.svelte'
  import SettingsModal from './lib/components/SettingsModal.svelte'

  let conversations = $state<Conversation[]>([])
  let currentId = $state<string | null>(null)
  let keys = $state<Keys>(emptyKeys())
  let settings = $state<Settings>(loadSettings())
  let showSettings = $state(false)
  let streaming = $state(false)
  let scroller: HTMLDivElement | undefined = $state()
  let controller: AbortController | null = null

  const current = $derived(conversations.find((c) => c.id === currentId) ?? null)

  // Initialisation (une seule fois) : état persisté + préchargement des clés dev.
  // $effect.root = portée réactive explicite hors cycle de rendu : les lectures
  // y sont volontaires (pas des captures d'init), et rien ne se déclenche après.
  $effect.root(() => {
    const loaded = loadConversations().map((c) => ({
      ...c,
      messages: c.messages.filter((m) => m.content.trim()), // purge les bulles vides
    }))
    conversations = loaded
    keys = loadKeys()
    settings = loadSettings()
    if (loaded.length) currentId = loaded[0].id
    else newChat()
    fetch('/keys.local')
      .then((r) => (r.ok ? r.json() : {}))
      .then((k: Partial<Keys>) => {
        const filled = Object.fromEntries(
          Object.entries(k).filter(([, v]) => typeof v === 'string' && v),
        ) as Partial<Keys>
        if (Object.keys(filled).length) {
          keys = { ...keys, ...filled }
          saveKeys(keys)
        }
      })
      .catch(() => {})
  })

  // Persistance automatique
  $effect(() => {
    if (conversations.length) saveConversations(conversations)
  })
  $effect(() => saveKeys(keys))
  $effect(() => saveSettings(settings))

  function scrollDown(): void {
    requestAnimationFrame(() => scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' }))
  }

  function newChat(): void {
    const c = newConversation('openrouter', providerOf('openrouter').models[0].id)
    conversations = [c, ...conversations]
    currentId = c.id
  }

  function selectChat(id: string): void {
    if (!streaming) currentId = id
  }

  function deleteChat(id: string): void {
    if (streaming) return
    conversations = conversations.filter((c) => c.id !== id)
    if (currentId === id) {
      if (conversations.length) currentId = conversations[0].id
      else newChat()
    }
  }

  function setProvider(pid: ProviderId): void {
    if (!current || streaming) return
    current.providerId = pid
    current.model = providerOf(pid).models[0].id
  }

  function setModel(m: string): void {
    if (!current || streaming) return
    current.model = m
  }

  async function send(text: string): Promise<void> {
    if (!current || streaming) return
    if (!keys[current.providerId]) {
      showSettings = true
      return
    }
    const user: Msg = { role: 'user', content: text, ts: Date.now() }
    current.messages.push(user)
    if (current.title === 'Nouvelle conversation') current.title = text.slice(0, 46)
    scrollDown()

    const assistant: Msg = { role: 'assistant', content: '', ts: Date.now() }
    current.messages.push(assistant)
    // Référence réactive : l'objet poussé doit être relu via le proxy $state pour déclencher le rendu
    const live: Msg = current.messages[current.messages.length - 1]
    streaming = true
    controller = new AbortController()

    const history: { role: 'user' | 'assistant' | 'system'; content: string }[] = current.messages
      .slice(0, -1)
      .filter((m) => !m.error && m.content)
      .map((m) => ({ role: m.role, content: m.content }))
    if (settings.system.trim()) history.unshift({ role: 'system', content: settings.system.trim() })

    try {
      await streamChat({
        providerId: current.providerId,
        apiKey: keys[current.providerId],
        model: current.model,
        messages: history,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        signal: controller.signal,
        onDelta: (d) => {
          live.content += d
          scrollDown()
        },
      })
    } catch (e) {
      const err = e as Error
      if (err.name === 'AbortError') {
        if (!live.content) current.messages.pop()
        else live.content += '\n\n*_(arrêté)_*'
      } else {
        live.content = err.message || String(e)
        live.error = true
      }
    } finally {
      streaming = false
      controller = null
      scrollDown()
    }
  }

  function stop(): void {
    controller?.abort()
  }

  function onKeydown(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      showSettings = !showSettings
    }
    if (e.key === 'Escape') showSettings = false
  }

  const SUGGESTIONS = [
    'Explique-moi Svelte 5 en 5 phrases.',
    'Écris une fonction debounce en TypeScript.',
    'Résume les différences entre Ollama et OpenRouter.',
  ]
</script>

<svelte:window onkeydown={onKeydown} />

<div class="shell">
  <Sidebar
    {conversations}
    {currentId}
    onNew={newChat}
    onSelect={selectChat}
    onDelete={deleteChat}
    onOpenSettings={() => (showSettings = true)}
  />

  <main class="main">
    {#if current}
      <div class="messages" bind:this={scroller}>
        {#if current.messages.length === 0}
          <div class="hero">
            <div class="logo">⚡</div>
            <h1>ChatDeck</h1>
            <p>Chat LLM léger — {providerOf(current.providerId).label} · <code>{current.model}</code></p>
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
        onSend={send}
        onStop={stop}
        onProvider={setProvider}
        onModel={setModel}
      />
    {/if}
  </main>
</div>

{#if showSettings}
  <SettingsModal
    {keys}
    {settings}
    onSave={(k, s) => {
      keys = k
      settings = s
      showSettings = false
    }}
    onClose={() => (showSettings = false)}
  />
{/if}

<style>
  .shell {
    display: flex;
    height: 100%;
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
