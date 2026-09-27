<script lang="ts">
  // Preview live : rend les pages HTML/CSS/JS du workspace dans une iframe sûre
  // (sandbox="allow-scripts", servie par /api/sandbox/:id/serve).
  import type { FileNode } from '../agents'

  let {
    convId,
    onClose,
  }: {
    convId: string
    onClose: () => void
  } = $props()

  let htmlFiles = $state<string[]>([])
  let path = $state('index.html')
  let key = $state(0)

  /** Collecte les chemins .html de l'arbre. */
  function collectHtml(nodes: FileNode[], prefix = ''): string[] {
    const out: string[] = []
    for (const n of nodes) {
      const p = prefix ? `${prefix}/${n.name}` : n.name
      if (n.type === 'dir') out.push(...collectHtml(n.children ?? [], p))
      else if (n.name.endsWith('.html')) out.push(p)
    }
    return out
  }

  async function refresh(): Promise<void> {
    try {
      const r = await fetch(`/api/sandbox/${convId}/tree`)
      const j = (await r.json()) as { exists: boolean; tree: FileNode[] }
      const files = collectHtml(j.tree ?? [])
      htmlFiles = files
      if (!files.includes(path) && files.length) path = files[0]
    } catch {
      /* ignore */
    }
  }

  $effect(() => {
    void convId
    void refresh()
  })
</script>

<aside class="preview hubbed" aria-label="Preview live du workspace">
  <header>
    <strong>👁 Preview</strong>
    <select bind:value={path} onchange={() => key++} title="Page à afficher">
      {#each htmlFiles as f (f)}
        <option value={f}>{f}</option>
      {/each}
    </select>
    <button class="mini" onclick={() => key++} title="Recharger">⟳</button>
    <button class="mini" onclick={onClose} title="Fermer">×</button>
  </header>
  {#if !htmlFiles.length}
    <p class="note">Aucune page .html dans le workspace — demande à Nexus d'en créer une, ou fais-le dans 📁 Fichiers.</p>
  {:else}
    {#key `${convId}/${path}/${key}`}
      <iframe title="Preview live" sandbox="allow-scripts" src="/api/sandbox/{convId}/serve?path={encodeURIComponent(path)}"></iframe>
    {/key}
  {/if}
</aside>

<style>
  /* DANS le hub/dock : remplit son conteneur (inset 0 via .hubbed).
     HORS hub (dock outils n'existe pas pour preview → jamais en overlay flottant
     devant le chat : le bug « fenêtre preview » signalé venait de ce fixed au
     milieu de l'écran qui chevauchait tout). Ici : toujours flux/hub. */
  .preview {
    inset: 0;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  header strong {
    font-size: 12.5px;
    margin-right: auto;
  }
  header select {
    max-width: 220px;
    font-size: 12px;
    font-family: var(--mono);
  }
  .mini {
    font-size: 12px;
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--muted);
    background: none;
  }
  .mini:hover {
    color: var(--text);
    border-color: var(--accent);
  }
  .note {
    color: var(--muted);
    font-size: 12.5px;
  }
  iframe {
    flex: 1;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: #fff;
  }
</style>
