#!/usr/bin/env node
/**
 * pdftotext.mjs — un « pdftotext » maison, en Node, sans poppler.
 *
 * Pourquoi ne pas simplement `brew install poppler` ? Parce que poppler tire
 * plus de 30 dépendances natives (libpng, libtiff, openjpeg, fontconfig…) et
 * que l'install a dépassé 10 minutes ici. Or StudyVault n'a besoin que d'une
 * chose : convertir un PDF en texte. pdfjs-dist fait ça très bien, en pur JS.
 *
 * On respecte l'interface de poppler pour que les skills existants qui
 * appellent `pdftotext "in.pdf" "out.txt"` fonctionnent sans les réécrire.
 *
 * Usage
 *   node pdftotext.mjs source.pdf out.txt
 *   node pdftotext.mjs source.pdf -            # vers stdout
 *   node pdftotext.mjs source.pdf out.txt -f 5 -l 12   # pages 5 à 12
 *   node pdftotext.mjs source.pdf out.txt -layout      # préserve la mise en page
 *   node pdftotext.mjs --probe source.pdf            # info rapide, sans écriture
 */

import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require_ = createRequire(import.meta.url)

/* ── args ────────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2)
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`)
  return i === -1 ? d : argv[i + 1]
}
const has = (n) => argv.includes(`--${n}`)

/**
 * poppler s'appelle avec des flags courts (`-layout`, `-f 5`, `-l 12`). On les
 * normalise en flags longs, sinon `2` serait interprété comme un nom de
 * fichier — bug silencieux et_specifiquement_piégeux.
 */
const SHORT = { '-layout': '--layout', '-f': '--f', '-l': '--l', '-enc': '--enc', '-r': '--r', '-nopgbrk': '--nopgbrk' }
for (let i = 0; i < argv.length; i++) {
  if (SHORT[argv[i]]) argv[i] = SHORT[argv[i]]
}

const flagArgs = new Set(['f', 'l', 'layout', 'r', 'nopgbrk', 'enc'])
const positional = argv.filter((a, i) => {
  if (a.startsWith('--')) return false
  if (a === '-') return true // « - » = stdout
  const prev = argv[i - 1]
  if (prev?.startsWith('--') && flagArgs.has(prev.slice(2))) return false
  return true
})

const [inPath, outArg] = positional
const layout = has('layout')
const first = Number(flag('f', 1)) || 1
const last = Number(flag('l', Infinity))

if (!inPath) {
  console.error('usage: pdftotext.mjs <source.pdf> [out.txt|-] [--layout] [-f N] [-l N] [--probe]')
  process.exit(2)
}

const input = resolve(inPath.replace(/^~/, process.env.HOME))
const out = !outArg || outArg === '-' ? null : resolve(outArg)

/* ── chargement pdfjs ────────────────────────────────────────────────────── */

// pdfjs-dist est ESM sous `legacy/build/pdf.mjs` ; on tente les deux chemins.
async function loadPdfjs() {
  const candidates = ['pdfjs-dist/legacy/build/pdf.mjs', 'pdfjs-dist/build/pdf.mjs']
  let lastErr
  for (const c of candidates) {
    try {
      return await import(c)
    } catch (e) {
      lastErr = e
    }
  }
  throw new Error(
    `pdfjs-dist introuvable. Lance : npm install pdfjs-dist\n(${lastErr?.message ?? 'cause inconnue'})`,
  )
}

let pdfjs
try {
  pdfjs = await loadPdfjs()
} catch (e) {
  console.error(`✗ ${e.message}`)
  process.exit(3)
}

// En Node il n'y a pas de DOM : on neutralise les alertes de worker.
pdfjs.GlobalWorkerOptions.workerSrc = pdfjs.GlobalWorkerOptions.workerSrc ?? ''

/**
 * pdfjs-dist v4 n'expose plus `setVerbosityLevel`, et ses warnings de police
 * (« Warning: TT: undefined function: 32 ») partent à chaque page. Ils sont
 * sans effet sur l'extraction mais polluent la sortie d'un outil censé être un
 * remplaçant de poppler. On les absorbe — et uniquement eux.
 *
 * pdf.js utilise `console.log` (donc stdout), pas `console.stderr.write` :
 * il faut intercepter les deux, sinon le filtre ne voit rien passer.
 */
// Tous les diagnostics de pdf.js sont préfixés « Warning: ». Nos propres
// messages, eux, commencent par ✗ ou ⚠ — ils ne sont donc jamais avalés.
const NOISE = /^\s*Warning: /
async function quietly(fn) {
  const realErr = process.stderr.write.bind(process.stderr)
  const realLog = console.log

  const keep = (s) => !NOISE.test(s)
  process.stderr.write = (chunk, ...rest) => (keep(String(chunk)) ? realErr(chunk, ...rest) : true)
  console.log = (...a) => {
    if (!keep(a.map(String).join(' '))) return
    realLog(...a)
  }

  try {
    return await fn()
  } finally {
    process.stderr.write = realErr
    console.log = realLog
  }
}

/* ── extraction ──────────────────────────────────────────────────────────── */

let data
try {
  data = new Uint8Array(await readFile(input))
} catch (e) {
  if (e.code === 'ENOENT') {
    console.error(`✗ fichier introuvable : ${input}`)
    process.exit(1)
  }
  if (e.code === 'EISDIR') {
    console.error(`✗ ${input} est un répertoire, pas un PDF`)
    process.exit(1)
  }
  throw e
}
let doc
try {
  doc = await quietly(() =>
    pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise,
  )
} catch (e) {
  console.error(`✗ PDF illisible : ${basename(input)} — ${e.message}`)
  process.exit(1)
}

if (has('probe')) {
  const meta = await doc.getMetadata().catch(() => ({}))
  const info = meta.info ?? {}
  console.log(`pages   : ${doc.numPages}`)
  console.log(`titre   : ${info.Title ?? '—'}`)
  console.log(`auteur  : ${info.Author ?? '—'}`)
  console.log(`créé    : ${info.CreationDate ?? '—'}`)
  process.exit(0)
}

/** Assemble les items de contenu d'une page en lignes, avec un peu d'intelligence. */
function pageText(content) {
  if (layout) {
    // -layout : on se fie aux positions y pour reconstruire les colonnes.
    const rows = new Map()
    for (const item of content.items) {
      if (!item.str) continue
      const y = Math.round(item.transform[5])
      if (!rows.has(y)) rows.set(y, [])
      rows.get(y).push({ x: item.transform[4], str: item.str })
    }
    return [...rows.entries()]
      .sort((a, b) => b[0] - a[0]) // pdf.js a y décroissant vers le bas
      .map(([, parts]) =>
        parts
          .sort((a, b) => a.x - b.x)
          .map((p) => p.str)
          .join('  ')
          .replace(/\s+$/, ''),
      )
      .filter((l) => l.trim())
      .join('\n')
  }

  // Mode flux (défaut, comme poppler) : onréassemble les items et on coupe aux
  // sauts de ligne que pdf.js a déjà encodés.
  let out = ''
  for (const item of content.items) {
    if (typeof item.str !== 'string') continue
    out += item.str
    if (item.hasEOL) out += '\n'
    else if (!item.str.endsWith(' ')) out += ' '
  }
  return out
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
}

const chunks = []
const from = Math.max(1, first)
const to = Math.min(doc.numPages, last === Infinity ? doc.numPages : last)

for (let n = from; n <= to; n++) {
  const page = await quietly(() => doc.getPage(n))
  const content = await quietly(() => page.getTextContent())
  chunks.push(pageText(content))
  page.cleanup()
}

const text = chunks.join('\n\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n'

if (out) {
  await writeFile(out, text, 'utf8')
  console.log(`✓ ${basename(input)} → ${out}  (${doc.numPages} page(s), ${to - from + 1} extraite(s), ${(Buffer.byteLength(text) / 1024).toFixed(0)} Ko)`)
} else {
  process.stdout.write(text)
}

// Garde-fou : un "texte" vide sur un PDF non vide sent le PDF scanné.
if (!text.trim() && doc.numPages > 0) {
  console.error(
    `\n⚠ aucun texte extrait. Ce PDF est probablement scanné (images).\n  Il faut un OCR : ce n'est pas dans le périmètre de cet outil.`,
  )
  process.exit(4)
}
