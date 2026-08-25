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
  const events = [
    { source: 'qa', kind: 'agent.action.declared', data: { summary: 'Update the QA draft', requestId: 'qa-journey', objectType: 'post', objectId: 42, postType: 'page', channel: 'wp-admin', transport: 'browser' } },
    { source: 'mcp', kind: 'presence.ready', data: { connectionId: 'mcp-qa', requestId: 'qa-journey', actor: 'QA agent', channel: 'mcp', transport: 'hook' } },
    { source: 'wp', kind: 'wp.post_meta.updated', data: { summary: 'Page metadata updated', requestId: 'qa-journey', objectType: 'post-meta', objectId: 42, postType: 'page', metaKey: '_qa_seed', channel: 'rest', transport: 'http' } },
    { source: 'wp', kind: 'wp.post.updated', data: { summary: 'WordPress post updated', requestId: 'qa-journey', objectType: 'post', objectId: 42, title: 'QA draft', status: 'draft', blockCount: 4, channel: 'rest', transport: 'http' } },
    { source: 'mcp', kind: 'presence.close', data: { connectionId: 'mcp-qa', requestId: 'qa-journey', actor: 'QA agent', channel: 'mcp', transport: 'hook' } },
    { source: 'qa', kind: 'agent.action.declared', data: { summary: 'Temporarily edit site tagline', requestId: 'qa-setting', objectType: 'option', name: 'blogdescription', channel: 'wp-cli', transport: 'docker-exec' } },
    { source: 'wp', kind: 'presence.open', data: { connectionId: 'qa-setting', requestId: 'qa-setting', actor: 'WP-CLI', channel: 'wp-cli', transport: 'process' } },
    { source: 'wp', kind: 'wp.option.updated', data: { summary: 'WordPress option updated', requestId: 'qa-setting', objectType: 'option', name: 'blogdescription', channel: 'wp-cli', transport: 'process' } },
    { source: 'wp', kind: 'presence.close', data: { connectionId: 'qa-setting', requestId: 'qa-setting', actor: 'WP-CLI', channel: 'wp-cli', transport: 'process' } },
    { source: 'qa', kind: 'agent.action.declared', data: { summary: 'Restore site tagline', requestId: 'qa-setting-restore', objectType: 'option', name: 'blogdescription', channel: 'wp-cli', transport: 'docker-exec' } },
    { source: 'wp', kind: 'presence.open', data: { connectionId: 'qa-setting-restore', requestId: 'qa-setting-restore', actor: 'WP-CLI', channel: 'wp-cli', transport: 'process' } },
    { source: 'wp', kind: 'wp.option.updated', data: { summary: 'WordPress option restored', requestId: 'qa-setting-restore', objectType: 'option', name: 'blogdescription', restored: true, channel: 'wp-cli', transport: 'process' } },
    { source: 'wp', kind: 'presence.close', data: { connectionId: 'qa-setting-restore', requestId: 'qa-setting-restore', actor: 'WP-CLI', channel: 'wp-cli', transport: 'process' } },
  ]
  for (let index = 0; index < 9; index++) {
    const requestId = `qa-page-pass-${index}`
    events.push(
      { source: 'qa', kind: 'agent.action.declared', data: { summary: `Edit page field ${index + 1}`, requestId, objectType: 'post', objectId: 42, channel: 'wp-cli', transport: 'docker-exec' } },
      { source: 'wp', kind: index % 2 ? 'wp.post_meta.updated' : 'wp.post.updated', data: { summary: `Page field ${index + 1} updated`, requestId, objectType: index % 2 ? 'post-meta' : 'post', objectId: 42, title: 'QA draft', metaKey: index % 2 ? `_qa_field_${index + 1}` : undefined, status: 'draft', blockCount: 4, channel: 'wp-cli', transport: 'process' } },
    )
  }
  events.push(
    { source: 'wp', kind: 'wp.post.trashed', data: { summary: 'Post trashed', requestId: 'qa-cleanup', objectType: 'post', objectId: 42, title: 'QA draft', status: 'trash', channel: 'wp-cli', transport: 'process' } },
    { source: 'wp', kind: 'wp.post_meta.created', data: { summary: 'metadata created', requestId: 'qa-cleanup', objectType: 'post-meta', objectId: 42, metaKey: '_wp_trash_meta_status', channel: 'wp-cli', transport: 'process' } },
    { source: 'wp', kind: 'wp.post_meta.created', data: { summary: 'metadata created', requestId: 'qa-cleanup', objectType: 'post-meta', objectId: 42, metaKey: '_wp_trash_meta_time', channel: 'wp-cli', transport: 'process' } },
    { source: 'wp', kind: 'wp.post_meta.updated', data: { summary: 'metadata updated', requestId: 'qa-seo', objectType: 'post-meta', objectId: 42, metaKey: '_yoast_wpseo_title', plugin: 'yoast-seo', channel: 'wp-cli', transport: 'process' } },
    { source: 'wp', kind: 'wp.post_meta.updated', data: { summary: 'metadata updated', requestId: 'qa-seo', objectType: 'post-meta', objectId: 42, metaKey: '_yoast_wpseo_metadesc', plugin: 'yoast-seo', channel: 'wp-cli', transport: 'process' } },
    { source: 'wp', kind: 'wp.post_meta.updated', data: { summary: 'metadata updated', requestId: 'qa-seo', objectType: 'post-meta', objectId: 42, metaKey: '_yoast_wpseo_focuskw', plugin: 'yoast-seo', channel: 'wp-cli', transport: 'process' } },
  )
  for (const event of events) await fetch(`${daemon.url}/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) })
})

test.afterAll(async () => {
  await daemon?.close('browser-test')
  fs.rmSync(root, { recursive: true, force: true })
})

test('v3 keeps the map quiet while cards and inspector retain the evidence', async ({ page }) => {
  const errors = []
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(daemon.url)

  const chrome = await page.locator('.chrome-bar').boundingBox()
  expect(chrome.height).toBeLessThanOrEqual(48)
  await expect(page.locator('.session-rail, .evidence-ledger, .current-brief, .presence-panel, .wordpress-panel')).toHaveCount(0)
  await expect(page.locator('.graph-node.site')).toHaveCount(1)
  await expect(page.locator('.graph-node.entity')).toHaveCount(2)
  expect(await page.locator('.graph-edge.channel').count()).toBeGreaterThanOrEqual(2)
  await expect(page.locator('[data-node-id="wp:post:42"] .place-type')).toHaveText('Page')
  expect(await page.locator('[data-node-id="wp:post:42"] .place-type').evaluate(element => getComputedStyle(element).textTransform)).toBe('uppercase')
  await expect(page.locator('[data-node-id="wp:post:42"] .place-address')).toHaveText('42')
  await expect(page.locator('[data-node-id="wp:post:42"] .place-name')).toHaveText('QA draft')
  await expect(page.locator('[data-node-id="wp:post:42"] .place-state')).toContainText('Trash')

  const band = await page.locator('[data-node-id="wp:post:42"] .place-band').boundingBox()
  expect(band.height).toBeGreaterThanOrEqual(29.9)
  expect(band.height).toBeLessThanOrEqual(30.1)
  expect(await page.locator('[data-node-id="wp:post:42"] .place-name').evaluate(element => getComputedStyle(element).fontSize)).toBe('15px')
  await expect(page.locator('[data-node-id="wp:option:blogdescription"] .change-row')).toHaveCount(2)
  await expect(page.locator('[data-node-id="wp:option:blogdescription"] .change-row').nth(0)).toContainText('Restored site tagline')
  await expect(page.locator('[data-node-id="wp:option:blogdescription"] .change-row').nth(1)).toContainText('Edited site tagline temporarily')
  await expect(page.locator('[data-node-id="wp:option:blogdescription"] .change-flag')).toHaveCount(0)
  expect((await page.locator('.change-row').allTextContents()).some(text => /via\s/i.test(text))).toBe(false)

  const pageCard = page.locator('[data-node-id="wp:post:42"]')
  await expect(pageCard.locator('.change-row').first()).toContainText('3 metadata changes')
  await expect(pageCard.locator('.change-row').nth(1)).toContainText('Trashed')
  await expect(pageCard).not.toContainText(/_wp_|_yoast_|wpseo/i)
  await expect(page.locator('[data-node-id="wp:site"] .change-tail')).toHaveCount(0)
  const siteCardHeight = (await page.locator('[data-node-id="wp:site"] .place-card').boundingBox()).height
  expect(siteCardHeight).toBeGreaterThanOrEqual(103.8)
  expect(siteCardHeight).toBeLessThanOrEqual(104.2)
  await expect(pageCard.locator('.tail-more')).toContainText(/\+\d+ earlier/)
  await pageCard.locator('.tail-more').click()
  await expect(pageCard.locator('.change-tail')).toHaveAttribute('data-expanded', 'true')
  expect(await pageCard.locator('.change-tail').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)

  await pageCard.click()
  await expect(page.locator('.app-shell')).toHaveAttribute('data-inspector-open', 'true')
  await expect(page.locator('#place-panel')).toContainText('Stable identity')
  await expect(page.locator('#place-panel')).toContainText('Transport')
  await expect(page.locator('#place-panel')).toContainText('Request')
  await expect(page.locator('#place-panel')).toContainText('_wp_trash_meta_status')
  await page.getByRole('tab', { name: 'Trail' }).click()
  const seqs = await page.locator('#trail-panel .trail-row').evaluateAll(rows => rows.map(row => Number(row.dataset.seq)))
  expect(seqs).toEqual([...seqs].sort((left, right) => left - right))
  await page.keyboard.press('Escape')
  await expect(page.locator('.app-shell')).toHaveAttribute('data-inspector-open', 'false')
  await pageCard.locator('.tail-more').click()
  await expect(pageCard.locator('.change-tail')).toHaveAttribute('data-expanded', 'false')

  await page.getByRole('tab', { name: 'Replay' }).click()
  await expect(page.getByRole('slider', { name: 'Replay position' })).toBeEnabled()
  const finalViewBox = await page.locator('.work-graph').getAttribute('viewBox')
  const siteTransform = await page.locator('[data-node-id="wp:site"]').getAttribute('transform')
  const postTransform = await page.locator('[data-node-id="wp:post:42"]').getAttribute('transform')
  const optionTransform = await page.locator('[data-node-id="wp:option:blogdescription"]').getAttribute('transform')
  await page.getByRole('slider', { name: 'Replay position' }).fill('1')
  await expect(page.locator('.graph-node.entity.future')).toHaveCount(2)
  await expect(page.locator('[data-node-id="wp:post:42"] .place-state')).toHaveCount(0)
  const replayViewBox = await page.locator('.work-graph').getAttribute('viewBox')
  const finalViewBoxParts = finalViewBox.split(/\s+/).map(Number)
  const replayViewBoxParts = replayViewBox.split(/\s+/).map(Number)
  expect(replayViewBoxParts.slice(0, 2)).toEqual(finalViewBoxParts.slice(0, 2))
  expect(Math.abs(replayViewBoxParts[2] - finalViewBoxParts[2])).toBeLessThanOrEqual(1)
  expect(Math.abs(replayViewBoxParts[3] - finalViewBoxParts[3])).toBeLessThanOrEqual(1)
  expect(await page.locator('[data-node-id="wp:site"]').getAttribute('transform')).toBe(siteTransform)
  expect(await page.locator('[data-node-id="wp:post:42"]').getAttribute('transform')).toBe(postTransform)
  expect(await page.locator('[data-node-id="wp:option:blogdescription"]').getAttribute('transform')).toBe(optionTransform)
  const replaySessionId = await page.locator('#session-select').inputValue()
  const firstPageEffect = await page.evaluate(async sessionId => {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/events`)
    const events = await response.json()
    return events.findIndex(event => event.data?.metaKey === '_qa_seed')
  }, replaySessionId)
  expect(firstPageEffect).toBeGreaterThan(0)
  await page.getByRole('slider', { name: 'Replay position' }).fill(String(firstPageEffect))
  await expect(page.locator('[data-node-id="wp:post:42"]')).not.toHaveClass(/future/)
  await expect(page.locator('[data-node-id="wp:post:42"] .place-name')).toHaveText('Page #42')
  await expect(page.locator('[data-node-id="wp:post:42"] .place-state')).toHaveCount(0)
  await page.getByRole('slider', { name: 'Replay position' }).fill(await page.getByRole('slider', { name: 'Replay position' }).getAttribute('max'))
  await expect(page.locator('.graph-node.entity.future')).toHaveCount(0)

  const overflow = await page.evaluate(() => ({
    delta: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    offenders: [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 8).map(element => `${element.tagName.toLowerCase()}.${element.className}`),
  }))
  expect(overflow.delta, `overflowing elements: ${overflow.offenders.join(', ')}`).toBeLessThanOrEqual(1)
  expect(errors).toEqual([])
})

test('deep links reopen a session, replay moment, and inspector selection', async ({ page }) => {
  const sessions = await fetch(`${daemon.url}/api/sessions`).then(response => response.json())
  const sessionId = sessions[0].id
  const events = await fetch(`${daemon.url}/api/sessions/${encodeURIComponent(sessionId)}/events`).then(response => response.json())
  const target = events.find(event => event.data?.metaKey === '_qa_seed')
  const targetIndex = events.findIndex(event => event.seq === target.seq)
  const url = new URL(daemon.url)
  url.searchParams.set('keep', 'yes')
  url.searchParams.set('session', sessionId)
  url.searchParams.set('mode', 'replay')
  url.searchParams.set('seq', String(target.seq))
  url.searchParams.set('place', 'wp:post:42')
  url.searchParams.set('tab', 'trail')

  await page.goto(url.href)
  await expect(page.locator('#session-select')).toHaveValue(sessionId)
  await expect(page.getByRole('tab', { name: 'Replay' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('slider', { name: 'Replay position' })).toHaveValue(String(targetIndex))
  await expect(page.locator('.app-shell')).toHaveAttribute('data-inspector-open', 'true')
  await expect(page.getByRole('tab', { name: 'Trail' })).toHaveAttribute('aria-selected', 'true')
  expect(new URL(page.url()).searchParams.get('keep')).toBe('yes')
  expect(new URL(page.url()).searchParams.get('place')).toBe('wp:post:42')

  await page.getByRole('button', { name: 'Close inspector' }).last().click()
  expect(new URL(page.url()).searchParams.has('place')).toBe(false)
  expect(new URL(page.url()).searchParams.has('tab')).toBe(false)

  await page.locator('.graph-edge-hit').first().dispatchEvent('click')
  expect(new URL(page.url()).searchParams.get('flow')).toMatch(/^channel:/)
  await page.getByRole('tab', { name: 'Live' }).click()
  const liveUrl = new URL(page.url())
  expect(liveUrl.searchParams.get('keep')).toBe('yes')
  for (const key of ['session', 'mode', 'seq', 'place', 'flow', 'tab']) expect(liveUrl.searchParams.has(key)).toBe(false)

  await page.goto(`${daemon.url}/?keep=yes&session=missing&mode=replay&seq=999`)
  await expect(page.getByRole('tab', { name: 'Live' })).toHaveAttribute('aria-selected', 'true')
  const fallbackUrl = new URL(page.url())
  expect(fallbackUrl.searchParams.get('keep')).toBe('yes')
  expect(fallbackUrl.searchParams.has('session')).toBe(false)
})

test('an existing place shows one awaiting row while its flow is in flight', async ({ page }) => {
  const startedAt = Date.now()
  for (const event of [
    { source: 'qa', kind: 'agent.action.declared', ts: startedAt, data: { summary: 'Inspect the site tagline', requestId: 'active-journey', objectType: 'option', name: 'blogdescription', channel: 'mcp', transport: 'stdio' } },
    { source: 'wp', kind: 'presence.open', ts: startedAt + 1_800, data: { actor: 'QA connector', connectionId: 'active-journey', requestId: 'active-journey', objectType: 'option', name: 'blogdescription', channel: 'mcp', transport: 'stdio' } },
  ]) await fetch(`${daemon.url}/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) })
  await page.goto(daemon.url)
  await expect(page.locator('.graph-edge.channel.active')).toHaveCount(1)
  await expect(page.locator('.energy-particle animateMotion')).toHaveAttribute('dur', '1800ms')
  await expect(page.locator('[data-node-id="wp:option:blogdescription"] .change-row.awaiting')).toHaveCount(1)
  await expect(page.locator('[data-node-id="wp:option:blogdescription"] .change-flag.awaiting')).toHaveText('awaiting')
})

test('reduced motion preserves state without continuous energy', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(daemon.url)
  await expect(page.locator('.energy-particle')).toBeHidden()
  await expect(page.locator('.graph-node.site')).toBeVisible()
  expect(parseFloat(await page.locator('.graph-node.site').evaluate(element => getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(.001)
})
