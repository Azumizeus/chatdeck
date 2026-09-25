<script module lang="ts">
  // Palette de commandes ⌘K : filtre instantané, navigation clavier, exécution d'actions.
  export interface Command {
    id: string
    label: string
    hint?: string
    run: () => void
  }
</script>

<script lang="ts">
  let { commands, onClose }: { commands: Command[]; onClose: () => void } = $props()

  let query = $state('')
  let index = $state(0)
  let input: HTMLInputElement | undefined = $state()

  // Focus à l'ouverture (équivalent autofocus, sans l'attribut déprécié a11y)
  $effect(() => {
    input?.focus()
  })

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) => (c.label + ' ' + (c.hint ?? '')).toLowerCase().includes(q))
  })

  $effect(() => {
    index = 0
  })

  function key(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      index = Math.min(index + 1, filtered.length - 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      index = Math.max(index - 1, 0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const c = filtered[index]
      if (c) {
        onClose()
        c.run()
      }
    } else if (e.key === 'Escape') {
      onClose()
    }
  }
</script>

<div
  class="backdrop"
  role="presentation"
  onclick={(e) => e.target === e.currentTarget && onClose()}
  onkeydown={key}
>
  <div class="palette">
    <input bind:this={input} bind:value={query} onkeydown={key} placeholder="Tape une commande…" spellcheck="false" />
    <div class="list">
      {#if filtered.length === 0}
        <div class="empty">Aucune commande</div>
      {:else}
        {#each filtered as c, i (c.id)}
          <button
            class="item"
            class:hl={i === index}
            role="option"
            aria-selected={i === index}
            onpointerenter={() => (index = i)}
            onclick={() => {
              onClose()
              c.run()
            }}
          >
            <span>{c.label}</span>
            {#if c.hint}<kbd>{c.hint}</kbd>{/if}
          </button>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 12vh;
    z-index: 90;
  }
  .palette {
    width: min(520px, 92vw);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
  }
  input {
    width: 100%;
    border: none;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
    padding: 13px 16px;
    font-size: 14px;
  }
  input:focus {
    border-color: var(--border);
  }
  .list {
    max-height: 320px;
    overflow-y: auto;
    padding: 6px;
  }
  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    text-align: left;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 13.5px;
    color: var(--text);
  }
  .item.hl {
    background: var(--panel2);
  }
  kbd {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 5px;
  }
  .empty {
    padding: 14px;
    color: var(--muted);
    font-size: 13px;
  }
</style>
