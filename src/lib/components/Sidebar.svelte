<script lang="ts">
  import type { Conversation, CustomProvider, Project } from '../store'
  import { providerOf, findModel } from '../llm'

  let {
    conversations,
    currentId,
    customs = [],
    projects = [],
    onNew,
    onNewIncognito,
    onSelect,
    onDelete,
    onMergeIncognito,
    onExportAll,
    onExportCurrent,
    onImport,
    onCreateProject,
    onDeleteProject,
    onUpdateProject,
    onAttachProject,
    onSetProjectFolders,
  }: {
    conversations: Conversation[]
    currentId: string | null
    customs?: CustomProvider[]
    projects?: Project[]
    onNew: () => void
    onNewIncognito: () => void
    onSelect: (id: string) => void
    onDelete: (id: string) => void
    onMergeIncognito: () => void
    onExportAll: () => void
    onExportCurrent: () => void
    onImport: (file: File) => void
    onCreateProject?: (name: string) => void
    onDeleteProject?: (id: string) => void
    onUpdateProject?: (id: string, patch: Partial<Project>) => void
    onAttachProject?: (convId: string, projectId: string | null) => void
    onSetProjectFolders?: (id: string, folders: string[]) => Promise<string | null>
  } = $props()

  const incognitoCount = $derived(conversations.filter((c) => c.incognito).length)
  let fileInput: HTMLInputElement | undefined = $state()

  /* ── Projets : créer, éditer règles, dossiers Mac, rattacher ── */
  let projOpen = $state(false)
  let projEdit = $state<string | null>(null) // id du projet en cours d'édition
  let projName = $state('')
  let projDraft = $state('')
  let foldersDraft = $state('')
  let foldersMsg = $state('')

  async function saveProjectEdit(p: Project): Promise<void> {
    // Chemins absolus requis (le backend refuse les relatifs) — un ~/ est
    // quand même accepté : le backend macOS le développe via homedir().
    const folders = foldersDraft
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const err = (await onSetProjectFolders?.(p.id, folders)) ?? null
    foldersMsg = err ? `⚠︎ ${err}` : `✓ ${folders.length} dossier(s) autorisé(s)`
    onUpdateProject?.(p.id, { instructions: projDraft })
  }


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

  <!-- Projets : sandbox partagée + règles + dossiers Mac (inspiré Claude Desktop) -->
  <div class="proj">
    <button class="proj-head" onclick={() => (projOpen = !projOpen)} title="Projets : workspace partagé, règles, accès dossiers Mac">
      <span>{projOpen ? '▾' : '▸'} Projets</span>
      <span class="count">{projects.length}</span>
    </button>
    {#if projOpen}
      {#each projects as p (p.id)}
        {@const convCount = conversations.filter((c) => c.projectId === p.id).length}
        <div class="proj-item" class:editing={projEdit === p.id}>
          <div class="proj-row">
            <span class="dot">📦</span>
            <span class="pname" role="button" tabindex="0" onclick={() => (projEdit = projEdit === p.id ? null : p.id)} onkeydown={(e) => e.key === 'Enter' && (projEdit = projEdit === p.id ? null : p.id)}>{p.name}</span>
            <span class="pcount">{convCount}</span>
            <button class="pdel" title="Supprimer le projet (les conversations sont conservées)" onclick={() => onDeleteProject?.(p.id)}>×</button>
          </div>
          {#if projEdit === p.id}
            <label class="plab" for="pinstr-{p.id}">Règles du projet (injectées au prompt de chaque conversation)</label>
            <textarea
              id="pinstr-{p.id}"
              class="pinstr"
              rows="4"
              placeholder="Ex. : TypeScript strict, tests obligatoires, jamais de npm install sans demande…"
              value={p.instructions}
              oninput={(e) => (projDraft = e.currentTarget.value)}
            ></textarea>
            <label class="plab" for="pfold-{p.id}">Dossiers du Mac en LECTURE (un chemin par ligne)</label>
            <textarea
              id="pfold-{p.id}"
              class="pinstr"
              rows="2"
              placeholder={'~/projects/mon-repo\n/Documents/specs'}
              value={p.folders.join('\n')}
              oninput={(e) => (foldersDraft = e.currentTarget.value)}
            ></textarea>
            {#if foldersMsg}<div class="pmsg">{foldersMsg}</div>{/if}
            <button class="psave" onclick={() => void saveProjectEdit(p)}>Enregistrer</button>
            <p class="phint">Les agents lisent ces dossiers via read_project_file (jamais d'écriture hors sandbox).</p>
          {/if}
        </div>
      {/each}
      <div class="proj-new">
        <input
          placeholder="Nom du nouveau projet…"
          bind:value={projName}
          onkeydown={(e) => {
            if (e.key === 'Enter' && projName.trim()) {
              onCreateProject?.(projName)
              projName = ''
            }
          }}
        />
        <button onclick={() => { if (projName.trim()) { onCreateProject?.(projName); projName = '' } }} title="Créer le projet">＋</button>
      </div>
    {/if}
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
        <div class="meta">
          {#if c.projectId}
            <select
              class="proj-sel"
              title="Projet rattaché (sandbox partagée + règles)"
              value={c.projectId}
              onclick={(e) => e.stopPropagation()}
              onchange={(e) => {
                e.stopPropagation()
                onAttachProject?.(c.id, (e.currentTarget as HTMLSelectElement).value || null)
              }}
            >
              <option value="">📦 projet…</option>
              {#each projects as p (p.id)}
                <option value={p.id}>{p.name}</option>
              {/each}
              <option value="">— détacher</option>
            </select>
          {:else}
            {meta(c)}
          {/if}
        </div>
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
  /* ── Projets ── */
  .proj {
    border-bottom: 1px solid var(--border);
    padding: 4px 8px 8px;
  }
  .proj-head {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border: none;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    opacity: 0.75;
    cursor: pointer;
    padding: 4px 6px;
  }
  .proj-head:hover {
    opacity: 1;
  }
  .count {
    font-size: 10.5px;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0 6px;
  }
  .proj-item {
    border: 1px solid var(--border);
    border-radius: 9px;
    padding: 5px 7px;
    margin: 4px 0;
  }
  .proj-item.editing {
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .proj-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .pname {
    flex: 1;
    min-width: 0;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pcount {
    font-size: 10.5px;
    opacity: 0.6;
  }
  .pdel {
    border: none;
    background: none;
    color: var(--fg);
    opacity: 0.45;
    cursor: pointer;
    font-size: 13px;
    padding: 0 2px;
  }
  .pdel:hover {
    opacity: 1;
    color: var(--danger, #ff6b6b);
  }
  .plab {
    display: block;
    font-size: 10.5px;
    opacity: 0.6;
    margin: 7px 0 3px;
  }
  .pinstr {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    padding: 5px 7px;
  }
  .psave {
    margin-top: 6px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    padding: 4px 10px;
    cursor: pointer;
  }
  .psave:hover {
    background: color-mix(in srgb, var(--accent) 28%, transparent);
  }
  .pmsg {
    font-size: 11px;
    margin-top: 4px;
    opacity: 0.85;
  }
  .phint {
    font-size: 10.5px;
    opacity: 0.5;
    margin: 5px 0 0;
  }
  .proj-new {
    display: flex;
    gap: 5px;
    margin-top: 4px;
  }
  .proj-new input {
    flex: 1;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    padding: 4px 8px;
  }
  .proj-new button {
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--accent);
    color: #fff;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    padding: 0 9px;
  }
  .proj-sel {
    max-width: 150px;
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    border-radius: 6px;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    color: var(--fg);
    font: inherit;
    font-size: 10.5px;
    padding: 1px 4px;
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
