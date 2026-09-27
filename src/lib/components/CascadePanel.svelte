<script lang="ts">
  // Panneau Cascade ⚡ — santé des 9 providers du méga-pack (ordre omniroute →
  // freellm → groq → cerebras → mistral → cohere → gemini → openrouter → anthropic)
  // + test réel : envoie un mini-prompt à /api/cascade et montre le provider
  // gagnant et les bascules effectuées. Les clés restent côté serveur.
  interface ProviderHealth {
    up: boolean
    ms: number
    at: number
    key: string
  }
  interface Attempt {
    id: string
    error: string
  }
  interface CascadeResult {
    text?: string
    provider?: string
    latencyMs?: number
    switches?: string[]
    attempts?: Attempt[]
    error?: string
  }

  let { onClose, onPopout }: { onClose: () => void; onPopout?: () => void } = $props()

  let health = $state<Record<string, ProviderHealth>>({})
  let loading = $state(true)
  let testing = $state(false)
  let result = $state<CascadeResult | null>(null)
  let testError = $state('')

  const ORDER = ['omniroute', 'freellm', 'groq', 'cerebras', 'mistral', 'cohere', 'gemini', 'openrouter', 'anthropic']
  const LABELS: Record<string, string> = {
    omniroute: 'OmniRoute (local :20128)',
    freellm: 'FreeLLMAPI (local :8000)',
    groq: 'Groq',
    cerebras: 'Cerebras',
    mistral: 'Mistral',
    cohere: 'Cohere',
    gemini: 'Gemini',
    openrouter: 'OpenRouter',
    anthropic: 'Anthropic',
  }

  async function loadHealth(): Promise<void> {
    loading = true
    try {
      const j = (await fetch('/api/cascade-check').then((r) => r.json())) as { providers: Record<string, ProviderHealth> }
      health = j.providers ?? {}
    } catch (e) {
      health = {}
      testError = (e as Error).message
    } finally {
      loading = false
    }
  }
  $effect(() => {
    void loadHealth()
    const t = setInterval(() => void loadHealth(), 60_000)
    return () => clearInterval(t)
  })

  async function runTest(): Promise<void> {
    testing = true
    testError = ''
    result = null
    try {
      const r = await fetch('/api/cascade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Réponds uniquement : OK' }] }),
      })
      result = (await r.json()) as CascadeResult
    } catch (e) {
      testError = (e as Error).message
    } finally {
      testing = false
      void loadHealth()
    }
  }

  const upCount = $derived(ORDER.filter((id) => health[id]?.up).length)
</script>

<aside class="cascade" aria-label="Cascade LLM (santé et test des fournisseurs)">
  <header>
    <strong>⚡ Cascade LLM</strong>
    <span class="count">{loading ? 'sonde…' : `${upCount}/${ORDER.length} up`}</span>
    {#if onPopout}<button class="mini" onclick={onPopout} title="Extraire en fenêtre">⧉</button>{/if}
    <button class="mini" onclick={onClose} title="Fermer">×</button>
  </header>

  <div class="list">
    <p class="intro">
      Ordre du méga-pack : <code>omniroute → freellm → groq → cerebras → mistral → cohere → gemini → openrouter → anthropic</code>.
      Si un maillon échoue (402, 429, 502…), le suivant prend le relais — comme ton mini-chat MEGA PACK.
    </p>

    {#each ORDER as id (id)}
      {@const h = health[id]}
      <div class="prov" class:on={h?.up === true} class:off={h?.up === false} class:unknown={!h}>
        <div class="row">
          <span class="name">
            <i class="hdot {h ? (h.up ? 'up' : 'down') : 'unknown'}"></i>
            {LABELS[id] ?? id}
          </span>
          <span class="meta">
            {#if h}
              {h.up ? '✓' : '✗'} {h.ms} ms{h.key === 'oui' ? ' · clé ✓' : h.key === 'non' ? ' · clé ✗' : ''}
            {:else}
              non sondé
            {/if}
          </span>
        </div>
      </div>
    {/each}

    <div class="test">
      <button class="run" onclick={() => void runTest()} disabled={testing}>
        {testing ? '… test en cours (bascules incluses)' : '⚡ Tester la cascade en réel'}
      </button>
      {#if testError}<p class="err">✗ {testError}</p>{/if}
      {#if result}
        {#if result.text}
          <div class="ok">
            <p class="answer">💬 {result.text.slice(0, 300)}</p>
            <p class="winner">🏆 Gagnant : <strong>{LABELS[result.provider ?? ''] ?? result.provider}</strong> en {result.latencyMs} ms</p>
            {#if result.switches?.length}
              <p class="switches">Bascules : {result.switches.join(' → ')}</p>
            {/if}
          </div>
        {:else if result.error}
          <p class="err">✗ {result.error}</p>
        {/if}
      {/if}
      {#if result?.attempts?.length}
        <p class="attempts">
          {#each result.attempts as a (a.id)}
            <code class="fail">{a.id} : {a.error}</code>
          {/each}
        </p>
      {/if}
    </div>

    <p class="note">
      Sonde et test côté serveur (plugin Vite) — les clés lues dans <code>~/.secrets</code>, <code>auth.json</code>
      et <code>keys.local.json</code> ne quittent jamais la machine.
    </p>
  </div>
</aside>

<style>
  .cascade {
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
  .count { flex: 1; font-size: 11.5px; color: var(--muted); }
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
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .intro { margin: 0 0 2px; font-size: 12px; color: var(--muted); line-height: 1.5; }
  .intro code { background: var(--bg); border: 1px solid var(--border); border-radius: 5px; padding: 0 4px; font-size: 10.5px; }
  .prov {
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 8px 10px;
    opacity: 0.55;
  }
  .prov.on { opacity: 1; border-color: color-mix(in srgb, var(--ok, #27c93f) 35%, var(--border)); }
  .prov.off { opacity: 0.8; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .name { font-weight: 600; display: flex; align-items: center; gap: 7px; }
  .meta { font-size: 11px; color: var(--muted); font-family: var(--mono); white-space: nowrap; }
  .hdot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); opacity: 0.5; flex-shrink: 0; }
  .hdot.up { background: var(--ok, #27c93f); opacity: 1; }
  .hdot.down { background: #ff6b6b; opacity: 1; }
  .hdot.unknown { animation: pulse 0.8s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.3; } }
  .test { border: 1px dashed var(--border); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  .run {
    border: 1px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--fg);
    border-radius: 10px;
    padding: 8px;
    cursor: pointer;
    font: inherit;
    font-size: 12.5px;
  }
  .run:hover { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .run:disabled { opacity: 0.6; cursor: wait; }
  .ok { display: flex; flex-direction: column; gap: 4px; }
  .answer { margin: 0; font-size: 12.5px; }
  .winner { margin: 0; font-size: 12.5px; }
  .switches, .attempts { margin: 0; font-size: 11px; color: var(--muted); font-family: var(--mono); line-height: 1.6; }
  .fail { display: inline-block; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 0 4px; margin-right: 4px; font-size: 10.5px; }
  .err { margin: 0; font-size: 12px; color: #ff6b6b; }
  .note { margin: 0; font-size: 11px; color: var(--muted); }
  .note code { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 0 4px; }
</style>
