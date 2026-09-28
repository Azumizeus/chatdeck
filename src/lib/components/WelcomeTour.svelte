<script lang="ts">
  // Mode d'emploi interactif — visite guidée au lancement de ChatDeck (6 étapes),
  // persistée (ne réapparaît qu'à la demande : ⌘K « mode d'emploi » ou ⚙︎ Réglages).
  let { onClose, onAction }: { onClose: () => void; onAction: (action: string) => void } = $props()

  let step = $state(0)

  const STEPS: { title: string; body: string; emoji: string; action?: { label: string; cmd: string } }[] = [
    {
      emoji: '⚡',
      title: 'Bienvenue dans ChatDeck',
      body: 'ChatDeck est un IDE multi-LLM : tu discutes avec OpenRouter, NVIDIA NIM, Cohere ou Mistral (clés stockées localement, jamais envoyées ailleurs). Les clés se règlent dans ⚙︎ Réglages — elles sont préchargées si keys.local.json existe.',
    },
    {
      emoji: '🧠',
      title: 'Les agents : Nexus, Seeker, PromptDeck',
      body: 'Active les agents (bouton 🧠) : Nexus orchestre et écrit dans une vraie sandbox disque, Seeker explore, PromptDeck conçoit les prompts. Ils collaborent au même workspace, délèguent entre eux et rendent des rapports.',
      action: { label: 'Activer les agents', cmd: 'agents' },
    },
    {
      emoji: '⚔️',
      title: 'Duel & débat en 2 tours',
      body: 'Le duel compare deux modèles côte à côte sur la même question. Lance la Synthèse : l\'arbitre tranche. Coche « débat 2 tours » pour que A et B répliquent au verdict avant le verdict final.',
      action: { label: 'Ouvrir le duel', cmd: 'duel' },
    },
    {
      emoji: '📁',
      title: 'Sandbox : fichiers, terminal, git',
      body: 'Le panneau Fichiers gère le workspace : arborescence complète, filtre, renommer/dupliquer/télécharger/importer. Le terminal ⌨︎ exécute node/npm/git. ⑂ commit auto versionne le travail des agents (visible dans l\'arbre Git).',
      action: { label: 'Ouvrir les fichiers', cmd: 'files' },
    },
    {
      emoji: '🕸',
      title: 'Graphify : le graphe de tout ça',
      body: 'Le panneau 🕘 Graphify dessine conversations, workspaces et liens entre agents. Glisse les nœuds (positions gardées), range avec ⌗ (par type / agent / fraîcheur), exporte en PNG.',
      action: { label: 'Voir le graphe', cmd: 'graph' },
    },
    {
      emoji: '📡',
      title: 'Réseau & raccourcis',
      body: 'Les pastilles vertes/rouges en bas à gauche montrent l\'état des 4 fournisseurs (sonde 1×/min). Si OpenRouter devient injoignable, une bannière avec « réessayer » apparaît. Raccourcis : ⌘K palette, ⌘N nouvelle conv, ⌘⇧F recherche.',
      action: { label: 'Relancer la sonde réseau', cmd: 'net' },
    },
  ]

  const last = $derived(step === STEPS.length - 1)
  const next = (): void => {
    if (last) onClose()
    else step++
  }
  const doAction = (): void => {
    const a = STEPS[step].action
    if (a) onAction(a.cmd)
  }
</script>

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="tour" role="dialog" aria-label="Mode d'emploi interactif">
    <header>
      <span class="dots">
        {#each STEPS as _, i (i)}
          <button class="dot" class:on={i === step} aria-label="Étape {i + 1}" onclick={() => (step = i)}></button>
        {/each}
      </span>
      <button class="skip" onclick={onClose}>passer</button>
    </header>
    <div class="body">
      <div class="emoji">{STEPS[step].emoji}</div>
      <h2>{STEPS[step].title}</h2>
      <p>{STEPS[step].body}</p>
      {#if STEPS[step].action}
        <button class="ghost act" onclick={doAction}>▶ {STEPS[step].action!.label}</button>
      {/if}
    </div>
    <footer>
      <span class="hint">Affichable à tout moment : ⌘K → « mode d'emploi » · désactivable dans ⚙︎ Réglages</span>
      <button class="ghost" onclick={() => (step > 0 ? step-- : undefined)} disabled={step === 0}>← précédent</button>
      <button class="primary" onclick={next}>{last ? 'C\'est parti ⚡' : 'suivant →'}</button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 95;
  }
  .tour {
    width: min(560px, calc(100vw - 48px));
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 16px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px 0;
  }
  .dots {
    display: flex;
    gap: 6px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--border);
    padding: 0;
  }
  .dot.on {
    background: var(--accent);
  }
  .skip {
    font-size: 11.5px;
    color: var(--muted);
    background: none;
    border: none;
  }
  .skip:hover {
    color: var(--text);
  }
  .body {
    padding: 6px 22px 14px;
    text-align: center;
  }
  .emoji {
    font-size: 42px;
    margin-bottom: 6px;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 19px;
  }
  p {
    margin: 0 0 12px;
    color: var(--muted);
    font-size: 13.5px;
    line-height: 1.6;
  }
  .ghost,
  .primary {
    border-radius: 9px;
    padding: 7px 14px;
    font-size: 13px;
  }
  .ghost {
    border: 1px solid var(--border);
    color: var(--muted);
    background: none;
  }
  .ghost:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--accent);
  }
  .ghost:disabled {
    opacity: 0.35;
  }
  .ghost.act {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }
  .primary {
    background: var(--accent);
    color: #fff;
    border: none;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px 14px;
    border-top: 1px solid var(--border);
  }
  .hint {
    flex: 1;
    font-size: 10.5px;
    color: var(--muted);
  }
</style>
