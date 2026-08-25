import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  retries: 0,
  reporter: 'line',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
})
