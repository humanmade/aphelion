function toolDetail(input = {}) {
  const value = input.file_path || input.notebook_path || input.command || input.pattern || input.url || input.query || input.prompt || ''
  return String(value).replace(/\s+/g, ' ').slice(0, 240)
}

function mcpDetails(tool = '', input = {}) {
  const parts = String(tool).split('__').filter(Boolean)
  return {
    server: parts.length > 2 ? parts[1] : null,
    ability: input.ability || input.name || parts.slice(2).join('/') || tool,
    tool,
    requestId: input.correlationId || input.requestId || null,
    detail: toolDetail(input),
  }
}

export function classifyHookEvent(event = {}) {
  const hook = event.hook_event_name || event.event || ''
  const tool = event.tool_name || event.tool || ''
  const input = event.tool_input || event.input || {}
  const sessionId = event.session_id || event.sessionId || 'agent-session'
  const common = { sessionId, actor: event.agent || 'claude', cwd: event.cwd || null }
  if (hook === 'SessionStart') return [{ source: 'hook', kind: 'presence.open', data: { ...common, connectionId: sessionId, channel: 'agent-hook', transport: 'stdio' } }]
  if (hook === 'Stop' || hook === 'SessionEnd') return [
    { source: 'hook', kind: 'presence.close', data: { ...common, connectionId: sessionId, channel: 'agent-hook', transport: 'stdio' } },
    { source: 'mcp', kind: 'presence.close', data: { ...common, connectionId: sessionId, channel: 'mcp', transport: event.transport || input.transport || 'agent-hook' } },
  ]
  if (hook === 'PreToolUse') {
    if (String(tool).startsWith('mcp__')) {
      const transport = event.transport || input.transport || 'agent-hook'
      return [
        { source: 'mcp', kind: 'presence.ready', data: { ...common, connectionId: sessionId, channel: 'mcp', transport } },
        { source: 'mcp', kind: 'mcp.ability.call', data: { ...common, ...mcpDetails(tool, input), channel: 'mcp', transport } },
      ]
    }
    return [{ source: 'hook', kind: 'tool.pre', data: { ...common, tool, detail: toolDetail(input) } }]
  }
  if (hook === 'PostToolUse') return [{ source: String(tool).startsWith('mcp__') ? 'mcp' : 'hook', kind: 'tool.post', data: { ...common, tool, detail: toolDetail(input), failed: Boolean(event.error) } }]
  return []
}
