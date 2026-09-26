<script lang="ts">
  // Bannière d'état réseau : remplace l'erreur brutale par un diagnostic clair
  // et un bouton « réessayer ». Visible uniquement quand le proxy est injoignable.
  import { net } from '../net.svelte'

  let { onRetry }: { onRetry?: () => void } = $props()

  const retry = (): void => {
    void net.probe()
    onRetry?.()
  }
</script>

{#if net.bannerVisible}
  <div class="netbanner" role="alert">
    <span class="ico">📡</span>
    <div class="txt">
      <strong>Réseau injoignable</strong>
      <span>
        Impossible de joindre OpenRouter via le serveur local. Vérifie ta connexion,
        ou relance le serveur : <code>npm run dev:bg</code>
      </span>
    </div>
    <button class="retry" onclick={retry} disabled={net.checking}>
      {net.checking ? '… test' : '⟳ réessayer'}
    </button>
    <button class="close" onclick={() => (net.proxy = 'unknown')} title="Masquer (la sonde repart dans 1 min)">×</button>
  </div>
{/if}

<style>
  .netbanner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    background: color-mix(in srgb, #ff6b6b 14%, var(--panel));
    border-bottom: 1px solid color-mix(in srgb, #ff6b6b 40%, var(--border));
    color: var(--text);
    flex-shrink: 0;
    z-index: 30;
  }
  .ico {
    font-size: 16px;
  }
  .txt {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .txt strong {
    font-size: 12.5px;
  }
  .txt span {
    font-size: 11.5px;
    color: var(--muted);
    line-height: 1.35;
  }
  .txt code {
    font-family: var(--mono);
    font-size: 10.5px;
    background: var(--panel2);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0 5px;
  }
  .retry {
    font-size: 12px;
    padding: 5px 12px;
    border: 1px solid color-mix(in srgb, #ff6b6b 45%, var(--border));
    border-radius: 8px;
    color: var(--text);
    background: color-mix(in srgb, #ff6b6b 18%, transparent);
    white-space: nowrap;
  }
  .retry:hover:not(:disabled) {
    border-color: #ff6b6b;
  }
  .retry:disabled {
    opacity: 0.6;
  }
  .close {
    border: none;
    background: none;
    color: var(--muted);
    font-size: 14px;
    padding: 2px 6px;
  }
  .close:hover {
    color: var(--text);
  }
</style>
