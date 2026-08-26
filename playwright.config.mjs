import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  // The dense-ingest specs (20-200 place fixtures) run serially against a real
  // daemon; CI's shared runners need headroom the 30s default doesn't give.
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: 'line',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
})
