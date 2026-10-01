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
    convId = undefined,
    agentsActive = false,
    onSlash,
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
    /** Id de conversation : active l'autocomplétion @fichier (arbre sandbox) */
    convId?: string
    /** Sandbox disponible (agents actifs) : le menu @fichier le signale sinon */
    agentsActive?: boolean
    /** Commandes / : reçoit « /undo » … (intercepté par App, pas envoyé au LLM) */
    onSlash?: (cmd: string, arg?: string) => boolean | void
  } = $props()

  let cardsOpen = $state(false)

  let text = $state('')
  let ta: HTMLTextAreaElement | undefined = $state()

  /* ── Hint « mode agents » (chat simple) ──
   * Taper « tu es Nexus », « tes outils »… en chat simple ne peut pas marcher :
   * aucun persona ni outil n'est envoyé au modèle (par design). On le signale
   * discrètement, avec activation directe possible (dismissible). */
  let agentHintDismissed = $state(false)
  const AGENT_HINT_RE =
    /\b(tu es|t'es|vous êtes)\s+(nexus|seeker|deck|promptdeck)\b|\btes outils\b|\btes agents\b|\btes commandes\b|\bliste (de tes )?outils\b|\bactive (les )?(agents|outils)\b/i

  const providers = $derived(allProviders(customs))
  const hint = $derived(providers.find((p) => p.id === providerId)?.docs ?? '')
  const isCatalog = $derived(providerId === 'openrouter')

  /* ── Autocomplétion @fichier (inspiré d'OpenCode) ──
   * Quand l'utilisateur tape @, l'arbre de la sandbox est proposé en menu
   * (flèches + Entrée/Tab, ou clic). Entrée = envoyer reste prioritaire
   * quand aucun @ n'est en cours de frappe. */
  let atOpen = $state(false)
  let atItems = $state<string[]>([])
  let atIndex = $state(0)
  let atStart = -1
  let treeCache: { conv: string; at: number; paths: string[] } | null = null

  async function sandboxPaths(): Promise<string[]> {
    if (!convId) return []
    if (treeCache && treeCache.conv === convId && Date.now() - treeCache.at < 5000) return treeCache.paths
    try {
      const r = await fetch(`/api/sandbox/${convId}/tree`)
      const j = (await r.json()) as { exists?: boolean; tree?: AtNode[] }
      const paths: string[] = []
      const walk = (nodes: AtNode[] | undefined, prefix: string): void => {
        for (const n of nodes ?? []) {
          const p = prefix + n.name
          if (n.type === 'dir') {
            paths.push(`${p}/`)
            walk(n.children, `${p}/`)
          } else paths.push(p)
        }
      }
      walk(j.tree, '')
      treeCache = { conv: convId, at: Date.now(), paths }
      return paths
    } catch {
      return []
    }
  }

  interface AtNode {
    name: string
    type: string
    children?: AtNode[]
  }

  function closeAt(): void {
    atOpen = false
    atItems = []
    atIndex = 0
    atStart = -1
  }

  /** Menu / : commandes disponibles, filtrées par le préfixe tapé. */
  const SLASH_COMMANDS: { cmd: string; label: string; hint: string }[] = [
    { cmd: '/undo', label: '/undo', hint: 'Annule le dernier tour d\'agent (checkpoint sandbox)' },
    { cmd: '/plan', label: '/plan', hint: 'Mode Plan : agents en lecture seule' },
    { cmd: '/agents', label: '/agents', hint: 'Active/désactive Nexus + Seeker' },
    { cmd: '/fichiers', label: '/fichiers', hint: 'Ouvre le panneau Fichiers' },
    { cmd: '/terminal', label: '/terminal', hint: 'Ouvre le terminal du workspace' },
  ]
  let slashOpen = $state(false)
  let slashIndex = $state(0)
  let slashStart = -1

  function closeSlash(): void {
    slashOpen = false
    slashIndex = 0
    slashStart = -1
  }

  const slashItems = $derived.by(() => {
    if (slashStart < 0) return []
    const q = text.slice(slashStart + 1).split(/\s/)[0].toLowerCase()
    return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(`/${q}`)).slice(0, 6)
  })

  function applySlash(cmd: string): void {
    text = ''
    closeSlash()
    onSlash?.(cmd)
  }

  async function updateAt(): Promise<void> {
    if (!ta) return closeAt()
    const pos = ta.selectionStart ?? text.length
    const upto = text.slice(0, pos)
    // /commande en cours de frappe ?
    const sm = upto.match(/(^|\s)(\/[\w-]*)$/)
    if (sm && onSlash) {
      closeAt()
      slashStart = pos - sm[2].length
      slashIndex = 0
      slashOpen = true
      return
    }
    if (slashOpen) closeSlash()
    const m = upto.match(/(^|\s)@([\w./-]*)$/)
    if (!m) return closeAt()
    atStart = pos - m[2].length - 1
    const paths = await sandboxPaths()
    const q = m[2].toLowerCase()
    atItems = paths.filter((p) => p.toLowerCase().includes(q)).slice(0, 8)
    atIndex = 0
    atOpen = true
  }

  /** La frappe @ a quitté le champ ou le token @ a disparu → referme le menu.
   *  (atOpen seul ne suffit pas : il faut distinguer « ouvert avec items » et
   *  « ouvert, sandbox vide » pour afficher l'état vide explicite.) */
  const atHasItems = $derived(atItems.length > 0)

  function applyAt(path: string): void {
    const start = atStart
    if (!ta || start < 0) return closeAt()
    const pos = ta.selectionStart ?? text.length
    const insert = `@${path.replace(/\/$/, '')} `
    text = text.slice(0, start) + insert + text.slice(pos)
    closeAt()
    requestAnimationFrame(() => {
      ta?.focus()
      ta?.setSelectionRange(start + insert.length, start + insert.length)
      autosize()
    })
  }

  function autosize(): void {
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'
  }

  /** Commande / tapée dans le champ : interceptée AVANT l'envoi au modèle. */
  function trySlash(raw: string): boolean {
    if (!raw.startsWith('/') || !onSlash) return false
    const [cmd, ...rest] = raw.slice(1).split(/\s+/)
    const handled = onSlash(`/${cmd}`, rest.join(' ').trim() || undefined)
    if (handled !== false) {
      text = ''
      requestAnimationFrame(autosize)
    }
    return handled !== false
  }

  function submit(): void {
    const t = text.trim()
    if (!t || streaming) return
    if (trySlash(t)) return
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

  const atHintSandbox = $derived(
    !convId
      ? null
      : agentsActive
        ? null
        : 'Active les agents (barre d\'outils) pour joindre des fichiers de la sandbox',
  )

  const agentsValue = $derived(agents.length ? agents.join(',') : '')
  const showAgentHint = $derived(
    !agentHintDismissed && !agents.length && AGENT_HINT_RE.test(text),
  )
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
  {#if showAgentHint}
    <div class="hint-row" role="status">
      <span>💡 En chat simple, le modèle n'a ni persona ni outils. Pour « {text.match(/nexus|seeker|deck/i)?.[0] ?? 'Nexus'} » et la sandbox, active le mode agents —</span>
      <button onclick={() => onAgents(['nexus', 'seeker'])}>🧠 Nexus + 🔎 Seeker</button>
      <button class="ghost" onclick={() => (agentHintDismissed = true)} title="Ne plus afficher" aria-label="Masquer l'astuce">✕</button>
    </div>
  {/if}
  <div class="inputrow">
    {#if atOpen && atHasItems}
      <ul class="at-menu" role="listbox" aria-label="Fichiers sandbox">
        {#each atItems as p, i (p)}
          <li>
            <button
              type="button"
              class:sel={i === atIndex}
              onmouseenter={() => (atIndex = i)}
              onclick={() => applyAt(p)}
            >
              <span class="at-ico">{p.endsWith('/') ? '📁' : '📄'}</span> {p}
            </button>
          </li>
        {/each}
        <li class="at-hint">↑↓ naviguer · Entrée/Tab insérer · Échap fermer — l'extrait sera joint au prompt</li>
      </ul>
    {:else if atOpen}
      <ul class="at-menu" role="listbox" aria-label="Fichiers sandbox">
        <li class="at-empty">
          <span class="at-ico">🗂</span>
          {atHintSandbox
            ? atHintSandbox
            : convId
              ? 'Aucun fichier dans la sandbox de ce fil — il sera créé au premier tour d\'agent'
              : 'Ouvre un fil agents pour joindre des fichiers'}
        </li>
        <li class="at-hint">Échap fermer</li>
      </ul>
    {/if}
    {#if slashOpen && slashItems.length}
      <ul class="at-menu slash" role="listbox" aria-label="Commandes">
        {#each slashItems as c, i (c.cmd)}
          <li>
            <button
              type="button"
              class:sel={i === slashIndex}
              onmouseenter={() => (slashIndex = i)}
              onclick={() => applySlash(c.cmd)}
            >
              <span class="at-ico">⌘</span> <strong>{c.label}</strong> <span class="slash-hint">{c.hint}</span>
            </button>
          </li>
        {/each}
        <li class="at-hint">Entrée exécute la commande — le reste part au modèle comme d'habitude</li>
      </ul>
    {/if}
    <textarea
      bind:this={ta}
      bind:value={text}
      oninput={() => {
        autosize()
        void updateAt()
      }}
      onkeydown={(e) => {
        // Menu /commandes ouvert : navigation clavier prioritaire
        if (slashOpen && slashItems.length) {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            slashIndex = (slashIndex + 1) % slashItems.length
            return
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            slashIndex = (slashIndex - 1 + slashItems.length) % slashItems.length
            return
          }
          if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault()
            applySlash(slashItems[slashIndex].cmd)
            return
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            closeSlash()
            return
          }
        }
        // Menu @fichier ouvert : navigation clavier prioritaire
        if (atOpen && atItems.length) {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            atIndex = (atIndex + 1) % atItems.length
            return
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            atIndex = (atIndex - 1 + atItems.length) % atItems.length
            return
          }
          if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault()
            applyAt(atItems[atIndex])
            return
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            closeAt()
            return
          }
        }
        // Menu @ ouvert SANS candidat (sandbox vide) : Échap referme quand même
        if (atOpen && e.key === 'Escape') {
          e.preventDefault()
          closeAt()
          return
        }
        // Tab = bascule Mode Plan (OpenCode), tant qu'aucune suggestion @ n'est active
        if (e.key === 'Tab' && onTogglePlan && !text.startsWith('@')) {
          e.preventDefault()
          onTogglePlan()
          return
        }
        key(e)
      }}
      rows="1"
      placeholder={atHintSandbox
        ? atHintSandbox
        : agents.length
          ? 'Écris à Nexus — @fichier pour joindre, / pour les commandes…'
          : 'Écris ton message…  (Entrée = envoyer · @fichier · /commandes)'}
    ></textarea>
    {#if streaming}
      <button class="stop" onclick={onStop} title="Arrêter la génération" aria-label="Arrêter la génération">■</button>
    {:else}
      {#if onSendBoth}
        <button class="send both" onclick={submitBoth} disabled={!text.trim()} title="Envoyer aux deux" aria-label="Envoyer aux deux conversations">⇉</button>
      {/if}
      <button class="send" onclick={submit} disabled={!text.trim()} title="Envoyer" aria-label="Envoyer le message">↑</button>
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
  .hint-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .hint-row button {
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--fg);
    font: inherit;
    font-size: 12.5px;
    border-radius: 8px;
    padding: 3px 8px;
    cursor: pointer;
  }
  .hint-row button.ghost {
    background: none;
    border-color: var(--border);
    color: var(--muted);
    min-width: 24px;
    min-height: 24px;
  }
  .pickers {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap; /* colonne de duel étroite : passe à la ligne au lieu de déborder sur les docks */
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
    position: relative;
  }
  .inputrow:focus-within {
    border-color: var(--accent);
  }
  /* Menu @fichier */
  .at-menu {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    right: 0;
    z-index: 30;
    margin: 0;
    padding: 4px;
    list-style: none;
    background: var(--panel2);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 -8px 24px #00000066;
    max-height: 240px;
    overflow-y: auto;
  }
  .at-menu button {
    display: block;
    width: 100%;
    text-align: left;
    border: 0;
    background: transparent;
    color: var(--fg);
    font-size: 12.5px;
    padding: 5px 8px;
    border-radius: 7px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .at-menu button.sel {
    background: #818cf82c;
    color: #c7d2fe;
  }
  .at-ico {
    margin-right: 4px;
  }
  .slash-hint {
    color: var(--muted);
    font-size: 11.5px;
    margin-left: 6px;
  }
  .at-hint {
    font-size: 10.5px;
    color: var(--muted);
    padding: 4px 8px 2px;
    border-top: 1px dashed var(--border);
    margin-top: 2px;
  }
  /* État vide du menu @ : sandbox sans fichiers — explicite plutôt que muet */
  .at-empty {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 8px;
    font-size: 12.5px;
    color: var(--muted);
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
