<script lang="ts">
  import type { Conversation } from '../store'
  import { findModel, providerOf } from '../llm'

  let {
    conversations,
    currentId,
    onNew,
    onSelect,
    onDelete,
    onOpenSettings,
  }: {
    conversations: Conversation[]
    currentId: string | null
    onNew: () => void
    onSelect: (id: string) => void
    onDelete: (id: string) => void
    onOpenSettings: () => void
  } = $props()
</script>

<aside class="side">
  <div class="head">
    <span class="brand">⚡ ChatDeck</span>
    <button class="new" onclick={onNew} title="Nouvelle conversation">＋</button>
  </div>

  <div class="list">
    {#each conversations as c (c.id)}
      <div
        class="item"
        class:active={c.id === currentId}
        role="button"
        tabindex="0"
        onclick={() => onSelect(c.id)}
        onkeydown={(e) => e.key === 'Enter' && onSelect(c.id)}
      >
        <div class="title">{c.title}</div>
        <div class="meta">{providerOf(c.providerId).label} · {findModel(c.providerId, c.model).label}</div>
        <button
          class="del"
          title="Supprimer"
          onclick={(e) => {
            e.stopPropagation()
            onDelete(c.id)
          }}>×</button
        >
      </div>
    {/each}
  </div>

  <button class="settings" onclick={onOpenSettings}>⚙︎ Réglages <kbd>⌘K</kbd></button>
</aside>

<style>
  .side {
    width: 248px;
    flex-shrink: 0;
    background: var(--panel);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 14px 10px;
  }
  .brand {
    font-weight: 700;
    letter-spacing: 0.3px;
  }
  .new {
    width: 26px;
    height: 26px;
    border-radius: 8px;
    background: var(--accent);
    color: #fff;
    font-size: 16px;
    line-height: 1;
  }
  .new:hover {
    filter: brightness(1.15);
  }
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 8px;
  }
  .item {
    position: relative;
    padding: 8px 26px 8px 10px;
    border-radius: 10px;
    cursor: pointer;
    margin-bottom: 2px;
  }
  .item:hover {
    background: var(--panel2);
  }
  .item.active {
    background: var(--panel2);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .title {
    font-size: 13.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta {
    font-size: 11.5px;
    color: var(--muted);
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .del {
    position: absolute;
    right: 6px;
    top: 8px;
    color: var(--muted);
    font-size: 15px;
    opacity: 0;
    transition: 0.12s;
  }
  .item:hover .del {
    opacity: 1;
  }
  .del:hover {
    color: var(--danger);
  }
  .settings {
    margin: 10px;
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--muted);
    text-align: left;
  }
  .settings:hover {
    color: var(--text);
    border-color: var(--accent);
  }
  kbd {
    float: right;
    font-size: 11px;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0 4px;
  }
</style>
