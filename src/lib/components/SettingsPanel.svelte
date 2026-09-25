<script lang="ts">
  // Panneau de réglages dockable (remplace l'ancienne modale) : clés multi-providers,
  // fournisseurs personnalisés OpenAI-compatible, préférences IDE, effacement des données.
  import { PROVIDERS, isCustom } from '../llm'
  import {
    defaultSettings,
    type CustomProvider,
    type Keys,
    type Settings,
    type Theme,
  } from '../store'

  let {
    keys,
    settings,
    customs,
    onKeys,
    onSettings,
    onAddCustom,
    onUpdateCustom,
    onRemoveCustom,
    onClose,
    onPopout,
    onSendNote,
  }: {
    keys: Keys
    settings: Settings
    customs: CustomProvider[]
    onKeys: (k: Keys) => void
    onSettings: (s: Settings) => void
    onAddCustom: () => void
    onUpdateCustom: (p: CustomProvider) => void
    onRemoveCustom: (id: string) => void
    onClose: () => void
    onPopout?: () => void
    /** Cliquer une note Obsidian → envoyée dans le chat */
    onSendNote?: (text: string) => void
  } = $props()

  // Édition directe : chaque modification remonte au store via onKeys/onSettings
  // (pas de brouillon local → le panneau reste synchronisé même ouvert à deux endroits)
  let results = $state<Record<string, string>>({})
  let testing = $state<string | null>(null)

  const LABELS: Record<string, string> = {
    openrouter: 'OpenRouter',
    nvidia: 'NVIDIA NIM',
    cohere: 'Cohere',
    mistral: 'Mistral',
  }

  function keyFor(pid: string): string {
    return isCustom(pid) ? (keys.custom[pid] ?? '') : (keys[pid as keyof Keys] as string)
  }
  function setKey(pid: string, v: string): void {
    onKeys(
      isCustom(pid)
        ? { ...keys, custom: { ...keys.custom, [pid]: v } }
        : { ...keys, [pid]: v },
    )
  }

  function authValue(header: string, key: string): string {
    return header.toLowerCase() === 'authorization' ? `Bearer ${key}` : key
  }

  async function test(pid: string, header = 'Authorization'): Promise<void> {
    const key = keyFor(pid)
    if (!key) return
    testing = pid
    results = { ...results, [pid]: '…' }
    const base = isCustom(pid) ? `/api/custom/${pid}` : `/api/${pid}`
    const path = isCustom(pid) ? '' : (PROVIDERS.find((p) => p.id === pid)?.path ?? '')
    try {
      const r = await fetch(`${base}${path}/models`, {
        headers: { [header]: authValue(header, key) },
      })
      results = { ...results, [pid]: r.ok ? '✅ clé OK' : `❌ HTTP ${r.status}` }
    } catch {
      results = { ...results, [pid]: '❌ réseau' }
    }
    testing = null
  }

  function setSetting<K extends keyof Settings>(key: K, v: Settings[K]): void {
    onSettings({ ...settings, [key]: v })
  }

  function reset(): void {
    onSettings(defaultSettings())
  }

  function clearData(): void {
    if (!confirm('Effacer toutes les conversations, clés et réglages stockées localement ?')) return
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith('chatdeck.')) localStorage.removeItem(key)
      sessionStorage.clear()
    } catch {
      /* ignore */
    }
    location.reload()
  }

  function addModelCsv(p: CustomProvider, csv: string): void {
    const models = csv
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((id) => ({ id }))
    onUpdateCustom({ ...p, models })
  }

  /* ---------- sections dépliables ---------- */

  type SectionId = 'keys' | 'customs' | 'generation' | 'sandbox' | 'obsidian' | 'promptdeck' | 'appearance' | 'data'
  let open = $state<Set<SectionId>>(new Set(['keys']))

  function toggleSection(id: SectionId): void {
    const next = new Set(open)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    open = next
  }

  /* ---------- instructions système : brouillon + Enregistrer ---------- */

  // Capture initiale assumée : la resynchro est faite par le $effect ci-dessous
  // svelte-ignore state_referenced_locally
  let sysDraft = $state(settings.system)
  let sysSaved = $state(false)
  $effect(() => {
    sysDraft = settings.system // resynchro si les réglages sont réinitialisés ailleurs
  })
  function saveSystem(): void {
    setSetting('system', sysDraft)
    sysSaved = true
    setTimeout(() => (sysSaved = false), 1400)
  }

  /* ---------- typographies ---------- */

  const FONTS: { id: string; label: string; stack: string }[] = [
    { id: 'system', label: 'Système (SF Pro)', stack: '' },
    { id: 'serif', label: 'Serif — lecture', stack: 'ui-serif, Georgia, Cambria, serif' },
    { id: 'mono', label: 'Mono — terminal', stack: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
    { id: 'rounded', label: 'Rounded — doux', stack: 'ui-rounded, -apple-system, sans-serif' },
    { id: 'georgia', label: 'Georgia', stack: 'Georgia, serif' },
    { id: 'helvetica', label: 'Helvetica Neue', stack: '"Helvetica Neue", Helvetica, sans-serif' },
    { id: 'avenir', label: 'Avenir Next', stack: '"Avenir Next", Avenir, sans-serif' },
  ]
  const fontOf = (id: string | undefined): string => FONTS.find((f) => f.id === id)?.id ?? 'system'

  /* ---------- santé de la sandbox ---------- */

  interface WsInfo {
    id: string
    sizeBytes: number
    files: number
    mtime: number
  }
  let health = $state<{ root: string; count: number; totalBytes: number; workspaces: WsInfo[] } | null>(null)

  async function refreshHealth(): Promise<void> {
    try {
      const r = await fetch('/api/sandbox/status')
      if (r.ok) health = await r.json()
    } catch {
      /* serveur sandbox indisponible */
    }
  }

  async function removeWs(id: string): Promise<void> {
    if (!confirm(`Supprimer le workspace ${id.slice(0, 12)}… sur le disque ?`)) return
    await fetch(`/api/sandbox/${id}`, { method: 'DELETE' }).catch(() => {})
    void refreshHealth()
  }

  async function cleanupAll(): Promise<void> {
    if (!health?.workspaces.length) return
    if (!confirm(`Supprimer TOUS les ${health.workspaces.length} workspace(s) (~${fmtBytes(health.totalBytes)}) ?`)) return
    for (const w of health.workspaces) await fetch(`/api/sandbox/${w.id}`, { method: 'DELETE' }).catch(() => {})
    void refreshHealth()
  }

  function fmtBytes(n: number): string {
    if (n < 1024) return `${n} o`
    if (n < 1_048_576) return `${(n / 1024).toFixed(1)} ko`
    return `${(n / 1_048_576).toFixed(1)} Mo`
  }

  /* ---------- connexions : Obsidian & PromptDeck ---------- */

  interface Vault {
    name: string
    path: string
    notes: { path: string; size: number }[]
  }
  let vaults = $state<Vault[] | null>(null)
  let selVault = $state<string | null>(null)
  let pd = $state<{ path: string; tree: { name: string; type: 'file' | 'dir'; children?: { name: string; type: 'file' | 'dir' }[] }[] } | string | null>(null)

  async function loadVaults(): Promise<void> {
    try {
      const r = await fetch('/api/sandbox/obsidian-vaults')
      const j = (await r.json()) as { vaults: { name: string; path: string }[] }
      // Compte les notes de chaque coffret côté serveur
      const withNotes = await Promise.all(
        j.vaults.map(async (v) => {
          try {
            const r2 = await fetch(`/api/sandbox/obsidian-notes?vault=${encodeURIComponent(v.name)}`)
            const j2 = (await r2.json()) as { notes?: { path: string; size: number }[] }
            return { ...v, notes: j2.notes ?? [] }
          } catch {
            return { ...v, notes: [] }
          }
        }),
      )
      vaults = withNotes
    } catch {
      vaults = []
    }
  }

  function openVault(name: string): void {
    selVault = name
  }

  async function readNote(vault: string, note: string): Promise<void> {
    try {
      const r = await fetch(`/api/sandbox/obsidian-read?vault=${encodeURIComponent(vault)}&note=${encodeURIComponent(note)}`)
      const j = (await r.json()) as { content?: string; error?: string }
      if (j.error) alert(j.error)
      else if (onSendNote) onSendNote(`## 📓 Obsidian — ${note}\n\n${j.content?.slice(0, 8000) ?? ''}`)
    } catch (e) {
      alert((e as Error).message)
    }
  }

  async function loadPd(): Promise<void> {
    try {
      const r = await fetch('/api/sandbox/promptdeck')
      if (!r.ok) {
        const j = (await r.json()) as { error?: string }
        pd = j.error ?? 'PromptDeck introuvable'
      } else pd = await r.json()
    } catch (e) {
      pd = (e as Error).message
    }
  }

  $effect(() => {
    void refreshHealth()
  })

  const THEMES: { id: Theme; label: string }[] = [
    { id: 'dark', label: 'Sombre' },
    { id: 'light', label: 'Clair' },
    { id: 'auto', label: 'Auto' },
  ]
</script>

<div class="panel">
  <header>
    <h2>⚙︎ Réglages</h2>
    <div class="head-actions">
      {#if onPopout}
        <button class="icon" onclick={onPopout} title="Sortir ce panneau en fenêtre (⌘⌥F)">⧉</button>
      {/if}
      <button class="icon" onclick={onClose} title="Replier">×</button>
    </div>
  </header>

  <div class="scroll">
    {#snippet head(id: SectionId, title: string)}
      <button class="secthead" onclick={() => toggleSection(id)} aria-expanded={open.has(id)}>
        <span class="chev">{open.has(id) ? '▾' : '▸'}</span>
        <h3>{title}</h3>
      </button>
    {/snippet}

    {@render head('keys', 'Clés API — stockées localement, envoyées uniquement au fournisseur choisi')}
    {#if open.has('keys')}
    {#each PROVIDERS as p (p.id)}
      <div class="keyrow">
        <span class="dot" style="background: {p.color}"></span>
        <label>
          <span class="name">{LABELS[p.id]}</span>
          <input
            type="password"
            value={keyFor(p.id)}
            oninput={(e) => setKey(p.id, e.currentTarget.value)}
            placeholder="sk-…"
            autocomplete="off"
          />
        </label>
        <button class="ghost" onclick={() => test(p.id)} disabled={testing === p.id || !keyFor(p.id)}>
          tester
        </button>
        <span class="result" class:ok={results[p.id]?.startsWith('✅')}>{results[p.id] ?? ''}</span>
      </div>
    {/each}
    {/if}

    {@render head('customs', 'Fournisseurs personnalisés (OpenAI-compatible)')}
    {#if open.has('customs')}
    {#each customs as p (p.id)}
      {@const keyId = keyFor(p.id)}
      <div class="custom">
        <div class="crow">
          <input
            value={p.name}
            oninput={(e) => onUpdateCustom({ ...p, name: e.currentTarget.value })}
            placeholder="Nom"
          />
          <button class="ghost danger" onclick={() => onRemoveCustom(p.id)} title="Supprimer">suppr.</button>
        </div>
        <input
          class="mono"
          value={p.baseUrl}
          oninput={(e) => onUpdateCustom({ ...p, baseUrl: e.currentTarget.value })}
          placeholder="https://api.exemple.com/v1"
        />
        <div class="crow">
          <input
            class="mono"
            value={p.keyHeader}
            oninput={(e) => onUpdateCustom({ ...p, keyHeader: e.currentTarget.value })}
            placeholder="Authorization"
          />
          <input
            type="password"
            value={keyId}
            oninput={(e) => setKey(p.id, e.currentTarget.value)}
            placeholder="clé API"
            autocomplete="off"
          />
        </div>
        <textarea
          rows="2"
          class="mono"
          value={p.models.map((m) => m.id).join(', ')}
          oninput={(e) => addModelCsv(p, e.currentTarget.value)}
          placeholder="modèle-a, modèle-b (ids, séparés par des virgules)"
        ></textarea>
        <div class="crow">
          <button class="ghost" onclick={() => test(p.id, p.keyHeader)} disabled={!keyId}>tester la clé</button>
          <span class="result" class:ok={results[p.id]?.startsWith('✅')}>{results[p.id] ?? ''}</span>
        </div>
      </div>
    {/each}
    <button class="addcustom" onclick={onAddCustom}>＋ Ajouter un fournisseur</button>
    {/if}

    {@render head('generation', 'Génération & instructions système')}
    {#if open.has('generation')}
    <div class="gen">
      <label>
        <span>Température : {settings.temperature.toFixed(1)}</span>
        <input type="range" min="0" max="2" step="0.1" value={settings.temperature} oninput={(e) => setSetting('temperature', Number(e.currentTarget.value))} />
      </label>
      <label>
        <span>Tokens max</span>
        <input type="number" min="128" max="32768" step="128" value={settings.maxTokens} oninput={(e) => setSetting('maxTokens', Number(e.currentTarget.value) || 2048)} />
      </label>
    </div>
    <div class="syshead">
      <span class="syslabel">Instructions système (utilisées par tous les fils)</span>
      <button class="ghost save" class:saved={sysSaved} onclick={saveSystem} disabled={sysDraft === settings.system}>
        {sysSaved ? '✓ enregistré' : 'Enregistrer'}</button>
    </div>
    <textarea
      class="system"
      rows="3"
      bind:value={sysDraft}
      placeholder="ex : Réponds en français, sois concis."
    ></textarea>
    {/if}

    {@render head('sandbox', 'Sandbox — workspaces agents')}
    {#if open.has('sandbox')}
    {#if health}
      <p class="sb-root mono">{health.root}</p>
      <div class="sb-line">
        <span>{health.count} workspace(s) · {fmtBytes(health.totalBytes)}</span>
        <button class="ghost" onclick={refreshHealth} title="Rafraîchir">⟳</button>
      </div>
      {#each health.workspaces as w (w.id)}
        <div class="wsrow">
          <code class="mono">{w.id.slice(0, 14)}…</code>
          <span class="ws-meta">{w.files} fichiers · {fmtBytes(w.sizeBytes)}</span>
          <button class="ghost danger" onclick={() => removeWs(w.id)} title="Supprimer ce workspace">suppr.</button>
        </div>
      {/each}
      {#if health.workspaces.length}
        <button class="ghost danger" onclick={cleanupAll}>Tout supprimer…</button>
      {:else}
        <p class="sb-empty">Aucun workspace — il sera créé au premier message d'un fil agents.</p>
      {/if}
    {:else}
      <button class="ghost" onclick={refreshHealth}>Vérifier la sandbox…</button>
    {/if}
    {/if}

    {@render head('obsidian', 'Obsidian — coffrets connectés')}
    {#if open.has('obsidian')}
    {#if vaults === null}
      <button class="ghost" onclick={() => void loadVaults()}>Charger les coffrets…</button>
    {:else if !vaults.length}
      <p class="sb-empty">Aucun coffret enregistré dans Obsidian (registre macOS introuvable).</p>
    {:else}
      {#each vaults as v (v.name)}
        <div class="wsrow">
          <code class="mono">📓 {v.name}</code>
          <span class="ws-meta">{v.notes.length} notes</span>
          {#if selVault === v.name}
            <button class="ghost" onclick={() => (selVault = null)}>fermer</button>
          {:else}
            <button class="ghost" onclick={() => void openVault(v.name)}>voir</button>
          {/if}
        </div>
        {#if selVault === v.name}
          <div class="vault">
            {#each v.notes.slice(0, 40) as n (n.path)}
              <button class="note" onclick={() => void readNote(v.name, n.path)} title="Envoyer dans le chat">
                📄 {n.path}</button>
            {/each}
            {#if v.notes.length > 40}<p class="sb-empty">+ {v.notes.length - 40} autres notes…</p>{/if}
          </div>
        {/if}
      {/each}
    {/if}
    {/if}

    {@render head('promptdeck', 'PromptDeck — MEGA PACK (agents & skills)')}
    {#if open.has('promptdeck')}
    {#if pd === null}
      <button class="ghost" onclick={() => void loadPd()}>Charger le MEGA PACK…</button>
    {:else if typeof pd === 'string'}
      <p class="sb-empty">{pd}</p>
    {:else}
      <p class="sb-root mono">{pd.path}</p>
      <div class="pd">
        {#each pd.tree as n, i (i)}
          {#if n.type === 'dir'}
            <div class="pd-dir">📁 {n.name} {n.children?.length ? `(${n.children.length})` : ''}</div>
            {#each n.children ?? [] as c, j (j)}
              <div class="pd-child">{c.type === 'dir' ? '└ 📁' : '└ 📄'} {c.name}</div>
            {/each}
          {:else if i < 40}
            <div class="pd-child">📄 {n.name}</div>
          {/if}
        {/each}
      </div>
      <p class="sb-empty">Agents & skills disponibles aux agents via l'outil promptdeck_browse (arborescence complète).</p>
    {/if}
    {/if}

    {@render head('appearance', 'Apparence')}
    {#if open.has('appearance')}
    <div class="gen">
      <label>
        <span>Thème</span>
        <div class="seg">
          {#each THEMES as t (t.id)}
            <button class:active={settings.theme === t.id} onclick={() => setSetting('theme', t.id)}>{t.label}</button>
          {/each}
        </div>
      </label>
      <label>
        <span>Typographie</span>
        <select value={fontOf(settings.fontFamily)} onchange={(e) => setSetting('fontFamily', FONTS.find((f) => f.id === e.currentTarget.value)?.stack ?? undefined)}>
          {#each FONTS as f (f.id)}
            <option value={f.id}>{f.label}</option>
          {/each}
        </select>
      </label>
      <label>
        <span>Police : {settings.fontSize}px</span>
        <input type="range" min="12" max="18" step="1" value={settings.fontSize} oninput={(e) => setSetting('fontSize', Number(e.currentTarget.value))} />
      </label>
    </div>
    <label class="check">
      <input type="checkbox" checked={settings.reduceMotion} onchange={(e) => setSetting('reduceMotion', e.currentTarget.checked)} />
      <span>Réduire les animations</span>
    </label>
    {/if}

    {@render head('data', 'Données')}
    {#if open.has('data')}
    <div class="gen">
      <button class="ghost" onclick={reset}>Réinitialiser les réglages</button>
      <button class="ghost danger" onclick={clearData}>Effacer toutes les données…</button>
    </div>
    {/if}
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--panel);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px 8px;
    border-bottom: 1px solid var(--border);
  }
  h2 {
    margin: 0;
    font-size: 14px;
  }
  .head-actions {
    display: flex;
    gap: 6px;
  }
  .icon {
    color: var(--muted);
    font-size: 14px;
    padding: 2px 7px;
    border-radius: 6px;
  }
  .icon:hover {
    color: var(--text);
    background: var(--panel2);
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 12px 14px 20px;
  }
  h3 {
    margin: 18px 0 8px;
    font-size: 11.5px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--muted);
  }
  h3:first-child {
    margin-top: 0;
  }
  .keyrow {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .keyrow label {
    flex: 1;
    display: grid;
    grid-template-columns: 92px 1fr;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .name {
    font-size: 13px;
    color: var(--muted);
  }
  input,
  textarea {
    font-size: 13px;
    min-width: 0;
  }
  .custom {
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px;
    margin-bottom: 10px;
    display: grid;
    gap: 8px;
  }
  .crow {
    display: flex;
    gap: 8px;
  }
  .crow > * {
    flex: 1;
  }
  textarea {
    resize: vertical;
  }
  .ghost {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 5px 10px;
    color: var(--muted);
    font-size: 12.5px;
    white-space: nowrap;
  }
  .ghost:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--accent);
  }
  .ghost:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .ghost.danger:hover:not(:disabled) {
    color: var(--danger);
    border-color: var(--danger);
  }
  .result {
    font-size: 12px;
    min-width: 76px;
    color: var(--danger);
  }
  .result.ok {
    color: var(--ok);
  }
  .addcustom {
    width: 100%;
    border: 1px dashed var(--border);
    border-radius: 10px;
    padding: 8px;
    color: var(--muted);
    font-size: 13px;
  }
  .addcustom:hover {
    color: var(--text);
    border-color: var(--accent);
  }
  .gen {
    display: grid;
    grid-template-columns: 1fr 150px;
    gap: 12px;
  }
  .gen label {
    display: grid;
    gap: 6px;
    font-size: 13px;
    color: var(--muted);
  }
  .seg {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  .seg button {
    flex: 1;
    padding: 5px 0;
    font-size: 12.5px;
    color: var(--muted);
  }
  .seg button.active {
    background: var(--accent);
    color: #fff;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    font-size: 13px;
    color: var(--muted);
  }
  .system {
    width: 100%;
  }
  .sb-root {
    font-size: 11px;
    color: var(--muted);
    margin: 0 0 6px;
    word-break: break-all;
  }
  .sb-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .wsrow {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    font-size: 12.5px;
  }
  .wsrow code {
    flex: 1;
    min-width: 0;
  }
  .ws-meta {
    color: var(--muted);
    font-size: 11.5px;
    white-space: nowrap;
  }
  .sb-empty {
    color: var(--muted);
    font-size: 12.5px;
  }
  .secthead {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    text-align: left;
    padding: 0;
    background: none;
    border: none;
  }
  .secthead:hover h3 {
    color: var(--text);
  }
  .chev {
    color: var(--accent);
    font-size: 12px;
    width: 12px;
  }
  .syshead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 10px;
  }
  .syslabel {
    font-size: 13px;
    color: var(--muted);
  }
  .ghost.save {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }
  .ghost.save.saved {
    color: var(--ok);
    border-color: var(--ok);
  }
  .vault {
    display: grid;
    gap: 2px;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px;
    max-height: 180px;
    overflow-y: auto;
  }
  .note {
    text-align: left;
    font-size: 12px;
    font-family: var(--mono);
    color: var(--muted);
    background: none;
    border: none;
    padding: 2px 4px;
    border-radius: 5px;
  }
  .note:hover {
    color: var(--accent);
    background: var(--panel2);
  }
  .pd {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px;
    max-height: 260px;
    overflow-y: auto;
    font-size: 12px;
    font-family: var(--mono);
  }
  .pd-dir {
    color: var(--text);
    margin-top: 4px;
  }
  .pd-child {
    color: var(--muted);
    padding-left: 16px;
  }
</style>
