<script lang="ts">
  import { PROVIDERS, type ProviderId } from '../llm'
  import type { Keys, Settings } from '../store'

  let {
    keys,
    settings,
    onSave,
    onClose,
  }: {
    keys: Keys
    settings: Settings
    onSave: (keys: Keys, settings: Settings) => void
    onClose: () => void
  } = $props()

  let k = $state<Keys>({ ...keys })
  let s = $state<Settings>({ ...settings })
  let results = $state<Record<string, string>>({})
  let testing = $state<string | null>(null)

  const LABELS: Record<ProviderId, string> = {
    openrouter: 'OpenRouter',
    nvidia: 'NVIDIA NIM',
    cohere: 'Cohere',
    mistral: 'Mistral',
  }

  async function test(pid: ProviderId): Promise<void> {
    const p = PROVIDERS.find((x) => x.id === pid)!
    testing = pid
    results = { ...results, [pid]: '…' }
    try {
      const r = await fetch(`${p.base}${p.path}/models`, {
        headers: { Authorization: `Bearer ${k[pid]}` },
      })
      results = { ...results, [pid]: r.ok ? '✅ clé OK' : `❌ HTTP ${r.status}` }
    } catch {
      results = { ...results, [pid]: '❌ réseau' }
    }
    testing = null
  }

  function save(): void {
    onSave({ ...k }, { ...s })
  }
</script>

<div
  class="backdrop"
  role="presentation"
  onclick={(e) => e.target === e.currentTarget && onClose()}
>
  <div class="modal">
    <h2>⚙︎ Réglages</h2>

    <h3>Clés API (stockées localement dans ton navigateur)</h3>
    {#each PROVIDERS as p (p.id)}
      <div class="keyrow">
        <label>
          <span>{LABELS[p.id]}</span>
          <input type="password" bind:value={k[p.id]} placeholder="sk-…" autocomplete="off" />
        </label>
        <button class="ghost" onclick={() => test(p.id)} disabled={testing === p.id || !k[p.id]}>
          tester
        </button>
        <span class="result" class:ok={results[p.id]?.startsWith('✅')}>{results[p.id] ?? ''}</span>
      </div>
    {/each}

    <h3>Génération</h3>
    <div class="gen">
      <label>
        <span>Température : {s.temperature.toFixed(1)}</span>
        <input type="range" min="0" max="2" step="0.1" bind:value={s.temperature} />
      </label>
      <label>
        <span>Tokens max</span>
        <input type="number" min="128" max="32768" step="128" bind:value={s.maxTokens} />
      </label>
    </div>

    <h3>Instructions système</h3>
    <textarea class="system" rows="3" bind:value={s.system} placeholder="ex : Réponds en français, sois concis."></textarea>

    <div class="actions">
      <button class="ghost" onclick={onClose}>Annuler</button>
      <button class="primary" onclick={save}>Enregistrer</button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    z-index: 50;
  }
  .modal {
    width: min(520px, 92vw);
    max-height: 88vh;
    overflow-y: auto;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 20px 22px;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 19px;
  }
  h3 {
    margin: 18px 0 8px;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--muted);
  }
  .keyrow {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .keyrow label {
    flex: 1;
    display: grid;
    grid-template-columns: 92px 1fr;
    align-items: center;
    gap: 8px;
  }
  .keyrow span {
    font-size: 13px;
    color: var(--muted);
  }
  .keyrow input {
    font-size: 13px;
  }
  .ghost {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 12px;
    color: var(--muted);
    font-size: 13px;
  }
  .ghost:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--accent);
  }
  .result {
    font-size: 12px;
    min-width: 76px;
    color: var(--danger);
  }
  .result.ok {
    color: var(--ok);
  }
  .gen {
    display: grid;
    grid-template-columns: 1fr 140px;
    gap: 14px;
  }
  .gen label {
    display: grid;
    gap: 6px;
    font-size: 13px;
    color: var(--muted);
  }
  .system {
    width: 100%;
    resize: vertical;
    font-size: 13.5px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 20px;
  }
  .primary {
    background: var(--accent);
    color: #fff;
    border-radius: 10px;
    padding: 8px 18px;
  }
  .primary:hover {
    filter: brightness(1.12);
  }
</style>
