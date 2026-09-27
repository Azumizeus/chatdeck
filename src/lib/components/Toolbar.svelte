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
    graphOpen,
    variant = 'standard',
    onToggleAgents,
    onToggleDuel,
    onToggleFiles,
    onToggleTerminal,
    onTogglePreview,
    onToggleGraph,
    onSearch,
    onSettings,
    onToggleHub,
    hubOpen,
  }: {
    conv: { id: string; agents?: string[] } | null
    streaming: boolean
    duelActive: boolean
    agentsActive: boolean
    filesOpen: boolean
    terminalOpen: boolean
    previewOpen?: boolean
    graphOpen?: boolean
    variant?: 'standard' | 'compact' | 'perConv'
    onToggleAgents: () => void
    onToggleDuel: () => void
    onToggleFiles: () => void
    onToggleTerminal: () => void
    onTogglePreview?: () => void
    onToggleGraph?: () => void
    onSearch: () => void
    onSettings: () => void
    /** Fenêtre outils (hub) : bouton affiché si fourni, actif si hubOpen */
    onToggleHub?: () => void
    hubOpen?: boolean
  } = $props()

  const compact = $derived(variant === 'compact')
  const perConv = $derived(variant === 'perConv')
</script>

<div class="toolbar" class:compact role="toolbar" aria-label="Outils">
  <!-- Groupe 1 : sessions d'agents -->
  <div class="grp" role="group" aria-label="Sessions d'agents">
    <button
      class="tb"
      class:active={agentsActive}
      aria-pressed={agentsActive}
      onclick={onToggleAgents}
      disabled={!conv || streaming}
      title={agentsActive ? 'Désactiver les agents Nexus, Seeker & PromptDeck' : 'Activer les agents Nexus, Seeker & PromptDeck (sandbox disque)'}
    >
      <span aria-hidden="true">🧠</span> {#if !compact}<span>Agents</span>{/if}
    </button>
    {#if !perConv}
      <button
        class="tb"
        class:active={duelActive}
        aria-pressed={duelActive}
        onclick={onToggleDuel}
        title={duelActive ? 'Quitter le mode duel' : 'Mode duel : deux conversations côte à côte'}
      >
        <span aria-hidden="true">⚔︎</span> {#if !compact}<span>Duel</span>{/if}
      </button>
    {/if}
  </div>

  <span class="sep" aria-hidden="true"></span>

  <!-- Groupe 2 : espace de travail (sandbox) -->
  <div class="grp" role="group" aria-label="Espace de travail de la conversation">
    <button class="tb" class:active={filesOpen} aria-pressed={filesOpen} onclick={onToggleFiles} disabled={!conv} title="Fichiers de la sandbox (hub)">
      <span aria-hidden="true">📁</span> {#if !compact}<span>Fichiers</span>{/if}
    </button>
    <button class="tb" class:active={terminalOpen} aria-pressed={terminalOpen} onclick={onToggleTerminal} disabled={!conv} title="Terminal du workspace (liste blanche, cwd = sandbox)">
      <span aria-hidden="true">⌨︎</span> {#if !compact}<span>Terminal</span>{/if}
    </button>
    {#if onTogglePreview}
      <button class="tb" class:active={previewOpen} aria-pressed={previewOpen} onclick={onTogglePreview} disabled={!conv} title="Preview live du workspace (index.html servi par /serve)">
        <span aria-hidden="true">👁</span> {#if !compact}<span>Preview</span>{/if}
      </button>
    {/if}
    {#if onToggleGraph}
      <button class="tb" class:active={graphOpen} aria-pressed={graphOpen} onclick={onToggleGraph} title="Graphify : graphe des conversations, workspaces et agents">
        <span aria-hidden="true">🕸</span> {#if !compact}<span>Graphify</span>{/if}
      </button>
    {/if}
    {#if onToggleHub && !perConv}
      <button class="tb" class:active={hubOpen} aria-pressed={hubOpen} onclick={onToggleHub} title="Hub à onglets : Graphify, Fichiers, Terminal, Preview, Réglages, Skills — double-clic sur son titre pour le replier">
        <span aria-hidden="true">🗂</span> {#if !compact}<span>Outils</span>{/if}
      </button>
    {/if}
  </div>

  {#if !perConv}
    <div class="spacer"></div>
    <!-- Groupe 3 : app -->
    <div class="grp" role="group" aria-label="Application">
      <button class="tb" onclick={onSearch} title="Rechercher dans toutes les conversations (⌘⇧F)">
        <span aria-hidden="true">🔍</span> {#if !compact}<span>Chercher</span>{/if}
      </button>
      <button class="tb" onclick={onSettings} title="Réglages (⌘,)">
        <span aria-hidden="true">⚙︎</span> {#if !compact}<span>Réglages</span>{/if}
      </button>
    </div>
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
  .grp {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .compact .grp {
    gap: 2px;
  }
  .sep {
    width: 1px;
    height: 18px;
    background: var(--border);
    margin: 0 4px;
    flex-shrink: 0;
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
