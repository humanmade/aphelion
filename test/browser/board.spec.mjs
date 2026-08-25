import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { startDaemon } from '../../src/index.mjs'
import { renderFrameGeometry } from '../../src/timelapse/render.mjs'

let daemon
let root
const qaRoot = path.resolve('qa-artifacts/2026-08-25/work-order-g')
const qaHRoot = path.resolve('qa-artifacts/2026-08-25/work-order-h')
const qaIRoot = path.resolve('qa-artifacts/2026-08-25/work-order-i')
const qaScreenshot = async (page, testInfo, name) => {
  fs.mkdirSync(qaRoot, { recursive: true })
  await page.screenshot({ path: path.join(qaRoot, `${name}-${testInfo.project.name}.png`) })
}
const qaHScreenshot = async (page, testInfo, name) => {
  fs.mkdirSync(qaHRoot, { recursive: true })
  await page.screenshot({ path: path.join(qaHRoot, `${name}-${testInfo.project.name}.png`) })
}
const qaIScreenshot = async (page, testInfo, name) => {
  fs.mkdirSync(qaIRoot, { recursive: true })
  await page.screenshot({ path: path.join(qaIRoot, `${name}-${testInfo.project.name}.png`) })
}

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

  const wordmarkFont = await page.locator('.brand-word').evaluate(async element => {
    await document.fonts.ready
    const faces = await document.fonts.load('15px "Geist Pixel"', element.textContent)
    return {
      family: getComputedStyle(element).fontFamily,
      loaded: document.fonts.check('15px "Geist Pixel"'),
      faces: faces.length,
    }
  })
  expect(wordmarkFont.family).toMatch(/^"Geist Pixel"/)
  expect(wordmarkFont.loaded).toBe(true)
  expect(wordmarkFont.faces).toBeGreaterThan(0)

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

  expect(await page.locator('[data-node-id="wp:post:42"] .place-band').evaluate(element => getComputedStyle(element).height)).toBe('30px')
  expect(await page.locator('[data-node-id="wp:post:42"] .place-name').evaluate(element => getComputedStyle(element).fontSize)).toBe('15px')
  await expect(page.locator('[data-node-id="wp:option:blogdescription"] .change-row')).toHaveCount(1)
  await expect(page.locator('[data-node-id="wp:option:blogdescription"] .change-row')).toContainText('2 updates')
  await expect(page.locator('[data-node-id="wp:option:blogdescription"] .change-flag')).toHaveCount(0)
  expect((await page.locator('.change-row').allTextContents()).some(text => /via\s/i.test(text))).toBe(false)

  const pageCard = page.locator('[data-node-id="wp:post:42"]')
  await expect(pageCard.locator('.change-row').first()).toContainText('3 metadata updates')
  await expect(pageCard.locator('.change-row').nth(1)).toContainText('Trashed')
  await expect(pageCard).not.toContainText(/_wp_|_yoast_|wpseo/i)
  await expect(page.locator('[data-node-id="wp:site"] .change-tail')).toHaveCount(0)
  expect(await page.locator('[data-node-id="wp:site"] .place-card').evaluate(element => getComputedStyle(element).height)).toBe('104px')
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
  await expect(page.locator('[data-node-id="wp:post:42"] .place-state')).toBeHidden()
  const replayViewBox = await page.locator('.work-graph').getAttribute('viewBox')
  const finalViewBoxParts = finalViewBox.split(/\s+/).map(Number)
  const replayViewBoxParts = replayViewBox.split(/\s+/).map(Number)
  expect(replayViewBoxParts[2]).toBeLessThanOrEqual(finalViewBoxParts[2])
  expect(replayViewBoxParts[3]).toBeLessThanOrEqual(finalViewBoxParts[3])
  expect(await page.locator('[data-node-id="wp:site"]').getAttribute('transform')).toBe(siteTransform)
  expect(await page.locator('[data-node-id="wp:post:42"]').getAttribute('transform')).toBe(postTransform)
  expect(await page.locator('[data-node-id="wp:option:blogdescription"]').getAttribute('transform')).toBe(optionTransform)
  const replaySessionId = await page.locator('#session-select').inputValue()
  const firstPageEffect = await page.evaluate(async sessionId => {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/events`)
    const events = (await response.json()).filter(event => event.kind !== 'presence.heartbeat')
    return events.findIndex(event => event.data?.metaKey === '_qa_seed')
  }, replaySessionId)
  expect(firstPageEffect).toBeGreaterThan(0)
  await page.getByRole('slider', { name: 'Replay position' }).fill(String(firstPageEffect))
  await expect(page.locator('[data-node-id="wp:post:42"]')).not.toHaveClass(/future/)
  await expect(page.locator('[data-node-id="wp:post:42"] .place-name')).toHaveText('Page #42')
  await expect(page.locator('[data-node-id="wp:post:42"] .place-state')).toHaveText('Updated')
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
  const targetIndex = events.filter(event => event.kind !== 'presence.heartbeat').findIndex(event => event.seq === target.seq)
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

test('keyed rendering preserves card identity and a user-moved camera across live events', async ({ page }) => {
  await page.goto(daemon.url)
  await page.waitForSelector('[data-node-id="wp:post:42"]', { state: 'attached' })
  await page.evaluate(() => {
    window.__aphelionNode = document.querySelector('[data-node-id="wp:post:42"]')
    window.__aphelionName = window.__aphelionNode.querySelector('.place-name')
  })
  await page.getByRole('button', { name: 'Zoom graph in' }).click()
  const movedViewBox = await page.locator('.work-graph').getAttribute('viewBox')
  const beforePosition = await page.locator('#event-position').textContent()
  await fetch(`${daemon.url}/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'wp', kind: 'presence.heartbeat', data: { connectionId: 'identity-check', channel: 'wp-cli', transport: 'process' } }) })
  await expect(page.locator('#event-position')).not.toHaveText(beforePosition)

  expect(await page.evaluate(() => window.__aphelionNode === document.querySelector('[data-node-id="wp:post:42"]'))).toBe(true)
  expect(await page.evaluate(() => window.__aphelionName === document.querySelector('[data-node-id="wp:post:42"] .place-name'))).toBe(true)
  expect(await page.locator('.work-graph').getAttribute('viewBox')).toBe(movedViewBox)
  expect(parseFloat(await page.locator('[data-node-id="wp:post:42"] .place-card').evaluate(element => getComputedStyle(element).transitionDuration))).toBeGreaterThanOrEqual(.4)

  await page.getByRole('button', { name: 'Fit graph to view' }).click()
  const fittedViewBox = await page.locator('.work-graph').getAttribute('viewBox')
  await fetch(`${daemon.url}/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'wp', kind: 'presence.heartbeat', data: { connectionId: 'fit-check', channel: 'wp-cli', transport: 'process' } }) })
  await expect(page.locator('#event-position')).not.toHaveText(beforePosition)
  expect(await page.locator('.work-graph').getAttribute('viewBox')).toBe(fittedViewBox)
})

test('replay exposes its position and timelapse starts without pressing play', async ({ page }) => {
  await page.goto(daemon.url)
  await page.getByRole('tab', { name: 'Replay' }).click()
  await expect(page.locator('#event-position')).toContainText('Paused · moment')
  const sessionId = await page.locator('#session-select').inputValue()
  const recordedEvents = await fetch(`${daemon.url}/api/sessions/${encodeURIComponent(sessionId)}/events`).then(response => response.json())
  const visibleMoments = recordedEvents.filter(event => event.kind !== 'presence.heartbeat').length
  await expect(page.locator('#event-position')).toContainText(` / ${visibleMoments}`)

  await page.getByRole('tab', { name: 'Timelapse' }).click()
  await expect(page.locator('#event-position')).toContainText('Playing · moment')
  const initial = Number(await page.getByRole('slider', { name: 'Replay position' }).inputValue())
  await expect.poll(async () => Number(await page.getByRole('slider', { name: 'Replay position' }).inputValue())).toBeGreaterThan(initial)

  const events = await fetch(`${daemon.url}/api/sessions/${encodeURIComponent(sessionId)}/events`).then(response => response.json())
  const playbackEvents = events.filter(event => event.kind !== 'presence.heartbeat')
  const startIndex = Math.max(1, Math.floor(playbackEvents.length / 2))
  const startSeq = playbackEvents[startIndex].seq
  await page.goto(`${daemon.url}/?session=${encodeURIComponent(sessionId)}&mode=timelapse&seq=${startSeq}`)
  await expect(page.getByRole('tab', { name: 'Timelapse' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#event-position')).toContainText('Playing · moment')
  const linkedInitial = Number(await page.getByRole('slider', { name: 'Replay position' }).inputValue())
  expect(linkedInitial).toBeGreaterThanOrEqual(startIndex)
  await expect.poll(async () => Number(await page.getByRole('slider', { name: 'Replay position' }).inputValue())).toBeGreaterThan(linkedInitial)
})

test('exported timelapse frames share the board topology geometry', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'exported timelapse uses canonical desktop geometry')
  const sessions = await fetch(`${daemon.url}/api/sessions`).then(response => response.json())
  const sessionId = sessions[0].id
  const events = (await fetch(`${daemon.url}/api/sessions/${encodeURIComponent(sessionId)}/events`).then(response => response.json())).filter(event => event.kind !== 'presence.heartbeat')
  await page.goto(`${daemon.url}/?session=${encodeURIComponent(sessionId)}&mode=replay&seq=${events.at(-1).seq}`)
  await expect(page.locator('.graph-node.entity')).toHaveCount(2)
  const browserNodes = await page.locator('.graph-node:not(.future)').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.nodeId, node.getAttribute('transform')])))
  const browserEdges = await page.locator('.graph-edge.channel:not(.future)').evaluateAll(edges => Object.fromEntries(edges.map(edge => [edge.dataset.edgeId, edge.getAttribute('d')])))
  const frame = renderFrameGeometry(events, events.length - 1)
  const exportedNodes = Object.fromEntries(frame.nodes.filter(node => !node.future).map(node => [node.id, `translate(${node.x} ${node.y})`]))
  const exportedEdges = Object.fromEntries(frame.edges.filter(edge => !edge.future && edge.path).map(edge => [edge.id, edge.path]))
  expect(exportedNodes).toEqual(browserNodes)
  expect(exportedEdges).toEqual(browserEdges)
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
  await expect(page.locator('.graph-flow-claim')).toHaveCount(0)
})

test('reduced motion preserves state without continuous energy', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(daemon.url)
  await expect(page.locator('.energy-particle')).toBeHidden()
  await expect(page.locator('.graph-node.site')).toBeVisible()
  expect(parseFloat(await page.locator('.graph-node.site').evaluate(element => getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(.001)
  const brandAnimations = await page.locator('.brand-mark').evaluate(mark => [...mark.querySelectorAll('.bm, .bd')].map(element => getComputedStyle(element).animationName))
  expect(brandAnimations.every(name => name === 'none')).toBe(true)
})

test('site sessions show their root immediately and promote declared ghosts in place', async ({ page }) => {
  const trailRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aphelion-ghost-'))
  const siteDaemon = await startDaemon({ target: 'http://localhost:8081', targetType: 'site', trailDirectory: path.join(trailRoot, 'trails'), port: 6320, watch: false })
  const ingest = event => fetch(`${siteDaemon.url}/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) })
  try {
    await page.goto(siteDaemon.url)
    await expect(page.locator('[data-node-id="wp:site"]')).toBeVisible()
    await expect(page.locator('.graph-node.entity')).toHaveCount(0)
    await page.evaluate(() => {
      window.__birthSeen = false
      new MutationObserver(() => {
        if (document.querySelector('[data-node-id="wp:option:fresh_setting"]')?.classList.contains('birth')) window.__birthSeen = true
      }).observe(document.querySelector('.graph-nodes'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    })

    await ingest({ source: 'agent', kind: 'agent.action.declared', data: { summary: 'Update fresh setting', requestId: 'fresh', objectType: 'option', name: 'fresh_setting', channel: 'wp-cli', transport: 'docker-exec' } })
    const ghost = page.locator('[data-node-id="wp:option:fresh_setting"]')
    await expect(ghost).toBeVisible()
    await expect(ghost).toHaveClass(/provisional/)
    await expect(ghost.locator('.change-flag.awaiting')).toHaveText('awaiting')
    await expect(page.locator('.graph-edge.channel.active')).toHaveCount(1)
    await expect.poll(() => page.evaluate(() => window.__birthSeen)).toBe(true)
    await page.evaluate(() => { window.__ghostNode = document.querySelector('[data-node-id="wp:option:fresh_setting"]') })

    await ingest({ source: 'wp', kind: 'wp.option.updated', data: { summary: 'Fresh setting updated', requestId: 'fresh', objectType: 'option', name: 'fresh_setting', channel: 'wp-cli', transport: 'process' } })
    await expect(ghost).not.toHaveClass(/provisional/)
    expect(await page.evaluate(() => window.__ghostNode === document.querySelector('[data-node-id="wp:option:fresh_setting"]'))).toBe(true)
    for (let index = 0; index < 3; index++) await ingest({ source: 'wp', kind: 'wp.option.updated', data: { summary: `Fresh setting follow-up ${index + 1}`, requestId: `fresh-follow-up-${index}`, objectType: 'option', name: 'fresh_setting', channel: 'wp-cli', transport: 'process' } })
    await expect(ghost.locator('.change-row')).toHaveCount(1)
    await expect(ghost.locator('.change-row')).toContainText('4 updates')
    await expect(ghost.locator('.tail-more')).toHaveCount(0)

    await ingest({ source: 'agent', kind: 'agent.action.declared', data: { summary: 'Create a QA post', requestId: 'create-post', objectType: 'post', channel: 'wp-cli', transport: 'docker-exec' } })
    await ingest({ source: 'wp', kind: 'wp.post.created', data: { summary: 'QA post created', requestId: 'create-post', objectType: 'post', objectId: 901, title: 'QA post', status: 'draft', blockCount: 1, channel: 'wp-cli', transport: 'process' } })
    await ingest({ source: 'agent', kind: 'agent.action.declared', data: { summary: 'Inspect unfinished setting', requestId: 'unfinished', objectType: 'option', name: 'unfinished_setting', channel: 'mcp', transport: 'stdio' } })
    await ingest({ source: 'session', kind: 'session.end', data: {} })
    await expect(page.locator('[data-node-id="wp:option:unfinished_setting"]')).toHaveClass(/unconfirmed/)
    await expect(page.locator('[data-node-id="wp:option:unfinished_setting"] .change-flag.unconfirmed')).toHaveText('unconfirmed')

    const moments = await page.evaluate(async sessionId => {
      const events = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/events`).then(response => response.json())
      return {
        claim: events.findIndex(event => event.data?.requestId === 'fresh' && event.kind.endsWith('.declared')),
        confirmation: events.findIndex(event => event.data?.requestId === 'fresh' && event.kind === 'wp.option.updated'),
        createClaim: events.findIndex(event => event.data?.requestId === 'create-post' && event.kind.endsWith('.declared')),
        createConfirmation: events.findIndex(event => event.data?.requestId === 'create-post' && event.kind === 'wp.post.created'),
      }
    }, await page.locator('#session-select').inputValue())
    await page.getByRole('tab', { name: 'Replay' }).click()
    await page.getByRole('slider', { name: 'Replay position' }).fill(String(moments.claim))
    await expect(ghost).toHaveClass(/provisional/)
    await page.evaluate(() => { window.__replayGhost = document.querySelector('[data-node-id="wp:option:fresh_setting"]') })
    await page.getByRole('slider', { name: 'Replay position' }).fill(String(moments.confirmation))
    await expect(ghost).not.toHaveClass(/provisional/)
    expect(await page.evaluate(() => window.__replayGhost === document.querySelector('[data-node-id="wp:option:fresh_setting"]'))).toBe(true)

    await page.getByRole('slider', { name: 'Replay position' }).fill(String(moments.createClaim))
    const createGhost = page.locator('[data-node-id="wp:post:901"]')
    await expect(createGhost).toHaveClass(/provisional/)
    await expect(createGhost.locator('.place-type')).toHaveText('Post')
    await expect(createGhost.locator('.place-address')).toHaveText('')
    await expect(createGhost.locator('.place-name')).toHaveText('New post')
    await expect(page.locator('#playback-caption')).toContainText('New post')
    const createPosition = await createGhost.getAttribute('transform')
    await expect(createGhost).toHaveAttribute('data-territory', 'content')
    await page.evaluate(() => { window.__createGhost = document.querySelector('[data-node-id="wp:post:901"]') })
    await page.getByRole('slider', { name: 'Replay position' }).fill(String(moments.createConfirmation))
    await expect(createGhost).not.toHaveClass(/provisional/)
    await expect(createGhost.locator('.place-address')).toHaveText('901')
    await expect(createGhost.locator('.place-name')).toHaveText('QA post')
    expect(await createGhost.getAttribute('transform')).toBe(createPosition)
    expect(await page.evaluate(() => window.__createGhost === document.querySelector('[data-node-id="wp:post:901"]'))).toBe(true)
  } finally {
    await siteDaemon.close('ghost-test')
    fs.rmSync(trailRoot, { recursive: true, force: true })
  }
})

test('twenty places occupy stable category lanes with one resting channel label', async ({ page }) => {
  const trailRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aphelion-lanes-'))
  const siteDaemon = await startDaemon({ target: 'http://localhost:8081', targetType: 'site', trailDirectory: path.join(trailRoot, 'trails'), port: 6340, watch: false })
  const ingest = event => fetch(`${siteDaemon.url}/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) })
  try {
    for (let index = 0; index < 18; index++) await ingest({ source: 'wp', kind: 'wp.post.updated', data: { objectType: 'post', objectId: index, postType: 'page', title: `Page ${index}`, channel: 'wp-cli' } })
    await page.goto(siteDaemon.url)
    const before = await page.locator('.graph-node.entity').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.nodeId, node.getAttribute('transform')])))
    for (let index = 18; index < 20; index++) await ingest({ source: 'wp', kind: 'wp.post.updated', data: { objectType: 'post', objectId: index, postType: 'page', title: `Page ${index}`, channel: 'wp-cli' } })
    await expect(page.locator('.graph-node.entity')).toHaveCount(20)
    const after = await page.locator('.graph-node.entity').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.nodeId, node.getAttribute('transform')])))
    for (const [id, transform] of Object.entries(before)) expect(after[id]).toBe(transform)
    await expect(page.locator('.graph-lane')).toHaveCount(1)
    await expect(page.locator('.graph-lane-label')).toHaveText('Content')
    const gridShape = await page.locator('.graph-node.entity').evaluateAll(nodes => ({
      columns: new Set(nodes.map(node => node.getAttribute('transform').match(/translate\(([-\d.]+)/)?.[1])).size,
      rows: new Set(nodes.map(node => node.getAttribute('transform').match(/\s([-\d.]+)\)/)?.[1])).size,
    }))
    expect(gridShape).toEqual(page.viewportSize().width <= 680 ? { columns: 1, rows: 20 } : { columns: 5, rows: 5 })
    await expect(page.locator('.graph-edge-label:not([hidden])')).toHaveCount(1)
    await expect(page.locator('.graph-edge-label:not([hidden])')).toHaveText('WP-CLI')
    if (page.viewportSize().width > 680) {
      const geometry = await page.locator('.graph-edge.channel').evaluateAll(paths => {
        const cards = [...document.querySelectorAll('.graph-node.entity:not(.future) .place-card')].map(card => card.getBoundingClientRect())
        const intersections = []
        for (const path of paths) {
          const length = path.getTotalLength()
          const matrix = path.getScreenCTM()
          for (let distance = 1; distance < length - 1; distance += 2) {
            const point = path.getPointAtLength(distance).matrixTransform(matrix)
            if (cards.some(card => point.x > card.left + 1 && point.x < card.right - 1 && point.y > card.top + 1 && point.y < card.bottom - 1)) {
              intersections.push(path.dataset.edgeId)
              break
            }
          }
        }
        return { intersections, hasCurves: paths.some(path => /[CQSA]/i.test(path.getAttribute('d') || '')) }
      })
      expect(geometry.intersections).toEqual([])
      expect(geometry.hasCurves).toBe(false)

      await ingest({ source: 'agent', kind: 'agent.action.declared', data: { requestId: 'twenty-active', objectType: 'post', objectId: 19, postType: 'page', changedProperties: ['content'], summary: 'Update Page 19', channel: 'wp-cli' } })
      const particlePath = page.locator('[data-edge-id="channel:wp-cli:wp:post:19"] .energy-particle animateMotion')
      await expect(particlePath).toHaveAttribute('path', /^M[^CQSA]*H[^CQSA]*V[^CQSA]*H[^CQSA]*V[^CQSA]*H[^CQSA]*$/)
    }
    const livePositions = await page.locator('.graph-node').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.nodeId, node.getAttribute('transform')])))
    await page.getByRole('tab', { name: 'Replay' }).click()
    const replayPositions = await page.locator('.graph-node').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.nodeId, node.getAttribute('transform')])))
    expect(replayPositions).toEqual(livePositions)
  } finally {
    await siteDaemon.close('lanes-test')
    fs.rmSync(trailRoot, { recursive: true, force: true })
  }
})

test('v2 containment renders territory and plugin regions in fixed territory order', async ({ page }) => {
  const trailRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aphelion-containment-'))
  const siteDaemon = await startDaemon({ target: 'http://localhost:8081', targetType: 'site', trailDirectory: path.join(trailRoot, 'trails'), port: 6350, watch: false })
  const ingest = event => fetch(`${siteDaemon.url}/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) })
  try {
    await ingest({ source: 'wp', kind: 'wp.option.updated', data: { objectType: 'option', name: 'blogdescription', channel: 'wp-cli' } })
    await page.goto(siteDaemon.url)
    const tagline = page.locator('[data-node-id="wp:option:blogdescription"]')
    await expect(tagline).toHaveAttribute('data-territory', 'settings')
    await ingest({ source: 'wp', kind: 'wp.post.updated', data: { objectType: 'post', objectId: 464, postType: 'page', title: 'Pricing', channel: 'wp-cli' } })
    await ingest({ source: 'wp', kind: 'wp.option.updated', data: { objectType: 'option', name: 'accelerate_outbound_tracking_enabled', channel: 'wp-cli' } })
    await expect(page.locator('.graph-node.entity')).toHaveCount(3)
    await expect(page.locator('[data-node-id="wp:post:464"]')).toHaveAttribute('data-territory', 'content')
    await expect(page.locator('[data-node-id="wp:option:accelerate_outbound_tracking_enabled"]')).toHaveAttribute('data-owner-plugin', 'altis-accelerate')
    await expect(page.locator('[data-plugin-region="altis-accelerate"] .graph-lane-label')).toHaveText('Altis Accelerate')
    await expect(page.locator('.graph-lane.territory-region')).toHaveCount(3)
    const territoryTops = await page.locator('.graph-lane.territory-region').evaluateAll(regions => Object.fromEntries(regions.map(region => [region.dataset.territory, region.getBBox().y])))
    expect(territoryTops.content).toBeLessThan(territoryTops.plugins)
    expect(territoryTops.plugins).toBeLessThan(territoryTops.settings)
  } finally {
    await siteDaemon.close('containment-test')
    fs.rmSync(trailRoot, { recursive: true, force: true })
  }
})

test('v2 reparenting cross-fades a static guide and tombstones the same leaf in place', async ({ page }, testInfo) => {
  const trailRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aphelion-reparent-'))
  const siteDaemon = await startDaemon({ target: 'http://localhost:8081', targetType: 'site', trailDirectory: path.join(trailRoot, 'trails'), port: 6360, watch: false })
  const ingest = event => fetch(`${siteDaemon.url}/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) })
  try {
    await ingest({ source: 'wp', kind: 'wp.post.updated', data: { objectType: 'post', objectId: 100, postType: 'page', title: 'Parent one', status: 'publish', channel: 'wp-cli' } })
    await ingest({ source: 'wp', kind: 'wp.post.updated', data: { objectType: 'post', objectId: 200, postType: 'page', title: 'Parent two', status: 'publish', channel: 'wp-cli' } })
    await ingest({ source: 'wp', kind: 'wp.post.updated', data: { objectType: 'post', objectId: 300, postType: 'page', title: 'Child page', status: 'publish', parentId: 100, channel: 'wp-cli' } })
    await page.goto(siteDaemon.url)
    const child = page.locator('[data-node-id="wp:post:300"]')
    const childPosition = await child.getAttribute('transform')
    await page.evaluate(() => {
      window.__reparentChild = document.querySelector('[data-node-id="wp:post:300"]')
      window.__sawLeavingGuide = false
      new MutationObserver(() => { if (document.querySelector('.containment-guide.leaving')) window.__sawLeavingGuide = true }).observe(document.querySelector('.graph-containments'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    })
    const guide = page.locator('[data-containment-id="containment:wp:post:300:wp:post:100"]')
    await expect(guide).toHaveCount(1)
    expect(await guide.evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none')
    await expect(guide).not.toHaveAttribute('marker-end', /.+/)

    await ingest({ source: 'wp', kind: 'wp.post.updated', data: { objectType: 'post', objectId: 300, postType: 'page', title: 'Child page', status: 'publish', parentId: 200, channel: 'wp-cli' } })
    await expect(page.locator('[data-containment-id="containment:wp:post:300:wp:post:200"]')).toHaveCount(1)
    await expect(guide).toHaveCount(0)
    expect(await page.evaluate(() => window.__sawLeavingGuide)).toBe(true)
    expect(await page.evaluate(() => window.__reparentChild === document.querySelector('[data-node-id="wp:post:300"]'))).toBe(true)
    expect(await child.getAttribute('transform')).toBe(childPosition)

    await ingest({ source: 'wp', kind: 'wp.option.updated', data: { objectType: 'option', name: 'accelerate_outbound_tracking_enabled', channel: 'wp-cli' } })
    await expect(page.locator('[data-plugin-region="altis-accelerate"]')).toHaveCount(1)
    await page.getByRole('button', { name: 'Fit graph to view' }).click()
    await qaScreenshot(page, testInfo, 'reparent-plugin-option')

    const cameraBeforeGrowth = await page.locator('.work-graph').getAttribute('viewBox')
    await ingest({ source: 'wp', kind: 'wp.post.updated', data: { objectType: 'post', objectId: 400, postType: 'page', title: 'Later page', status: 'publish', channel: 'wp-cli' } })
    await expect(page.locator('[data-node-id="wp:post:400"]')).toHaveCount(1)
    expect(await page.locator('.work-graph').getAttribute('viewBox')).toBe(cameraBeforeGrowth)
    await page.getByRole('button', { name: 'Fit graph to view' }).click()
    expect(await page.locator('.work-graph').getAttribute('viewBox')).not.toBe(cameraBeforeGrowth)

    await ingest({ source: 'wp', kind: 'wp.post.deleted', data: { objectType: 'post', objectId: 300, postType: 'page', title: 'Child page', parentId: 200, channel: 'wp-cli' } })
    await ingest({ source: 'wp', kind: 'wp.option.updated', data: { objectType: 'option', name: 'blogdescription', channel: 'wp-cli' } })
    await expect(child).toHaveAttribute('data-size-tier', 'tombstone')
    await expect(child.locator('.place-card')).toHaveCSS('height', '58px')
    expect(await child.getAttribute('transform')).toBe(childPosition)
  } finally {
    await siteDaemon.close('reparent-test')
    fs.rmSync(trailRoot, { recursive: true, force: true })
  }
})

test('v2 scale posture keeps 200 places navigable', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  const trailRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aphelion-scale-'))
  const siteDaemon = await startDaemon({ target: 'http://localhost:8081', targetType: 'site', trailDirectory: path.join(trailRoot, 'trails'), port: 6370, watch: false })
  const ingest = event => fetch(`${siteDaemon.url}/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) })
  try {
    for (let index = 0; index < 200; index++) await ingest(index % 2 === 0
      ? { source: 'wp', kind: 'wp.post.updated', data: { requestId: `scale-${index}`, objectType: 'post', objectId: index + 1, postType: 'page', title: `Scale page ${index + 1}`, status: 'publish', channel: 'wp-cli' } }
      : { source: 'wp', kind: 'wp.option.updated', data: { requestId: `scale-${index}`, objectType: 'option', name: `scale_setting_${index + 1}`, channel: 'wp-cli' } })
    await page.goto(siteDaemon.url)
    await expect(page.locator('.graph-node.entity')).toHaveCount(200)
    await expect(page.locator('.graph-edge.channel')).toHaveCount(24)
    const focusedView = (await page.locator('.work-graph').getAttribute('viewBox')).split(/\s+/).map(Number)
    expect(focusedView[2]).toBeLessThanOrEqual(720)
    const viewport = page.viewportSize()
    const expectedAspect = viewport.width / (viewport.height - 48)
    expect(Math.abs(focusedView[2] / focusedView[3] - expectedAspect)).toBeLessThan(.03)
    const focusContained = await page.evaluate(() => {
      const canvas = document.querySelector('.map-surface').getBoundingClientRect()
      const card = document.querySelector('[data-node-id="wp:option:scale_setting_200"] .place-card').getBoundingClientRect()
      return card.left >= canvas.left - 1 && card.top >= canvas.top - 1 && card.right <= canvas.right + 1 && card.bottom <= canvas.bottom + 1
    })
    expect(focusContained).toBe(true)
    await qaScreenshot(page, testInfo, '200-places')
    const settingPosition = await page.locator('[data-node-id="wp:option:scale_setting_2"]').getAttribute('transform')
    await expect(page.getByRole('toolbar', { name: 'Filter map by territory' })).toBeVisible()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.locator('.graph-node.entity:not(.filtered)')).toHaveCount(100)
    await expect(page.locator('.graph-edge.channel')).toHaveCount(24)
    expect(await page.locator('[data-node-id="wp:option:scale_setting_2"]').getAttribute('transform')).toBe(settingPosition)
    await page.getByRole('button', { name: 'All', exact: true }).click()
    await expect(page.locator('.graph-node.entity:not(.filtered)')).toHaveCount(200)
    const positions = await page.locator('.graph-node').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.nodeId, node.getAttribute('transform')])))
    await page.getByRole('tab', { name: 'Replay' }).click()
    const replayPositions = await page.locator('.graph-node').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.nodeId, node.getAttribute('transform')])))
    expect(replayPositions).toEqual(positions)

  } finally {
    await siteDaemon.close('scale-test')
    fs.rmSync(trailRoot, { recursive: true, force: true })
  }
})

test('v2 keeps 300 edits on one page spatially singular', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  const trailRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aphelion-edits-'))
  const siteDaemon = await startDaemon({ target: 'http://localhost:8081', targetType: 'site', trailDirectory: path.join(trailRoot, 'trails'), port: 6380, watch: false })
  const ingest = event => fetch(`${siteDaemon.url}/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) })
  try {
    for (let index = 0; index < 300; index++) await ingest({ source: 'wp', kind: 'wp.post.updated', data: { requestId: `edit-${index}`, objectType: 'post', objectId: 999, postType: 'page', title: 'One intensely edited page', status: 'draft', changedProperties: ['content'], channel: 'wp-cli' } })
    await page.goto(siteDaemon.url)
    await expect(page.locator('.graph-node.entity')).toHaveCount(1)
    await expect(page.locator('[data-node-id="wp:post:999"] .change-row')).toHaveCount(1)
    await expect(page.locator('[data-node-id="wp:post:999"] .change-row')).toContainText('300 block edits')
    await qaScreenshot(page, testInfo, '300-edits-one-page')
  } finally {
    await siteDaemon.close('edits-test')
    fs.rmSync(trailRoot, { recursive: true, force: true })
  }
})

test('v2 full fit contains every card and channel label below the scale ceiling', async ({ page }, testInfo) => {
  const trailRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aphelion-camera-small-'))
  const siteDaemon = await startDaemon({ target: 'http://localhost:8081', targetType: 'site', trailDirectory: path.join(trailRoot, 'trails'), port: 6390, watch: false })
  const ingest = event => fetch(`${siteDaemon.url}/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) })
  try {
    await ingest({ source: 'wp', kind: 'wp.option.updated', data: { requestId: 'setting', objectType: 'option', name: 'blogdescription', channel: 'wp-cli' } })
    await ingest({ source: 'wp', kind: 'wp.post.updated', data: { requestId: 'page', objectType: 'post', objectId: 464, postType: 'page', title: 'Camera QA page', status: 'publish', channel: 'wp-cli' } })
    await ingest({ source: 'wp', kind: 'wp.option.updated', data: { requestId: 'plugin', objectType: 'option', name: 'accelerate_outbound_tracking_enabled', channel: 'wp-cli' } })
    await page.goto(siteDaemon.url)
    await expect(page.locator('.graph-node.entity')).toHaveCount(3)
    const containment = await page.evaluate(() => {
      const canvas = document.querySelector('.map-surface').getBoundingClientRect()
      const subjects = [...document.querySelectorAll('.graph-node:not(.future):not(.filtered), .graph-edge-label:not([hidden])')]
      const outside = subjects.filter(element => {
        const rect = element.getBoundingClientRect()
        return rect.left < canvas.left - 1 || rect.top < canvas.top - 1 || rect.right > canvas.right + 1 || rect.bottom > canvas.bottom + 1
      }).map(element => element.dataset.nodeId || element.textContent)
      return { outside, subjectCount: subjects.length }
    })
    expect(containment.subjectCount).toBeGreaterThan(3)
    expect(containment.outside).toEqual([])
    const defaultViewBox = await page.locator('.work-graph').getAttribute('viewBox')
    await page.getByRole('button', { name: 'Fit graph to view' }).click()
    expect(await page.locator('.work-graph').getAttribute('viewBox')).toBe(defaultViewBox)
    const territoryTops = await page.locator('.graph-lane.territory-region').evaluateAll(regions => Object.fromEntries(regions.map(region => [region.dataset.territory, region.getBBox().y])))
    expect(territoryTops.content).toBeLessThan(territoryTops.plugins)
    expect(territoryTops.plugins).toBeLessThan(territoryTops.settings)
    await qaHScreenshot(page, testInfo, '3-place-full-fit')
  } finally {
    await siteDaemon.close('camera-small-test')
    fs.rmSync(trailRoot, { recursive: true, force: true })
  }
})

test('v2 sentence framing centers and contains the active target above the ceiling', async ({ page }, testInfo) => {
  const trailRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aphelion-camera-sentence-'))
  const siteDaemon = await startDaemon({ target: 'http://localhost:8081', targetType: 'site', trailDirectory: path.join(trailRoot, 'trails'), port: 6400, watch: false })
  const ingest = event => fetch(`${siteDaemon.url}/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) })
  try {
    for (let index = 1; index <= 30; index++) await ingest({ source: 'wp', kind: 'wp.post.updated', data: { requestId: `seed-${index}`, objectType: 'post', objectId: index, postType: 'page', title: `Camera page ${index}`, status: 'publish', channel: 'wp-cli' } })
    await ingest({ source: 'agent', kind: 'agent.action.declared', data: { requestId: 'active-camera', objectType: 'post', objectId: 30, postType: 'page', summary: 'Edit Camera page 30', channel: 'wp-cli' } })
    await page.goto(siteDaemon.url)
    const target = page.locator('[data-node-id="wp:post:30"]')
    await expect(target).toHaveClass(/claimed/)
    const activeViewBox = await page.locator('.work-graph').getAttribute('viewBox')
    const framing = await page.evaluate(() => {
      const canvas = document.querySelector('.map-surface').getBoundingClientRect()
      const card = document.querySelector('[data-node-id="wp:post:30"] .place-card').getBoundingClientRect()
      const label = document.querySelector('.graph-edge-label.active:not([hidden])').getBoundingClientRect()
      return {
        contained: card.left >= canvas.left - 1 && card.top >= canvas.top - 1 && card.right <= canvas.right + 1 && card.bottom <= canvas.bottom + 1 && label.left >= canvas.left - 1 && label.right <= canvas.right + 1,
        dx: Math.abs((card.left + card.right) / 2 - (canvas.left + canvas.right) / 2) / canvas.width,
        dy: Math.abs((card.top + card.bottom) / 2 - (canvas.top + canvas.bottom) / 2) / canvas.height,
      }
    })
    expect(framing.contained).toBe(true)
    expect(framing.dx).toBeLessThan(.14)
    expect(framing.dy).toBeLessThan(.18)
    await qaHScreenshot(page, testInfo, '30-place-active-sentence')

    await page.getByRole('tab', { name: 'Replay' }).click()
    expect(await page.locator('.work-graph').getAttribute('viewBox')).toBe(activeViewBox)
    await page.getByRole('tab', { name: 'Live' }).click()
    await ingest({ source: 'wp', kind: 'wp.post.updated', data: { requestId: 'active-camera', objectType: 'post', objectId: 30, postType: 'page', title: 'Camera page 30', status: 'publish', changedProperties: ['content'], channel: 'wp-cli' } })
    await expect(target).not.toHaveClass(/claimed/)
    expect(await page.locator('.work-graph').getAttribute('viewBox')).toBe(activeViewBox)
    await ingest({ source: 'wp', kind: 'presence.close', data: { requestId: 'active-camera', connectionId: 'active-camera', channel: 'wp-cli' } })
    expect(await page.locator('.work-graph').getAttribute('viewBox')).toBe(activeViewBox)
    const settledContained = await page.evaluate(() => {
      const canvas = document.querySelector('.map-surface').getBoundingClientRect()
      const card = document.querySelector('[data-node-id="wp:post:30"] .place-card').getBoundingClientRect()
      return card.left >= canvas.left - 1 && card.top >= canvas.top - 1 && card.right <= canvas.right + 1 && card.bottom <= canvas.bottom + 1
    })
    expect(settledContained).toBe(true)
  } finally {
    await siteDaemon.close('camera-sentence-test')
    fs.rmSync(trailRoot, { recursive: true, force: true })
  }
})

test('wide-run projection keeps five nouns, semantic evidence, and a composed small map', async ({ page }, testInfo) => {
  const trailRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aphelion-wide-run-'))
  const siteDaemon = await startDaemon({ target: 'http://localhost:8081', targetType: 'site', trailDirectory: path.join(trailRoot, 'trails'), port: 6410, watch: false })
  const ingest = event => fetch(`${siteDaemon.url}/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) })
  try {
    const events = [
      { source: 'sidecar', kind: 'runtime.site.identity', data: { siteName: 'Accelerate Demo', channel: 'wp-cli' } },
      { source: 'wp', kind: 'wp.option.updated', data: { requestId: 'tagline', objectType: 'option', name: 'blogdescription', channel: 'wp-cli' } },
      { source: 'wp', kind: 'wp.option.updated', data: { requestId: 'toggle-on', objectType: 'option', name: 'accelerate_outbound_tracking_enabled', channel: 'wp-cli' } },
      { source: 'adapter', kind: 'adapter.accelerate.changed', data: { requestId: 'toggle-on', objectType: 'option', name: 'accelerate_outbound_tracking_enabled', adapter: 'altis-accelerate', rawKind: 'wp.option.updated', summary: 'Accelerate changed outbound tracking', channel: 'wp-cli' } },
      { source: 'wp', kind: 'wp.option.updated', data: { requestId: 'toggle-off', objectType: 'option', name: 'accelerate_outbound_tracking_enabled', channel: 'wp-cli' } },
      { source: 'adapter', kind: 'adapter.accelerate.changed', data: { requestId: 'toggle-off', objectType: 'option', name: 'accelerate_outbound_tracking_enabled', adapter: 'altis-accelerate', rawKind: 'wp.option.updated', summary: 'Accelerate changed outbound tracking', channel: 'wp-cli' } },
      { source: 'wp', kind: 'wp.post.created', data: { requestId: 'create', objectType: 'post', objectId: 476, postType: 'post', title: 'Aphelion wide-run scratch', channel: 'wp-cli' } },
      { source: 'wp', kind: 'wp.post.updated', data: { requestId: 'edit', objectType: 'post', objectId: 476, postType: 'post', title: 'Aphelion wide-run scratch', changedProperties: ['content'], channel: 'wp-cli' } },
      { source: 'wp', kind: 'wp.post.trashed', data: { requestId: 'trash', objectType: 'post', objectId: 476, postType: 'post', title: 'Aphelion wide-run scratch', channel: 'wp-cli' } },
      { source: 'wp', kind: 'wp.post.deleted', data: { requestId: 'delete', objectType: 'post', objectId: 477, postType: 'revision', post_parent: 476, title: 'Aphelion wide-run scratch', channel: 'wp-cli' } },
      { source: 'wp', kind: 'wp.post.deleted', data: { requestId: 'delete', objectType: 'post', objectId: 476, postType: 'post', title: 'Aphelion wide-run scratch', channel: 'wp-cli' } },
      { source: 'wp', kind: 'wp.term.created', data: { requestId: 'term-create', objectType: 'term', objectId: 51, title: 'Aphelion QA', channel: 'wp-cli' } },
      { source: 'wp', kind: 'wp.term.deleted', data: { requestId: 'term-delete', objectType: 'term', objectId: 51, title: 'Aphelion QA', channel: 'wp-cli' } },
      { source: 'wp', kind: 'wp.post.updated', data: { requestId: 'rename', objectType: 'post', objectId: 339, postType: 'page', title: 'Home', changedProperties: ['title'], actor: 'WordPress sidecar', channel: 'wp-cli' } },
    ]
    for (const event of events) await ingest(event)
    await page.goto(siteDaemon.url)
    await expect(page.locator('.graph-node.entity')).toHaveCount(5)
    await expect(page.locator('[data-node-id="wp:post:477"]')).toHaveCount(0)
    await expect(page.locator('[data-node-id="wp:site"] .place-state')).toContainText('5 places touched')
    const accelerate = page.locator('[data-node-id="wp:option:accelerate_outbound_tracking_enabled"]')
    await expect(accelerate.locator('.change-row')).toHaveCount(1)
    await expect(accelerate.locator('.change-row')).toContainText('2 changes')

    await accelerate.click()
    await expect(page.locator('#place-panel .inspector-change')).toHaveCount(2)
    const evidence = await page.locator('#place-panel .inspector-change').allTextContents()
    expect(evidence.every(row => row.includes('wp.option.updated') && row.includes('adapter.accelerate.changed'))).toBe(true)
    await page.locator('#inspector-close').click()
    await expect(page.locator('#inspector')).toHaveAttribute('aria-hidden', 'true')
    await page.waitForTimeout(350)

    const geometry = await page.evaluate(() => {
      const position = id => {
        const matrix = document.querySelector(`[data-node-id="${id}"]`).transform.baseVal.consolidate().matrix
        return { x: matrix.e, y: matrix.f }
      }
      const labels = [...document.querySelectorAll('.graph-edge-label:not([hidden])')]
      const canvas = document.querySelector('.map-surface').getBoundingClientRect()
      const clippedLabels = labels.filter(label => { const rect = label.getBoundingClientRect(); return rect.left < canvas.left - 1 || rect.right > canvas.right + 1 }).length
      const territory = document.querySelector('.territory-region[data-territory="plugins"] .graph-lane-label').getBoundingClientRect()
      const plugin = document.querySelector('[data-plugin-region="altis-accelerate"] .graph-lane-label').getBoundingClientRect()
      const overlaps = !(territory.right <= plugin.left || plugin.right <= territory.left || territory.bottom <= plugin.top || plugin.bottom <= territory.top)
      return { root: position('wp:site'), post: position('wp:post:476'), page: position('wp:post:339'), term: position('wp:term:51'), plugin: position('wp:option:accelerate_outbound_tracking_enabled'), setting: position('wp:option:blogdescription'), clippedLabels, overlaps }
    })
    expect(geometry.clippedLabels).toBe(0)
    expect(geometry.overlaps).toBe(false)
    if (testInfo.project.name === 'desktop') {
      expect(geometry.root.y).toBe(geometry.post.y)
      expect(geometry.root.y).toBe(geometry.page.y)
      expect(geometry.term.y).toBe(geometry.plugin.y)
      expect(geometry.setting.y).toBe(geometry.term.y)
      expect(geometry.term.x).toBeLessThan(geometry.plugin.x)
      expect(geometry.plugin.x).toBeLessThan(geometry.setting.x)
      const caption = page.locator('.playback-caption')
      await expect(caption).toContainText('Sidecar · WP-CLI → Home')
      expect(await caption.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    }
    await qaIScreenshot(page, testInfo, '5-place-wide-run')
  } finally {
    await siteDaemon.close('wide-run-test')
    fs.rmSync(trailRoot, { recursive: true, force: true })
  }
})

test('twenty content places form an append-stable balanced block', async ({ page }, testInfo) => {
  test.slow()
  const trailRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aphelion-composition-20-'))
  const siteDaemon = await startDaemon({ target: 'http://localhost:8081', targetType: 'site', trailDirectory: path.join(trailRoot, 'trails'), port: 6420, watch: false })
  const ingest = index => fetch(`${siteDaemon.url}/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'wp', kind: 'wp.post.updated', data: { requestId: `page-${index}`, objectType: 'post', objectId: index, postType: 'page', title: `Composition page ${index}`, status: 'publish', channel: 'wp-cli' } }) })
  try {
    for (let index = 1; index <= 18; index++) await ingest(index)
    await page.goto(siteDaemon.url)
    const before = await page.locator('.graph-node').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.nodeId, node.getAttribute('transform')])))
    await ingest(19)
    await ingest(20)
    await expect(page.locator('.graph-node.entity')).toHaveCount(20)
    const live = await page.locator('.graph-node').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.nodeId, node.getAttribute('transform')])))
    for (const [id, transform] of Object.entries(before)) expect(live[id]).toBe(transform)
    if (testInfo.project.name === 'desktop') {
      const positions = await page.locator('.graph-node').evaluateAll(nodes => nodes.map(node => {
        const matrix = node.transform.baseVal.consolidate().matrix
        return { x: matrix.e, y: matrix.f }
      }))
      expect(new Set(positions.map(item => item.x)).size).toBe(5)
      expect(new Set(positions.map(item => item.y)).size).toBe(5)
    }
    await page.getByRole('tab', { name: 'Replay' }).click()
    const replay = await page.locator('.graph-node').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.nodeId, node.getAttribute('transform')])))
    expect(replay).toEqual(live)
    if (testInfo.project.name === 'desktop') expect(await page.locator('.playback-caption').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await qaIScreenshot(page, testInfo, '20-place-balanced')
  } finally {
    await siteDaemon.close('composition-20-test')
    fs.rmSync(trailRoot, { recursive: true, force: true })
  }
})
