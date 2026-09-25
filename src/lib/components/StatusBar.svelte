<script lang="ts">
  // Barre d'état façon IDE : fournisseur, modèle, latence, tokens approximatifs, état du stream.
  import type { Conversation, CustomProvider } from '../store'
  import { providerOf } from '../llm'

  let {
    conv,
    streaming,
    latencyMs,
    customs = [],
  }: {
    /** Conversation à décrire (peut être null) */
    conv: Conversation | null
    streaming: boolean
    /** Latence du dernier échange (envoi → 1er token) */
    latencyMs: number | null
    customs?: CustomProvider[]
  } = $props()

  const provider = $derived(conv ? providerOf(conv.providerId, customs) : null)
  const tokensOut = $derived(
    conv
      ? Math.ceil(
          conv.messages
            .filter((m) => m.role === 'assistant')
            .reduce((n, m) => n + m.content.length, 0) / 4,
        )
      : 0,
  )
  const tokensIn = $derived(
    conv
      ? Math.ceil(
          conv.messages
            .filter((m) => m.role === 'user')
            .reduce((n, m) => n + m.content.length, 0) / 4,
        )
      : 0,
  )
</script>

<footer class="status">
  <div class="left">
    <span class="dot" class:live={streaming} title={streaming ? 'Génération en cours' : 'Inactif'}></span>
    {#if provider}
      <span class="mono">{provider.label}</span>
      <span class="sep">·</span>
      <span class="mono">{conv?.model}</span>
    {:else}
      <span class="mono">aucune conversation</span>
    {/if}
  </div>
  <div class="right">
    {#if latencyMs !== null}
      <span class="mono" title="Latence d'ouverture du stream">⏱ {latencyMs} ms</span>
      <span class="sep">·</span>
    {/if}
    <span class="mono" title="Estimation ~4 caractères/token">↑{tokensIn} ↓{tokensOut} tok</span>
    <span class="sep">·</span>
    <span class="mono">UTF-8</span>
  </div>
</footer>

<style>
  .status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    height: 26px;
    padding: 0 12px;
    font-size: 11px;
    color: var(--muted);
    background: color-mix(in srgb, var(--panel) 80%, transparent);
    border-top: 1px solid var(--border);
    backdrop-filter: blur(8px);
    flex-shrink: 0;
    user-select: none;
  }
  .left,
  .right {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .mono {
    font-family: var(--mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted);
    flex-shrink: 0;
  }
  .dot.live {
    background: var(--ok);
    animation: pulse 1s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
  .sep {
    opacity: 0.4;
  }
</style>
