<script lang="ts">
  // Fenêtre popout ouverte par l'app principale : rend le panneau demandé
  // (#popout=settings | #popout=chat) avec un état dérivé du localStorage,
  // synchronisé bidirectionnellement via BroadcastChannel.
  import ChatMessage from './ChatMessage.svelte'
  import SettingsPanel from './SettingsPanel.svelte'
  import {
    loadConversations,
    loadKeys,
    loadSettings,
    loadCustomProviders,
    saveKeys,
    saveSettings,
    saveCustomProviders,
    type Conversation,
    type CustomProvider,
    type Keys,
    type Settings,
  } from '../store'

  const panel = new URLSearchParams(location.hash.slice(1)).get('popout') === 'settings' ? 'settings' : 'chat'

  let conversations = $state<Conversation[]>([])
  let activeId = $state<string | null>(null)
  let keys = $state<Keys>(loadKeys())
  let settings = $state<Settings>(loadSettings())
  let customs = $state<CustomProvider[]>(loadCustomProviders())
  let draft = $state('')

  const active = $derived(conversations.find((c) => c.id === activeId) ?? null)

  function reload(): void {
    conversations = loadConversations()
    keys = loadKeys()
    settings = loadSettings()
    customs = loadCustomProviders()
  }
  reload()

  const channel = new BroadcastChannel('chatdeck-sync-v1')
  channel.onmessage = (e: MessageEvent) => {
    const msg = e.data as { type: string; payload?: unknown }
    if (msg.type === 'state-saved' || msg.type === 'conversations-changed') reload()
    if (msg.type === 'active-conversation') {
      const p = msg.payload as { conversationId: string | null; panel: string }
      if (p.panel === 'chat') activeId = p.conversationId
    }
  }
  // Enregistrement auprès de l'app principale (elle poussera la conversation active)
  channel.postMessage({ type: 'popout-registered', payload: panel === 'settings' ? 'settings' : 'chat' })

  // Persistance de la géométrie de la fenêtre (poll léger : pas d'événement de déplacement)
  const geoTimer = setInterval(() => {
    channel.postMessage({
      type: 'popout-geometry',
      payload: {
        panel: panel === 'settings' ? 'settings' : 'chat',
        geo: { x: window.screenX, y: window.screenY, w: window.innerWidth, h: window.innerHeight },
      },
    })
  }, 2000)

  window.addEventListener('beforeunload', () => {
    clearInterval(geoTimer)
    channel.postMessage({ type: 'popout-closed', payload: panel === 'settings' ? 'settings' : 'chat' })
    channel.close()
  })

  function persistKeys(k: Keys): void {
    keys = k
    saveKeys(k)
    channel.postMessage({ type: 'state-saved' })
  }
  function persistSettings(s: Settings): void {
    settings = s
    saveSettings(s)
    channel.postMessage({ type: 'state-saved' })
  }
  function persistCustom(p: CustomProvider): void {
    customs = customs.map((x) => (x.id === p.id ? p : x))
    saveCustomProviders(customs)
    channel.postMessage({ type: 'state-saved' })
  }
  function addCustom(): void {
    const id = `custom:${Math.random().toString(36).slice(2, 7)}`
    customs = [...customs, { id, name: 'Nouveau fournisseur', baseUrl: '', keyHeader: 'Authorization', models: [] }]
    saveCustomProviders(customs)
    channel.postMessage({ type: 'state-saved' })
  }
  function removeCustom(id: string): void {
    customs = customs.filter((x) => x.id !== id)
    saveCustomProviders(customs)
    channel.postMessage({ type: 'state-saved' })
  }

  /** Envoie le message via l'app principale (qui gère le streaming). */
  function send(): void {
    const text = draft.trim()
    if (!text || !active) return
    draft = ''
    channel.postMessage({ type: 'popout-send', payload: { conversationId: active.id, text } })
  }
</script>

<div class="popout">
  {#if panel === 'settings'}
    <SettingsPanel
      {keys}
      {settings}
      {customs}
      onKeys={persistKeys}
      onSettings={persistSettings}
      onAddCustom={addCustom}
      onUpdateCustom={persistCustom}
      onRemoveCustom={removeCustom}
      onClose={() => window.close()}
    />
  {:else}
    <div class="chat">
      <div class="msgs">
        {#if !active}
          <div class="placeholder">Aucune conversation active — sélectionne-en une dans l'app principale.</div>
        {:else if active.incognito}
          <div class="placeholder">👻 Les conversations incognito ne quittent pas la fenêtre principale.</div>
        {:else}
          {#each active.messages as m, i (i)}
            <ChatMessage msg={m} />
          {/each}
        {/if}
      </div>
      {#if active && !active.incognito}
        <div class="composer">
          <textarea
            rows="1"
            bind:value={draft}
            placeholder="Écris dans la fenêtre popout… (Entrée = envoyer)"
            onkeydown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          ></textarea>
          <button class="send" onclick={send} disabled={!draft.trim()}>↑</button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .popout {
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--text);
  }
  .chat {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .msgs {
    flex: 1;
    overflow-y: auto;
    padding: 18px;
  }
  .placeholder {
    color: var(--muted);
    text-align: center;
    padding-top: 40vh;
    font-size: 13.5px;
  }
  .composer {
    display: flex;
    gap: 8px;
    padding: 10px 14px 14px;
    border-top: 1px solid var(--border);
  }
  textarea {
    flex: 1;
    resize: none;
  }
  .send {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    font-size: 16px;
    flex-shrink: 0;
  }
  .send:disabled {
    opacity: 0.35;
  }
</style>
