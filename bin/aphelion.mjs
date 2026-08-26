#!/usr/bin/env node
import { runCli } from '../src/cli.mjs'

runCli().then(code => {
  process.exitCode = code
}).catch(error => {
  console.error(`aphelion: ${error.message}`)
  process.exitCode = 1
})
