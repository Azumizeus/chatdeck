<script lang="ts">
  import { allProviders, type ProviderId } from '../llm'
  import type { CustomProvider } from '../store'
  import type { AgentId } from '../agents'
  import ModelPicker from './ModelPicker.svelte'

  let {
    streaming,
    providerId,
    model,
    customs = [],
    agents = [],
    cards = [],
    cardsActive = [],
    onToggleCard,
    planMode = false,
    onTogglePlan,
    onSend,
    onStop,
    onProvider,
    onModel,
    onAgents,
    onSendBoth,
  }: {
    streaming: boolean
    providerId: ProviderId
    model: string
    customs?: CustomProvider[]
    /** Agents actifs du fil (vide = chat simple) */
    agents?: AgentId[]
    /** Fiches .CD disponibles (id + libellé) pour la pastille 🃏 */
    cards?: { id: string; label: string }[]
    /** Fiches activées POUR CE FIL */
    cardsActive?: string[]
    onToggleCard?: (id: string) => void
    /** Mode Plan (lecture seule, inspiré d'OpenCode) — toggle Tab */
    planMode?: boolean
    onTogglePlan?: () => void
    onSend: (text: string) => void
    onStop: () => void
    onProvider: (pid: ProviderId) => void
    onModel: (model: string) => void
    onAgents: (list: AgentId[]) => void
    /** Présent en mode duel : envoie le même texte aux deux conversations */
    onSendBoth?: (text: string) => void
  } = $props()

  let cardsOpen = $state(false)

  let text = $state('')
  let ta: HTMLTextAreaElement | undefined = $state()

  const providers = $derived(allProviders(customs))
  const hint = $derived(providers.find((p) => p.id === providerId)?.docs ?? '')
  const isCatalog = $derived(providerId === 'openrouter')

  function autosize(): void {
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'
  }

  function submit(): void {
    const t = text.trim()
    if (!t || streaming) return
    onSend(t)
    text = ''
    requestAnimationFrame(autosize)
  }

  function submitBoth(): void {
    const t = text.trim()
    if (!t || !onSendBoth) return
    onSendBoth(t)
    text = ''
    requestAnimationFrame(autosize)
  }

  function key(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  const agentsValue = $derived(agents.length ? agents.join(',') : '')
</script>

<div class="composer">
  <div class="pickers">
    <select
      value={agentsValue}
      onchange={(e) => onAgents(e.currentTarget.value ? (e.currentTarget.value.split(',') as AgentId[]) : [])}
      title="Mode agents"
    >
      <option value="">Chat simple</option>
      <option value="nexus,seeker">🧠 Nexus + 🔎 Seeker</option>
      <option value="nexus,deck">🧠 Nexus + 🃏 PromptDeck (collab)</option>
    </select>
    <select
      value={providerId}
      onchange={(e) => onProvider(e.currentTarget.value)}
      title="Fournisseur"
    >
      {#each providers as p (p.id)}
        <option value={p.id}>{p.custom ? '⭑ ' : ''}{p.label}</option>
      {/each}
    </select>
    {#if isCatalog}
      <div class="picker-model">
        <ModelPicker value={model} onCommit={onModel} />
      </div>
    {:else}
      <select value={model} onchange={(e) => onModel(e.currentTarget.value)} title="Modèle">
        {#each providers.find((p) => p.id === providerId)?.models ?? [] as m (m.id)}
          <option value={m.id}>{m.label}</option>
        {/each}
      </select>
    {/if}
    {#if onTogglePlan}
      <button
        class="plan-btn"
        class:on={planMode}
        onclick={onTogglePlan}
        title="Mode Plan (Tab) : les agents lisent et proposent, sans modifier la sandbox"
      >📋 Plan</button>
    {/if}
    {#if cards.length && onToggleCard}
      <div class="cards-menu">
        <button
          class="cards-btn"
          class:on={cardsActive.length > 0}
          class:open={cardsOpen}
          onclick={() => (cardsOpen = !cardsOpen)}
          title="Fiches .CD appliquées à ce fil (injectées dans le prompt des agents)"
        >🃏 {cardsActive.length ? cardsActive.length : ''}</button>
        {#if cardsOpen}
          <div class="cards-pop">
            {#each cards as cd (cd.id)}
              <button
                class:active={cardsActive.includes(cd.id)}
                onclick={() => onToggleCard(cd.id)}
                title={cardsActive.includes(cd.id) ? 'Retirer de ce fil' : 'Appliquer à ce fil'}
              >{cardsActive.includes(cd.id) ? '☑' : '☐'} {cd.label}</button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
    <span class="hint">{hint}</span>
  </div>
  <div class="inputrow">
    <textarea
      bind:this={ta}
      bind:value={text}
      oninput={autosize}
      onkeydown={(e) => {
        // Tab = bascule Mode Plan (OpenCode), tant qu'aucune suggestion @ n'est active
        if (e.key === 'Tab' && onTogglePlan && !text.startsWith('@')) {
          e.preventDefault()
          onTogglePlan()
          return
        }
        key(e)
      }}
      rows="1"
      placeholder={agents.length
        ? 'Écris à Nexus — il orchestre, écrit dans la sandbox et délègue à Seeker…'
        : 'Écris ton message…  (Entrée = envoyer · Maj+Entrée = nouvelle ligne)'}
    ></textarea>
    {#if streaming}
      <button class="stop" onclick={onStop} title="Arrêter la génération">■</button>
    {:else}
      {#if onSendBoth}
        <button class="send both" onclick={submitBoth} disabled={!text.trim()} title="Envoyer aux deux">⇉</button>
      {/if}
      <button class="send" onclick={submit} disabled={!text.trim()} title="Envoyer">↑</button>
    {/if}
  </div>
</div>

<style>
  .composer {
    padding: 8px 26px 18px;
    max-width: 900px;
    width: 100%;
    margin: 0 auto;
  }
  .pickers {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .plan-btn {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 12.5px;
    padding: 4px 8px;
    cursor: pointer;
    white-space: nowrap;
  }
  .plan-btn.on {
    background: color-mix(in srgb, #fb923c 18%, transparent);
    border-color: color-mix(in srgb, #fb923c 50%, transparent);
  }
  .cards-menu {
    position: relative;
  }
  .cards-btn {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 12.5px;
    padding: 4px 8px;
    cursor: pointer;
  }
  .cards-btn.on {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .cards-pop {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 80;
    min-width: 280px;
    max-height: 260px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 14px 36px rgba(0, 0, 0, 0.4);
    padding: 4px;
  }
  .cards-pop button {
    border: none;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 12.5px;
    text-align: left;
    padding: 6px 8px;
    border-radius: 7px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cards-pop button:hover {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .cards-pop button.active {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .picker-model {
    flex: 1;
    min-width: 0;
    max-width: 340px;
  }
  select {
    font-size: 13px;
    padding: 5px 8px;
    max-width: 200px;
  }
  .hint {
    color: var(--muted);
    font-size: 12px;
    margin-left: auto;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .inputrow {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    background: var(--panel2);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 10px 12px;
    transition: border-color 0.15s;
  }
  .inputrow:focus-within {
    border-color: var(--accent);
  }
  textarea {
    flex: 1;
    background: none;
    border: none;
    resize: none;
    padding: 4px 2px;
    max-height: 180px;
    line-height: 1.5;
  }
  textarea:focus {
    border: none;
  }
  .send,
  .stop {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    font-size: 16px;
    flex-shrink: 0;
  }
  .send {
    background: var(--accent);
    color: #fff;
  }
  .send.both {
    background: color-mix(in srgb, var(--accent) 40%, var(--panel));
    width: auto;
    border-radius: 10px;
    padding: 0 10px;
    font-size: 13px;
  }
  .send:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .stop {
    background: var(--danger);
    color: #fff;
    font-size: 12px;
  }
</style>
