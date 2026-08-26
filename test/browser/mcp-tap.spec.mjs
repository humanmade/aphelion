import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { startDaemon } from '../../src/index.mjs'

let daemon
let root

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aphelion-mcp-browser-'))
  daemon = await startDaemon({
    target: 'http://localhost:8081',
    targetType: 'site',
    trailDirectory: path.join(root, 'trails'),
    port: 6460,
    watch: false,
  })
  const startedAt = Date.now()
  const events = [
    { source: 'mcp', kind: 'presence.open', ts: startedAt, data: { connectionId: 'mcp-browser', channel: 'mcp', transport: 'stdio', actor: { name: 'Tap agent', version: '1.0' }, server: { name: 'WordPress MCP', version: '2.0' } } },
    { source: 'mcp', kind: 'agent.action.declared', ts: startedAt + 1_000, data: { requestId: 'json-rpc-1', correlationId: 'mcp-correlation-1', summary: 'Called wp.update_option', tool: 'wp.update_option', objectType: 'option', name: 'blogdescription', objectHintKeys: ['option'], channel: 'mcp', transport: 'stdio', actor: { name: 'Tap agent', version: '1.0' } } },
    { source: 'wp', kind: 'wp.option.updated', ts: startedAt + 12_000, data: { requestId: 'wordpress-effect-1', objectType: 'option', name: 'blogdescription', channel: 'rest', transport: 'http' } },
    { source: 'mcp', kind: 'agent.action.declared', ts: startedAt + 13_000, data: { requestId: 'json-rpc-2', correlationId: 'mcp-correlation-2', summary: 'Called wp.update_option', tool: 'wp.update_option', objectType: 'option', name: 'blogname', objectHintKeys: ['option'], channel: 'mcp', transport: 'stdio', actor: { name: 'Tap agent', version: '1.0' } } },
    { source: 'mcp', kind: 'agent.action.declared', ts: startedAt + 14_000, data: { requestId: 'json-rpc-3', correlationId: 'mcp-correlation-3', summary: 'Called wp.search', tool: 'wp.search', objectHintKeys: [], channel: 'mcp', transport: 'stdio', actor: { name: 'Tap agent', version: '1.0' } } },
    { source: 'session', kind: 'session.end', ts: startedAt + 15_000, data: { reason: 'fixture complete' } },
  ]
  for (const event of events) {
    await fetch(`${daemon.url}/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    })
  }
})

test.afterAll(async () => {
  await daemon?.close('browser-test')
  fs.rmSync(root, { recursive: true, force: true })
})

test('MCP tap shows its live actor flow, inferred confirmation evidence, and session-end unconfirmed claim', async ({ page }) => {
  await page.goto(daemon.url)
  await page.getByRole('tab', { name: 'Replay' }).click()
  const scrubber = page.locator('#scrubber')
  const beforeEnd = await scrubber.evaluate(element => Number(element.max) - 1)
  await scrubber.evaluate((element, value) => {
    element.value = String(value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }, beforeEnd)

  await expect(page.locator('.graph-edge-label.active')).toContainText('MCP · Tap agent')
  await expect(page.locator('[data-node-id="wp:option:blogname"] .change-flag')).toHaveText('awaiting')
  await page.locator('[data-node-id="wp:option:blogdescription"]').click()
  await expect(page.locator('#place-panel')).toContainText('Matched by object and time, not request ID')

  const atEnd = await scrubber.evaluate(element => Number(element.max))
  await scrubber.evaluate((element, value) => {
    element.value = String(value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }, atEnd)
  await expect(page.locator('[data-node-id="wp:option:blogname"] .change-flag')).toHaveText('unconfirmed')
})
