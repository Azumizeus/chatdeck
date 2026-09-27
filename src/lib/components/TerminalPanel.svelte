<script lang="ts">
  // Terminal réel du workspace : exécution bornée côté serveur sandbox
  // (spawn sans shell, timeout 60 s, sortie stdout+stderr streamée).
  import { loadTermHeight, saveTermHeight } from '../store'

  let {
    convId,
    onClose,
  }: {
    convId: string
    onClose: () => void
  } = $props()

  /* Redimensionnement : poignée en haut du panneau (docké sous le composer).
   * On règle la hauteur du panneau, persistée entre les sessions. */
  let termH = $state(loadTermHeight())
  let resizing = $state(false)
  let resizeY0 = 0
  let resizeH0 = 0
  function startResize(e: PointerEvent): void {
    resizing = true
    resizeY0 = e.clientY
    resizeH0 = termH
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  function moveResize(e: PointerEvent): void {
    if (!resizing) return
    // Glisser vers le HAUT = agrandit (la poignée est au sommet du panneau)
    termH = Math.max(120, Math.min(720, resizeH0 - (e.clientY - resizeY0)))
  }
  function endResize(): void {
    if (resizing) saveTermHeight(termH)
    resizing = false
  }

  interface Line {
    text: string
    cls?: 'cmd' | 'err'
  }

  let lines = $state<Line[]>([])
  let input = $state('')
  let running = $state(false)
  let bodyEl: HTMLDivElement | undefined = $state()
  let history = $state<string[]>([])
  let historyIx = $state(-1)

  const BINARIES = 'node, npm, npx, ls, cat, pwd, echo, mkdir, touch, rm, cp, mv, git'

  function scrollEnd(): void {
    requestAnimationFrame(() => bodyEl?.scrollTo({ top: bodyEl.scrollHeight }))
  }

  async function run(cmd: string): Promise<void> {
    if (!cmd.trim() || running) return
    running = true
    lines = [...lines, { text: `$ ${cmd}`, cls: 'cmd' }]
    history = [...history, cmd]
    historyIx = history.length
    input = ''
    scrollEnd()
    try {
      const res = await fetch(`/api/sandbox/${convId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        lines = [...lines, { text: j.error ?? `HTTP ${res.status}`, cls: 'err' }]
      } else {
        // Sortie streamée : on découpe au fil de l'arrivée
        const reader = res.body!.getReader()
        const dec = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let nl: number
          while ((nl = buf.indexOf('\n')) >= 0) {
            lines = [...lines, { text: buf.slice(0, nl) }]
            buf = buf.slice(nl + 1)
            scrollEnd()
          }
        }
        if (buf) lines = [...lines, { text: buf }]
      }
    } catch (e) {
      lines = [...lines, { text: (e as Error).message, cls: 'err' }]
    } finally {
      running = false
      scrollEnd()
    }
  }

  function key(e: KeyboardEvent): void {
    if (e.key === 'Enter') void run(input)
    else if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault()
      historyIx = Math.max(0, historyIx - 1)
      input = history[historyIx] ?? ''
    } else if (e.key === 'ArrowDown' && history.length) {
      e.preventDefault()
      historyIx = Math.min(history.length, historyIx + 1)
      input = history[historyIx] ?? ''
    }
  }

  $effect(() => {
    if (!lines.length) {
      lines = [
        { text: `Terminal du workspace — binaires : ${BINARIES}`, cls: 'cmd' },
        { text: 'Timeout 60 s, cwd = racine du workspace. ex. : node src/main.js' },
      ]
    }
  })
</script>

<aside class="term" style="height:{termH}px" aria-label="Terminal du workspace">
  <!-- Poignée de redimensionnement (haut du panneau quand docké sous le composer) -->
  <div
    class="grip"
    role="separator"
    aria-label="Redimensionner le terminal"
    title="Glisser pour redimensionner"
    onpointerdown={startResize}
    onpointermove={moveResize}
    onpointerup={endResize}
    onpointercancel={endResize}
  ></div>
  <header>
    <strong>⌨︎ Terminal</strong>
    <span class="mono">{convId.slice(0, 10)}…</span>
    <button class="mini" onclick={onClose} title="Fermer">×</button>
  </header>
  <div class="body" bind:this={bodyEl}>
    {#each lines as l, i (i)}
      <div class="line {l.cls ?? ''}">{l.text}</div>
    {/each}
    {#if running}
      <div class="line running">▍ en cours…</div>
    {/if}
  </div>
  <div class="inputrow">
    <span class="prompt">$</span>
    <input
      bind:value={input}
      onkeydown={key}
      placeholder={running ? 'en cours…' : 'node src/main.js'}
      disabled={running}
      aria-label="Commande"
    />
  </div>
</aside>

<style>
  .term {
    position: fixed;
    left: 16px;
    bottom: 42px;
    width: min(560px, calc(100vw - 32px));
    /* hauteur pilotée par la poignée (persistée) ; .term-docked la borne */
    height: 300px;
    display: flex;
    flex-direction: column;
    background: #0d1015;
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5);
    z-index: 70;
    overflow: hidden;
  }
  .grip {
    position: absolute;
    top: -3px;
    left: 12px;
    right: 12px;
    height: 7px;
    cursor: ns-resize;
    touch-action: none;
    z-index: 3;
  }
  .grip:hover {
    background: color-mix(in srgb, var(--accent) 35%, transparent);
    border-radius: 4px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: color-mix(in srgb, var(--panel) 92%, transparent);
    border-bottom: 1px solid var(--border);
  }
  header strong {
    flex: 1;
    font-size: 13px;
  }
  .mono {
    font-size: 11px;
    color: var(--muted);
    font-family: var(--mono);
  }
  .mini {
    font-size: 13px;
    padding: 1px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--muted);
    background: none;
  }
  .mini:hover {
    color: var(--text);
    border-color: var(--accent);
  }
  .body {
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 1.5;
  }
  .line {
    white-space: pre-wrap;
    color: #cfe3c8;
  }
  .line.cmd {
    color: var(--accent);
    margin-top: 4px;
  }
  .line.err {
    color: #ffb4b4;
  }
  .line.running {
    color: var(--muted);
    animation: blink 1s steps(2) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.3;
    }
  }
  .inputrow {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    background: color-mix(in srgb, var(--panel) 88%, transparent);
  }
  .prompt {
    color: var(--accent);
    font-family: var(--mono);
    font-weight: bold;
  }
  .inputrow input {
    flex: 1;
    font-family: var(--mono);
    font-size: 13px;
    background: none;
    border: none;
    color: var(--text);
  }
  .inputrow input:focus {
    outline: none;
  }
</style>
