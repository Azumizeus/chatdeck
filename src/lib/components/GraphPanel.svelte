<script lang="ts">
  // Panneau Graphify — graphe interactif des conversations, workspaces et liens
  // entre agents. SVG local, zéro dépendance : drag des nœuds (positions persistées),
  // auto-rangement (layout recalculé), zoom, export PNG.
  import { buildGraph, layoutGraph, KIND_COLOR, type GraphNode } from '../graph'
  import { loadGraphLayout, saveGraphLayout, type GraphLayout } from '../store'
  import { organizeGraph, ORGANIZE_LABELS, type OrganizeMode } from '../organize'

  let {
    conversations,
    onClose,
    onOpen,
  }: {
    conversations: { id: string; title: string; model: string; agents?: string[]; sandboxReady?: boolean; incognito?: boolean; messages?: { role: string; content: string; agent?: string; toolEvents?: { tool: string; detail: string }[] }[] }[]
    onClose: () => void
    onOpen: (convId: string) => void
  } = $props()

  let selected = $state<GraphNode | null>(null)
  let workspaceIds = $state<Set<string>>(new Set())
  let zoom = $state(1)
  let pan = $state({ x: 0, y: 0 })
  let dragging = $state(false)
  let dragStart = { x: 0, y: 0 }
  /** Nœud en cours de déplacement + offset pointeur→centre */
  let moving = $state<{ id: string; dx: number; dy: number } | null>(null)

  // Positions persistées (localStorage chatdeck.graph.v1)
  let saved = $state<GraphLayout>(loadGraphLayout())
  /** Mode de rangement auto : par type / par agent / par fraîcheur */
  let organizeMode = $state<OrganizeMode | null>(null)

  const W = 640
  const H = 420

  const graph = $derived(buildGraph(conversations, workspaceIds))

  /**
   * Positions finales : auto-layout, puis recouvrement par les positions
   * manuelles persistées (mode manual ou simple mémorisation de drag).
   */
  const pos = $derived.by(() => {
    // Rangement actif (⌗ choisi) : layout organisé, prioritaire sur tout le reste
    if (organizeMode) return organizeGraph(graph.nodes, organizeMode, W, H)
    const base = layoutGraph(graph, W, H)
    if (saved.mode === 'manual' || Object.keys(saved.pos).length) {
      for (const [id, p] of Object.entries(saved.pos)) {
        if (base.has(id)) base.set(id, p)
      }
    }
    return base
  })

  async function refreshWorkspaces(): Promise<void> {
    try {
      const r = await fetch('/api/sandbox/status')
      const j = (await r.json()) as { workspaces?: { id: string }[] }
      workspaceIds = new Set((j.workspaces ?? []).map((w) => w.id))
    } catch {
      workspaceIds = new Set()
    }
  }

  function persistPos(id: string, p: { x: number; y: number }): void {
    saved = { ...saved, pos: { ...saved.pos, [id]: p }, mode: 'manual' }
    saveGraphLayout(saved)
  }

  function clickNode(n: GraphNode): void {
    selected = n
    if (n.kind === 'conversation') onOpen(n.id)
  }

  function wheel(e: WheelEvent): void {
    e.preventDefault()
    zoom = Math.min(3, Math.max(0.4, zoom * (e.deltaY < 0 ? 1.12 : 0.9)))
  }

  function down(e: PointerEvent): void {
    dragging = true
    dragStart = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }
  function move(e: PointerEvent): void {
    if (moving) {
      // Conversion écran→coordonnées SVG (viewBox 640×420)
      const svg = (e.currentTarget as Element).closest('svg')
      if (!svg) return
      const r = svg.getBoundingClientRect()
      const sx = ((e.clientX - r.left) / r.width) * W
      const sy = ((e.clientY - r.top) / r.height) * H
      const nx = Math.max(20, Math.min(W - 20, (sx - pan.x) / zoom - moving.dx))
      const ny = Math.max(20, Math.min(H - 20, (sy - pan.y) / zoom - moving.dy))
      const p = { x: nx, y: ny }
      pos.set(moving.id, p)
      return
    }
    if (!dragging) return
    pan = { x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }
  }
  function up(): void {
    if (moving) {
      const p = pos.get(moving.id)
      if (p) persistPos(moving.id, p)
      moving = null
    }
    dragging = false
  }

  /** Début de drag d'un nœud (ne déclenche pas le pan du fond). */
  function nodeDown(n: GraphNode, e: PointerEvent): void {
    e.stopPropagation()
    const p = pos.get(n.id) ?? { x: 0, y: 0 }
    const svg = (e.currentTarget as Element).closest('svg')
    let sx = 0
    let sy = 0
    if (svg) {
      const r = svg.getBoundingClientRect()
      sx = ((e.clientX - r.left) / r.width) * W
      sy = ((e.clientY - r.top) / r.height) * H
    }
    moving = { id: n.id, dx: sx - pan.x - p.x, dy: sy - pan.y - p.y }
    selected = n
  }

  /** Auto-rangement : cycle les modes organisés (null → type → agent → recent → null). */
  function autoArrange(): void {
    const cycle: (OrganizeMode | null)[] = [null, 'type', 'agent', 'recent']
    organizeMode = cycle[(cycle.indexOf(organizeMode) + 1) % cycle.length]
    if (organizeMode === null) {
      saved = { pos: {}, mode: 'auto' }
      saveGraphLayout(saved)
    }
  }

  /** Export PNG : sérialise le SVG, le dessine sur un canvas et télécharge. */
  function exportPng(): void {
    const svg = document.querySelector('.graphify svg')
    if (!svg) return
    const xml = new XMLSerializer().serializeToString(svg)
    const img = new Image()
    img.onload = (): void => {
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = W * scale
      canvas.height = H * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg') || '#101418'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        if (!blob) return
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `graphify-${new Date().toISOString().slice(0, 10)}.png`
        a.click()
        URL.revokeObjectURL(a.href)
      }, 'image/png')
    }
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)
  }

  function resetView(): void {
    zoom = 1
    pan = { x: 0, y: 0 }
  }

  $effect(() => {
    void refreshWorkspaces()
  })

  const stats = $derived({
    convs: graph.nodes.filter((n) => n.kind === 'conversation').length,
    workspaces: graph.nodes.filter((n) => n.kind === 'workspace').length,
    agents: graph.nodes.filter((n) => n.kind === 'agent').length,
    links: graph.links.length,
  })
</script>

<aside class="graphify hubbed" aria-label="Graphe des conversations">
  <header>
    <strong>🕸 Graphify</strong>
    <span class="stats">{stats.convs} conv · {stats.workspaces} sandbox · {stats.agents} agents · {stats.links} liens</span>
    <button class="mini" onclick={autoArrange} title="Ranger : cycle Par type → Par agent → Par fraîcheur → libre" class:active={organizeMode !== null}>
      ⌗ {organizeMode ? ORGANIZE_LABELS[organizeMode] : 'ranger'}
    </button>
    <button class="mini" onclick={exportPng} title="Exporter en PNG">⬇ png</button>
    <button class="mini" onclick={resetView} title="Recadrer">⊙</button>
    <button class="mini" onclick={onClose} title="Fermer">×</button>
  </header>

  <div class="stage">
    <svg
      viewBox="0 0 {W} {H}"
      onwheel={wheel}
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointerleave={up}
      role="img"
      aria-label="Graphe conversations — workspaces — agents"
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted)" opacity="0.7" />
        </marker>
      </defs>
      <g transform="translate({pan.x},{pan.y}) scale({zoom})">
        {#each graph.links as l (l.source + '→' + l.target)}
          {@const a = pos.get(l.source)}
          {@const b = pos.get(l.target)}
          {#if a && b}
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              class:deleg={l.source.startsWith('agent:')}
              marker-end="url(#arrow)"
            />
          {/if}
        {/each}
        {#each graph.nodes as n (n.id)}
          {@const p = pos.get(n.id)}
          {#if p}
            <g class="node" class:selected={selected?.id === n.id} transform="translate({p.x},{p.y})" role="button" tabindex="0"
               aria-label="Nœud {n.label}"
               onpointerdown={(e) => nodeDown(n, e)} onpointerup={(e) => e.stopPropagation()}
               onkeydown={(e) => e.key === 'Enter' && clickNode(n)}>
              <circle r={n.kind === 'conversation' ? 14 : 10} fill={KIND_COLOR[n.kind]} opacity="0.9" />
              <circle r={n.kind === 'conversation' ? 14 : 10} fill="none" stroke="var(--border)" />
              <text y={n.kind === 'conversation' ? -20 : -16} text-anchor="middle">{n.label}</text>
              {#if n.kind === 'conversation' && n.detail}
                <text class="detail" y="26" text-anchor="middle">{n.detail}</text>
              {/if}
            </g>
          {/if}
        {/each}
      </g>
    </svg>
    {#if selected}
      <div class="inspector">
        <span class="kind">{selected.kind}</span>
        <strong>{selected.label}</strong>
        {#if selected.detail}<span class="detail">{selected.detail}</span>{/if}
      </div>
    {/if}
  </div>
  <footer>
    <span><i style="background:{KIND_COLOR.conversation}"></i> conversation</span>
    <span><i style="background:{KIND_COLOR.workspace}"></i> workspace</span>
    <span><i style="background:{KIND_COLOR.agent}"></i> agent</span>
    <span class="hint">glisser un nœud = déplacer (persisté) · fond = vue · ⌗ = ranger</span>
  </footer>
</aside>

<style>
  .graphify {
    position: fixed;
    right: 16px;
    bottom: 42px;
    width: min(700px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px;
    background: color-mix(in srgb, var(--panel) 96%, transparent);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(10px);
    z-index: 70;
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  header strong {
    font-size: 13px;
  }
  .stats {
    flex: 1;
    font-size: 11.5px;
    color: var(--muted);
  }
  .mini {
    font-size: 11.5px;
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--muted);
    background: transparent;
    white-space: nowrap;
  }
  .mini:hover,
  .mini.active {
    color: var(--text);
    border-color: var(--accent);
  }
  .stage {
    position: relative;
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    background: radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--accent) 6%, transparent), transparent 70%);
  }
  svg {
    display: block;
    width: 100%;
    height: 380px;
    cursor: grab;
    touch-action: none;
  }
  svg:active {
    cursor: grabbing;
  }
  line {
    stroke: var(--muted);
    stroke-width: 1.2;
    opacity: 0.55;
  }
  line.deleg {
    stroke: #27c93f;
    stroke-dasharray: 4 3;
  }
  .node {
    cursor: grab;
  }
  .node text {
    font-size: 10.5px;
    fill: var(--text);
    pointer-events: none;
    user-select: none;
  }
  .node text.detail {
    font-size: 9px;
    fill: var(--muted);
  }
  .node:hover circle:first-child {
    filter: brightness(1.25);
  }
  .node.selected circle:first-child {
    stroke: var(--text);
    stroke-width: 2;
  }
  .inspector {
    position: absolute;
    left: 10px;
    bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    background: var(--panel2);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 12px;
  }
  .inspector .kind {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--accent);
  }
  .inspector .detail {
    color: var(--muted);
  }
  footer {
    display: flex;
    gap: 12px;
    align-items: center;
    font-size: 11px;
    color: var(--muted);
  }
  footer i {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 4px;
  }
  footer .hint {
    margin-left: auto;
    opacity: 0.75;
  }
</style>
