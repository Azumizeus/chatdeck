// Générateur d'icône ChatDeck — éclair ⚡ sur fond sombre, sans dépendance.
//
// Écrit build/icon.png (512×512) et build/icon.iconset (10 tailles) par
// encodage PNG manuel (chunks IHDR/IDAT/IEND, zlib de node). `npm run dmg`
// convertit l'iconset en icon.icns (iconutil) et electron-builder l'embarque.
//
// Perf : zéro allocation par pixel (précalculs par ligne/colonne, sqrt natif,
// pas de destructuration) — le rendu 1024×1024 complet reste < 2 s.
//
//   node tools/gen-icon.mjs
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const OUT = path.resolve('build')
mkdirSync(OUT, { recursive: true })

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (buf) => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([head, body, crc])
}

/** Écrit un PNG RGBA8 (filtre « none ») d'une fonction pixel(x, y) → rgba. */
function writePng(file, size, fill) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0
    o = fill(raw, o, y)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
  writeFileSync(file, png)
}

/* ── Palette ChatDeck (les couleurs sombres de l'app) ── */
const BG_TOP_R = 26, BG_TOP_G = 29, BG_TOP_B = 41 // #1a1d29
const BG_BOT_R = 13, BG_BOT_G = 15, BG_BOT_B = 20 // #0d0f14 (fond fenêtre)
const HI_R = 255, HI_G = 236, HI_B = 170 // accent clair (haut)
const LO_R = 222, LO_G = 160, LO_B = 40 // accent foncé (bas)
const HALO_R = 51, HALO_G = 46, HALO_B = 40 // mix(BG_TOP, accent, 10 %)

// Éclair : polygone en coordonnées normalisées (u, v) — y vers le bas.
const PX = [0.62, 0.86, 0.68, 0.78, 0.3, 0.48, 0.38]
const PY = [0.1, 0.44, 0.44, 0.9, 0.5, 0.5, 0.1]
const N = PX.length
// Côtés précalculés : dx, dy, (dx²+dy²), pour le point-sur-segment.
const DX = new Float64Array(N)
const DY = new Float64Array(N)
const DD = new Float64Array(N)
for (let i = 0; i < N; i++) {
  const j = (i + 1) % N
  DX[i] = PX[j] - PX[i]
  DY[i] = PY[j] - PY[i]
  DD[i] = DX[i] * DX[i] + DY[i] * DY[i]
}
const EDGE = 0.03 // épaisseur du liseré (normalisée)
const INV_EDGE = 1 / EDGE
const UV_MAX = 1.5 // pivot du dégradé diagonal du jaune

/**
 * Rend l'icône à `size` px. Retourne un remplisseur de ligne (o = offset
 * d'écriture dans le buffer, retourne le nouvel offset) — aucune allocation
 * dans la boucle.
 */
function render(size) {
  const scale = size // 1 unité UV = size px
  const u01 = 1 / size
  const S1 = size // nb de lignes
  // Halo : centre (0.58, 0.5), rayon 0.62
  const HCX = 0.58 * size
  const HCY = 0.5 * size
  const HR = 0.62 * size
  const INV_HR2 = 1 / (HR * HR)
  return (raw, o, y) => {
    const v = (y + 0.5) * u01
    // Dégradé de fond (précalculé pour la ligne)
    const ft = 1 - y / S1
    const bgr = BG_BOT_R + (BG_TOP_R - BG_BOT_R) * ft
    const bgg = BG_BOT_G + (BG_TOP_G - BG_BOT_G) * ft
    const bgb = BG_BOT_B + (BG_TOP_B - BG_BOT_B) * ft
    const dy = y + 0.5 - HCY
    const dy2 = dy * dy
    // Dégradé du jaune : mix(HI, LO, (u+v)/1.5) — partie dépendant de v seule
    const vt = (v / UV_MAX) * size // ajout linéique de v au pivot
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - HCX
      // Halo doux derrière l'éclair
      let r = bgr
      let g = bgg
      let b = bgb
      const hd2 = (dx * dx + dy2) * INV_HR2
      if (hd2 < 1) {
        const h = (1 - hd2) * (1 - hd2) * 0.9
        r += (HALO_R - r) * h
        g += (HALO_G - g) * h
        b += (HALO_B - b) * h
      }
      const u = (x + 0.5) * u01
      // ── test point-in-polygon (ray casting) + distance aux segments ──
      let inside = false
      let best = 1e9
      for (let i = 0; i < N; i++) {
        const j = i === N - 1 ? 0 : i + 1
        const xi = PX[i]
        const yi = PY[i]
        const xj = PX[j]
        const yj = PY[j]
        if (yi > v !== yj > v) {
          // x d'intersection du rayon horizontal avec le côté
          const xv = xi + ((v - yi) * (xj - xi)) / (yj - yi)
          if (u < xv) inside = !inside
        }
        // distance au segment
        let t = ((u - xi) * DX[i] + (v - yi) * DY[i]) * (1 / DD[i])
        if (t < 0) t = 0
        else if (t > 1) t = 1
        const ex = u - (xi + t * DX[i])
        const ey = v - (yi + t * DY[i])
        const d = Math.sqrt(ex * ex + ey * ey)
        if (d < best) best = d
      }
      if (inside) {
        // Dégradé diagonal du jaune (clair haut-gauche → foncé bas-droite)
        let tt = (u * size + vt) / (UV_MAX * size)
        if (tt < 0) tt = 0
        else if (tt > 1) tt = 1
        raw[o++] = HI_R + (LO_R - HI_R) * tt
        raw[o++] = HI_G + (LO_G - HI_G) * tt
        raw[o++] = HI_B + (LO_B - HI_B) * tt
        raw[o++] = 255
      } else if (best <= EDGE) {
        // Liseré clair qui s'estompe dans le fond
        const e = (1 - best * INV_EDGE) * 0.6
        raw[o++] = HI_R + (r - HI_R) * (1 - e)
        raw[o++] = HI_G + (g - HI_G) * (1 - e)
        raw[o++] = HI_B + (b - HI_B) * (1 - e)
        raw[o++] = 255
      } else {
        raw[o++] = r
        raw[o++] = g
        raw[o++] = b
        raw[o++] = 255
      }
    }
    return o
  }
}

// Icône principale + rendu direct de chaque taille (pas un resize : les
// diagonales restent nettes en 16 px comme en 1024).
const ICONSET = path.join(OUT, 'icon.iconset')
mkdirSync(ICONSET, { recursive: true })
for (const s of [16, 32, 64, 128, 256, 512, 1024]) {
  const t = Date.now()
  writePng(path.join(ICONSET, `icon_${s}x${s}.png`), s, render(s))
  if (s <= 512) writePng(path.join(ICONSET, `icon_${s}x${s}@2x.png`), s * 2, render(s * 2))
  console.log(`  ${s}px : ${Date.now() - t} ms`)
}
writePng(path.join(OUT, 'icon.png'), 512, render(512))
console.log('build/icon.png + build/icon.iconset (10 tailles) écrits.')
