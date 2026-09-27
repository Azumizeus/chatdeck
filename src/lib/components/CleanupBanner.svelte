<script lang="ts">
  // Semi-nettoyage automatique de la sandbox, AU LANCEMENT de l'app :
  //  · on calcule ce qui PEUT partir (orphelins = conversations disparues du
  //    localStorage + workspaces inactifs > 30 jours) — côté client ;
  //  · on NE SUPPRIME RIEN sans validation humaine : bannière discrète avec
  //    le décompte exact, « Nettoyer » exécute /api/sandbox/cleanup (les
  //    projets p-* sont toujours préservés), « Plus tard » remet au
    //    prochain lancement (l'état n'est pas consommé avant acceptation).
  let {
    onDone,
  }: {
    onDone: () => void
  } = $props()

  interface WsInfo {
    id: string
    sizeBytes: number
    files: number
    mtime: number
  }

  let checking = $state(true)
  let orphans = $state<string[]>([])
  let stale = $state<WsInfo[]>([])
  let totalBytes = $state(0)
  let running = $state(false)
  let note = $state('')
  let expanded = $state(false)

  function fmtBytes(n: number): string {
    if (n < 1024) return `${n} o`
    if (n < 1_048_576) return `${(n / 1024).toFixed(1)} ko`
    return `${(n / 1_048_576).toFixed(1)} Mo`
  }

  /** Ouvre une page {@page} = contexte navigateur léger ; ici on lit juste le
   *  localStorage de l'app courante (déjà la bonne partition) — pas de page. */
  function liveConversationIds(): Set<string> {
    const ids = new Set<string>()
    try {
      const convs = JSON.parse(localStorage.getItem('chatdeck.conversations.v1') || '[]') as { id?: string }[]
      for (const c of convs) if (typeof c.id === 'string') ids.add(c.id.toLowerCase())
    } catch {
      /* conversations illisibles : aucun orphelin déclaré */
    }
    return ids
  }

  $effect(() => {
    void (async () => {
      try {
        const r = await fetch('/api/sandbox/status')
        if (!r.ok) return onDone()
        const j = (await r.json()) as { workspaces?: WsInfo[] }
        const all = (j.workspaces ?? []).filter((w) => !w.id.startsWith('p-'))
        const live = liveConversationIds()
        const cutoff = Date.now() - 30 * 86_400_000
        const seenBase = new Set<string>()
        for (const w of all) {
          const base = w.id.split('@@')[0].replace(/^p-/, '')
          if (seenBase.has(base)) continue // base + @@os comptés une fois
          seenBase.add(base)
          const isOrphan = /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(base) && !live.has(base.toLowerCase())
          const isStale = w.mtime < cutoff
          if (isOrphan || isStale) {
            if (isOrphan) orphans = [...orphans, base]
            else stale = [...stale, w]
            totalBytes += w.sizeBytes
          }
        }
        if (!orphans.length && !stale.length) onDone() // rien à signaler : bannière jamais montrée
      } catch {
        onDone() // serveur indisponible : on n'embête personne
      } finally {
        checking = false
      }
    })()
  })

  async function clean(): Promise<void> {
    running = true
    note = ''
    try {
      const r = await fetch('/api/sandbox/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orphans, maxAgeDays: 30 }),
      })
      const j = (await r.json()) as { removed?: number; bytesFreed?: number; error?: string }
      note = j.error ? `✗ ${j.error}` : `✓ ${j.removed ?? 0} workspace(s) supprimé(s) · ${fmtBytes(j.bytesFreed ?? 0)} libérés`
      orphans = []
      stale = []
      setTimeout(onDone, 1800)
    } catch (e) {
      note = `✗ ${(e as Error).message}`
    } finally {
      running = false
    }
  }
</script>

<div class="cleanup-banner" role="status" aria-live="polite">
  {#if checking}
    <span class="quiet">… vérification de la sandbox</span>
  {:else}
    <span class="ico" aria-hidden="true">🧹</span>
    <span class="txt">
      {orphans.length + stale.length} workspace(s) nettoyable(s)
      — {orphans.length} orphelin(s), {stale.length} inactif(s) &gt; 30 j · {fmtBytes(totalBytes)}
      <button class="link" onclick={() => (expanded = !expanded)}>{expanded ? 'masquer' : 'détails'}</button>
    </span>
    <button class="go" disabled={running} onclick={() => void clean()}>
      {running ? '… nettoyage' : 'Nettoyer'}
    </button>
    <button class="later" onclick={onDone} title="Rien ne sera supprimé — resignalé au prochain lancement">Plus tard</button>
    {#if note}<span class="note">{note}</span>{/if}
  {/if}
  {#if expanded && (orphans.length || stale.length)}
    <div class="details">
      {#if orphans.length}
        <p>Orphelins (conversation supprimée) : <code>{orphans.slice(0, 8).join(', ')}{orphans.length > 8 ? ` +${orphans.length - 8}` : ''}</code></p>
      {/if}
      {#if stale.length}
        <p>Inactifs &gt; 30 j : <code>{stale.slice(0, 8).map((w) => w.id).join(', ')}{stale.length > 8 ? ` +${stale.length - 8}` : ''}</code></p>
      {/if}
      <p class="hint">Les workspaces des PROJETS (p-…) ne sont jamais touchés. Rien n'est supprimé sans ton accord.</p>
    </div>
  {/if}
</div>

<style>
  .cleanup-banner {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0 auto 10px;
    max-width: 860px;
    width: 100%;
    padding: 8px 12px;
    border: 1px solid color-mix(in srgb, #fbbf24 35%, transparent);
    background: color-mix(in srgb, #fbbf24 8%, var(--panel, #151926));
    border-radius: 10px;
    font-size: 12.5px;
  }
  .ico {
    font-size: 14px;
  }
  .txt {
    color: var(--muted, #9aa3b2);
    flex: 1;
    min-width: 200px;
  }
  .link {
    border: none;
    background: none;
    color: var(--accent, #6366f1);
    font: inherit;
    font-size: 11.5px;
    cursor: pointer;
    padding: 0 2px;
  }
  .go {
    border: 1px solid color-mix(in srgb, #fbbf24 45%, transparent);
    background: color-mix(in srgb, #fbbf24 18%, transparent);
    color: inherit;
    font: inherit;
    font-size: 12px;
    border-radius: 8px;
    padding: 4px 10px;
    cursor: pointer;
  }
  .go:hover {
    background: color-mix(in srgb, #fbbf24 28%, transparent);
  }
  .later {
    border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
    background: none;
    color: var(--muted, #9aa3b2);
    font: inherit;
    font-size: 12px;
    border-radius: 8px;
    padding: 4px 10px;
    cursor: pointer;
  }
  .later:hover {
    color: inherit;
  }
  .note {
    font-size: 11.5px;
    color: var(--muted, #9aa3b2);
  }
  .details {
    flex-basis: 100%;
    border-top: 1px dashed var(--border, rgba(255, 255, 255, 0.08));
    padding-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .details p {
    margin: 0;
    font-size: 11.5px;
    color: var(--muted, #9aa3b2);
  }
  .details code {
    font-family: var(--mono, ui-monospace, monospace);
    font-size: 11px;
    word-break: break-all;
  }
  .details .hint {
    opacity: 0.75;
  }
  .quiet {
    color: var(--muted, #9aa3b2);
    font-size: 12px;
  }
</style>
