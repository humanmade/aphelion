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
    await expect(ghost.locator('.tail-more')).toHaveAttribute('aria-label', 'Show 1 earlier change for Fresh Setting')

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
    const rootPosition = await page.locator('[data-node-id="wp:site"]').getAttribute('transform')
    const sharedAxis = page.viewportSize().width <= 680 ? 0 : 1
    expect(createPosition.split(/\s+/)[sharedAxis]).toBe(rootPosition.split(/\s+/)[sharedAxis])
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
    await expect(page.locator('.graph-lane')).toHaveCount(page.viewportSize().width <= 680 ? 0 : 1)
    const gridShape = await page.locator('.graph-node.entity').evaluateAll(nodes => ({
      columns: new Set(nodes.map(node => node.getAttribute('transform').match(/translate\(([-\d.]+)/)?.[1])).size,
      rows: new Set(nodes.map(node => node.getAttribute('transform').match(/\s([-\d.]+)\)/)?.[1])).size,
    }))
    expect(gridShape).toEqual(page.viewportSize().width <= 680 ? { columns: 1, rows: 20 } : { columns: 4, rows: 5 })
    await expect(page.locator('.graph-edge-label:not([hidden])')).toHaveCount(1)
    await expect(page.locator('.graph-edge-label:not([hidden])')).toHaveText('WP-CLI')
    const livePositions = await page.locator('.graph-node').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.nodeId, node.getAttribute('transform')])))
    await page.getByRole('tab', { name: 'Replay' }).click()
    const replayPositions = await page.locator('.graph-node').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.nodeId, node.getAttribute('transform')])))
    expect(replayPositions).toEqual(livePositions)
  } finally {
    await siteDaemon.close('lanes-test')
    fs.rmSync(trailRoot, { recursive: true, force: true })
  }
})
