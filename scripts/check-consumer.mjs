import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aphelion-consumer-'))
const consumer = path.join(temporary, 'consumer')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd || root, encoding: 'utf8', env: process.env })
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || `${command} failed`)
    process.exitCode = result.status || 1
    throw new Error(`${command} ${args.join(' ')} failed`)
  }
  return result.stdout
}

try {
  const packed = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary]))[0]
  const tarball = path.join(temporary, packed.filename)
  fs.mkdirSync(consumer)
  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'aphelion-consumer-smoke', private: true, type: 'module' }))
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: consumer })
  const help = run(path.join(consumer, 'node_modules', '.bin', 'aphelion'), ['--help'], { cwd: consumer })
  if (!help.includes('Usage:') || !help.includes('aphelion serve')) throw new Error('installed CLI did not render its help contract')
  run(process.execPath, ['--input-type=module', '--eval', "const api = await import('aphelion'); if (typeof api.createTrailWriter !== 'function' || typeof api.startDaemon !== 'function') process.exit(1)"], { cwd: consumer })
  console.log(`consumer check: installed ${packed.filename}, imported the ESM API, and executed the CLI`)
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}
