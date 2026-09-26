// État réseau ChatDeck : santé du serveur dev (proxy inclus) et des 4 fournisseurs.
// Sondes /api/health (côté serveur Vite) + /api/openrouter (bout en bout via le proxy).
// Alimente la bannière « réseau injoignable » et les indicateurs de la barre d'état.

export type ProviderHealth = { up: boolean; status?: number; ms: number; error?: string }

export interface HealthData {
  server: boolean
  providers: Record<string, ProviderHealth>
  allUp: boolean
}

/** Résultat de la sonde bout en bout du proxy OpenRouter (celui qui sert le chat). */
export type ProbeResult = 'up' | 'down' | 'checking' | 'unknown'

class NetState {
  /** État de la sonde proxy OpenRouter (le chemin critique : envoyer un message) */
  proxy = $state<ProbeResult>('unknown')
  /** Détail des 4 fournisseurs (indicateurs de la barre d'état) */
  providers = $state<Record<string, ProviderHealth>>({})
  allUp = $state(false)
  /** Dernière sonde réussie (évite de re-sonder en boucle quand tout va bien) */
  lastOkAt = $state(0)
  checking = $state(false)

  /** Bannière visible : la sonde proxy a échoué (ou n'a jamais réussi et le serveur ne répond pas). */
  get bannerVisible(): boolean {
    return this.proxy === 'down'
  }

  /** Sonde complète : health (4 providers) + test réel du proxy /api/openrouter. */
  async probe(): Promise<void> {
    if (this.checking) return
    this.checking = true
    this.proxy = this.proxy === 'up' ? 'up' : 'checking'
    try {
      // 1) Le chemin critique : un GET proxifié vers OpenRouter (cache 10 min côté app,
      //    réponse en <1 s quand le réseau va). Abort au bout de 8 s.
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 8000)
      try {
        const r = await fetch('/api/openrouter/api/v1/models', { signal: ctrl.signal })
        this.proxy = r.ok ? 'up' : 'down'
      } catch {
        this.proxy = 'down'
      } finally {
        clearTimeout(timer)
      }
      if (this.proxy === 'up') this.lastOkAt = Date.now()

      // 2) Détail par fournisseur (endpoint Vite, best effort)
      const h = await fetch('/api/health', { signal: AbortSignal.timeout(12_000) })
        .then((r) => r.json() as Promise<HealthData>)
        .catch(() => null)
      if (h?.providers) {
        this.providers = h.providers
        this.allUp = h.allUp
      }
    } finally {
      this.checking = false
    }
  }

  /** Démarre les sondes périodiques + écoute offline/online du navigateur. */
  start(): () => void {
    void this.probe()
    const interval = setInterval(() => void this.probe(), 60_000)
    const offline = (): void => {
      this.proxy = 'down'
    }
    const online = (): void => {
      void this.probe()
    }
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    return () => {
      clearInterval(interval)
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', online)
    }
  }
}

/** Singleton partagé (app principale + popouts). */
export const net = new NetState()
