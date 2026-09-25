// Gestionnaire de layout « IDE premium » : géométrie persistée des panneaux,
// fenêtres popout synchronisées via BroadcastChannel.

import {
  loadLayout,
  saveLayout,
  resetLayout,
  MIN_SIDEBAR,
  MAX_SIDEBAR,
  MIN_SETTINGS,
  MAX_SETTINGS,
  type Layout,
  type PaneGeometry,
} from './store'

export type PanelId = 'sidebar' | 'settings' | 'chat'

export interface PopoutState {
  /** Conversation mise en popout (id) — null si aucune */
  conversationId: string | null
  /** Référence de la fenêtre ouverte */
  win: Window | null
}

const CHANNEL = 'chatdeck-sync-v1'

export class LayoutManager {
  layout = $state<Layout>(loadLayout())
  /** Popouts actifs : panneau → état */
  popouts = $state<Record<PanelId, PopoutState | null>>({ sidebar: null, settings: null, chat: null })
  /** Conversation poussée vers les popouts (diffusée) */
  channel: BroadcastChannel | null = null

  constructor() {
    try {
      this.channel = new BroadcastChannel(CHANNEL)
      this.channel.onmessage = (e: MessageEvent) => this.onMessage(e.data)
    } catch {
      this.channel = null // BroadcastChannel indisponible (vieux navigateurs) : repli silencieux
    }
    window.addEventListener('beforeunload', () => this.closeAllPopouts())
  }

  private onMessage(msg: { type: string; payload?: unknown }): void {
    if (msg.type === 'layout') this.layout = { ...this.layout, ...(msg.payload as Partial<Layout>) }
    if (msg.type === 'popout-closed') {
      const pid = msg.payload as PanelId
      // L'ONGLET principal reçoit la fermeture : il réintégre le panneau en dock
      if (this.popouts[pid]) this.popouts[pid] = null
    }
    if (msg.type === 'popout-registered') {
      const pid = msg.payload as PanelId
      // Le popout confirme son ouverture : on mémorise la conversation
      const st = this.popouts[pid]
      if (st && st.conversationId) this.broadcastConversation(st.conversationId, pid)
    }
  }

  broadcast(kind: string, payload?: unknown): void {
    this.channel?.postMessage({ type: kind, payload })
  }

  broadcastConversation(convId: string | null, panel: PanelId): void {
    this.broadcast('active-conversation', { conversationId: convId, panel })
  }

  broadcastTheme(theme: string): void {
    this.broadcast('theme', { theme })
  }

  /* ---------- redimensionnement ---------- */

  setSidebarWidth(px: number): void {
    this.layout.sidebarWidth = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, Math.round(px)))
    saveLayout(this.layout)
  }

  setSettingsWidth(px: number): void {
    this.layout.settingsWidth = Math.min(MAX_SETTINGS, Math.max(MIN_SETTINGS, Math.round(px)))
    saveLayout(this.layout)
  }

  toggleSidebar(): void {
    this.layout.sidebarCollapsed = !this.layout.sidebarCollapsed
    saveLayout(this.layout)
  }

  toggleSettings(): void {
    this.layout.settingsCollapsed = !this.layout.settingsCollapsed
    saveLayout(this.layout)
  }

  reset(): void {
    this.layout = resetLayout()
  }

  /* ---------- fenêtre principale (dockée / flottante / pill) ---------- */

  get appMode(): 'docked' | 'floating' | 'pill' {
    const m = this.layout.appMode
    return m === 'floating' || m === 'pill' ? m : 'docked'
  }

  setAppMode(m: 'docked' | 'floating' | 'pill'): void {
    this.layout.appMode = m
    saveLayout(this.layout)
  }

  /** Géométrie par défaut de la fenêtre flottante (centrée-haute, bornée au viewport). */
  defaultAppGeo(): PaneGeometry {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800
    const w = Math.min(1120, vw - 96)
    const h = Math.min(720, vh - 96)
    return { x: Math.max(24, (vw - w) / 2), y: Math.max(24, (vh - h) / 3), w, h }
  }

  get appGeo(): PaneGeometry {
    return this.layout.appGeo ?? this.defaultAppGeo()
  }

  setAppGeo(geo: PaneGeometry): void {
    this.layout.appGeo = geo
    saveLayout(this.layout)
  }

  /* ---------- mode duel (deux conversations côte à côte) ---------- */

  get duel(): { left: string; right: string } | null {
    return this.layout.duel ?? null
  }

  get duelSplit(): number {
    return this.layout.duelSplit ?? 50
  }

  startDuel(left: string, right: string): void {
    this.layout.duel = { left, right }
    saveLayout(this.layout)
  }

  stopDuel(): void {
    this.layout.duel = null
    saveLayout(this.layout)
  }

  setDuelSplit(n: number): void {
    this.layout.duelSplit = Math.min(80, Math.max(20, Math.round(n)))
    saveLayout(this.layout)
  }

  /* ---------- popouts ---------- */

  /** Ouvre un popout ; renvoie null si bloqué (popup blocker) → repli en dock. */
  async openPopout(panel: PanelId, conversationId: string | null): Promise<boolean> {
    const geo: PaneGeometry = this.layout.popouts[panel] ?? { x: 120, y: 120, w: 720, h: 560 }
    const features = `popup=yes,width=${geo.w},height=${geo.h},left=${geo.x},top=${geo.y}`
    const win = window.open(`/#popout=${panel}`, `chatdeck-${panel}`, features)
    if (!win) return false
    this.popouts[panel] = { conversationId, win }
    this.layout.popouts[panel] = geo
    saveLayout(this.layout)
    // Surveille la fermeture par l'utilisateur pour réintégrer le panneau
    const watch = setInterval(() => {
      const st = this.popouts[panel]
      if (!st || st.win?.closed) {
        clearInterval(watch)
        this.popouts[panel] = null
        this.broadcast('popout-closed', panel)
      }
    }, 800)
    return true
  }

  closePopout(panel: PanelId): void {
    this.popouts[panel]?.win?.close()
    this.popouts[panel] = null
    this.broadcast('popout-closed', panel)
  }

  closeAllPopouts(): void {
    for (const pid of ['sidebar', 'settings', 'chat'] as PanelId[]) this.closePopout(pid)
  }

  /** Mémorise la géométrie d'un popout à son déplacement/redimensionnement. */
  savePopoutGeometry(panel: PanelId, geo: PaneGeometry): void {
    this.layout.popouts[panel] = geo
    saveLayout(this.layout)
  }
}

/** Singleton partagé : l'onglet principal ET les popouts l'utilisent. */
export const layout = new LayoutManager()
