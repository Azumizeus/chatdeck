<script lang="ts">
  // Fenêtre popout ouverte par l'app principale : rend le panneau demandé
  // (#popout=settings | #popout=chat) avec un état dérivé du localStorage,
  // synchronisé bidirectionnellement via BroadcastChannel.
  import ChatMessage from './ChatMessage.svelte'
  import SettingsPanel from './SettingsPanel.svelte'
  import DeckPanel from './DeckPanel.svelte'
  import GraphPanel from './GraphPanel.svelte'
  import FilesPanel from './FilesPanel.svelte'
  import TerminalPanel from './TerminalPanel.svelte'
  import PreviewPanel from './PreviewPanel.svelte'
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

  const panel = new URLSearchParams(location.hash.slice(1)).get('popout') ?? 'chat'

  let conversations = $state<Conversation[]>([])
  /** Conversation active initiale : l'app principale marque la conv ouverte
   *  (open:true) dans localStorage — le popout démarre dessus sans attendre le
   *  1er message du canal (et fonctionne même ouvert hors de l'app). Les
   *  broadcasts « active-conversation » prennent ensuite la main. */
  function initialActiveId(): string | null {
    try {
      const convs = JSON.parse(localStorage.getItem('chatdeck.conversations.v1') || '[]') as { id: string; open?: boolean; incognito?: boolean }[]
      return (convs.find((c) => c.open && !c.incognito) ?? convs.find((c) => !c.incognito))?.id ?? null
    } catch {
      return null
    }
  }
  let activeId = $state<string | null>(initialActiveId())
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
      // panel === 'chat' : popout conversation · panel = nom d'outil (files/
      // terminal/preview) : popout outil, il suit AUSSI la conversation active.
      if (p.panel === 'chat' || p.panel === 'files' || p.panel === 'terminal' || p.panel === 'preview') activeId = p.conversationId
    }
  }
  // Enregistrement auprès de l'app principale (elle poussera la conversation active)
  channel.postMessage({ type: 'popout-registered', payload: panel })

  // Persistance de la géométrie de la fenêtre (poll léger : pas d'événement de déplacement)
  const geoTimer = setInterval(() => {
    channel.postMessage({
      type: 'popout-geometry',
      payload: {
        panel,
        geo: { x: window.screenX, y: window.screenY, w: window.innerWidth, h: window.innerHeight },
      },
    })
  }, 2000)

  window.addEventListener('beforeunload', () => {
    clearInterval(geoTimer)
    channel.postMessage({ type: 'popout-closed', payload: panel })
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
  {:else if panel === 'deck'}
    <div class="deckpop">
      <DeckPanel onClose={() => window.close()} />
    </div>
  {:else if panel === 'graph'}
    <div class="graphpop">
      <GraphPanel conversations={loadConversations()} onOpen={() => window.close()} onClose={() => window.close()} />
    </div>
  {:else if panel === 'files' || panel === 'terminal' || panel === 'preview'}
    <!-- Panneau lié à la conversation active : Fichiers (édition + ▶ Exécuter),
         Terminal réel ou Preview live — même fonction que dans l'app. -->
    {#if !active}
      <div class="placeholder">Aucune conversation active — sélectionne-en une dans l'app principale.</div>
    {:else if panel === 'files'}
      <div class="toolpop">
        <FilesPanel convId={active.id} enabled={Boolean(active.agents?.length)} onClose={() => window.close()} />
      </div>
    {:else if panel === 'terminal'}
      <div class="toolpop">
        <TerminalPanel convId={active.id} onClose={() => window.close()} />
      </div>
    {:else}
      <div class="toolpop">
        <PreviewPanel convId={active.id} onClose={() => window.close()} />
      </div>
    {/if}
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
  .deckpop {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .graphpop {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .graphpop :global(.graphify) {
    position: absolute;
    inset: 0;
    width: auto;
    max-width: none;
    border: none;
    border-radius: 0;
    box-shadow: none;
  }
  .deckpop :global(.deck) {
    position: absolute;
    inset: 0;
    width: auto;
    max-height: none;
    border: none;
    border-radius: 0;
    box-shadow: none;
  }
  .toolpop {
    flex: 1;
    display: flex;
    min-height: 0;
    position: relative;
  }
  /* Ces panneaux sont fixed chez eux → ancrés dans la fenêtre popout. */
  .toolpop :global(.files),
  .toolpop :global(.term),
  .toolpop :global(.preview) {
    position: absolute;
    inset: 0;
    width: auto;
    max-width: none;
    max-height: none;
    height: auto;
    border: none;
    border-radius: 0;
    box-shadow: none;
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
