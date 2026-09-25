<script lang="ts">
  // Panneau Fichiers : explorateur complet de la sandbox de la conversation —
  // arbre récursif, création fichiers/dossiers, arbre Git, profil OS sécurisé
  // (Secure AI Multi-OS) et preview live des pages HTML du workspace.
  import type { FileNode } from '../agents'

  let {
    convId,
    enabled,
    onClose,
  }: {
    convId: string
    enabled: boolean
    onClose: () => void
  } = $props()

  let tree = $state<FileNode[] | null>(null)
  let exists = $state(false)
  let selected = $state<{ path: string; content: string } | null>(null)
  let newPath = $state('')
  let newKind = $state<'file' | 'dir'>('file')
  let error = $state('')
  let loading = $state(false)
  let gitOpen = $state(false)
  let git = $state<{ repo: boolean; log: { hash: string; date: string; subject: string }[]; status: string[] } | null>(null)
  let os = $state<string>('')
  let osBusy = $state(false)
  let previewPath = $state<string | null>(null)
  let previewKey = $state(0)

  const expanded = $state<Set<string>>(new Set(['src']))

  async function refresh(): Promise<void> {
    loading = true
    error = ''
    try {
      const r = await fetch(`/api/sandbox/${convId}/tree`)
      const j = (await r.json()) as { exists: boolean; tree: FileNode[] }
      exists = j.exists
      tree = j.tree
      const ro = await fetch(`/api/sandbox/${convId}/os`)
      os = ((await ro.json()) as { os: string }).os
    } catch (e) {
      error = (e as Error).message
    } finally {
      loading = false
    }
  }

  function toggleDir(p: string): void {
    if (expanded.has(p)) expanded.delete(p)
    else expanded.add(p)
  }

  function openFile(path: string): void {
    void (async () => {
      error = ''
      try {
        const r = await fetch(`/api/sandbox/${convId}/file?path=${encodeURIComponent(path)}`)
        const j = (await r.json()) as { content?: string; error?: string }
        if (j.error) error = j.error
        else {
          selected = { path, content: j.content ?? '' }
          if (/\.(html|css|js|json|svg|md|txt)$/i.test(path)) {
            previewPath = path
            previewKey++
          }
        }
      } catch (e) {
        error = (e as Error).message
      }
    })()
  }

  async function createEntry(): Promise<void> {
    const p = newPath.trim()
    if (!p) return
    error = ''
    try {
      if (newKind === 'dir') {
        const r = await fetch(`/api/sandbox/${convId}/mkdir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: p }),
        })
        const j = (await r.json()) as { error?: string }
        if (j.error) error = j.error
      } else {
        const r = await fetch(`/api/sandbox/${convId}/file`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: p, content: selected?.path === p ? selected.content : '' }),
        })
        const j = (await r.json()) as { error?: string }
        if (j.error) error = j.error
        else await openFile(p)
      }
      newPath = ''
      await refresh()
    } catch (e) {
      error = (e as Error).message
    }
  }

  function createClicked(): void {
    void createEntry()
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
      else {
        previewKey++ // rafraîchit la preview live
        await refresh()
      }
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function removePath(p: string): Promise<void> {
    error = ''
    try {
      await fetch(`/api/sandbox/${convId}/file?path=${encodeURIComponent(p)}`, { method: 'DELETE' })
      if (selected?.path === p) selected = null
      if (previewPath === p) previewPath = null
      await refresh()
    } catch (e) {
      error = (e as Error).message
    }
  }

  async function loadGit(): Promise<void> {
    gitOpen = !gitOpen
    if (!gitOpen) return
    const r = await fetch(`/api/sandbox/${convId}/git`)
    git = await r.json()
  }

  async function setOs(next: string): Promise<void> {
    osBusy = true
    error = ''
    try {
      const r = await fetch(`/api/sandbox/${convId}/os`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ os: next }),
      })
      const j = (await r.json()) as { ok?: boolean; error?: string }
      if (j.error) error = j.error
      else os = next
      await refresh()
    } catch (e) {
      error = (e as Error).message
    } finally {
      osBusy = false
    }
  }

  const ICONS: Record<string, string> = {
    '.html': '🌐', '.css': '🎨', '.js': '📜', '.mjs': '📜', '.json': '🧩',
    '.md': '📝', '.txt': '📄', '.svg': '🖼️', '.png': '🖼️', '.sh': '⚙️', '.py': '🐍',
  }
  const iconOf = (name: string): string =>
    ICONS[name.slice(name.lastIndexOf('.')).toLowerCase()] ?? '📄'

  $effect(() => {
    void convId
    void refresh()
  })
</script>

<!-- Rendu récursif d'un nœud de l'arbre -->
{#snippet node(n: FileNode, prefix: string)}
  {@const p = prefix ? `${prefix}/${n.name}` : n.name}
  <li>
    {#if n.type === 'dir'}
      <button class="f dir" onclick={() => toggleDir(p)}>
        <span class="chev">{expanded.has(p) ? '▾' : '▸'}</span> 📁 {n.name}
      </button>
      <button class="mini del" title="Supprimer le dossier" onclick={() => removePath(p)}>×</button>
      {#if expanded.has(p) && n.children?.length}
        <ul>
          {#each n.children as c (c.name)}
            {@render node(c, p)}
          {/each}
        </ul>
      {/if}
    {:else}
      <button class="f" onclick={() => openFile(p)}>{iconOf(n.name)} {n.name}</button>
      {#if /\.(html|css|js|json|svg|md)$/i.test(n.name)}
        <button class="mini eye" title="Preview live" onclick={() => { previewPath = p; previewKey++ }}>👁</button>
      {/if}
      <button class="mini del" title="Supprimer" onclick={() => removePath(p)}>×</button>
    {/if}
  </li>
{/snippet}

<aside class="files" aria-label="Fichiers sandbox">
  <header>
    <strong>📁 Sandbox — {convId.slice(0, 10)}…</strong>
    <button class="mini" class:active={gitOpen} onclick={loadGit} title="Arbre Git">⑂</button>
    <button class="mini" onclick={refresh} title="Rafraîchir">⟳</button>
    <button class="mini" onclick={onClose} title="Fermer">×</button>
  </header>

  {#if !enabled}
    <p class="note">Active les agents Nexus &amp; Seeker (barre d'outils) pour créer la sandbox de ce fil.</p>
  {:else if !exists}
    <p class="note">Workspace pas encore créé — il le sera au premier message des agents.</p>
  {/if}

  {#if error}<p class="err">{error}</p>{/if}

  <!-- profil OS sécurisé (Secure AI Multi-OS) -->
  <div class="osrow">
    <span class="oslabel">OS sécurisé :</span>
    {#each ['mac', 'windows', 'linux'] as o (o)}
      <button class="osbtn" class:active={os === o} disabled={osBusy} onclick={() => setOs(o)} title="Profil {o} — fichiers platform/ + exécutions bornées">
        {o === 'mac' ? '🍎' : o === 'windows' ? '🪟' : '🐧'} {o}
      </button>
    {/each}
  </div>

  {#if gitOpen}
    <div class="git">
      {#if !git?.repo}
        <p class="note">Pas de dépôt Git — exécute <code>git init</code> puis des commits dans le terminal ⌨︎.</p>
      {:else}
        {#each git.log as c (c.hash)}
          <div class="commit"><code>{c.hash}</code> <span>{c.subject.slice(0, 34)}</span></div>
        {/each}
        {#each git.status as s (s)}
          <div class="st">{s}</div>
        {/each}
        {#if !git.log.length && !git.status.length}<p class="note">Dépôt vide.</p>{/if}
      {/if}
    </div>
  {/if}

  {#if tree?.length}
    <ul class="tree">
      {#each tree as n (n.name)}
        {@render node(n, '')}
      {/each}
    </ul>
  {:else if exists && !loading}
    <p class="note">Workspace vide.</p>
  {/if}

  <div class="newrow">
    <select bind:value={newKind} title="Type d'entrée">
      <option value="file">fichier</option>
      <option value="dir">dossier</option>
    </select>
    <input
      placeholder={newKind === 'dir' ? 'nouveau/dossier' : 'nouveau/fichier.md'}
      bind:value={newPath}
      onkeydown={(e) => e.key === 'Enter' && void createEntry()}
    />
    <button class="mini" onclick={createClicked} title="Créer">＋</button>
  </div>

  {#if selected}
    <div class="editor">
      <header class="edhead">
        <code>{selected.path}</code>
        <button class="mini" onclick={saveFile} title="Sauvegarder">💾</button>
        <button class="mini" onclick={() => (selected = null)} title="Fermer">×</button>
      </header>
      <textarea bind:value={selected.content} spellcheck="false"></textarea>
    </div>
  {/if}

  {#if previewPath}
    <div class="preview">
      <header class="edhead">
        <code>👁 {previewPath}</code>
        <button class="mini" onclick={() => (previewKey++)} title="Recharger">⟳</button>
        <button class="mini" onclick={() => (previewPath = null)} title="Fermer la preview">×</button>
      </header>
      {#key previewKey}
        <iframe
          title="Preview live du workspace"
          sandbox="allow-scripts"
          src="/api/sandbox/{convId}/serve?path={encodeURIComponent(previewPath)}"
        ></iframe>
      {/key}
    </div>
  {/if}
</aside>

<style>
  .files {
    position: fixed;
    right: 16px;
    bottom: 42px;
    width: min(470px, calc(100vw - 32px));
    max-height: 56vh;
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
  .mini:hover,
  .mini.active {
    color: var(--text);
    border-color: var(--accent);
  }
  .osrow {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
  }
  .oslabel {
    font-size: 12px;
    color: var(--muted);
  }
  .osbtn {
    font-size: 11.5px;
    padding: 3px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--muted);
    background: none;
  }
  .osbtn.active {
    color: var(--text);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .osbtn:disabled {
    opacity: 0.5;
  }
  .git {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 8px;
    font-size: 11.5px;
    font-family: var(--mono);
    max-height: 120px;
    overflow: auto;
  }
  .commit code {
    color: var(--accent);
    margin-right: 6px;
  }
  .commit span {
    color: var(--muted);
  }
  .st {
    color: #ffb86b;
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
  .tree,
  .tree ul {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 13px;
  }
  .tree ul {
    padding-left: 16px;
  }
  .tree li {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-wrap: wrap;
  }
  .f {
    flex: 1;
    min-width: 0;
    text-align: left;
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--text);
    background: none;
    border: none;
    padding: 2px 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .f:hover {
    color: var(--accent);
  }
  .f.dir {
    color: var(--muted);
  }
  .chev {
    color: var(--accent);
    font-size: 10px;
  }
  .del,
  .eye {
    opacity: 0;
    border: none;
    padding: 2px 5px;
  }
  li:hover .del,
  li:hover .eye {
    opacity: 1;
  }
  .newrow {
    display: flex;
    gap: 6px;
  }
  .newrow select {
    font-size: 12px;
  }
  .newrow input {
    flex: 1;
    font-family: var(--mono);
    font-size: 12.5px;
  }
  .editor,
  .preview {
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
  .preview iframe {
    width: 100%;
    height: 240px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: #fff;
  }
</style>
