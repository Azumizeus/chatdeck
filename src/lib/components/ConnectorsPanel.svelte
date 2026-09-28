<script lang="ts">
  // Connecteurs 🔌 — la liste des sources de données/outils accessibles aux
  // agents (esprit Claude Desktop / MCP) :
  //  · intégrés  : servis par l'app elle-même (workspace, deck, horloge), sans clé
  //  · HTTP      : déclarés par l'utilisateur (base URL + auth optionnelle),
  //                passés par la passerelle locale /api/connector/<nom> — la clé
  //                reste sur la machine, jamais exposée au modèle.
  //  · MCP stdio : serveurs locaux (~/.chatdeck/mcp-servers.local.json) lancés
  //                par l'app ; leurs tools sont exposés via connector_call.
  // Test d'un connecteur HTTP en un clic (GET sur la base, statut + extrait).
  import { BUILTIN_CONNECTORS, type ConnectorCfg } from '../store'

  interface McpTool {
    name: string
    description?: string
  }
  let mcpList = $state<{ server: string; tools: McpTool[] }[]>([])
  let mcpError = $state('')
  interface WebEntry { q?: string; url?: string; title?: string; at: number }
  let web = $state<{ history: WebEntry[]; favorites: WebEntry[]; cache: Record<string, { title: string; at: number; chars: number }> } | null>(null)

  async function loadWeb(): Promise<void> {
    try {
      web = await fetch('/api/sandbox/connectors/web').then((r) => r.json())
    } catch {
      web = null
    }
  }

  async function toggleFav(url: string, title: string): Promise<void> {
    const has = (web?.favorites ?? []).some((f) => f.url === url)
    await fetch('/api/sandbox/connectors/web', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'favorite', url, title, add: !has }),
    })
    void loadWeb()
  }

  async function loadMcp(): Promise<void> {
    mcpError = ''
    try {
      // La liste des serveurs déclarés vit dans le fichier local ; on demande
      // tools/list pour chacun d'eux (cache serveur 60 s).
      const servers: { name: string; enabled?: boolean }[] = await fetch('/api/sandbox/mcp-config').then((r) => r.json()).then((j) => j.servers ?? [])
      const out: { server: string; tools: McpTool[] }[] = []
      for (const s of servers.filter((x) => x.enabled !== false)) {
        try {
          const r = await fetch(`/api/sandbox/mcp/tools?server=${encodeURIComponent(s.name)}`)
          const j = (await r.json()) as { tools?: McpTool[]; error?: string }
          out.push({ server: s.name, tools: j.error ? [] : (j.tools ?? []) })
        } catch {
          out.push({ server: s.name, tools: [] })
        }
      }
      mcpList = out
    } catch (e) {
      mcpError = (e as Error).message
    }
  }
  $effect(() => {
    void loadMcp()
    void loadWeb()
  })

  let {
    connectors = [],
    onConnectors,
    onClose,
    onPopout,
  }: {
    connectors: ConnectorCfg[]
    onConnectors: (list: ConnectorCfg[]) => void
    onClose: () => void
    onPopout?: () => void
  } = $props()

  let testResult = $state<Record<string, string>>({})
  let testing = $state<string | null>(null)

  function update(i: number, patch: Partial<ConnectorCfg>): void {
    onConnectors(connectors.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  }

  function add(): void {
    onConnectors([
      ...connectors,
      { name: `connecteur-${connectors.length + 1}`, baseUrl: 'https://', keyHeader: 'Authorization', key: '', enabled: true },
    ])
  }

  function remove(i: number): void {
    onConnectors(connectors.filter((_, j) => j !== i))
  }

  async function test(c: ConnectorCfg): Promise<void> {
    testing = c.name
    testResult = { ...testResult, [c.name]: '…' }
    try {
      const r = await fetch(`/api/connector/${encodeURIComponent(c.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'test' }),
      })
      const text = (await r.text()).slice(0, 300)
      testResult = { ...testResult, [c.name]: `HTTP ${r.status} — ${text || '(vide)'}` }
    } catch (e) {
      testResult = { ...testResult, [c.name]: `✗ ${(e as Error).message}` }
    } finally {
      testing = null
    }
  }
</script>

<aside class="conns hubbed" aria-label="Connecteurs (sources de données des agents)">
  <header>
    <strong>🔌 Connecteurs</strong>
    <span class="count">{BUILTIN_CONNECTORS.length} intégrés · {connectors.filter((c) => c.enabled !== false).length} HTTP actifs</span>
    {#if onPopout}<button class="mini" onclick={onPopout} title="Extraire en fenêtre">⧉</button>{/if}
    <button class="mini" onclick={onClose} title="Fermer">×</button>
  </header>

  <div class="list">
    <p class="intro">
      Les agents interrogent ces sources avec l'outil <code>connector_call</code>.
      Les connecteurs intégrés parlent à TON espace de travail ; les connecteurs
      HTTP pointent vers des services externes (façon MCP) — leur clé d'auth reste
      sur ta machine.
    </p>

    {#each BUILTIN_CONNECTORS as b (b.name)}
      <div class="conn on">
        <div class="row">
          <span class="name">🧩 {b.name}</span>
          <span class="tag">intégré</span>
        </div>
        <p class="desc">{b.desc}</p>
      </div>
    {/each}

    {#each connectors as c, i (i)}
      <div class="conn" class:on={c.enabled !== false}>
        <div class="row">
          <label class="switch" title={c.enabled !== false ? 'Désactiver' : 'Activer'}>
            <input type="checkbox" checked={c.enabled !== false} onchange={(e) => update(i, { enabled: e.currentTarget.checked })} />
            <span>🧩 {c.name}</span>
          </label>
          <button class="mini danger" onclick={() => remove(i)} title="Supprimer ce connecteur">🗑</button>
        </div>
        <label class="field">
          <span>Base URL</span>
          <input value={c.baseUrl} oninput={(e) => update(i, { baseUrl: e.currentTarget.value })} placeholder="https://api.exemple.com/v1" />
        </label>
        <div class="grid2">
          <label class="field">
            <span>En-tête auth (vide = public)</span>
            <input value={c.keyHeader ?? ''} oninput={(e) => update(i, { keyHeader: e.currentTarget.value })} placeholder="Authorization" />
          </label>
          <label class="field">
            <span>Valeur (Bearer auto)</span>
            <input type="password" value={c.key ?? ''} oninput={(e) => update(i, { key: e.currentTarget.value })} placeholder="ghp_… / clé API" />
          </label>
        </div>
        <div class="row">
          <button class="mini" onclick={() => void test(c)} disabled={testing === c.name || !c.baseUrl.startsWith('http')}>
            {testing === c.name ? '… test' : '⚡ tester'}
          </button>
          {#if testResult[c.name]}<code class="result" title={testResult[c.name]}>{testResult[c.name]}</code>{/if}
        </div>
      </div>
    {/each}

    <!-- Connecteur web natif : historique web_search, favoris, cache web_fetch -->
    {#if web}
      <div class="conn on">
        <div class="row"><span class="name">🌐 Web</span><span class="tag">intégré</span></div>
        <p class="desc">Mémoire des accès web des agents : recherches (<code>web_search</code>), pages lues (<code>web_fetch</code>, 10 ko de texte mis en cache), favoris.</p>
        {#if web.favorites.length}
          <p class="sec">⭐ Favoris</p>
          {#each web.favorites.slice(-8).reverse() as f (f.url!)}
            <div class="wrow">
              <span class="wtitle" title={f.url}>{f.title}</span>
              <button class="mini" onclick={() => void toggleFav(f.url!, f.title ?? f.url!)} title="Retirer des favoris">★</button>
            </div>
          {/each}
        {/if}
        {#if web.history.length}
          <p class="sec">🕘 Dernières recherches</p>
          {#each web.history.slice(0, 8) as h (h.at)}
            <div class="wrow"><span class="wtitle">{h.q}</span><span class="ws-meta">{new Date(h.at).toLocaleTimeString()}</span></div>
          {/each}
        {/if}
        {#if Object.keys(web.cache).length}
          <p class="sec">📄 Pages en cache</p>
          {#each Object.entries(web.cache).slice(-8).reverse() as [u, v] (u)}
            <div class="wrow">
              <span class="wtitle" title={u}>{v.title}</span>
              <span class="ws-meta">{v.chars} car.</span>
            </div>
          {/each}
        {/if}
        {#if !web.favorites.length && !web.history.length && !Object.keys(web.cache).length}
          <p class="desc">Rien encore — les recherches et pages des agents apparaîtront ici.</p>
        {/if}
      </div>
    {/if}

    <!-- Serveurs MCP stdio (~/.chatdeck/mcp-servers.local.json) -->
    {#if mcpList.length}
      <div class="conn on">
        <div class="row"><span class="name">🛰 Serveurs MCP</span><span class="tag">stdio</span></div>
        {#each mcpList as m (m.server)}
          <div class="mcp-row">
            <code class="mono">{m.server}</code>
            <span class="ws-meta">{m.tools.length} outil{m.tools.length > 1 ? 's' : ''}</span>
          </div>
          {#if m.tools.length}
            <p class="desc">{m.tools.map((t) => t.name).join(', ')}</p>
          {/if}
        {/each}
        <p class="note">Déclarés dans <code>~/.chatdeck/mcp-servers.local.json</code> — ex. &#123;"name": "…", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-…"]&#125; — les agents les appellent via <code>connector_call</code> (op: tools|call).</p>
      </div>
    {/if}
    {#if mcpError}<p class="desc">MCP : {mcpError}</p>{/if}

    <button class="add" onclick={add} title="Ajoute un connecteur HTTP (base URL + auth optionnelle)">＋ ajouter un connecteur HTTP</button>
    <p class="note">
      Fichier de secours : <code>custom-connectors.local.json</code> (gitigné,
      même schéma) alimente aussi la passerelle au démarrage du serveur dev.
    </p>
  </div>
</aside>

<style>
  .conns {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    font-size: 13px;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  header strong { font-size: 13px; }
  .count {
    flex: 1;
    font-size: 11.5px;
    color: var(--muted);
  }
  .mini {
    border: 1px solid var(--border);
    background: none;
    color: var(--fg);
    border-radius: 7px;
    padding: 2px 8px;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }
  .mini:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .mini.danger:hover { background: color-mix(in srgb, var(--danger, #ff6b6b) 15%, transparent); }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 10px 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .intro {
    margin: 0 0 2px;
    font-size: 12px;
    color: var(--muted);
    line-height: 1.5;
  }
  .intro code {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 0 4px;
  }
  .conn {
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    opacity: 0.55;
  }
  .conn.on { opacity: 1; }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: space-between;
  }
  .name {
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tag {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 1px 6px;
  }
  .desc {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 11.5px;
    color: var(--muted);
  }
  .field input {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--fg);
    padding: 6px 8px;
    font: inherit;
    font-size: 12.5px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .switch {
    display: flex;
    align-items: center;
    gap: 7px;
    cursor: pointer;
  }
  .result {
    font-size: 11px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 70%;
  }
  .mcp-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  /* Les chemins et longues listes d'outils passent à la ligne au lieu de
     déborder (chemin ~/.chatdeck/mcp-servers.local.json coupé, badge tronqué) */
  .note code,
  .intro code {
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .desc {
    overflow-wrap: anywhere;
  }
  .ws-meta {
    font-size: 11px;
    color: var(--muted);
  }
  .sec {
    margin: 2px 0 0;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .wrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .wtitle {
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .add {
    border: 1px dashed var(--border);
    border-radius: 10px;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 12.5px;
    padding: 8px;
    cursor: pointer;
  }
  .add:hover { color: var(--fg); border-color: var(--accent); }
  .note {
    margin: 0;
    font-size: 11px;
    color: var(--muted);
  }
  .note code {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0 4px;
  }
</style>
