<script lang="ts">
  import type { Conversation, CustomProvider } from '../store'
  import { providerOf, findModel } from '../llm'

  let {
    conversations,
    currentId,
    customs = [],
    onNew,
    onNewIncognito,
    onSelect,
    onDelete,
    onMergeIncognito,
    onExportAll,
    onExportCurrent,
    onImport,
  }: {
    conversations: Conversation[]
    currentId: string | null
    customs?: CustomProvider[]
    onNew: () => void
    onNewIncognito: () => void
    onSelect: (id: string) => void
    onDelete: (id: string) => void
    onMergeIncognito: () => void
    onExportAll: () => void
    onExportCurrent: () => void
    onImport: (file: File) => void
  } = $props()

  const incognitoCount = $derived(conversations.filter((c) => c.incognito).length)
  let fileInput: HTMLInputElement | undefined = $state()

  function meta(c: Conversation): string {
    return `${providerOf(c.providerId, customs).label} · ${findModel(c.providerId, c.model, customs).label}`
  }
</script>

<aside class="side">
  <div class="head">
    <span class="brand">⚡ ChatDeck</span>
    <div class="head-btns">
      <button class="ghost" onclick={onNewIncognito} title="Nouvelle conversation incognito (⌘⇧N)">👻</button>
      <button class="new" onclick={onNew} title="Nouvelle conversation (⌘N)">＋</button>
    </div>
  </div>

  <div class="list">
    {#each conversations as c (c.id)}
      <div
        class="item"
        class:active={c.id === currentId}
        class:ghosty={c.incognito}
        role="button"
        tabindex="0"
        onclick={() => onSelect(c.id)}
        onkeydown={(e) => e.key === 'Enter' && onSelect(c.id)}
      >
        <div class="title">{c.incognito ? '👻 ' : ''}{c.title}</div>
        <div class="meta">{meta(c)}</div>
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
    {#if incognitoCount > 0}
      <button
        class="merge"
        onclick={onMergeIncognito}
        title="Copier les conversations 👻 dans l'historique persistant"
      >
        ⤵ Fusionner {incognitoCount} conversation{incognitoCount > 1 ? 's' : ''} 👻 dans l'historique
      </button>
    {/if}
  </div>

  <div class="io">
    <button onclick={onExportCurrent} title="Exporter la conversation courante (⌘E)">⬇︎ Export</button>
    <button onclick={onExportAll} title="Exporter toutes les conversations">Tout</button>
    <button onclick={() => fileInput?.click()} title="Importer un JSON (⌘I)">⬆︎ Import</button>
    <input
      type="file"
      accept=".json,application/json"
      hidden
      bind:this={fileInput}
      onchange={(e) => {
        const f = (e.currentTarget as HTMLInputElement).files?.[0]
        if (f) onImport(f)
        e.currentTarget.value = ''
      }}
    />
  </div>
</aside>

<style>
  .side {
    width: 100%;
    height: 100%;
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
  .head-btns {
    display: flex;
    gap: 6px;
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
  .ghost {
    width: 26px;
    height: 26px;
    border-radius: 8px;
    border: 1px solid var(--border);
    font-size: 13px;
    line-height: 1;
  }
  .ghost:hover {
    border-color: var(--accent);
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
  .item:hover,
  .item.active {
    background: var(--panel2);
  }
  .item.active {
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .item.ghosty {
    opacity: 0.8;
    border: 1px dashed var(--border);
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
    font-family: var(--mono);
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
  .merge {
    width: calc(100% - 8px);
    margin: 6px 4px;
    padding: 8px;
    font-size: 12px;
    color: var(--accent);
    border: 1px dashed var(--accent);
    border-radius: 10px;
  }
  .merge:hover {
    background: var(--panel2);
  }
  .io {
    display: flex;
    gap: 4px;
    padding: 8px;
    border-top: 1px solid var(--border);
  }
  .io button {
    flex: 1;
    font-size: 11.5px;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 4px;
    white-space: nowrap;
  }
  .io button:hover {
    color: var(--text);
    border-color: var(--accent);
  }
</style>
