<script lang="ts">
  import type { Msg } from '../store'
  import { AGENTS, type AgentId } from '../agents'
  import { renderMarkdown } from '../markdown'

  let { msg }: { msg: Msg } = $props()

  const who = $derived(msg.agent ? AGENTS[msg.agent as AgentId] : null)

  let copied = $state(false)

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(msg.content)
    copied = true
    setTimeout(() => (copied = false), 1200)
  }
</script>

<div class="row" class:user={msg.role === 'user'} class:error={msg.error} class:agent-seeker={msg.agent === 'seeker'}>
  <div class="avatar">{who ? who.emoji : msg.role === 'assistant' ? '⚡' : '🧑'}</div>
  <div class="bubble">
    {#if who}
      <span class="who">{who.emoji} {who.name} · {who.role}</span>
    {/if}
    {#if msg.role === 'assistant'}
      {#if msg.content}
        {@html renderMarkdown(msg.content)}
      {:else}
        <span class="cursor">▍</span>
      {/if}
      {#if msg.content && !msg.error}
        <button class="copy" onclick={copy}>{copied ? '✓ copié' : 'copier'}</button>
      {/if}
    {:else}
      <span class="plain">{msg.content}</span>
    {/if}
  </div>
</div>

<style>
  .row {
    display: flex;
    gap: 12px;
    margin-bottom: 18px;
    max-width: 860px;
  }
  .avatar {
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    border-radius: 9px;
    background: var(--panel2);
    display: grid;
    place-items: center;
    font-size: 15px;
  }
  .bubble {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px 14px;
    min-width: 0;
    overflow-wrap: break-word;
    line-height: 1.55;
    position: relative;
  }
  .agent-seeker .avatar {
    background: color-mix(in srgb, #27c93f 22%, var(--panel2));
  }
  .who {
    display: block;
    font-size: 11px;
    font-family: var(--mono);
    color: var(--muted);
    margin-bottom: 4px;
  }
  .user .bubble {
    background: var(--user-bubble);
  }
  .error .bubble {
    border-color: var(--danger);
    color: #ffb4b4;
  }
  .plain {
    white-space: pre-wrap;
  }
  .cursor {
    display: inline-block;
    animation: blink 1s steps(2) infinite;
    color: var(--accent);
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  .copy {
    position: absolute;
    top: 6px;
    right: 8px;
    font-size: 11px;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 2px 7px;
    opacity: 0;
    transition: 0.12s;
  }
  .row:hover .copy {
    opacity: 1;
  }
  .copy:hover {
    color: var(--text);
  }

  /* rendu markdown */
  .bubble :global(p) {
    margin: 0.35em 0;
  }
  .bubble :global(pre) {
    background: #0d1015;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px;
    overflow-x: auto;
    font-size: 13px;
  }
  .bubble :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.92em;
  }
  .bubble :global(:not(pre) > code) {
    background: #0d1015;
    border-radius: 5px;
    padding: 1px 5px;
  }
  .bubble :global(ul),
  .bubble :global(ol) {
    margin: 0.4em 0;
    padding-left: 1.3em;
  }
  .bubble :global(table) {
    border-collapse: collapse;
    margin: 0.5em 0;
  }
  .bubble :global(th),
  .bubble :global(td) {
    border: 1px solid var(--border);
    padding: 4px 10px;
  }
  .bubble :global(a) {
    color: var(--accent);
  }
</style>
