// Moteur de fenêtre flottante : déplacement, redimensionnement 8 directions
// et snap aux zones (bords, moitiés, quarters, plein écran) — pointer events natifs.

import type { PaneGeometry } from './store'

export type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export type Edge =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'maximize'
  | 'tl'
  | 'tr'
  | 'bl'
  | 'br'

export interface SnapZone {
  key: Edge
  label: string
  rect: (vw: number, vh: number) => PaneGeometry
}

/** Marges intérieures appliquées aux rects de snap. */
const INSET = 8

/** Zones de snap : 4 moitiés, 4 quarters, plein écran — déclenchées bords ou coins. */
export const SNAP_ZONES: SnapZone[] = [
  { key: 'left', label: 'Moitié gauche', rect: (vw, vh) => ({ x: INSET, y: INSET, w: vw / 2 - INSET - 4, h: vh - INSET * 2 }) },
  { key: 'right', label: 'Moitié droite', rect: (vw, vh) => ({ x: vw / 2 + 4, y: INSET, w: vw / 2 - INSET - 4, h: vh - INSET * 2 }) },
  { key: 'top', label: 'Moitié haute', rect: (vw, vh) => ({ x: INSET, y: INSET, w: vw - INSET * 2, h: vh / 2 - INSET - 4 }) },
  { key: 'bottom', label: 'Moitié basse', rect: (vw, vh) => ({ x: INSET, y: vh / 2 + 4, w: vw - INSET * 2, h: vh / 2 - INSET - 4 }) },
  { key: 'maximize', label: 'Plein écran', rect: (vw, vh) => ({ x: INSET, y: INSET, w: vw - INSET * 2, h: vh - INSET * 2 }) },
  { key: 'tl', label: 'Quart haut-gauche', rect: (vw, vh) => ({ x: INSET, y: INSET, w: vw / 2 - INSET - 4, h: vh / 2 - INSET - 4 }) },
  { key: 'tr', label: 'Quart haut-droit', rect: (vw, vh) => ({ x: vw / 2 + 4, y: INSET, w: vw / 2 - INSET - 4, h: vh / 2 - INSET - 4 }) },
  { key: 'bl', label: 'Quart bas-gauche', rect: (vw, vh) => ({ x: INSET, y: vh / 2 + 4, w: vw / 2 - INSET - 4, h: vh / 2 - INSET - 4 }) },
  { key: 'br', label: 'Quart bas-droit', rect: (vw, vh) => ({ x: vw / 2 + 4, y: vh / 2 + 4, w: vw / 2 - INSET - 4, h: vh / 2 - INSET - 4 }) },
]

/** Seuil de déclenchement du snap (px du bord / coin vers la zone). */
const SNAP_TRIGGER = 34
export const MIN_W = 420
export const MIN_H = 320

export interface ResizeSpec {
  dir: Dir
  /** Départ : géométrie + position pointeur */
  start: PaneGeometry
  startX: number
  startY: number
  /** Bounding box autorisée */
  vw: number
  vh: number
}

/** Applique un delta de resize 8 directions à une géométrie de départ (sans snap). */
export function resizeGeo(spec: ResizeSpec, cx: number, cy: number): PaneGeometry {
  const { dir, start } = spec
  let { x, y, w, h } = start
  const dx = cx - spec.startX
  const dy = cy - spec.startY

  if (dir.includes('e')) w = start.w + dx
  if (dir.includes('s')) h = start.h + dy
  if (dir.includes('w')) {
    w = start.w - dx
    x = start.x + dx
  }
  if (dir.includes('n')) {
    h = start.h - dy
    y = start.y + dy
  }

  // Minimaux : ancre le bord opposé
  if (w < MIN_W) {
    if (dir.includes('w')) x -= MIN_W - w
    w = MIN_W
  }
  if (h < MIN_H) {
    if (dir.includes('n')) y -= MIN_H - h
    h = MIN_H
  }
  // Maximaux : reste dans le viewport
  if (x < 0) {
    w += x
    x = 0
  }
  if (y < 0) {
    h += y
    y = 0
  }
  if (x + w > spec.vw) w = spec.vw - x
  if (y + h > spec.vh) h = spec.vh - y
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
}

/** Zone de snap suggérée pour un pointeur : bords → moitiés, coins → quarters, bord haut → plein écran. */
export function snapForPointer(cx: number, cy: number, vw: number, vh: number): Edge | null {
  const t = SNAP_TRIGGER
  const nearL = cx <= t
  const nearR = cx >= vw - t
  const nearT = cy <= t
  const nearB = cy >= vh - t
  // Priorité aux coins : quarters
  if (nearL && nearT) return 'tl'
  if (nearR && nearT) return 'tr'
  if (nearL && nearB) return 'bl'
  if (nearR && nearB) return 'br'
  // Bords : moitiés (haut = plein écran)
  if (nearT) return 'maximize'
  if (nearB) return 'bottom'
  if (nearL) return 'left'
  if (nearR) return 'right'
  return null
}

/** Toutes les zones touchées par un bord/coin donné, triées de la plus prioritaire
 *  (bord pur) à la plus large (plein écran) — pour le cycle de snap. */
export function snapCycle(edge: Edge): Edge[] {
  switch (edge) {
    case 'left':
      return ['tl', 'left', 'bl', 'maximize']
    case 'right':
      return ['tr', 'right', 'br', 'maximize']
    case 'top':
      return ['tl', 'top', 'tr', 'maximize']
    case 'bottom':
      return ['bl', 'bottom', 'br', 'maximize']
    default:
      return [edge]
  }
}

export function zoneRect(edge: Edge, vw: number, vh: number): PaneGeometry {
  return (SNAP_ZONES.find((z) => z.key === edge) ?? SNAP_ZONES[4]).rect(vw, vh)
}

/** Vrai si le pointeur a été enfoncé au-delà de la moitié du seuil vers l'extérieur —
 *  utilisé pour faire avancer le cycle de snap (quart → moitié → plein écran). */
export function beyondTrigger(cx: number, cy: number, vw: number, vh: number, edge: Edge): boolean {
  const t = SNAP_TRIGGER / 2
  switch (edge) {
    case 'left':
      return cx <= t
    case 'right':
      return cx >= vw - t
    case 'top':
    case 'maximize':
      return cy <= t
    case 'bottom':
      return cy >= vh - t
    default:
      return false // les quarters ne cyclent pas
  }
}
