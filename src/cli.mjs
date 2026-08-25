import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { startDaemon, relayHook } from './daemon/server.mjs'
import { discoverSessions } from './trail/reader.mjs'
import { renderTimelapse } from './timelapse/render.mjs'

const HELP = `aphelion — local flight recorder for AI agents working on WordPress

Usage:
  aphelion [target] [--open] [--port 5330]
  aphelion serve [target] [--open] [--port 5330]
  aphelion sessions [target]
  aphelion timelapse <trail.jsonl> [--output trail.html|trail.mp4]
  aphelion hook
  aphelion --help

Options:
  --open              Open the live board in your browser
  --port <number>     Preferred loopback port (falls forward when occupied)
  --idle-timeout <m>  End inactive sessions after this many minutes (default: 30)
  --site <url>        Record as a site target instead of a project target
  --integrity         Add optional SHA-256 prev links to the trail
  --no-watch          Start without a repository watcher
  --audit-log <path>  Collect the Aphelion mu-plugin's site-local JSONL
  --debug-log <path>  Collect WordPress debug.log lines with redaction
  --wp-command <json> WP-CLI command as a JSON array; no shell evaluation
  --output <path>     Timelapse output (.html or .mp4)
  --version           Print the installed version

Aphelion binds to 127.0.0.1, keeps its trail locally, and never controls an agent.
`

function parseArguments(argv) {
  const args = [...argv]
  let command = 'serve'
  if (['serve', 'sessions', 'timelapse', 'hook'].includes(args[0])) command = args.shift()
  const options = { target: process.cwd(), port: 5330, open: false, integrity: false, watch: true, targetType: 'project' }
  const positional = []
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--help' || argument === '-h') options.help = true
    else if (argument === '--version' || argument === '-v') options.version = true
    else if (argument === '--open') options.open = true
    else if (argument === '--integrity') options.integrity = true
    else if (argument === '--no-watch') options.watch = false
    else if (argument === '--audit-log') options.auditLog = path.resolve(args[++index] || '')
    else if (argument === '--debug-log') options.debugLog = path.resolve(args[++index] || '')
    else if (argument === '--wp-command') {
      try { options.wpCommand = JSON.parse(args[++index]) } catch { throw new Error('--wp-command requires a JSON array') }
      if (!Array.isArray(options.wpCommand) || !options.wpCommand.length || options.wpCommand.some(value => typeof value !== 'string')) throw new Error('--wp-command requires a non-empty JSON string array')
    }
    else if (argument === '--output') options.output = path.resolve(args[++index] || '')
    else if (argument === '--idle-timeout') {
      const value = Number(args[++index])
      if (!Number.isFinite(value) || value <= 0) throw new Error('--idle-timeout requires a positive number of minutes')
      options.idleTimeoutMs = value * 60_000
    }
    else if (argument === '--port') {
      const value = Number(args[++index])
      if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('--port requires a valid port number')
      options.port = value
    } else if (argument === '--site') {
      options.target = args[++index]
      if (!options.target) throw new Error('--site requires a URL')
      options.targetType = 'site'
    } else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`)
    else positional.push(argument)
  }
  if (positional.length > 1) throw new Error(command === 'timelapse' ? 'Only one trail file may be provided' : 'Only one target path may be provided')
  if (positional[0]) {
    if (command === 'timelapse') options.input = path.resolve(positional[0])
    else options.target = path.resolve(positional[0])
  }
  return { command, options }
}

function openBrowser(url) {
  const spec = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]]
  const child = spawn(spec[0], spec[1], { detached: true, stdio: 'ignore' })
  child.unref()
}

async function readStdin() {
  let value = ''
  for await (const chunk of process.stdin) value += chunk
  return value
}

export async function runCli(argv = process.argv.slice(2), io = console) {
  const { command, options } = parseArguments(argv)
  if (options.help) { io.log(HELP.trimEnd()); return 0 }
  if (options.version) { io.log('0.1.0'); return 0 }
  if (command === 'hook') {
    const raw = await readStdin()
    if (raw) await relayHook(raw, { port: process.env.APHELION_PORT })
    return 0
  }
  if (command === 'sessions') {
    const sessions = await discoverSessions(options.target, { targetType: options.targetType })
    if (!sessions.length) io.log('No aphelion sessions found.')
    else for (const session of sessions) io.log(`${session.id}\t${session.size} bytes\t${session.path}`)
    return 0
  }
  if (command === 'timelapse') {
    if (!options.input) throw new Error('timelapse requires a trail JSONL file')
    if (!fs.existsSync(options.input)) throw new Error(`Trail does not exist: ${options.input}`)
    const output = options.output || options.input.replace(/\.jsonl$/i, '') + '.timelapse.html'
    const result = await renderTimelapse(options.input, output)
    io.log(`timelapse: ${result.output}`)
    io.log(`frames: ${result.frames}`)
    return 0
  }
  if (options.targetType === 'project' && !fs.existsSync(options.target)) throw new Error(`Target does not exist: ${options.target}`)
  const daemon = await startDaemon(options)
  io.log(`aphelion observing ${daemon.target}`)
  io.log(`board: ${daemon.url}`)
  io.log(`trail: ${daemon.trailPath}`)
  if (options.open) openBrowser(daemon.url)
  const shutdown = async signal => {
    await daemon.close(signal)
    process.exitCode = 0
  }
  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
  return new Promise(() => {})
}

export { HELP, parseArguments }
