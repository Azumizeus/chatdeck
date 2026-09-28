<script lang="ts">
  // Barre d'état façon IDE : fournisseur, modèle, latence, tokens approximatifs, état du stream.
  // + indicateurs réseau vert/rouge par fournisseur (sonde /api/health 1×/min).
  import type { Conversation, CustomProvider } from '../store'
  import { providerOf, priceLookup } from '../llm'
  import { conversationCost, formatCost } from '../cost'
  import { net } from '../net.svelte'

  let {
    conv,
    streaming,
    latencyMs,
    customs = [],
    onCascade,
  }: {
    /** Conversation à décrire (peut être null) */
    conv: Conversation | null
    streaming: boolean
    /** Latence du dernier échange (envoi → 1er token) */
    latencyMs: number | null
    customs?: CustomProvider[]
    /** Ouvre le panneau Cascade (santé des 9 providers + test réel) */
    onCascade: () => void
  } = $props()

  const provider = $derived(conv ? providerOf(conv.providerId, customs) : null)
  const cost = $derived(conv ? conversationCost(conv, customs, priceLookup) : null)
  const realTokens = $derived(Boolean(conv?.messages.some((m) => m.usage)))

  const DOT_LABELS: Record<string, string> = {
    openrouter: 'OpenRouter',
    nvidia: 'NVIDIA NIM',
    cohere: 'Cohere',
    mistral: 'Mistral',
  }
  const healthOf = (id: string): 'up' | 'down' | 'unknown' => {
    const h = net.providers[id]
    if (!h) return 'unknown'
    return h.up ? 'up' : 'down'
  }
  const proxyState = $derived(net.proxy)
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
    <span class="sep">·</span>
    <span class="health" title="Réseau : {proxyState === 'up' ? 'proxy OpenRouter OK' : proxyState === 'down' ? 'proxy OpenRouter INJOIGNABLE' : 'sonde en cours'}">
      <i class="hdot {proxyState}" ></i>proxy
    </span>
    <button class="cascade-btn" onclick={onCascade} title="Cascade LLM : santé des 9 providers du méga-pack + test réel">⚡ cascade</button>
    {#each Object.keys(DOT_LABELS) as pid (pid)}
      {@const st = healthOf(pid)}
      <span class="health" title="{DOT_LABELS[pid]} : {st === 'up' ? 'joignable' : st === 'down' ? 'injoignable' : 'non sondé'}">
        <i class="hdot {st}"></i>{DOT_LABELS[pid].split(' ')[0].toLowerCase()}
      </span>
    {/each}
  </div>
  <div class="right">
    {#if latencyMs !== null}
      <span class="mono" title="Latence d'ouverture du stream">⏱ {latencyMs} ms</span>
      <span class="sep">·</span>
    {/if}
    <span
      class="mono"
      title={realTokens ? 'Tokens réels (usage API)' : 'Estimation ~4 caractères/token'}
    >↑{cost?.promptTokens ?? 0} ↓{cost?.completionTokens ?? 0} tok{realTokens ? '' : '~'}</span>
    <span class="sep">·</span>
    <span class="mono" title={cost?.realPricing ? 'Prix réels du catalogue' : 'Prix indicatifs'}>
      {formatCost(cost?.cost ?? null)}{cost && !cost.realPricing && cost.cost !== null ? '~' : ''}
    </span>
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
  /* La droite (tokens/coût/UTF-8) garde une largeur naturelle : les compteurs
   * ne se font plus manger par le bord (« 0.00… », « UT… ») — c'est la gauche
   * (longs labels fournisseur/modèle) qui cède la place en rétrécissant. */
  .right {
    flex-shrink: 0;
    max-width: 60%;
    overflow: hidden;
  }
  .mono {
    font-family: var(--mono);
    white-space: nowrap;
  }
  .left .mono {
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
  .health {
    display: flex;
    align-items: center;
    gap: 3px;
    font-family: var(--mono);
    white-space: nowrap;
  }
  .hdot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--muted);
    opacity: 0.5;
  }
  .hdot.up {
    background: var(--ok, #27c93f);
    opacity: 1;
  }
  .hdot.down {
    background: #ff6b6b;
    opacity: 1;
    animation: pulse 1s ease-in-out infinite;
  }
  .hdot.checking {
    animation: pulse 0.8s ease-in-out infinite;
  }
  .cascade-btn {
    border: 1px solid var(--border);
    background: none;
    color: var(--muted);
    border-radius: 6px;
    padding: 1px 7px;
    font: inherit;
    font-size: 10.5px;
    cursor: pointer;
    white-space: nowrap;
  }
  .cascade-btn:hover {
    color: var(--fg);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
</style>
