<script lang="ts">
  // Fenêtre flottante : drag par la barre de titre, resize 8 directions par poignées,
  // snap aux zones (moitiés, quarters, plein écran) avec ghost outline animé 150 ms.
  // Le snap cycle : maintenir le pointeur au-delà du seuil fait avancer la zone
  // (coin → quart → moitié → quart → plein écran).
  import type { Snippet } from 'svelte'
  import { fade } from 'svelte/transition'
  import { resizeGeo, snapForPointer, snapCycle, zoneRect, beyondTrigger, MIN_W, type Dir, type Edge } from '../float.svelte'
  import type { PaneGeometry } from '../store'

  let {
    geo,
    title,
    snapHint = true,
    onGeo,
    onSnap,
    onRestore,
    onMinimize,
    children,
  }: {
    geo: PaneGeometry
    title: string
    onGeo: (g: PaneGeometry) => void
    /** Snap demandé : le parent reçoit le rect cible + la zone (moitié/quarter/plein écran) */
    onSnap: (rect: PaneGeometry, edge: Edge) => void
    onRestore: () => void
    /** Bouton jaune : réduire en pill (barre de tâches) */
    onMinimize?: () => void
    snapHint?: boolean
    children?: Snippet
  } = $props()

  // Capture initiale assumée : resynchro via $effect quand le parent snappe
  // svelte-ignore state_referenced_locally
  let local = $state<PaneGeometry>({ ...geo })
  let dragging = $state(false)
  let resizing = $state<Dir | null>(null)
  /** Ghost outline de la zone de snap ciblée */
  let ghost = $state<{ x: number; y: number; w: number; h: number } | null>(null)
  let maximized = $state(false)
  let restoreGeo = $state<PaneGeometry | null>(null)
  /** Animation 150 ms quand la géométrie est pilotée de l'extérieur (snap) */
  let anim = $state(false)

  // Resynchro assumée quand la prop geo change (snap piloté par le parent)
  // svelte-ignore state_referenced_locally
  $effect(() => {
    local = { ...geo }
    maximized = false
    anim = true
    const t = setTimeout(() => (anim = false), 170)
    return () => clearTimeout(t)
  })

  const CURSORS: Record<Dir, string> = {
    n: 'ns-resize',
    s: 'ns-resize',
    e: 'ew-resize',
    w: 'ew-resize',
    ne: 'nesw-resize',
    sw: 'nesw-resize',
    nw: 'nwse-resize',
    se: 'nwse-resize',
  }

  const EDGES: Dir[] = ['n', 's', 'e', 'w']
  const CORNERS: Dir[] = ['ne', 'nw', 'se', 'sw']

  function vw(): number {
    return window.innerWidth
  }
  function vh(): number {
    return window.innerHeight
  }

  /* ---------- déplacement + snap 8 directions (cycle) ---------- */

  function startDrag(e: PointerEvent): void {
    if ((e.target as HTMLElement).closest('.traffic')) return
    e.preventDefault()
    dragging = true
    const startX = e.clientX
    const startY = e.clientY
    const origin = { ...local }
    let pendingEdge: Edge | null = null
    let cycle: Edge[] | null = null
    let cycleIx = 0
    let beyond = false

    const move = (ev: PointerEvent): void => {
      const nx = Math.min(vw() - MIN_W / 2, Math.max(-origin.w + MIN_W / 2, origin.x + ev.clientX - startX))
      const ny = Math.min(vh() - 40, Math.max(0, origin.y + ev.clientY - startY))
      local = { ...local, x: Math.round(nx), y: Math.round(ny) }
      if (snapHint) {
        const edge = snapForPointer(ev.clientX, ev.clientY, vw(), vh())
        if (edge !== pendingEdge) {
          // Nouvelle zone touchée : on repart au début du cycle
          pendingEdge = edge
          cycle = edge ? snapCycle(edge) : null
          cycleIx = 0
          beyond = false
        } else if (edge && cycle && cycle.length > 1) {
          // Pointeur repoussé au-delà du seuil → zone suivante du cycle
          const nowBeyond = beyondTrigger(ev.clientX, ev.clientY, vw(), vh(), edge)
          if (nowBeyond && !beyond) cycleIx = (cycleIx + 1) % cycle.length
          beyond = nowBeyond
        }
        ghost = pendingEdge && cycle ? zoneRect(cycle[cycleIx], vw(), vh()) : null
      }
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      dragging = false
      if (pendingEdge && cycle) {
        const edge = cycle[cycleIx]
        const target = zoneRect(edge, vw(), vh())
        ghost = null
        onSnap(target, edge)
        return
      }
      onGeo({ ...local })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* ---------- resize 8 directions ---------- */

  function startResize(dir: Dir, e: PointerEvent): void {
    e.preventDefault()
    e.stopPropagation()
    resizing = dir
    const spec = { dir, start: { ...local }, startX: e.clientX, startY: e.clientY, vw: vw(), vh: vh() }
    const move = (ev: PointerEvent): void => {
      local = resizeGeo(spec, ev.clientX, ev.clientY)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      resizing = null
      onGeo({ ...local })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* ---------- plein écran ---------- */

  function toggleMax(): void {
    if (maximized && restoreGeo) {
      local = { ...restoreGeo }
      maximized = false
      onGeo({ ...local })
    } else {
      restoreGeo = { ...local }
      local = { x: 8, y: 8, w: vw() - 16, h: vh() - 16 }
      maximized = true
      onGeo({ ...local })
    }
  }

  const style = $derived(
    maximized
      ? 'left:8px;top:8px;width:calc(100vw - 16px);height:calc(100vh - 16px)'
      : `left:${local.x}px;top:${local.y}px;width:${local.w}px;height:${local.h}px`,
  )
</script>

<!-- Ghost de snap : racine séparée, fixed, sous la fenêtre (z-index 55 < 60) -->
{#if ghost}
  <div
    class="ghost"
    style="left:{ghost.x}px;top:{ghost.y}px;width:{ghost.w}px;height:{ghost.h}px"
    transition:fade={{ duration: 150 }}
  ></div>
{/if}

<div class="float-win" class:dragging class:resizing class:maximized class:anim {style} role="dialog" aria-label={title}>
  <div class="titlebar" role="presentation" onpointerdown={startDrag} ondblclick={toggleMax}>
    <div class="traffic">
      <button class="light close" title="Revenir en fenêtre ancrée" aria-label="Revenir en fenêtre ancrée" onclick={onRestore}></button>
      <button class="light minimize" title="Réduire en pill (barre de tâches)" aria-label="Réduire en pill" onclick={() => onMinimize?.()}></button>
      <button class="light maximize" title="Plein écran (ou double-clic sur la barre)" aria-label="Plein écran" onclick={toggleMax}></button>
    </div>
    <div class="title">{title}</div>
    <div class="right"></div>
  </div>

  <div class="body">
    {@render children?.()}
  </div>

  <!-- Poignées de resize : 4 bords + 4 coins (pointer events, mutuellement exclusives) -->
  {#each EDGES as d (d)}
    <div
      class="h edge {d}"
      style="cursor:{CURSORS[d]}"
      role="separator"
      aria-label="Redimensionner {d.toUpperCase()}"
      onpointerdown={(e) => startResize(d, e)}
    ></div>
  {/each}
  {#each CORNERS as d (d)}
    <div
      class="h corner {d}"
      style="cursor:{CURSORS[d]}"
      role="separator"
      aria-label="Redimensionner {d.toUpperCase()}"
      onpointerdown={(e) => startResize(d, e)}
    ></div>
  {/each}
</div>

<style>
  .ghost {
    position: fixed;
    border: 2px dashed var(--accent);
    border-radius: 14px;
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    z-index: 55;
    pointer-events: none;
  }
  .float-win {
    position: fixed;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
    overflow: visible;
    z-index: 60;
    transition: border-color var(--anim) ease;
    min-width: 0;
    min-height: 0;
  }
  .float-win.dragging,
  .float-win.resizing {
    border-color: var(--accent);
    user-select: none;
  }
  .float-win.anim:not(.dragging):not(.resizing) {
    transition:
      left 150ms ease,
      top 150ms ease,
      width 150ms ease,
      height 150ms ease,
      border-color var(--anim) ease;
  }
  .titlebar {
    height: 36px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    background: color-mix(in srgb, var(--panel) 85%, transparent);
    border-bottom: 1px solid var(--border);
    backdrop-filter: blur(8px);
    border-radius: 13px 13px 0 0;
    cursor: grab;
    user-select: none;
  }
  .titlebar:active {
    cursor: grabbing;
  }
  .traffic {
    display: flex;
    gap: 8px;
  }
  .light {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1px solid rgba(0, 0, 0, 0.25);
    padding: 0;
  }
  .light.close {
    background: #ff5f56;
  }
  .light.minimize {
    background: #ffbd2e;
  }
  .light.maximize {
    background: #27c93f;
  }
  .light:hover {
    filter: brightness(1.2);
  }
  .title {
    flex: 1;
    text-align: center;
    font-size: 12.5px;
    color: var(--muted);
    font-family: var(--mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .right {
    min-width: 52px;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-radius: 0 0 13px 13px;
    overflow: hidden;
  }
  /* Poignées invisibles mais exclusives */
  .h {
    position: absolute;
    z-index: 70;
  }
  .edge.n,
  .edge.s {
    left: 10px;
    right: 10px;
    height: 6px;
  }
  .edge.n {
    top: -3px;
  }
  .edge.s {
    bottom: -3px;
  }
  .edge.e,
  .edge.w {
    top: 10px;
    bottom: 10px;
    width: 6px;
  }
  .edge.e {
    right: -3px;
  }
  .edge.w {
    left: -3px;
  }
  .corner {
    width: 14px;
    height: 14px;
    z-index: 71;
  }
  .corner.ne {
    top: -5px;
    right: -5px;
  }
  .corner.nw {
    top: -5px;
    left: -5px;
  }
  .corner.se {
    bottom: -5px;
    right: -5px;
  }
  .corner.sw {
    bottom: -5px;
    left: -5px;
  }
  .h:hover {
    background: color-mix(in srgb, var(--accent) 45%, transparent);
    border-radius: 3px;
  }
</style>
