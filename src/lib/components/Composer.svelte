<script lang="ts">
  import { allProviders, type ProviderId } from '../llm'
  import type { CustomProvider } from '../store'
  import ModelPicker from './ModelPicker.svelte'

  let {
    streaming,
    providerId,
    model,
    customs = [],
    onSend,
    onStop,
    onProvider,
    onModel,
  }: {
    streaming: boolean
    providerId: ProviderId
    model: string
    customs?: CustomProvider[]
    onSend: (text: string) => void
    onStop: () => void
    onProvider: (pid: ProviderId) => void
    onModel: (model: string) => void
  } = $props()

  let text = $state('')
  let ta: HTMLTextAreaElement | undefined = $state()

  const providers = $derived(allProviders(customs))
  const hint = $derived(providers.find((p) => p.id === providerId)?.docs ?? '')
  const isCatalog = $derived(providerId === 'openrouter')

  function autosize(): void {
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'
  }

  function submit(): void {
    const t = text.trim()
    if (!t || streaming) return
    onSend(t)
    text = ''
    requestAnimationFrame(autosize)
  }

  function key(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      submit()
    }
  }
</script>

<div class="composer">
  <div class="pickers">
    <select
      value={providerId}
      onchange={(e) => onProvider(e.currentTarget.value)}
      title="Fournisseur"
    >
      {#each providers as p (p.id)}
        <option value={p.id}>{p.custom ? '⭑ ' : ''}{p.label}</option>
      {/each}
    </select>
    {#if isCatalog}
      <div class="picker-model">
        <ModelPicker value={model} onCommit={onModel} />
      </div>
    {:else}
      <select value={model} onchange={(e) => onModel(e.currentTarget.value)} title="Modèle">
        {#each providers.find((p) => p.id === providerId)?.models ?? [] as m (m.id)}
          <option value={m.id}>{m.label}</option>
        {/each}
      </select>
    {/if}
    <span class="hint">{hint}</span>
  </div>
  <div class="inputrow">
    <textarea
      bind:this={ta}
      bind:value={text}
      oninput={autosize}
      onkeydown={key}
      rows="1"
      placeholder="Écris ton message…  (Entrée = envoyer · Maj+Entrée = nouvelle ligne)"
    ></textarea>
    {#if streaming}
      <button class="stop" onclick={onStop} title="Arrêter la génération">■</button>
    {:else}
      <button class="send" onclick={submit} disabled={!text.trim()} title="Envoyer">↑</button>
    {/if}
  </div>
</div>

<style>
  .composer {
    padding: 8px 26px 18px;
    max-width: 900px;
    width: 100%;
    margin: 0 auto;
  }
  .pickers {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .picker-model {
    flex: 1;
    min-width: 0;
    max-width: 340px;
  }
  select {
    font-size: 13px;
    padding: 5px 8px;
    max-width: 200px;
  }
  .hint {
    color: var(--muted);
    font-size: 12px;
    margin-left: auto;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .inputrow {
    display: flex;
    align-items: flex-end;
    gap: 10px;
    background: var(--panel2);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 10px 12px;
    transition: border-color 0.15s;
  }
  .inputrow:focus-within {
    border-color: var(--accent);
  }
  textarea {
    flex: 1;
    background: none;
    border: none;
    resize: none;
    padding: 4px 2px;
    max-height: 180px;
    line-height: 1.5;
  }
  textarea:focus {
    border: none;
  }
  .send,
  .stop {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    font-size: 16px;
    flex-shrink: 0;
  }
  .send {
    background: var(--accent);
    color: #fff;
  }
  .send:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .stop {
    background: var(--danger);
    color: #fff;
    font-size: 12px;
  }
</style>
