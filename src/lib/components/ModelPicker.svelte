<script lang="ts">
  // Combobox du catalogue OpenRouter complet (458 modèles) + saisie libre d'identifiant.
  // Fetch proxifié au focus, cache 10 min côté llm.ts, repli sur la liste courte.
  import { fetchOpenRouterCatalog, type CatalogModel } from '../llm'

  let {
    value,
    onCommit,
    placeholder = 'openai/gpt-4.1-mini — tape pour chercher (458 modèles)',
  }: {
    value: string
    onCommit: (modelId: string) => void
    placeholder?: string
  } = $props()

  // Capture initiale assumée : le composant est recréé par conversation
  // (et l'$effect ci-dessous resynchronise si la prop change ensuite)
  // svelte-ignore state_referenced_locally
  let query = $state(value)
  let models = $state<CatalogModel[]>([])
  let loading = $state(false)
  let openList = $state(false)
  let highlighted = $state(0)
  let box: HTMLDivElement | undefined = $state()

  $effect(() => {
    query = value
  })

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase()
    const list = q ? models.filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)) : models
    return list.slice(0, 60) // rendu limité, la recherche filtre le reste
  })

  async function ensureModels(): Promise<void> {
    if (models.length || loading) return
    loading = true
    try {
      models = await fetchOpenRouterCatalog()
    } finally {
      loading = false
    }
  }

  function focus(): void {
    openList = true
    highlighted = 0
    void ensureModels()
  }

  function pick(m: CatalogModel): void {
    onCommit(m.id)
    query = m.id
    openList = false
  }

  function key(e: KeyboardEvent): void {
    if (!openList && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      openList = true
      void ensureModels()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      highlighted = Math.min(highlighted + 1, filtered.length - 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      highlighted = Math.max(highlighted - 1, 0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const m = filtered[highlighted]
      if (openList && m) pick(m)
      else if (query.trim()) {
        onCommit(query.trim()) // saisie libre : n'importe quel id de modèle
        openList = false
      }
    } else if (e.key === 'Escape') {
      openList = false
    }
  }

  function onClickOutside(e: PointerEvent): void {
    if (box && !box.contains(e.target as Node)) openList = false
  }
  $effect(() => {
    window.addEventListener('pointerdown', onClickOutside)
    return () => window.removeEventListener('pointerdown', onClickOutside)
  })
</script>

<div class="box" bind:this={box}>
  <input
    class="mono"
    bind:value={query}
    onfocus={focus}
    oninput={() => {
      openList = true
      highlighted = 0
    }}
    onkeydown={key}
    {placeholder}
    spellcheck="false"
    autocomplete="off"
  />
  {#if openList}
    <div class="list" role="listbox">
      {#if loading}
        <div class="empty">Chargement du catalogue…</div>
      {:else if filtered.length === 0}
        <div class="empty">Aucun modèle — Entrée pour utiliser « {query} » tel quel</div>
      {:else}
        {#each filtered as m, i (m.id)}
          <button
            class="item"
            class:hl={i === highlighted}
            role="option"
            aria-selected={i === highlighted}
            onpointerenter={() => (highlighted = i)}
            onclick={() => pick(m)}
          >
            <span class="id">{m.id}</span>
            <span class="meta">{#if m.context}{Math.round(m.context / 1000)}k ctx{/if}</span>
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .box {
    position: relative;
    min-width: 0;
  }
  input {
    width: 100%;
    font-size: 12px;
    padding: 5px 9px;
  }
  .mono {
    font-family: var(--mono);
  }
  .list {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    max-height: 280px;
    overflow-y: auto;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    z-index: 40;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  }
  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    text-align: left;
    padding: 6px 10px;
    font-size: 12px;
    color: var(--text);
  }
  .item.hl {
    background: var(--panel2);
  }
  .id {
    font-family: var(--mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta {
    color: var(--muted);
    font-size: 10.5px;
    flex-shrink: 0;
    font-family: var(--mono);
  }
  .empty {
    padding: 10px;
    color: var(--muted);
    font-size: 12px;
  }
</style>
