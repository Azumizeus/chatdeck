import { describe, expect, it } from 'vitest'
import {
  SNAP_ZONES,
  beyondTrigger,
  resizeGeo,
  snapCycle,
  snapForPointer,
  zoneRect,
  MIN_H,
  MIN_W,
  type Dir,
  type ResizeSpec,
} from './float.svelte'

const VW = 1280
const VH = 800

/** Fabrique une spécification de resize depuis une géométrie de départ. */
function spec(dir: Dir, start = { x: 100, y: 100, w: 500, h: 400 }, cx = 0, cy = 0): ResizeSpec {
  return { dir, start, startX: start.x, startY: start.y, vw: VW, vh: VH }
}

describe('resizeGeo — redimensionnement 8 directions', () => {
  it('le bord Est agrandit la largeur sans bouger x', () => {
    const g = resizeGeo(spec('e'), 200, 0)
    expect(g.x).toBe(100)
    expect(g.w).toBe(600)
  })

  it('le bord Ouest bouge x et compense la largeur', () => {
    const g = resizeGeo(spec('w', { x: 100, y: 100, w: 500, h: 400 }, 100, 100), 40, 0)
    expect(g.x).toBe(40)
    expect(g.w).toBe(560) // 100 - 40 ajoutés au bord gauche
  })

  it('le coin Sud-Est agrandit largeur et hauteur', () => {
    // curseur de (100,100) → (220,220) : dx = dy = 120
    const g = resizeGeo(spec('se'), 220, 220)
    expect(g.w).toBe(620)
    expect(g.h).toBe(520)
  })

  it('le coin Nord-Ouest bouge x, y, w et h ensemble', () => {
    const g = resizeGeo(spec('nw', { x: 100, y: 100, w: 500, h: 400 }, 100, 100), 60, 80)
    expect(g.x).toBe(60)
    expect(g.y).toBe(80)
    expect(g.w).toBe(540)
    expect(g.h).toBe(420)
  })

  it('les minima sont ancrés sur le bord opposé (Ouest)', () => {
    // Drag Ouest très loin vers la droite : la largeur ne passe jamais sous MIN_W
    const g = resizeGeo(spec('w', { x: 100, y: 100, w: 500, h: 400 }, 100, 100), 590, 0)
    expect(g.w).toBe(MIN_W)
    expect(g.x).toBe(100 + 500 - MIN_W)
  })

  it('les minima sont ancrés sur le bord opposé (Nord)', () => {
    const g = resizeGeo(spec('n', { x: 100, y: 100, w: 500, h: 400 }, 100, 100), 0, 590)
    expect(g.h).toBe(MIN_H)
    expect(g.y).toBe(100 + 400 - MIN_H)
  })

  it('la fenêtre ne sort jamais du viewport à droite', () => {
    const g = resizeGeo(spec('e', { x: 1000, y: 0, w: 200, h: 400 }, 1000, 0), 2000, 0)
    expect(g.x + g.w).toBeLessThanOrEqual(VW)
  })

  it('la fenêtre ne sort jamais du viewport en bas', () => {
    const g = resizeGeo(spec('s', { x: 0, y: 700, w: 400, h: 80 }, 0, 700), 0, 2000)
    expect(g.y + g.h).toBeLessThanOrEqual(VH)
  })
})

describe('snapForPointer — détection de zone', () => {
  it('les quatre coins déclenchent les quatre quarters', () => {
    expect(snapForPointer(10, 10, VW, VH)).toBe('tl')
    expect(snapForPointer(VW - 10, 10, VW, VH)).toBe('tr')
    expect(snapForPointer(10, VH - 10, VW, VH)).toBe('bl')
    expect(snapForPointer(VW - 10, VH - 10, VW, VH)).toBe('br')
  })

  it('les bords déclenchent moitiés et plein écran', () => {
    expect(snapForPointer(10, 400, VW, VH)).toBe('left')
    expect(snapForPointer(VW - 10, 400, VW, VH)).toBe('right')
    expect(snapForPointer(640, 10, VW, VH)).toBe('maximize')
    expect(snapForPointer(640, VH - 10, VW, VH)).toBe('bottom')
  })

  it('le centre du viewport ne déclenche rien', () => {
    expect(snapForPointer(640, 400, VW, VH)).toBeNull()
  })
})

describe('snapCycle — progression des zones', () => {
  it('le bord gauche cycle quart → moitié → quart → plein écran', () => {
    expect(snapCycle('left')).toEqual(['tl', 'left', 'bl', 'maximize'])
  })

  it('le bord haut propose les deux quarters du haut, la moitié haute et le plein écran', () => {
    expect(snapCycle('top')).toEqual(['tl', 'top', 'tr', 'maximize'])
  })

  it('une zone terminale ne cycle pas sur elle-même', () => {
    expect(snapCycle('maximize')).toEqual(['maximize'])
  })

  it('toutes les zones de chaque cycle existent dans SNAP_ZONES', () => {
    const keys = new Set(SNAP_ZONES.map((z) => z.key))
    for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
      for (const e of snapCycle(edge)) expect(keys.has(e)).toBe(true)
    }
  })
})

describe('zoneRect — géométrie des zones', () => {
  it('le quart haut-gauche occupe un quart moins les marges', () => {
    expect(zoneRect('tl', VW, VH)).toEqual({ x: 8, y: 8, w: VW / 2 - 12, h: VH / 2 - 12 })
  })

  it('la moitié droite commence au centre', () => {
    const r = zoneRect('right', VW, VH)
    expect(r.x).toBe(VW / 2 + 4)
    expect(r.w).toBe(VW / 2 - 12)
    expect(r.h).toBe(VH - 16)
  })

  it('le plein écran laisse une marge de 8 px', () => {
    expect(zoneRect('maximize', VW, VH)).toEqual({ x: 8, y: 8, w: VW - 16, h: VH - 16 })
  })

  it('tous les rects de snap restent dans le viewport', () => {
    for (const z of SNAP_ZONES) {
      const r = z.rect(VW, VH)
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.x + r.w).toBeLessThanOrEqual(VW)
      expect(r.y + r.h).toBeLessThanOrEqual(VH)
    }
  })
})

describe('beyondTrigger — enfoncement pour le cycle', () => {
  it('le bord gauche cycle quand le pointeur descend sous la moitié du seuil', () => {
    expect(beyondTrigger(5, 400, VW, VH, 'left')).toBe(true)
    expect(beyondTrigger(20, 400, VW, VH, 'left')).toBe(false)
  })

  it('le bord haut (plein écran) cycle sur l’axe vertical', () => {
    expect(beyondTrigger(640, 2, VW, VH, 'maximize')).toBe(true)
    expect(beyondTrigger(640, 20, VW, VH, 'maximize')).toBe(false)
  })

  it('les quarters ne cyclent pas', () => {
    expect(beyondTrigger(1, 1, VW, VH, 'tl')).toBe(false)
  })
})
