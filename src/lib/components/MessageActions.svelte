<script lang="ts">
  // Barre d'actions sous chaque message — reprise de la barre msg-acts de
  // seeker-agents-system (Nexus OS) : mêmes icônes, mêmes tooltips colorés.
  // Adaptation ChatDeck : copier · régénérer · Obsidian (note) · brancher · supprimer.
  import type { Msg } from '../store'

  let {
    msg,
    isLast,
    streaming,
    cardsApplied = [],
    canUndo = false,
    onUndo,
    onRegenerate,
    onUseAsPrompt,
    onDelete,
  }: {
    msg: Msg
    /** Vrai si c'est le dernier message du fil (régénérer visible) */
    isLast: boolean
    streaming: boolean
    /** Fiches .CD actives au moment de l'envoi (badge 🃏 « fiche appliquée ») */
    cardsApplied?: string[]
    /** /undo : revert des checkpoints agent (sandbox disque disponible) */
    canUndo?: boolean
    onUndo?: () => void
    onRegenerate?: () => void
    /** Renvoie le contenu comme nouveau prompt (répondre / brancher) */
    onUseAsPrompt: (text: string) => void
    onDelete?: () => void
  } = $props()

  let copied = $state(false)

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(msg.content)
      copied = true
      setTimeout(() => (copied = false), 1400)
    } catch {
      /* clipboard indisponible */
    }
  }

  const toNote = (): void => {
    const title = msg.content.replace(/[#*`>]/g, '').trim().split('\n')[0].slice(0, 48) || 'Note'
    const body = `# ${title}\n\n> Extrait de conversation — ${new Date().toLocaleString('fr-FR')}\n\n${msg.content}\n`
    onUseAsPrompt(`/note ${body.slice(0, 200)}`)
  }
</script>

<div class="msg-acts" role="toolbar" aria-label="Actions du message">
  <button class="act act-copy" onclick={() => void copy()} title="Copier">
    {copied ? '✔' : '⧉'}<span class="act-tip">{copied ? 'Copié !' : 'Copier'}</span>
  </button>
  {#if msg.role === 'assistant' && isLast && !streaming}
    <button class="act act-retry" onclick={() => onRegenerate?.()} title="Régénérer">
      ⟳<span class="act-tip">Régénérer</span>
    </button>
  {/if}
  {#if canUndo && onUndo && msg.role === 'assistant'}
    <button class="act act-undo" onclick={() => onUndo?.()} title="Annuler les modifications de l'agent (revert au checkpoint)">
      ↩<span class="act-tip">Undo sandbox</span>
    </button>
  {/if}
  {#if msg.role === 'assistant'}
    <button class="act act-reply" onclick={() => onUseAsPrompt('Réponds à ce point précis : ')} title="Répondre à ce message">
      ↩<span class="act-tip">Répondre</span>
    </button>
    <button class="act act-obsidian" onclick={toNote} title="Créer une note Obsidian">
      🗹<span class="act-tip">Obsidian</span>
    </button>
  {:else}
    <button class="act act-edit" onclick={() => onUseAsPrompt(msg.content)} title="Réutiliser comme prompt">
      ✎<span class="act-tip">Réutiliser</span>
    </button>
  {/if}
  {#if onDelete}
    <button class="act act-delete" onclick={() => onDelete?.()} title="Supprimer">
      🗑<span class="act-tip">Supprimer</span>
    </button>
  {/if}
  {#if cardsApplied.length}
    <span class="cards-badge" title="Fiches .CD appliquées : {cardsApplied.join(', ')}">🃏 {cardsApplied.length}</span>
  {/if}
</div>

<style>
  .msg-acts {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 4px;
    /* Toujours perceptibles (0.45), plein au survol : invisible au survol seul
       = introuvable au trackpad (bug signalé : « les boutons n'apparaissent pas »). */
    opacity: 0.45;
    transition: opacity 0.15s;
  }
  .msg-acts:hover,
  .msg-acts:focus-within {
    opacity: 1;
  }
  @media (hover: none) {
    .msg-acts {
      opacity: 1;
    }
  }
  .act {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    height: 26px;
    padding: 0 6px;
    background: var(--panel2);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .act:hover {
    color: var(--text);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    /* Pas de translateY ici : le déplacement au survol fait osciller le curseur
       au bord du bouton (rentre → le bouton bouge → sort → le bouton revient…)
       = le « clignotement » signalé au survol des actions de message. */
  }
  .act .act-tip {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%) scale(0.9);
    background: var(--panel);
    color: var(--text);
    font-size: 10.5px;
    padding: 2px 8px;
    border-radius: 5px;
    border: 1px solid var(--border);
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: all 0.15s;
    z-index: 5;
  }
  .act:hover .act-tip {
    opacity: 1;
    transform: translateX(-50%) scale(1);
  }
  /* Couleurs d'action reprises de Nexus OS */
  .act-copy:hover {
    color: #27c93f;
  }
  .act-retry:hover {
    color: #fb923c;
  }
  .act-undo:hover {
    color: #fb923c;
  }
  .act-reply:hover {
    color: var(--accent);
  }
  .act-obsidian:hover {
    color: #818cf8;
  }
  .act-edit:hover {
    color: var(--accent);
  }
  .act-delete:hover {
    color: #ff6b6b;
  }
  /* Badge « fiches .CD appliquées » (prompt enrichi au moment de l'envoi) */
  .cards-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-left: 2px;
    font-size: 10.5px;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1px 6px;
  }
</style>
