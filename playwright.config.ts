import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  // 45 s : sous forte charge machine (load > 150, fréquent ici), même le
  // page.goto dépasse 30 s — les tests passent tous, mais plus lentement.
  timeout: 45_000,
  // 1 retry : les échecs observés sous charge sont 100 % des timeouts, et la
  // relance passe (validé à plusieurs reprises). Vrai bug = 2 échecs de suite.
  retries: 1,
  workers: 1, // la sandbox disque est partagée : un test à la fois
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5199',
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
