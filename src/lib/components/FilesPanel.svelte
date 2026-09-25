<script lang="ts">
  // Panneau Fichiers : explorateur de la sandbox de la conversation
  // (~/.chatdeck/workspaces/<conv-id> via /api/sandbox). Lecture, création, suppression.
  import type { FileNode } from '../agents'

  let {
    convId,
    enabled,
    onClose,
  }: {
    convId: string
    /** true quand les agents sont actifs (sandbox bootstrappée au 1er message) */
    enabled: boolean
    onClose: () => void
  } = $props()

  let tree = $state<FileNode[] | null>(null)
  let exists = $state(false)
  let selected = $state<{ path: string; content: string } | null>(null)
  let newPath = $state('')
  let error = $state('')
  let loading = $state(false)

  async function refresh(): Promise<void> {
    loading = true
    error = ''
    try {
      const r = await fetch(`/api/sandbox/${convId}/tree`)
      const j = (await r.json()) as { exists: boolean; tree: FileNode[] }
      exists = j.exists
      tree = j.tree
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  }

  async function openFile(path: string): Promise<void> {
    error = ''
    try {
      const r = await fetch(`/api/sandbox/${convId}/file?path=${encodeURIComponent(path)}`)
      const j = (await r.json()) as { content?: string; error?: string }
      if (j.error) error = j.error
      else selected = { path, content: j.content ?? '' }
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function createFile(): Promise<void> {
    const p = newPath.trim()
    if (!p) return
    error = ''
    try {
      const r = await fetch(`/api/sandbox/${convId}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: p, content: selected?.path === p ? selected.content : '' }),
      })
      const j = (await r.json()) as { error?: string }
      if (j.error) error = j.error
      newPath = ''
      await refresh()
      await openFile(p)
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function saveFile(): Promise<void> {
    if (!selected) return
    error = ''
    try {
      const r = await fetch(`/api/sandbox/${convId}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selected.path, content: selected.content }),
      })
      const j = (await r.json()) as { error?: string }
      if (j.error) error = j.error
      else await refresh()
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function removePath(path: string): Promise<void> {
    error = ''
    try {
      await fetch(`/api/sandbox/${convId}/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
      if (selected?.path === path) selected = null
      await refresh()
    } catch (e) {
      error = (e as Error).message
    }
  }

  $effect(() => {
    void convId
    void refresh()
  })
</script>

<aside class="files" aria-label="Fichiers sandbox">
  <header>
    <strong>📁 Sandbox — {convId.slice(0, 10)}…</strong>
    <button class="mini" onclick={refresh} title="Rafraîchir">⟳</button>
    <button class="mini" onclick={onClose} title="Fermer">×</button>
  </header>

  {#if !enabled}
    <p class="note">Active les agents Nexus &amp; Seeker (⌘K) pour créer et peupler la sandbox de ce fil.</p>
  {:else if !exists}
    <p class="note">Workspace pas encore créé — il le sera au premier message des agents.</p>
  {/if}

  {#if error}<p class="err">{error}</p>{/if}

  {#if tree?.length}
    <ul class="tree">
      {#each tree as n (n.name)}
        <li>
          {#if n.type === 'dir'}
            <span class="dir">📁 {n.name}/</span>
            {#if n.children}
              <ul>
                {#each n.children as c (c.name)}
                  <li>
                    <button class="f" onclick={() => openFile(`${n.name}/${c.name}`)}>📄 {c.name}</button>
                    <button class="mini del" title="Supprimer" onclick={() => removePath(`${n.name}/${c.name}`)}>×</button>
                  </li>
                {/each}
              </ul>
            {/if}
          {:else}
            <button class="f" onclick={() => openFile(n.name)}>📄 {n.name}</button>
            <button class="mini del" title="Supprimer" onclick={() => removePath(n.name)}>×</button>
          {/if}
        </li>
      {/each}
    </ul>
  {:else if exists && !loading}
    <p class="note">Workspace vide.</p>
  {/if}

  <div class="newrow">
    <input
      placeholder="nouveau/fichier.md"
      bind:value={newPath}
      onkeydown={(e) => e.key === 'Enter' && createFile()}
    />
    <button class="mini" onclick={createFile} title="Créer">＋</button>
  </div>

  {#if selected}
    <div class="editor">
      <header class="edhead">
        <code>{selected.path}</code>
        <button class="mini" onclick={saveFile} title="Sauvegarder">💾</button>
        <button class="mini" onclick={() => (selected = null)} title="Fermer le fichier">×</button>
      </header>
      <textarea bind:value={selected.content} spellcheck="false"></textarea>
    </div>
  {/if}
</aside>

<style>
  .files {
    position: fixed;
    right: 16px;
    bottom: 42px;
    width: min(430px, calc(100vw - 32px));
    max-height: 46vh;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background: color-mix(in srgb, var(--panel) 96%, transparent);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(10px);
    z-index: 70;
    overflow: auto;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  header strong {
    flex: 1;
    font-size: 13px;
  }
  .mini {
    font-size: 12px;
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--muted);
    background: transparent;
  }
  .mini:hover {
    color: var(--text);
    border-color: var(--accent);
  }
  .note {
    color: var(--muted);
    font-size: 12.5px;
    margin: 0;
  }
  .err {
    color: #ffb4b4;
    font-size: 12.5px;
    margin: 0;
  }
  .tree {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 13px;
  }
  .tree ul {
    list-style: none;
    margin: 0;
    padding-left: 18px;
  }
  .dir {
    color: var(--muted);
  }
  .f {
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--text);
    background: none;
    border: none;
    padding: 2px 4px;
    text-align: left;
  }
  .f:hover {
    color: var(--accent);
  }
  .del {
    opacity: 0;
    border: none;
  }
  li:hover .del {
    opacity: 1;
  }
  .newrow {
    display: flex;
    gap: 6px;
  }
  .newrow input {
    flex: 1;
    font-family: var(--mono);
    font-size: 12.5px;
  }
  .editor {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-top: 1px solid var(--border);
    padding-top: 8px;
  }
  .edhead {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .edhead code {
    flex: 1;
    font-size: 12px;
    color: var(--muted);
  }
  textarea {
    height: 140px;
    font-family: var(--mono);
    font-size: 12.5px;
    resize: vertical;
  }
</style>
