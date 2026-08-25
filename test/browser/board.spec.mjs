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
    { source: 'mcp', kind: 'presence.close', data: { connectionId: 'mcp-qa', requestId: 'qa-journey', actor: 'QA agent', channel: 'mcp', transport: 'hook' } },
    { source: 'qa', kind: 'agent.action.declared', data: { summary: 'Update the site tagline', requestId: 'qa-setting', channel: 'wp-cli', transport: 'process' } },
    { source: 'wp', kind: 'presence.open', data: { connectionId: 'qa-setting', requestId: 'qa-setting', actor: 'WP-CLI', channel: 'wp-cli', transport: 'process' } },
    { source: 'wp', kind: 'wp.option.updated', data: { summary: 'WordPress option updated', requestId: 'qa-setting', objectType: 'option', name: 'blogdescription', channel: 'wp-cli' } },
    { source: 'wp', kind: 'presence.close', data: { connectionId: 'qa-setting', requestId: 'qa-setting', actor: 'WP-CLI', channel: 'wp-cli', transport: 'process' } },
    { source: 'qa', kind: 'agent.action.declared', data: { summary: 'Restore the site tagline', requestId: 'qa-setting-restore', objectType: 'option', name: 'blogdescription', channel: 'wp-cli', transport: 'process' } },
    { source: 'wp', kind: 'presence.open', data: { connectionId: 'qa-setting-restore', requestId: 'qa-setting-restore', actor: 'WP-CLI', channel: 'wp-cli', transport: 'process' } },
    { source: 'wp', kind: 'wp.option.updated', data: { summary: 'WordPress option restored', requestId: 'qa-setting-restore', objectType: 'option', name: 'blogdescription', restored: true, channel: 'wp-cli' } },
    { source: 'wp', kind: 'presence.close', data: { connectionId: 'qa-setting-restore', requestId: 'qa-setting-restore', actor: 'WP-CLI', channel: 'wp-cli', transport: 'process' } },
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
  await expect(page.locator('#presence-list').getByText('Connections appear here even before they change WordPress.')).toBeVisible()
  await expect(page.getByText('WordPress post updated', { exact: true }).first()).toBeVisible()
  await expect(page.locator('.graph-node.site')).toHaveCount(1)
  await expect(page.locator('.graph-node.entity')).toHaveCount(2)
  await expect(page.locator('.graph-node.component')).toHaveCount(0)
  await expect(page.locator('.graph-edge.channel')).toHaveCount(4)
  await expect(page.locator('#map-summary')).toContainText('2/2 places · 3 changes')
  await expect(page.locator('[data-node-id="wp:post:42"] .graph-node-kind')).toHaveText('Post · 42')
  await expect(page.locator('[data-node-id="wp:post:42"] .graph-node-title')).toHaveText('QA draft')
  await expect(page.locator('[data-node-id="wp:post:42"] .graph-node-state')).toContainText('Content')
  await expect(page.locator('[data-node-id="wp:post:42"] .graph-node-last-change')).toContainText('Updated · via REST')
  await expect(page.locator('[data-node-id="wp:option:blogdescription"] .graph-node-history')).toContainText('2 changes · open history')
  expect((await page.locator('.graph-edge-label').allTextContents()).some(text => text.includes('process'))).toBe(false)
  await expect(page.getByRole('button', { name: 'Fit graph to view' })).toBeVisible()
  await expect(page.locator('.orbit-track')).toHaveCount(0)
  const [controlsBox, firstNodeBox] = await Promise.all([
    page.locator('.graph-controls').boundingBox(),
    page.locator('[data-node-id="wp:site"]').boundingBox(),
  ])
  expect(controlsBox.y + controlsBox.height, 'canvas controls must leave the first topology node visible').toBeLessThanOrEqual(firstNodeBox.y + 1)
  const siteTransform = await page.locator('[data-node-id="wp:site"]').getAttribute('transform')
  const postTransform = await page.locator('[data-node-id="wp:post:42"]').getAttribute('transform')
  const optionTransform = await page.locator('[data-node-id="wp:option:blogdescription"]').getAttribute('transform')
  expect(siteTransform).toBe(page.viewportSize().width <= 680 ? 'translate(24 132)' : 'translate(52 80)')
  await page.getByRole('button', { name: 'Show history for QA draft' }).click()
  await expect(page.locator('.graph-detail-row')).toHaveCount(1)
  await expect(page.locator('.graph-property-row').filter({ has: page.locator('dt', { hasText: /^Claim$/ }) })).toContainText('Update the QA draft')
  await expect(page.locator('.graph-property-row').filter({ has: page.locator('dt', { hasText: /^Confirmation$/ }) })).toContainText('WordPress post updated')
  await expect(page.locator('#detail-sequence')).toContainText('wp.post.updated')
  await expect(page.locator('#event-detail')).toContainText('objectType')
  await expect.poll(() => page.locator('.graph-detail-card').evaluate(element => Number.parseFloat(getComputedStyle(element).opacity))).toBeGreaterThan(.5)
  await expect.poll(() => page.locator('.graph-detail-card').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(180)
  await page.getByRole('button', { name: 'Hide history for QA draft' }).click()
  await page.getByRole('button', { name: 'Zoom graph in' }).click()
  await expect(page.locator('.graph-zoom')).toHaveText('122%')
  await page.getByRole('button', { name: 'Fit graph to view' }).click()
  await expect(page.locator('.graph-zoom')).toHaveText('100%')
  await page.getByRole('tab', { name: 'Replay' }).click()
  await expect(page.getByRole('slider', { name: 'Replay position' })).toBeEnabled()
  const finalViewBox = await page.locator('.work-graph').getAttribute('viewBox')
  await page.getByRole('slider', { name: 'Replay position' }).fill('3')
  await expect(page.locator('.graph-node.entity.future')).toHaveCount(2)
  await expect(page.locator('.graph-node.entity:not(.future)')).toHaveCount(0)
  await page.getByRole('slider', { name: 'Replay position' }).fill('5')
  await expect(page.locator('.graph-node.entity.future')).toHaveCount(1)
  await expect(page.locator('.graph-node.entity:not(.future)')).toHaveCount(1)
  expect(await page.locator('.work-graph').getAttribute('viewBox')).toBe(finalViewBox)
  expect(await page.locator('[data-node-id="wp:site"]').getAttribute('transform')).toBe(siteTransform)
  expect(await page.locator('[data-node-id="wp:post:42"]').getAttribute('transform')).toBe(postTransform)
  expect(await page.locator('[data-node-id="wp:option:blogdescription"]').getAttribute('transform')).toBe(optionTransform)
  await page.getByRole('slider', { name: 'Replay position' }).fill('11')
  await expect(page.locator('.graph-node.entity.future')).toHaveCount(0)
  await expect(page.locator('.graph-node.entity:not(.future)')).toHaveCount(2)
  expect(await page.locator('.work-graph').getAttribute('viewBox')).toBe(finalViewBox)
  expect(await page.locator('[data-node-id="wp:post:42"]').getAttribute('transform')).toBe(postTransform)
  expect(await page.locator('[data-node-id="wp:option:blogdescription"]').getAttribute('transform')).toBe(optionTransform)
  await page.getByRole('button', { name: 'Focus canvas' }).click()
  await expect(page.locator('.session-rail')).toBeHidden()
  await expect(page.locator('.evidence-ledger')).toBeHidden()
  await expect(page.locator('.component-flow')).toBeVisible()
  if (page.viewportSize().width <= 680) {
    await page.locator('[data-node-id="wp:option:blogdescription"]').scrollIntoViewIfNeeded()
    await expect(page.locator('[data-node-id="wp:option:blogdescription"]')).toBeVisible()
  }
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
    { source: 'qa', kind: 'agent.action.declared', ts: startedAt, data: { summary: 'Inspect the permalink setting', requestId: 'active-journey', objectType: 'option', name: 'permalink_structure', channel: 'mcp', transport: 'stdio' } },
    { source: 'wp', kind: 'presence.open', ts: startedAt + 1_800, data: { actor: 'QA connector', connectionId: 'active-journey', requestId: 'active-journey', channel: 'mcp', transport: 'stdio' } },
  ]) await fetch(`${daemon.url}/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) })
  await page.goto(daemon.url)
  await expect(page.locator('.graph-edge.channel.active')).toHaveCount(1)
  await expect(page.locator('.energy-particle animateMotion')).toHaveAttribute('dur', '1800ms')
  await expect(page.locator('.graph-flow-claim')).toHaveText('Claim · Inspect the permalink setting')
  await expect(page.locator('[data-node-id="wp:option:permalink_structure"].future')).toHaveCount(1)
  await expect(page.locator('[data-node-id="wp:option:permalink_structure"]')).toHaveAttribute('aria-hidden', 'true')
  await expect.poll(() => page.locator('[data-node-id="wp:option:permalink_structure"]').evaluate(element => getComputedStyle(element).opacity)).toBe('0')
})
