<script lang="ts">
  // Panneau Skills & Agents : liste les fiches .CD (bibliothèque PromptDeck,
  // projet ./.cd, global ~/.chatdeck) via /api/deck/cards et permet de les
  // ACTIVER par clic — une fiche activée est injectée dans le prompt système
  // des agents (même mécanisme que `deck run`). Recherche, filtres
  // skill/agent/source, contenu dépliable et création de fiche (deck cd --new).
  import { loadDeckState, saveDeckState } from '../store'

  let {
    onClose,
    onPopout,
  }: {
    onClose: () => void
    onPopout?: () => void
  } = $props()

  interface Card {
    id: string
    kind: 'skill' | 'agent'
    source: 'library' | 'project' | 'global'
    path: string
    description: string
  }

  const SOURCE_LABEL: Record<Card['source'], string> = {
    library: 'pack',
    project: 'projet',
    global: 'global',
  }

  let cards = $state<Card[]>([])
  let loading = $state(true)
  let error = $state('')
  let query = $state('')
  let kindFilter = $state<'all' | 'skill' | 'agent'>('all')
  let sourceFilter = $state<'all' | Card['source']>('all')
  let openId = $state<string | null>(null)
  let openContent = $state('')
  let newName = $state('')
  let newKind = $state<'skill' | 'agent'>('skill')
  let newNote = $state('')
  /** Tampon d'édition de la fiche ouverte (textarea, sauvegarde PUT explicite) */
  let editBuffer = $state('')

  // État activé partagé app ⇄ popouts (localStorage)
  let deck = $state(loadDeckState())
  function persist(): void {
    saveDeckState(deck)
    try {
      new BroadcastChannel('chatdeck-sync-v1').postMessage({ type: 'state-saved' })
    } catch {
      /* canal indisponible */
    }
  }

  const isActive = (id: string): boolean => deck.active.includes(id)

  async function refresh(): Promise<void> {
    loading = true
    error = ''
    try {
      const r = await fetch('/api/deck/cards')
      const j = (await r.json()) as { cards?: Card[]; error?: string }
      if (j.error) error = j.error
      else cards = j.cards ?? []
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  }
  $effect(() => {
    void refresh()
  })

  /** Active/désactive une fiche : charge son contenu au besoin puis persiste. */
  async function toggle(id: string): Promise<void> {
    if (isActive(id)) {
      const cache = { ...deck.cache }
      delete cache[id]
      deck = { active: deck.active.filter((x) => x !== id), cache }
      persist()
      return
    }
    if (!deck.cache[id]) {
      try {
        const r = await fetch(`/api/deck/card?id=${encodeURIComponent(id)}`)
        const j = (await r.json()) as { content?: string; error?: string }
        if (j.error) {
          newNote = `✗ ${j.error}`
          return
        }
        deck.cache[id] = (j.content ?? '').slice(0, 12_000)
      } catch (e) {
        newNote = `✗ ${(e as Error).message}`
        return
      }
    }
    if (deck.active.length >= 12) {
      newNote = '⚠ 12 fiches actives maximum — désactive-en une d’abord.'
      return
    }
    deck = { active: [...deck.active, id], cache: { ...deck.cache } }
    persist()
    newNote = `✓ ${id} activée — injectée dans le prompt des agents`
    setTimeout(() => (newNote = ''), 2600)
  }

  async function show(id: string): Promise<void> {
    if (openId === id) {
      openId = null
      return
    }
    openId = id
    openContent = deck.cache[id] ?? ''
    if (!openContent) {
      const r = await fetch(`/api/deck/card?id=${encodeURIComponent(id)}`)
      const j = (await r.json()) as { content?: string }
      openContent = j.content ?? ''
    }
    editBuffer = openContent
  }

  /** Édition : sauvegarde via PUT (fiches projet uniquement). */
  async function saveEdit(): Promise<void> {
    if (!openId) return
    try {
      const r = await fetch('/api/deck/card', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: openId, content: editBuffer }),
      })
      const j = (await r.json()) as { ok?: boolean; path?: string; error?: string }
      if (j.error) newNote = `✗ ${j.error}`
      else {
        newNote = `✓ enregistrée : ${j.path}`
        openContent = editBuffer
        deck.cache[openId] = editBuffer
        persist()
        setTimeout(() => (newNote = ''), 2600)
      }
    } catch (e) {
      newNote = `✗ ${(e as Error).message}`
    }
  }

  async function createCard(): Promise<void> {
    newNote = ''
    const name = newName.trim()
    if (!name) return
    try {
      const r = await fetch('/api/deck/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, kind: newKind }),
      })
      const j = (await r.json()) as { ok?: boolean; path?: string; error?: string }
      if (j.error) newNote = `✗ ${j.error}`
      else {
        newNote = `✓ créée : ${j.path} — à remplir dans l’éditeur`
        newName = ''
        await refresh()
      }
    } catch (e) {
      newNote = `✗ ${(e as Error).message}`
    }
  }

  const filtered = $derived(
    cards.filter(
      (c) =>
        (kindFilter === 'all' || c.kind === kindFilter) &&
        (sourceFilter === 'all' || c.source === sourceFilter) &&
        (!query.trim() ||
          `${c.id} ${c.description}`.toLowerCase().includes(query.trim().toLowerCase())),
    ),
  )
  const activeCount = $derived(deck.active.length)
</script>

<aside class="deck hubbed" aria-label="Skills et agents (.CD)">
  <header>
    <strong>🃏 Skills &amp; Agents</strong>
    <span class="count">{cards.length} fiches · {activeCount} active{activeCount > 1 ? 's' : ''}</span>
    {#if onPopout}
      <button class="mini" onclick={onPopout} title="Extraire en fenêtre">⧉</button>
    {/if}
    <button class="mini" onclick={refresh} title="Rafraîchir">⟳</button>
    <button class="mini" onclick={onClose} title="Fermer">×</button>
  </header>

  <div class="filters">
    <input class="q" placeholder="chercher une fiche…" bind:value={query} />
    <div class="seg">
      {#each [['all', 'Tout'], ['skill', 'Skills'], ['agent', 'Agents']] as [kv, label]}
        <button class:active={kindFilter === kv} onclick={() => (kindFilter = kv as typeof kindFilter)}>{label}</button>
      {/each}
    </div>
    <div class="seg">
      {#each [['all', 'Toutes'], ['library', 'Pack'], ['project', 'Projet'], ['global', 'Global']] as [kv, label]}
        <button class:active={sourceFilter === kv} onclick={() => (sourceFilter = kv as typeof sourceFilter)}>{label}</button>
      {/each}
    </div>
  </div>

  {#if newNote}<p class="note">{newNote}</p>{/if}
  {#if error}<p class="err">{error}</p>{/if}

  <div class="list">
    {#if loading}
      <p class="note">chargement…</p>
    {:else if !filtered.length}
      <p class="note">aucune fiche ne correspond</p>
    {:else}
      {#each filtered as c (c.id)}
        <div class="cardrow" class:on={isActive(c.id)}>
          <button class="main" onclick={() => void toggle(c.id)} title={isActive(c.id) ? 'Désactiver (retirée du prompt)' : 'Activer (injectée dans le prompt des agents)'}>
            <span class="check">{isActive(c.id) ? '☑' : '☐'}</span>
            <span class="id">{c.kind === 'agent' ? '🤖' : '⚡'} {c.id}</span>
            <span class="src {c.source}">{SOURCE_LABEL[c.source]}</span>
          </button>
          <button class="eye" onclick={() => void show(c.id)} title="Voir la fiche">{openId === c.id ? '▴' : '▾'}</button>
        </div>
        {#if openId === c.id}
          <p class="desc">{c.description}</p>
          {#if openContent}
            <textarea
              class="edit"
              bind:value={editBuffer}
              spellcheck="false"
              rows={Math.min(18, editBuffer.split('\n').length + 2)}
            ></textarea>
            {#if c.source === 'project'}
              <div class="editbar">
                <button class="mini" onclick={() => void saveEdit()}>💾 enregistrer</button>
                <span class="edithint">fiche projet — éditable</span>
              </div>
            {:else}
              <div class="editbar"><span class="edithint">fiche du pack — lecture seule (copie-la pour l'éditer)</span></div>
            {/if}
          {/if}
        {/if}
      {/each}
    {/if}
  </div>

  <footer>
    <select bind:value={newKind} title="Type de fiche à créer">
      <option value="skill">skill</option>
      <option value="agent">agent</option>
    </select>
    <input placeholder="ma-methode" bind:value={newName} onkeydown={(e) => e.key === 'Enter' && void createCard()} />
    <button class="mini" onclick={() => void createCard()} title="Crée .cd/&lt;type&gt;/&lt;nom&gt;.cd à remplir">＋ créer</button>
  </footer>
</aside>

<style>
  .deck {
    position: fixed;
    right: 16px;
    bottom: 42px;
    width: min(560px, calc(100vw - 32px));
    max-height: 74vh;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.4);
    z-index: 70;
    font-size: 13px;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  header strong {
    font-size: 13px;
  }
  .count {
    flex: 1;
    font-size: 11.5px;
    color: var(--muted);
  }
  .mini {
    border: 1px solid var(--border);
    background: none;
    color: var(--fg);
    border-radius: 7px;
    padding: 2px 8px;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }
  .mini:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .q {
    flex: 1;
    min-width: 120px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--fg);
    padding: 5px 8px;
    font: inherit;
  }
  .seg {
    display: flex;
    gap: 2px;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  .seg button {
    border: none;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 11.5px;
    padding: 4px 8px;
    cursor: pointer;
  }
  .seg button.active {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--fg);
  }
  .note {
    margin: 6px 10px 0;
    font-size: 12px;
    color: var(--muted);
  }
  .err {
    margin: 6px 10px 0;
    font-size: 12px;
    color: var(--danger, #ff6b6b);
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 6px 0;
  }
  .cardrow {
    display: flex;
    align-items: stretch;
    gap: 4px;
    padding: 0 8px;
  }
  .cardrow.on .main {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .main {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    border: none;
    background: none;
    color: var(--fg);
    font: inherit;
    text-align: left;
    padding: 5px 8px;
    border-radius: 8px;
    cursor: pointer;
  }
  .main:hover {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .check {
    width: 16px;
    color: var(--accent);
  }
  .id {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .src {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 1px 5px;
  }
  .eye {
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
    font: inherit;
    padding: 0 6px;
  }
  .desc {
    margin: 0 16px 4px 34px;
    font-size: 11.5px;
    color: var(--muted);
  }
  .edit {
    margin: 0 16px 4px 34px;
    width: calc(100% - 50px);
    font-size: 11px;
    line-height: 1.45;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px;
    resize: vertical;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .editbar {
    margin: 0 16px 8px 34px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .edithint {
    font-size: 10.5px;
    color: var(--muted);
  }
  footer {
    display: flex;
    gap: 6px;
    padding: 8px 10px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }
  footer select,
  footer input {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    padding: 4px 8px;
  }
  footer input {
    flex: 1;
    min-width: 0;
  }
</style>
