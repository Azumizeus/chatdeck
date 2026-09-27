<script lang="ts">
  // Panneau Fichiers — gestionnaire complet de la sandbox : arbre récursif complet,
  // création/renommage/duplication/suppression, upload (drag & drop), téléchargement,
  // arbre Git + diff par commit, commit auto, profil OS, preview live.
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
  let selected = $state<{ path: string; content: string; dirty?: boolean } | null>(null)
  let newPath = $state('')
  let newKind = $state<'file' | 'dir'>('file')
  let error = $state('')
  let loading = $state(false)
  let gitOpen = $state(false)
  let git = $state<{ repo: boolean; log: { hash: string; date: string; subject: string }[]; status: string[] } | null>(null)
  let diff = $state<{ hash: string; files: { path: string; add: number; del: number }[]; diff: string } | null>(null)
  let diffBusy = $state(false)
  let os = $state<string>('')
  let osBusy = $state(false)
  let commitBusy = $state(false)
  let commitNote = $state('')
  let previewPath = $state<string | null>(null)
  let previewKey = $state(0)
  let renamedPath = $state<string | null>(null)
  let renameValue = $state('')
  let wide = $state(false)
  let fileInput: HTMLInputElement | undefined = $state()
  // Recherche dans l'arbre
  let filter = $state('')

  let expanded = $state<Set<string>>(new Set(['src']))

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

  /** Compte total de fichiers de l'arbre (affichage « N fichiers »). */
  const countFiles = (nodes: FileNode[] | null | undefined): number =>
    (nodes ?? []).reduce((a, n) => a + (n.type === 'file' ? 1 : countFiles(n.children)), 0)

  /** Filtre l'arbre sur `q` (insensible à la casse) en conservant les dossiers parents. */
  function filterTree(nodes: FileNode[], q: string): FileNode[] {
    if (!q) return nodes
    const lq = q.toLowerCase()
    const out: FileNode[] = []
    for (const n of nodes) {
      if (n.type === 'dir') {
        const kids = n.children ? filterTree(n.children, q) : []
        if (kids.length || n.name.toLowerCase().includes(lq)) out.push({ ...n, children: kids })
      } else if (n.name.toLowerCase().includes(lq)) out.push(n)
    }
    return out
  }
  const visibleTree = $derived(filterTree(tree ?? [], filter.trim()))

  function toggleDir(p: string): void {
    // Réassignation obligatoire : une mutation seule (add/delete) du Set ne
    // déclenche pas le re-render du snippet en Svelte 5 → dossiers incliquables.
    const next = new Set(expanded)
    if (next.has(p)) next.delete(p)
    else next.add(p)
    expanded = next
  }

  /** Déplie récursivement tous les dossiers (arborescence complète). */
  function expandAll(nodes: FileNode[], prefix = ''): void {
    const next = new Set(expanded)
    const walk = (ns: FileNode[], pre: string): void => {
      for (const n of ns) {
        if (n.type === 'dir') {
          const p = pre ? `${pre}/${n.name}` : n.name
          next.add(p)
          if (n.children) walk(n.children, p)
        }
      }
    }
    walk(nodes, prefix)
    expanded = next
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
        selected = { ...selected, dirty: false }
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

  /** Renomme (git mv-like : lecture + écriture + suppression). */
  function startRename(p: string, name: string): void {
    renamedPath = p
    renameValue = name
  }

  async function commitRename(): Promise<void> {
    const from = renamedPath
    if (!from) return
    const target = (renameValue ?? '').trim()
    renamedPath = null
    if (!target || target === from) return
    const to = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) + target : target
    error = ''
    try {
      const r = await fetch(`/api/sandbox/${convId}/file?path=${encodeURIComponent(from)}`)
      const j = (await r.json()) as { content?: string; error?: string }
      if (j.error) {
        error = j.error
        return
      }
      const isDir = j.content === undefined
      if (isDir) {
        // Dossier : recopie récursive via l'arbre en mémoire (borne : 200 fichiers)
        error = 'Renommage de dossier non supporté — recrée-le et déplace les fichiers.'
        return
      }
      await fetch(`/api/sandbox/${convId}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: to, content: j.content ?? '' }),
      })
      await fetch(`/api/sandbox/${convId}/file?path=${encodeURIComponent(from)}`, { method: 'DELETE' })
      if (selected?.path === from) selected = { path: to, content: j.content ?? '' }
      await refresh()
    } catch (e) {
      error = (e as Error).message
    }
  }

  /** Duplique un fichier « copie de nom » (ext conservée). */
  async function duplicate(p: string): Promise<void> {
    error = ''
    try {
      const r = await fetch(`/api/sandbox/${convId}/file?path=${encodeURIComponent(p)}`)
      const j = (await r.json()) as { content?: string; error?: string }
      if (j.error) {
        error = j.error
        return
      }
      const dot = p.lastIndexOf('.')
      const sep = p.lastIndexOf('/')
      const base = dot > sep ? p.slice(0, dot) : p
      const ext = dot > sep ? p.slice(dot) : ''
      const copy = `${base}-copie${ext}`
      await fetch(`/api/sandbox/${convId}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: copy, content: j.content ?? '' }),
      })
      await refresh()
    } catch (e) {
      error = (e as Error).message
    }
  }

  /** Télécharge un fichier du workspace (via l'endpoint serve, autorisé en lecture). */
  function download(p: string): void {
    const a = document.createElement('a')
    a.href = `/api/sandbox/${convId}/serve?path=${encodeURIComponent(p)}`
    a.download = p.split('/').pop() ?? 'fichier'
    a.click()
  }

  /** Upload : écrit chaque fichier sélectionné/déposé dans le workspace. */
  async function upload(files: FileList | File[]): Promise<void> {
    error = ''
    for (const f of Array.from(files).slice(0, 20)) {
      try {
        const isText = /\.(md|txt|js|mjs|ts|json|html|css|svg|csv|ya?ml)$/i.test(f.name) || f.type.startsWith('text/')
        const content = isText ? await f.text() : ''
        if (!isText && f.size > 0) {
          error = `« ${f.name} » : binaire non supporté (texte seul).`
          continue
        }
        await fetch(`/api/sandbox/${convId}/file`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: f.name, content }),
        })
      } catch (e) {
        error = `Upload ${f.name} : ${(e as Error).message}`
      }
    }
    await refresh()
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault()
    if (e.dataTransfer?.files.length) void upload(e.dataTransfer.files)
  }

  async function loadGit(): Promise<void> {
    gitOpen = !gitOpen
    if (!gitOpen) {
      diff = null
      return
    }
    const r = await fetch(`/api/sandbox/${convId}/git`)
    git = await r.json()
  }

  /** Charge le diff d'un commit (fichiers modifiés + patch). */
  async function showDiff(hash: string): Promise<void> {
    diffBusy = true
    error = ''
    try {
      const r = await fetch(`/api/sandbox/${convId}/git-diff?hash=${encodeURIComponent(hash)}`)
      const j = (await r.json()) as { hash: string; files?: { path: string; add: number; del: number }[]; diff?: string; error?: string }
      if (j.error) error = j.error
      else diff = { hash, files: j.files ?? [], diff: j.diff ?? '' }
    } catch (e) {
      error = (e as Error).message
    } finally {
      diffBusy = false
    }
  }

  /** Commit auto via l'endpoint sécurisé (git add -A + commit côté serveur). */
  async function autoCommit(): Promise<void> {
    commitBusy = true
    commitNote = ''
    try {
      const r = await fetch(`/api/sandbox/${convId}/git-commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `Travail agents — ${new Date().toLocaleString('fr-FR')}` }),
      })
      const j = (await r.json()) as { ok?: boolean; hash?: string | null; error?: string; note?: string }
      if (j.error) commitNote = `❌ ${j.error}`
      else if (j.hash === null) commitNote = j.note ?? 'rien à committer'
      else commitNote = `✅ ${j.hash} — commit créé`
      gitOpen = true
      const g = await fetch(`/api/sandbox/${convId}/git`)
      git = await g.json()
    } catch (e) {
      commitNote = (e as Error).message
    } finally {
      commitBusy = false
    }
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

  const fmtSize = (n?: number): string => (n == null ? '' : n < 1024 ? `${n} o` : `${(n / 1024).toFixed(1)} ko`)

  $effect(() => {
    void convId
    void refresh()
  })
</script>

<!-- Rendu récursif d'un nœud de l'arbre -->
{#snippet node(n: FileNode, prefix: string)}
  {@const p = prefix ? `${prefix}/${n.name}` : n.name}
  <li>
    {#if renamedPath === p}
      <input
        class="rename"
        bind:value={renameValue}
        onkeydown={(e) => {
          if (e.key === 'Enter') void commitRename()
          if (e.key === 'Escape') renamedPath = null
        }}
        onblur={() => void commitRename()}
      />
    {:else if n.type === 'dir'}
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
      <button class="f" onclick={() => openFile(p)}>{iconOf(n.name)} {n.name} <span class="size">{fmtSize(n.size)}</span></button>
      <button class="mini ren" title="Renommer" onclick={() => startRename(p, n.name)}>✎</button>
      <button class="mini dup" title="Dupliquer" onclick={() => void duplicate(p)}>⧈</button>
      <button class="mini dl" title="Télécharger" onclick={() => download(p)}>⬇</button>
      {#if /\.(html|css|js|json|svg|md)$/i.test(n.name)}
        <button class="mini eye" title="Preview live" onclick={() => { previewPath = p; previewKey++ }}>👁</button>
      {/if}
      <button class="mini del" title="Supprimer" onclick={() => removePath(p)}>×</button>
    {/if}
  </li>
{/snippet}

<aside class="files hubbed" class:wide aria-label="Fichiers sandbox" ondragover={(e) => e.preventDefault()} ondrop={onDrop}>
  <header>
    <strong>📁 {convId.slice(0, 10)}…</strong>
    <span class="count">{countFiles(tree)} fichiers</span>
    <button class="mini" onclick={() => fileInput?.click()} title="Importer des fichiers (ou glisser-déposer)">⬆ import</button>
    <button class="mini" class:active={gitOpen} onclick={loadGit} title="Arbre Git">⑂</button>
    <button class="mini" class:active={wide} onclick={() => (wide = !wide)} title="Agrandir / réduire le panneau">⤢</button>
    <button class="mini" onclick={refresh} title="Rafraîchir">⟳</button>
    <button class="mini" onclick={onClose} title="Fermer">×</button>
  </header>
  <input type="file" multiple hidden bind:this={fileInput} onchange={(e) => e.currentTarget.files && void upload(e.currentTarget.files)} />

  {#if !enabled}
    <p class="note">Active les agents (barre d'outils) pour créer la sandbox de ce fil.</p>
  {:else if !exists}
    <p class="note">Workspace pas encore créé — il le sera au premier message des agents.</p>
  {/if}

  {#if error}<p class="err">{error}</p>{/if}

  <!-- recherche dans l'arbre -->
  <div class="filterrow">
    <input placeholder="filtrer l'arbre…" bind:value={filter} />
    {#if tree?.length}
      <button class="mini" onclick={() => (tree ? expandAll(tree) : undefined)} title="Tout déplier">⇕</button>
      <button class="mini" onclick={() => (expanded = new Set())} title="Tout replier">⇥</button>
    {/if}
  </div>

  <!-- profil OS sécurisé (Secure AI Multi-OS) -->
  <div class="osrow">
    <span class="oslabel">OS :</span>
    {#each ['mac', 'windows', 'linux'] as o (o)}
      <button class="osbtn" class:active={os === o} disabled={osBusy} onclick={() => setOs(o)} title="Profil {o} — fichiers platform/ + exécutions bornées">
        {o === 'mac' ? '🍎' : o === 'windows' ? '🪟' : '🐧'} {o}
      </button>
    {/each}
  </div>

  {#if gitOpen}
    <div class="git">
      <button class="autocommit" disabled={commitBusy} onclick={() => void autoCommit()} title="git add -A + commit via l'endpoint sécurisé">
        {commitBusy ? '… commit en cours' : '⑂ commit auto'}
      </button>
      {#if commitNote}<div class="commitnote">{commitNote}</div>{/if}
      {#if !git?.repo}
        <p class="note">Pas de dépôt Git — « commit auto » l'initialise.</p>
      {:else}
        {#each git.log as c (c.hash)}
          <button class="commit" class:sel={diff?.hash === c.hash} onclick={() => void showDiff(c.hash)} title="Voir le diff de ce commit">
            <code>{c.hash}</code> <span>{c.subject.slice(0, 30)}</span>
          </button>
        {/each}
        {#each git.status as s (s)}
          <div class="st">{s}</div>
        {/each}
        {#if !git.log.length && !git.status.length}<p class="note">Dépôt vide.</p>{/if}
        {#if diffBusy}<p class="note">diff…</p>{/if}
        {#if diff}
          <div class="diffview">
            <div class="dhead">diff {diff.hash.slice(0, 7)} — {diff.files.length} fichier(s)</div>
            {#each diff.files as f (f.path)}
              <div class="dfile"><span class="add">+{f.add}</span><span class="del">-{f.del}</span> {f.path}</div>
            {/each}
            <pre class="patch">{diff.diff}</pre>
          </div>
        {/if}
      {/if}
    </div>
  {/if}

  {#if visibleTree?.length}
    <ul class="tree">
      {#each visibleTree as n (n.name)}
        {@render node(n, '')}
      {/each}
    </ul>
  {:else if exists && !loading}
    <p class="note">{filter ? 'Aucun fichier ne correspond.' : 'Workspace vide.'}</p>
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
        <code>{selected.path}{selected.dirty ? ' •' : ''}</code>
        <button class="mini" onclick={saveFile} title="Sauvegarder">💾</button>
        <button class="mini" onclick={() => (selected = null)} title="Fermer">×</button>
      </header>
      <textarea bind:value={selected.content} spellcheck="false" oninput={() => selected && (selected = { ...selected, dirty: true })}></textarea>
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
    width: min(560px, calc(100vw - 32px));
    max-height: 74vh;
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
  .files.wide {
    width: min(720px, calc(100vw - 32px));
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
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
    font-size: 12px;
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--muted);
    background: transparent;
    white-space: nowrap;
  }
  .mini:hover,
  .mini.active {
    color: var(--text);
    border-color: var(--accent);
  }
  .filterrow {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .filterrow input {
    flex: 1;
    font-size: 12.5px;
    padding: 4px 8px;
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
    max-height: 260px;
    overflow: auto;
  }
  .autocommit {
    width: 100%;
    margin-bottom: 6px;
    padding: 5px 8px;
    font-size: 12px;
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .autocommit:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .autocommit:disabled {
    opacity: 0.5;
  }
  .commitnote {
    font-size: 11.5px;
    color: var(--muted);
    margin-bottom: 4px;
  }
  .commit {
    display: flex;
    gap: 6px;
    width: 100%;
    text-align: left;
    padding: 2px 4px;
    border: none;
    background: none;
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--muted);
    border-radius: 5px;
  }
  .commit:hover {
    background: var(--panel2);
  }
  .commit.sel {
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .commit code {
    color: var(--accent);
  }
  .st {
    color: #ffb86b;
  }
  .diffview {
    margin-top: 6px;
    border-top: 1px solid var(--border);
    padding-top: 6px;
  }
  .dhead {
    color: var(--text);
    margin-bottom: 4px;
  }
  .dfile {
    font-size: 11px;
    padding: 1px 0;
  }
  .dfile .add {
    color: #27c93f;
    margin-right: 6px;
  }
  .dfile .del {
    color: #ff6b6b;
    margin-right: 6px;
  }
  .patch {
    margin: 6px 0 0;
    font-size: 10.5px;
    line-height: 1.45;
    background: var(--panel2);
    border-radius: 6px;
    padding: 8px;
    max-height: 160px;
    overflow: auto;
    white-space: pre;
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
  .f .size {
    color: var(--muted);
    font-size: 10.5px;
    margin-left: 6px;
  }
  .chev {
    color: var(--accent);
    font-size: 10px;
  }
  .rename {
    flex: 1;
    font-family: var(--mono);
    font-size: 12.5px;
    padding: 1px 6px;
  }
  .del,
  .eye,
  .ren,
  .dup,
  .dl {
    opacity: 0;
    border: none;
    padding: 2px 5px;
  }
  li:hover .del,
  li:hover .eye,
  li:hover .ren,
  li:hover .dup,
  li:hover .dl {
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
    height: 170px;
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
