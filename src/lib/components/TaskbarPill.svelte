<script lang="ts">
  // Pill « barre des tâches » : ChatDeck réduit en pastille compacte avec état live
  // (stream en cours, tokens, modèle). Un clic restaure la fenêtre.
  import type { Conversation, CustomProvider } from '../store'
  import { providerOf } from '../llm'

  let {
    conv,
    streaming,
    tokens,
    customs = [],
    onRestore,
  }: {
    conv: Conversation | null
    streaming: boolean
    /** Tokens générés sur le stream en cours (ou total conversation) */
    tokens: number
    customs?: CustomProvider[]
    onRestore: () => void
  } = $props()

  const providerLabel = $derived(conv ? providerOf(conv.providerId, customs).label : 'ChatDeck')
  const modelLabel = $derived(conv ? conv.model : '')
</script>

<button class="pill" class:live={streaming} onclick={onRestore} title="Restaurer ChatDeck">
  <span class="bolt">⚡</span>
  <span class="texts">
    <span class="l1">
      {providerLabel}{#if streaming}<span class="live-dot"></span>{/if}
    </span>
    <span class="l2 mono">{modelLabel}{#if tokens > 0} · ↓{tokens} tok{/if}</span>
  </span>
</button>

<style>
  .pill {
    position: fixed;
    right: 14px;
    bottom: 14px;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 14px 8px 10px;
    background: color-mix(in srgb, var(--panel) 92%, transparent);
    border: 1px solid var(--border);
    border-radius: 999px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(10px);
    z-index: 80;
    transition: border-color var(--anim) ease, transform var(--anim) ease;
    text-align: left;
  }
  .pill:hover {
    border-color: var(--accent);
    transform: translateY(-1px);
  }
  .bolt {
    font-size: 16px;
  }
  .texts {
    display: grid;
    line-height: 1.25;
    max-width: 240px;
  }
  .l1 {
    font-size: 12.5px;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .l2 {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mono {
    font-family: var(--mono);
  }
  .live-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);
    animation: pulse 1s ease-in-out infinite;
  }
  .pill.live {
    border-color: color-mix(in srgb, var(--ok) 55%, var(--border));
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
</style>
