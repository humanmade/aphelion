import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { startDaemon } from '../../src/index.mjs'

let daemon
let root
let sessionId
let replaySequence
const qaRoot = path.resolve('qa-artifacts/2026-08-26/work-order-q')

function luminance([red, green, blue]) {
  const channels = [red, green, blue].map(channel => {
    const value = channel / 255
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
  })
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2]
}

function contrast(first, second) {
  const [light, dark] = [luminance(first), luminance(second)].sort((left, right) => right - left)
  return (light + .05) / (dark + .05)
}

async function openWithoutThemeChoice(page, colorScheme, url = daemon.url) {
  await page.emulateMedia({ colorScheme })
  await page.goto(url)
  await expect(page.locator('.app-shell')).toHaveAttribute('data-app-state', 'ready')
}

async function tokenColors(page) {
  return page.evaluate(() => {
    const context = document.createElement('canvas').getContext('2d', { colorSpace: 'srgb' })
    const styles = getComputedStyle(document.documentElement)
    const color = property => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = styles.getPropertyValue(property).trim()
      context.fillRect(0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
    }
    return Object.fromEntries(['--surface', '--text', '--text-2', '--declared', '--live', '--attention', '--danger'].map(property => [property, color(property)]))
  })
}

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aphelion-theme-browser-'))
  daemon = await startDaemon({ target: root, trailDirectory: path.join(root, 'trails'), port: 6470, watch: false })
  const events = [
    { source: 'agent', kind: 'agent.action.declared', data: { summary: 'Refresh the site tagline', requestId: 'theme-setting', objectType: 'option', name: 'blogdescription', channel: 'wp-cli', transport: 'process' } },
    { source: 'wp', kind: 'presence.open', data: { connectionId: 'theme-setting', requestId: 'theme-setting', channel: 'wp-cli', transport: 'process' } },
    { source: 'wp', kind: 'wp.option.updated', data: { summary: 'Site tagline refreshed', requestId: 'theme-setting', objectType: 'option', name: 'blogdescription', channel: 'wp-cli', transport: 'process' } },
    { source: 'agent', kind: 'agent.action.declared', data: { summary: 'Draft a review page', requestId: 'theme-page', objectType: 'post', objectId: 42, postType: 'page', channel: 'wp-admin', transport: 'browser' } },
    { source: 'session', kind: 'session.end', data: { reason: 'theme fixture complete' } },
  ]
  for (const event of events) {
    await fetch(`${daemon.url}/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    })
  }
  const sessions = await fetch(`${daemon.url}/api/sessions`).then(response => response.json())
  sessionId = sessions[0].id
  const eventsForSession = await fetch(`${daemon.url}/api/sessions/${encodeURIComponent(sessionId)}/events`).then(response => response.json())
  replaySequence = eventsForSession.at(-1).seq
})

test.afterAll(async () => {
  await daemon?.close('theme-browser-test')
  fs.rmSync(root, { recursive: true, force: true })
})

test('theme toggle changes the root attribute and persists across reload', async ({ page }) => {
  await openWithoutThemeChoice(page, 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible()

  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible()

  await page.reload()
  await expect(page.locator('.app-shell')).toHaveAttribute('data-app-state', 'ready')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('the default theme follows the system preference without a stored choice', async ({ page }) => {
  await openWithoutThemeChoice(page, 'light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('aphelion-theme'))).toBeNull()

  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible()
})

test('text and state markers retain at least 4.5:1 contrast in both themes', async ({ page }) => {
  for (const colorScheme of ['light', 'dark']) {
    await openWithoutThemeChoice(page, colorScheme)
    const colors = await tokenColors(page)
    for (const property of ['--text', '--text-2', '--declared', '--live', '--attention', '--danger']) {
      expect(contrast(colors[property], colors['--surface']), `${colorScheme} ${property}`).toBeGreaterThanOrEqual(4.5)
    }
  }
})

test('deep-linked replay captures light and dark at the same recorded moment', async ({ page }, testInfo) => {
  const replayUrl = `${daemon.url}/?session=${encodeURIComponent(sessionId)}&mode=replay&seq=${replaySequence}`
  await openWithoutThemeChoice(page, 'dark', replayUrl)
  await expect(page.getByRole('tab', { name: 'Replay' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.graph-node')).toHaveCount(3)
  const dark = await page.screenshot()

  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  const light = await page.screenshot()

  fs.mkdirSync(qaRoot, { recursive: true })
  fs.writeFileSync(path.join(qaRoot, `replay-dark-${testInfo.project.name}.png`), dark)
  fs.writeFileSync(path.join(qaRoot, `replay-light-${testInfo.project.name}.png`), light)
  await page.setContent(`<!doctype html><style>body{margin:0;background:#d9d9d9;display:grid;grid-template-columns:repeat(2,max-content);gap:12px;padding:12px}img{display:block}</style><img alt="Dark replay" src="data:image/png;base64,${dark.toString('base64')}"><img alt="Light replay" src="data:image/png;base64,${light.toString('base64')}">`)
  await page.screenshot({ path: path.join(qaRoot, `replay-themes-${testInfo.project.name}.png`) })
})
