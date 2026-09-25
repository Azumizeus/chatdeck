<script lang="ts">
  // Barre d'onglets façon IDE : conversations ouvertes, réordonnables par drag,
  // pastille fournisseur, indicateur de streaming animé, + pour nouvelle conversation.
  import type { Conversation, CustomProvider } from '../store'
  import { providerOf } from '../llm'

  let {
    conversations,
    currentId,
    streamingId,
    customs = [],
    onSelect,
    onClose,
    onNew,
    onReorder,
  }: {
    conversations: Conversation[]
    currentId: string | null
    /** Conversation en cours de streaming (indicateur animé) */
    streamingId: string | null
    customs?: CustomProvider[]
    onSelect: (id: string) => void
    onClose: (id: string) => void
    onNew: () => void
    onReorder: (dragId: string, overId: string) => void
  } = $props()

  const open = $derived(conversations.filter((c) => c.open !== false))
  let dragId = $state<string | null>(null)

  function color(c: Conversation): string {
    return providerOf(c.providerId, customs).color
  }

  function drop(overId: string): void {
    if (dragId && dragId !== overId) onReorder(dragId, overId)
    dragId = null
  }
</script>

<div class="tabbar" role="tablist">
  {#each open as c (c.id)}
    <div
      class="tab"
      class:active={c.id === currentId}
      class:dragging={dragId === c.id}
      role="tab"
      aria-selected={c.id === currentId}
      tabindex="0"
      draggable="true"
      ondragstart={(e) => {
        dragId = c.id
        e.dataTransfer?.setData('text/plain', c.id)
      }}
      ondragover={(e) => e.preventDefault()}
      ondrop={(e) => {
        e.preventDefault()
        drop(c.id)
      }}
      ondragend={() => (dragId = null)}
      onclick={() => onSelect(c.id)}
      onkeydown={(e) => e.key === 'Enter' && onSelect(c.id)}
    >
      <span class="dot" style="background: {color(c)}" title="Fournisseur"></span>
      <span class="name">{c.incognito ? '👻 ' : ''}{c.title}</span>
      {#if streamingId === c.id}
        <span class="stream" title="Génération en cours"></span>
      {/if}
      <button
        class="close"
        title="Fermer l'onglet"
        onclick={(e) => {
          e.stopPropagation()
          onClose(c.id)
        }}>×</button
      >
    </div>
  {/each}
  <button class="add" onclick={onNew} title="Nouvelle conversation (⌘N)">＋</button>
</div>

<style>
  .tabbar {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    padding: 6px 10px 0;
    height: 38px;
    flex-shrink: 0;
    overflow-x: auto;
    background: color-mix(in srgb, var(--panel) 60%, transparent);
    border-bottom: 1px solid var(--border);
    scrollbar-width: none;
  }
  .tabbar::-webkit-scrollbar {
    display: none;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px 5px 10px;
    font-size: 12.5px;
    color: var(--muted);
    background: transparent;
    border: 1px solid transparent;
    border-bottom: none;
    border-radius: 9px 9px 0 0;
    cursor: pointer;
    max-width: 210px;
    min-width: 0;
    user-select: none;
    transition: background 130ms, color 130ms;
  }
  .tab:hover {
    color: var(--text);
    background: var(--panel2);
  }
  .tab.active {
    color: var(--text);
    background: var(--panel);
    border-color: var(--border);
    box-shadow: inset 0 2px 0 var(--accent);
  }
  .tab.dragging {
    opacity: 0.45;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .stream {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent2);
    animation: pulse 1s ease-in-out infinite;
    flex-shrink: 0;
  }
  @keyframes pulse {
    50% {
      opacity: 0.25;
      transform: scale(0.8);
    }
  }
  .close {
    color: var(--muted);
    font-size: 13px;
    line-height: 1;
    padding: 0 2px;
    border-radius: 4px;
    opacity: 0;
    transition: opacity 120ms;
  }
  .tab:hover .close,
  .tab.active .close {
    opacity: 1;
  }
  .close:hover {
    color: var(--danger);
  }
  .add {
    color: var(--muted);
    font-size: 15px;
    padding: 2px 9px;
    border-radius: 7px;
    margin-bottom: 3px;
  }
  .add:hover {
    color: var(--text);
    background: var(--panel2);
  }
</style>
