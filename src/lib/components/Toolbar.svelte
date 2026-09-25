<script lang="ts">
  // Barre d'outils permanente : accès direct aux fonctions clés depuis n'importe
  // quel mode (docké, flottant, duel) et n'importe quel fil.
  let {
    conv,
    streaming,
    duelActive,
    agentsActive,
    filesOpen,
    terminalOpen,
    onToggleAgents,
    onToggleDuel,
    onToggleFiles,
    onToggleTerminal,
    onSearch,
    onSettings,
  }: {
    /** Conversation active (null → boutons liés au fil désactivés) */
    conv: { id: string; agents?: string[] } | null
    streaming: boolean
    duelActive: boolean
    agentsActive: boolean
    filesOpen: boolean
    terminalOpen: boolean
    onToggleAgents: () => void
    onToggleDuel: () => void
    onToggleFiles: () => void
    onToggleTerminal: () => void
    onSearch: () => void
    onSettings: () => void
  } = $props()
</script>

<div class="toolbar" role="toolbar" aria-label="Outils">
  <button
    class="tb"
    class:active={agentsActive}
    onclick={onToggleAgents}
    disabled={!conv || streaming}
    title={agentsActive ? 'Désactiver les agents Nexus & Seeker' : 'Activer les agents Nexus & Seeker (sandbox)'}
  >
    🧠 <span>Agents</span>
  </button>
  <button
    class="tb"
    class:active={duelActive}
    onclick={onToggleDuel}
    title={duelActive ? 'Quitter le mode duel' : 'Mode duel : deux conversations côte à côte'}
  >
    ⚔︎ <span>Duel</span>
  </button>
  <button
    class="tb"
    class:active={filesOpen}
    onclick={onToggleFiles}
    disabled={!conv}
    title="Fichiers de la sandbox"
  >
    📁 <span>Fichiers</span>
  </button>
  <button
    class="tb"
    class:active={terminalOpen}
    onclick={onToggleTerminal}
    disabled={!conv}
    title="Terminal du workspace (node, npm, git…)"
  >
    ⌨︎ <span>Terminal</span>
  </button>
  <div class="spacer"></div>
  <button class="tb" onclick={onSearch} title="Rechercher dans toutes les conversations (⌘⇧F)">
    🔍 <span>Chercher</span>
  </button>
  <button class="tb" onclick={onSettings} title="Réglages (clés, sandbox, apparence)">
    ⚙︎ <span>Réglages</span>
  </button>
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
