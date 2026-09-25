<script lang="ts">
  // Recherche globale ⌘⇧F : un input, tous les messages, résultats cliquables
  // (surlignage de la correspondance, saut au message à la sélection).
  import { searchConversations, type SearchHit } from '../search'
  import type { Conversation } from '../store'

  let {
    conversations,
    onOpen,
    onClose,
  }: {
    conversations: Conversation[]
    onOpen: (convId: string, ts: number) => void
    onClose: () => void
  } = $props()

  let query = $state('')
  let inputEl: HTMLInputElement | undefined = $state()

  const hits = $derived(searchConversations(conversations, query))

  function open(hit: SearchHit): void {
    onOpen(hit.convId, hit.ts)
    onClose()
  }

  $effect(() => {
    inputEl?.focus()
  })
</script>

<div class="search-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="search-panel" role="dialog" aria-label="Recherche globale">
    <input
      bind:this={inputEl}
      bind:value={query}
      placeholder="Chercher dans toutes les conversations…"
      aria-label="Requête de recherche"
    />
    {#if query.trim() && !hits.length}
      <p class="empty">Aucun résultat pour « {query} ».</p>
    {:else if hits.length}
      <ul class="hits" aria-label="Résultats">
        {#each hits as h, i (h.convId + h.ts + i)}
          <li>
            <button class="hit" onclick={() => open(h)}>
              <span class="meta">
                {#if h.agent}<span class="agent">🧠 {h.agent === 'seeker' ? 'Seeker' : 'Nexus'}</span>{/if}
                <span class="conv">{h.convTitle.slice(0, 32)}</span>
                <span class="role">{h.role === 'user' ? '🧑 toi' : '⚡ agent'}</span>
              </span>
              <span class="excerpt">
                …{h.before}<mark>{h.match}</mark>{h.after}…
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <footer>
      <span>⏎ ou clic = aller au message</span>
      <span>Échap = fermer</span>
    </footer>
  </div>
</div>

<style>
  .search-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 90;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 10vh;
  }
  .search-panel {
    width: min(640px, calc(100vw - 40px));
    max-height: 68vh;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
    overflow: hidden;
  }
  input {
    margin: 12px;
    padding: 10px 14px;
    font-size: 15px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--panel2);
  }
  input:focus {
    border-color: var(--accent);
    outline: none;
  }
  .empty {
    color: var(--muted);
    padding: 4px 16px 14px;
    font-size: 13.5px;
  }
  .hits {
    list-style: none;
    margin: 0;
    padding: 0 8px 8px;
    overflow-y: auto;
  }
  .hit {
    display: block;
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    border-radius: 9px;
    background: none;
    border: 1px solid transparent;
  }
  .hit:hover {
    background: var(--panel2);
    border-color: var(--border);
  }
  .meta {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 11.5px;
    color: var(--muted);
    font-family: var(--mono);
    margin-bottom: 3px;
  }
  .conv {
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 220px;
  }
  .role {
    margin-left: auto;
  }
  .excerpt {
    font-size: 13px;
    color: var(--muted);
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  mark {
    background: color-mix(in srgb, var(--accent) 35%, transparent);
    color: var(--text);
    border-radius: 3px;
    padding: 0 2px;
  }
  footer {
    display: flex;
    justify-content: space-between;
    padding: 8px 14px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 11.5px;
    font-family: var(--mono);
  }
</style>
