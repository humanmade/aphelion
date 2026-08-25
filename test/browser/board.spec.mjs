import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { startDaemon } from '../../src/index.mjs'

let daemon
let root

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aphelion-browser-'))
  fs.writeFileSync(path.join(root, 'PLAN.md'), '# Browser fixture\n\n## Observe WordPress {#observe}\n- [x] Record a declared action {#declare}\n- [~] Show the observed effect {#effect}\n')
  daemon = await startDaemon({ target: root, trailDirectory: path.join(root, 'trails'), port: 6310, watch: false })
  for (const event of [
    { source: 'qa', kind: 'agent.action.declared', data: { summary: 'Update the QA draft', requestId: 'qa-journey', channel: 'wp-admin' } },
    { source: 'mcp', kind: 'presence.ready', data: { connectionId: 'mcp-qa', requestId: 'qa-journey', actor: 'QA agent', channel: 'mcp', transport: 'hook' } },
    { source: 'wp', kind: 'wp.post.updated', data: { summary: 'WordPress post updated', requestId: 'qa-journey', objectType: 'post', objectId: 42, title: 'QA draft', channel: 'rest' } },
    { source: 'qa', kind: 'agent.action.declared', data: { summary: 'Update the site tagline', requestId: 'qa-setting', channel: 'wp-cli', transport: 'process' } },
    { source: 'wp', kind: 'presence.open', data: { connectionId: 'qa-setting', requestId: 'qa-setting', actor: 'WP-CLI', channel: 'wp-cli', transport: 'process' } },
    { source: 'wp', kind: 'wp.option.updated', data: { summary: 'WordPress option updated', requestId: 'qa-setting', objectType: 'option', name: 'blogdescription', channel: 'wp-cli' } },
  ]) await fetch(`${daemon.url}/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) })
})

test.afterAll(async () => {
  await daemon?.close('browser-test')
  fs.rmSync(root, { recursive: true, force: true })
})

test('live, replay, and timelapse render from one trail', async ({ page }) => {
  const errors = []
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(daemon.url)
  await expect(page.locator('#presence-list').getByText('QA agent', { exact: true })).toBeVisible()
  await expect(page.getByText('WordPress post updated', { exact: true }).first()).toBeVisible()
  await expect(page.locator('.graph-node')).toHaveCount(7)
  await expect(page.locator('.graph-edge.journey')).toHaveCount(4)
  await expect(page.getByRole('button', { name: 'Fit graph to view' })).toBeVisible()
  await expect(page.locator('.orbit-track')).toHaveCount(0)
  const [controlsBox, firstNodeBox] = await Promise.all([
    page.locator('.graph-controls').boundingBox(),
    page.locator('.graph-node').first().boundingBox(),
  ])
  expect(controlsBox.y + controlsBox.height, 'canvas controls must leave the first topology node visible').toBeLessThanOrEqual(firstNodeBox.y + 1)
  await page.getByRole('button', { name: 'Show properties for WordPress post updated' }).click()
  await expect(page.locator('.graph-property-row').filter({ hasText: 'Object type' })).toBeVisible()
  await expect(page.locator('.graph-property-row').filter({ hasText: 'QA draft' })).toBeVisible()
  await expect.poll(() => page.locator('.graph-detail-card').evaluate(element => Number.parseFloat(getComputedStyle(element).opacity))).toBeGreaterThan(.5)
  await expect.poll(() => page.locator('.graph-detail-card').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(180)
  await page.getByRole('button', { name: 'Hide properties for WordPress post updated' }).click()
  await page.getByRole('button', { name: 'Show tasks for Observe WordPress' }).click()
  await expect(page.locator('.graph-detail-row')).toHaveCount(2)
  await expect(page.locator('.graph-property-row').filter({ hasText: 'Stable ID' }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Hide tasks for Observe WordPress' }).click()
  await page.getByRole('button', { name: 'Zoom graph in' }).click()
  await expect(page.locator('.graph-zoom')).toHaveText('122%')
  await page.getByRole('button', { name: 'Fit graph to view' }).click()
  await expect(page.locator('.graph-zoom')).toHaveText('100%')
  await page.getByRole('tab', { name: 'Replay' }).click()
  await expect(page.getByRole('slider', { name: 'Replay position' })).toBeEnabled()
  const finalViewBox = await page.locator('.work-graph').getAttribute('viewBox')
  const settledFirstJourney = await page.locator('.graph-node.declared').first().getAttribute('transform')
  await page.getByRole('slider', { name: 'Replay position' }).fill('3')
  await expect(page.locator('.graph-node.future')).toHaveCount(5)
  await expect(page.locator('.graph-node.declared:not(.future)')).toHaveCount(1)
  expect(await page.locator('.work-graph').getAttribute('viewBox')).toBe(finalViewBox)
  expect(await page.locator('.graph-node.declared:not(.future)').first().getAttribute('transform')).toBe(settledFirstJourney)
  await page.getByRole('slider', { name: 'Replay position' }).fill('8')
  await expect(page.locator('.graph-node.future')).toHaveCount(0)
  await expect(page.locator('.graph-node.declared:not(.future)')).toHaveCount(2)
  expect(await page.locator('.work-graph').getAttribute('viewBox')).toBe(finalViewBox)
  expect(await page.locator('.graph-node.declared:not(.future)').first().getAttribute('transform')).toBe(settledFirstJourney)
  await page.getByRole('button', { name: 'Focus canvas' }).click()
  await expect(page.locator('.session-rail')).toBeHidden()
  await expect(page.locator('.evidence-ledger')).toBeHidden()
  await expect(page.locator('.component-flow')).toBeVisible()
  await page.getByRole('button', { name: 'Exit focus' }).click()
  await page.getByRole('tab', { name: 'Timelapse' }).click()
  await expect(page.getByRole('button', { name: 'Play timelapse' })).toBeEnabled()
  const overflow = await page.evaluate(() => ({
    delta: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    scrollX: window.scrollX,
    sizes: ['.app-shell', '.topbar', '.workspace', '.current-brief', '.component-map', '.component-flow'].map(selector => {
      const element = document.querySelector(selector)
      return `${selector}:${element?.clientWidth}/${element?.scrollWidth}`
    }),
    offenders: [...document.querySelectorAll('body *')]
      .filter(element => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .slice(0, 8)
      .map(element => `${element.tagName.toLowerCase()}.${element.className}`),
    intrinsic: [...document.querySelectorAll('body *')]
      .filter(element => element.scrollWidth > element.clientWidth + 1)
      .slice(0, 8)
      .map(element => `${element.tagName.toLowerCase()}.${element.className}:${element.clientWidth}/${element.scrollWidth}`),
  }))
  expect(overflow.delta, `scrollX ${overflow.scrollX}; ${overflow.sizes.join(', ')}; overflowing elements: ${overflow.offenders.join(', ')}; intrinsic: ${overflow.intrinsic.join(', ')}`).toBeLessThanOrEqual(1)
  expect(errors).toEqual([])
})

test('an in-flight connector edge carries source-timed energy', async ({ page }) => {
  const startedAt = Date.now()
  for (const event of [
    { source: 'qa', kind: 'agent.action.declared', ts: startedAt, data: { summary: 'Inspect the WordPress site', requestId: 'active-journey', channel: 'mcp', transport: 'stdio' } },
    { source: 'wp', kind: 'presence.open', ts: startedAt + 1_800, data: { actor: 'QA connector', connectionId: 'active-journey', requestId: 'active-journey', channel: 'wp-cli', transport: 'process' } },
  ]) await fetch(`${daemon.url}/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) })
  await page.goto(daemon.url)
  await expect(page.locator('.graph-edge.journey.active')).toHaveCount(1)
  await expect(page.locator('.energy-particle animateMotion')).toHaveAttribute('dur', '1800ms')
  await expect(page.getByText(/latest path in flight/)).toBeVisible()
})
