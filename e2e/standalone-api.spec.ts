// Verrou anti-régression (bug 0.4.6) : en app packagée, l'API est le bundle
// esbuild de sandbox-server.ts (electron/api-server.mjs) — PAS le dev server
// Vite. Les endpoints /api/cascade* n'existaient que dans le plugin Vite : le
// serveur autonome répondait le fallback SPA (index.html) et le panneau
// Cascade échouait sur « Unexpected token '<' ». Ce spec bundle le VRAI
// sandbox-server.ts comme `npm run build:api`, boot le serveur autonome et
// exige du JSON partout où le frontend en attend.
import { spawn, type ChildProcess } from 'node:child_process'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test as base, expect } from '@playwright/test'

interface Fixture {
  apiUrl: string
}

const test = base.extend<Fixture>({
  apiUrl: [
    async ({}, use) => {
      const dir = mkdtempSync(path.join(tmpdir(), 'chatdeck-standalone-'))
      const outfile = path.join(dir, 'api-server.mjs')
      // MÊME commande que npm run build:api (package.json)
      await build({
        entryPoints: ['sandbox-server.ts'],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile,
        logLevel: 'silent',
      })
      const port = 5300 + Math.floor(Math.random() * 100)
      const child: ChildProcess = spawn('node', [outfile, '--serve', '--port', String(port)], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const out: string[] = []
      child.stdout?.on('data', (c: Buffer) => out.push(c.toString()))
      child.stderr?.on('data', (c: Buffer) => out.push(c.toString()))
      try {
        // Boot attendu : « [chatdeck-api] http://127.0.0.1:<port> »
        const up = await Promise.race([
          (async () => {
            for (;;) {
              try {
                const r = await fetch(`http://127.0.0.1:${port}/health`)
                if (r.ok) return true
              } catch { /* pas encore */ }
              await new Promise((r) => setTimeout(r, 250))
            }
          })(),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20_000)),
        ])
        if (!up) throw new Error(`serveur autonome non booté :\n${out.join('')}`)
        await use(`http://127.0.0.1:${port}`)
      } finally {
        child.kill('SIGTERM')
        rmSync(dir, { recursive: true, force: true })
      }
    },
    { timeout: 60_000 },
  ],
})

test.describe('serveur autonome (app packagée)', () => {
  test('health répond du JSON standalone', async ({ apiUrl }) => {
    const r = await fetch(`${apiUrl}/health`)
    expect(r.status).toBe(200)
    const ct = r.headers.get('content-type') ?? ''
    expect(ct).toContain('application/json')
    const j = (await r.json()) as { ok: boolean; server: string }
    expect(j.ok).toBe(true)
    expect(j.server).toBe('standalone')
  })

  // LE verrou 0.4.6 : sans le montage cascadeApiMount dans ChatDeckApi, ces
  // routes tombaient dans le fallback SPA → text/html → « Unexpected token '<' ».
  test('/api/cascade-check répond du JSON (pas du HTML)', async ({ apiUrl }) => {
    const r = await fetch(`${apiUrl}/api/cascade-check`)
    expect(r.status).toBe(200)
    const ct = r.headers.get('content-type') ?? ''
    expect(ct).toContain('application/json')
    const j = (await r.json()) as { providers: Record<string, { up: boolean }> }
    expect(j.providers).toBeTruthy()
    // La cascade du méga-pack expose exactement ces 9 maillons.
    for (const id of ['omniroute', 'freellm', 'groq', 'cerebras', 'mistral', 'cohere', 'gemini', 'openrouter', 'anthropic']) {
      expect(j.providers[id], `maillon ${id}`).toBeTruthy()
    }
  })

  test('/api/cascade {messages} répond du JSON avec gagnant ou erreur 502', async ({ apiUrl }) => {
    // Une cascade réelle avec bascules prend ~30-60 s (omniroute timeout 30 s
    // à lui seul) — timeout du test aligné.
    test.setTimeout(180_000)
    const r = await fetch(`${apiUrl}/api/cascade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Réponds uniquement : OK' }] }),
    })
    const ct = r.headers.get('content-type') ?? ''
    expect(ct).toContain('application/json') // JAMAIS text/html
    const j = (await r.json()) as { text?: string; provider?: string; error?: string }
    // En ligne : un provider gagne ; hors ligne : 502 {error} — les deux sont du JSON.
    if (r.status === 200) {
      expect(typeof j.text).toBe('string')
      expect(j.text!.length).toBeGreaterThan(0)
      expect(typeof j.provider).toBe('string')
    } else {
      expect(r.status).toBe(502)
      expect(typeof j.error).toBe('string')
    }
  })

  test('les routes inconnues restent du JSON 404 (pas de HTML masqué)', async ({ apiUrl }) => {
    const r = await fetch(`${apiUrl}/api/route-inexistante`)
    expect(r.status).toBe(404)
    const ct = r.headers.get('content-type') ?? ''
    expect(ct).toContain('application/json')
  })

  test('/api/sandbox/status et /api/deck/cards répondent toujours du JSON', async ({ apiUrl }) => {
    for (const p of ['/api/sandbox/status', '/api/deck/cards']) {
      const r = await fetch(`${apiUrl}${p}`)
      const ct = r.headers.get('content-type') ?? ''
      expect(ct).toContain('application/json')
      expect(r.status).toBeLessThan(500)
    }
  })
})
