import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const source = path.join(root, 'src', 'board')
const output = path.join(root, 'public')
const html = fs.readFileSync(path.join(source, 'index.html'), 'utf8')
const css = fs.readFileSync(path.join(source, 'styles.css'), 'utf8')
const javascript = fs.readFileSync(path.join(source, 'app.js'), 'utf8')
const built = html
  .replace('<link rel="stylesheet" href="/assets/styles.css">', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="/assets/app.js"></script>', `<script type="module">\n${javascript}\n</script>`)

if (!built.includes('seed b3813012')) throw new Error('Design direction contract was lost during board assembly')
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(path.join(output, 'index.html'), built)
console.log(`built public/index.html (${Buffer.byteLength(built).toLocaleString()} bytes)`)
