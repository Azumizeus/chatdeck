<script lang="ts">
  // Barre d'outils : accès direct aux fonctions clés depuis n'importe quel mode.
  // - standard  : avec libellés (modes docké / flottant)
  // - compact   : icônes seules (pill)
  // - perConv   : outils liés à UNE conversation (colonnes du duel)
  let {
    conv,
    streaming,
    duelActive,
    agentsActive,
    filesOpen,
    terminalOpen,
    previewOpen,
    variant = 'standard',
    onToggleAgents,
    onToggleDuel,
    onToggleFiles,
    onToggleTerminal,
    onTogglePreview,
    onSearch,
    onSettings,
  }: {
    conv: { id: string; agents?: string[] } | null
    streaming: boolean
    duelActive: boolean
    agentsActive: boolean
    filesOpen: boolean
    terminalOpen: boolean
    previewOpen?: boolean
    variant?: 'standard' | 'compact' | 'perConv'
    onToggleAgents: () => void
    onToggleDuel: () => void
    onToggleFiles: () => void
    onToggleTerminal: () => void
    onTogglePreview?: () => void
    onSearch: () => void
    onSettings: () => void
  } = $props()

  const compact = $derived(variant === 'compact')
  const perConv = $derived(variant === 'perConv')
</script>

<div class="toolbar" class:compact role="toolbar" aria-label="Outils">
  <button
    class="tb"
    class:active={agentsActive}
    onclick={onToggleAgents}
    disabled={!conv || streaming}
    title={agentsActive ? 'Désactiver les agents Nexus & Seeker' : 'Activer les agents Nexus & Seeker (sandbox)'}
  >
    🧠 {#if !compact}<span>Agents</span>{/if}
  </button>
  {#if !perConv}
    <button
      class="tb"
      class:active={duelActive}
      onclick={onToggleDuel}
      title={duelActive ? 'Quitter le mode duel' : 'Mode duel : deux conversations côte à côte'}
    >
      ⚔︎ {#if !compact}<span>Duel</span>{/if}
    </button>
  {/if}
  <button class="tb" class:active={filesOpen} onclick={onToggleFiles} disabled={!conv} title="Fichiers de la sandbox">
    📁 {#if !compact}<span>Fichiers</span>{/if}
  </button>
  <button class="tb" class:active={terminalOpen} onclick={onToggleTerminal} disabled={!conv} title="Terminal du workspace">
    ⌨︎ {#if !compact}<span>Terminal</span>{/if}
  </button>
  {#if onTogglePreview}
    <button class="tb" class:active={previewOpen} onclick={onTogglePreview} disabled={!conv} title="Preview live du workspace">
      👁 {#if !compact}<span>Preview</span>{/if}
    </button>
  {/if}
  {#if !perConv}
    <div class="spacer"></div>
    <button class="tb" onclick={onSearch} title="Rechercher dans toutes les conversations (⌘⇧F)">
      🔍 {#if !compact}<span>Chercher</span>{/if}
    </button>
    <button class="tb" onclick={onSettings} title="Réglages">
      ⚙︎ {#if !compact}<span>Réglages</span>{/if}
    </button>
  {/if}
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--panel) 70%, transparent);
    flex-shrink: 0;
    overflow-x: auto;
  }
  .toolbar.compact {
    padding: 3px 8px;
    gap: 2px;
  }
  .tb {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 9px;
    border-radius: 8px;
    border: 1px solid transparent;
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
  }
  .compact .tb {
    padding: 4px 6px;
    font-size: 13px;
  }
  .tb:hover:not(:disabled) {
    color: var(--text);
    background: var(--panel2);
    border-color: var(--border);
  }
  .tb.active {
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .tb:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .spacer {
    flex: 1;
  }
</style>
