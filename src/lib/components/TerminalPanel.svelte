<script lang="ts">
  // Terminal réel du workspace : exécution bornée côté serveur sandbox
  // (spawn sans shell, timeout 60 s, sortie stdout+stderr streamée).
  let {
    convId,
    onClose,
  }: {
    convId: string
    onClose: () => void
  } = $props()

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

<aside class="term" aria-label="Terminal du workspace">
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
