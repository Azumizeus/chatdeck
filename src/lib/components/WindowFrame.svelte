<script lang="ts">
  // Châssis « IDE premium » : barre de titre macOS à 3 pastilles + slot de contenu.
  // Le drag éventuel est délégué au parent via onDragPointerDown.
  import type { Snippet } from 'svelte'

  let {
    title = 'ChatDeck',
    onClose = () => {},
    onMinimize = () => {},
    onMaximize = () => {},
    draggable = true,
    onDragPointerDown,
    children,
  }: {
    title?: string
    onClose?: () => void
    onMinimize?: () => void
    onMaximize?: () => void
    draggable?: boolean
    onDragPointerDown?: (e: PointerEvent) => void
    children?: Snippet
  } = $props()

  function handlePointerDown(e: PointerEvent): void {
    if ((e.target as HTMLElement).closest('.traffic')) return
    onDragPointerDown?.(e)
  }
</script>

<div class="frame">
  <div
    class="titlebar"
    class:draggable
    onpointerdown={handlePointerDown}
    ondblclick={onMaximize}
    role="banner"
  >
    <div class="traffic">
      <button class="light close" onclick={onClose} title="Fermer" aria-label="Fermer"></button>
      <button class="light minimize" onclick={onMinimize} title="Réduire" aria-label="Réduire"></button>
      <button class="light maximize" onclick={onMaximize} title="Plein écran" aria-label="Plein écran"></button>
    </div>
    <div class="title">{title}</div>
    <div class="right"></div>
  </div>
  <div class="body">
    {@render children?.()}
  </div>
</div>

<style>
  .frame {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
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
    user-select: none;
  }
  .titlebar.draggable {
    cursor: grab;
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
    flex-shrink: 0;
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
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--mono);
    letter-spacing: 0.3px;
  }
  .right {
    min-width: 52px;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
</style>
