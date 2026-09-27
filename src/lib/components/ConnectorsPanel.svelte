<script lang="ts">
  // Connecteurs 🔌 — la liste des sources de données/outils accessibles aux
  // agents (esprit Claude Desktop / MCP) :
  //  · intégrés  : servis par l'app elle-même (workspace, deck, horloge), sans clé
  //  · HTTP      : déclarés par l'utilisateur (base URL + auth optionnelle),
  //                passés par la passerelle locale /api/connector/<nom> — la clé
  //                reste sur la machine, jamais exposée au modèle.
  // Test d'un connecteur HTTP en un clic (GET sur la base, statut + extrait).
  import { BUILTIN_CONNECTORS, type ConnectorCfg } from '../store'

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
    padding: 10px 12px;
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
