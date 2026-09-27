<script lang="ts">
  // Hub : fenêtre outils déployable qui regroupe Graphify, Fichiers, Terminal,
  // Preview et Réglages — le chat reste entièrement visible et accessible
  // derrière. Chrome minimal : drag par la barre de titre, resize (bords E/S/SE),
  // géométrie persistée (chatdeck.hub.v1). Le contenu de l'onglet actif est
  // rendu par le parent via le snippet `children` ; les panneaux dockables
  // (position:fixed chez eux) sont re-ancrés en absolute par la classe .hubbed.
  import type { Snippet } from 'svelte'
  import { HUB_TABS, loadHubGeometry, saveHubGeometry, type HubGeometry, type HubTab } from '../store'

  let {
    tabs,
    active,
    onTab,
    onClose,
    onDetach,
    children,
  }: {
    /** Onglets affichés (réglage hubTabs), déjà filtré */
    tabs: HubTab[]
    active: HubTab
    onTab: (t: HubTab) => void
    onClose: () => void
    /** Onglet tiré hors de la barre → ouvrir en fenêtre dédiée (comme un IDE) */
    onDetach?: (t: HubTab) => void
    children?: Snippet
  } = $props()

  const MIN_W = 380
  const MIN_H = 280

  // Géométrie persistée, re-clampée à l'init (fenêtre redimensionnée entre-temps,
  // ou géométrie obsolète d'une ancienne session).
  let geo = $state<HubGeometry>(clamp(loadHubGeometry()))
  let dragging = $state(false)
  let resizing = $state<false | 'e' | 's' | 'se'>(false)
  let grab: { dx: number; dy: number } | null = null
  let startGeo: HubGeometry | null = null
  let startPoint: { x: number; y: number } | null = null

  function clamp(g: HubGeometry): HubGeometry {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = Math.max(MIN_W, Math.min(g.w, vw - 24))
    const h = Math.max(MIN_H, Math.min(g.h, vh - 24))
    return {
      w,
      h,
      x: Math.max(8 - w + 80, Math.min(g.x, vw - 80)),
      y: Math.max(0, Math.min(g.y, vh - 40)),
    }
  }

  function down(e: PointerEvent): void {
    // On ne drague que depuis la surface de l'en-tête : presser un bouton
    // d'onglet (ou la croix) doit rester un clic, pas capturer le pointeur.
    if (e.target !== e.currentTarget) return
    dragging = true
    grab = { dx: e.clientX - geo.x, dy: e.clientY - geo.y }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  function startResize(e: PointerEvent, dir: 'e' | 's' | 'se'): void {
    resizing = dir
    startGeo = { ...geo }
    startPoint = { x: e.clientX, y: e.clientY }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  function move(e: PointerEvent): void {
    if (dragging && grab) geo = clamp({ ...geo, x: e.clientX - grab.dx, y: e.clientY - grab.dy })
    else if (resizing && startGeo && startPoint) {
      const dw = e.clientX - startPoint.x
      const dh = e.clientY - startPoint.y
      geo = clamp({
        ...geo,
        w: resizing === 's' ? startGeo.w : startGeo.w + dw,
        h: resizing === 'e' ? startGeo.h : startGeo.h + dh,
      })
    }
  }
  function up(): void {
    if (dragging || resizing) saveHubGeometry({ ...geo })
    dragging = false
    resizing = false
    grab = null
    startGeo = null
    startPoint = null
  }

  /* Détachement d'onglet : un drag horizontal de ~40 px hors du bouton
   * ouvre l'onglet en fenêtre dédiée (popout), comme un IDE. */
  let tabDrag: { id: HubTab; x0: number; armed: boolean } | null = null
  function tabDown(e: PointerEvent, id: HubTab): void {
    tabDrag = { id, x0: e.clientX, armed: false }
  }
  function tabMove(e: PointerEvent): void {
    if (!tabDrag) return
    if (!tabDrag.armed && Math.abs(e.clientX - tabDrag.x0) > 40) tabDrag.armed = true
    if (tabDrag.armed) {
      const done = tabDrag
      tabDrag = null
      onDetach?.(done.id)
    }
  }
  function tabUp(): void {
    tabDrag = null
  }

  const visible = $derived(HUB_TABS.filter((t) => tabs.includes(t.id)))
  const style = $derived(`left:${geo.x}px;top:${geo.y}px;width:${geo.w}px;height:${geo.h}px`)
</script>

<section class="hub" class:dragging class:resizing {style} aria-label="Fenêtre outils">
  <header role="presentation" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
    <span class="grip">⠿</span>
    <nav aria-label="Outils du hub">
      {#each visible as t (t.id)}
        <button
          class:active={active === t.id}
          onclick={() => onTab(t.id)}
          onpointerdown={(e) => tabDown(e, t.id)}
          onpointermove={tabMove}
          onpointerup={tabUp}
          onpointercancel={tabUp}
          title="{t.label} — glisser horizontalement pour détacher en fenêtre"
        >
          <span class="ico">{t.icon}</span><span class="lbl">{t.label}</span>
        </button>
      {/each}
    </nav>
    <button class="close" title="Fermer la fenêtre outils" onclick={onClose}>×</button>
  </header>
  <div class="hub-body">
    {@render children?.()}
  </div>
  <div class="rz e" role="separator" aria-label="Redimensionner E" onpointerdown={(e) => startResize(e, 'e')} onpointermove={move} onpointerup={up}></div>
  <div class="rz s" role="separator" aria-label="Redimensionner S" onpointerdown={(e) => startResize(e, 's')} onpointermove={move} onpointerup={up}></div>
  <div class="rz se" role="separator" aria-label="Redimensionner SE" onpointerdown={(e) => startResize(e, 'se')} onpointermove={move} onpointerup={up}></div>
</section>

<style>
  .hub {
    position: fixed;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
    /* Au-dessus de la fenêtre flottante de l'app (60) et des panneaux dockés (70),
       sous la palette ⌘K (90). */
    z-index: 72;
    overflow: visible;
  }
  .hub.dragging,
  .hub.resizing {
    user-select: none;
    border-color: var(--accent);
  }
  header {
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px 0 10px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--panel) 85%, transparent);
    border-radius: 13px 13px 0 0;
    cursor: grab;
    touch-action: none;
  }
  .hub.dragging header {
    cursor: grabbing;
  }
  .grip {
    opacity: 0.45;
    font-size: 13px;
  }
  nav {
    display: flex;
    gap: 4px;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
  }
  nav button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
    white-space: nowrap;
  }
  nav button:hover {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  nav button.active {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .close {
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 7px;
    background: none;
    color: var(--fg);
    font-size: 15px;
    cursor: pointer;
  }
  .close:hover {
    background: color-mix(in srgb, var(--danger, #ff6b6b) 22%, transparent);
  }
  .hub-body {
    position: relative;
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    border-radius: 0 0 13px 13px;
    overflow: hidden;
  }
  /* Les panneaux invités (fixed chez eux) vivent en absolute dans le hub */
  .hub-body :global(.hubbed) {
    position: absolute !important;
    inset: 0 !important;
    left: 0 !important;
    right: 0 !important;
    top: 0 !important;
    bottom: 0 !important;
    transform: none !important;
    width: auto !important;
    max-height: none !important;
    height: auto !important;
    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    z-index: auto !important;
  }
  .rz {
    position: absolute;
    touch-action: none;
  }
  .rz.e {
    top: 12px;
    right: -3px;
    width: 7px;
    height: calc(100% - 24px);
    cursor: ew-resize;
  }
  .rz.s {
    left: 12px;
    bottom: -3px;
    height: 7px;
    width: calc(100% - 24px);
    cursor: ns-resize;
  }
  .rz.se {
    right: -3px;
    bottom: -3px;
    width: 16px;
    height: 16px;
    cursor: nwse-resize;
  }
  @media (max-width: 720px) {
    nav .lbl {
      display: none;
    }
  }
</style>
