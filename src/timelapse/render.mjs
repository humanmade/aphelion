import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { projectEvents, summarizeEvent } from '../trail/reducer.mjs'
import { readTrail } from '../trail/reader.mjs'

function xml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]))
}

function sampleIndices(length, maxFrames) {
  if (!length) return []
  const count = Math.min(length, Math.max(2, maxFrames))
  return [...new Set(Array.from({ length: count }, (_, index) => Math.round(index * (length - 1) / (count - 1))))]
}

function wrap(text, limit = 46) {
  const words = String(text || '').split(/\s+/)
  const lines = []
  let line = ''
  for (const word of words) {
    if (`${line} ${word}`.trim().length > limit && line) { lines.push(line); line = word }
    else line = `${line} ${word}`.trim()
  }
  if (line) lines.push(line)
  return lines.slice(0, 3)
}

function renderFont() {
  return [
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Supplemental/Verdana.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
  ].find(candidate => fs.existsSync(candidate)) || null
}

export function renderFrameSvg(projection, event, options = {}) {
  const width = options.width || 1280
  const height = options.height || 720
  const recent = projection.recent.slice(0, 7)
  const components = projection.plan.nodes.filter(node => node.level === 'component').slice(0, 6)
  const journeys = Object.values(projection.journeys || {})
  const journey = journeys.filter(item => item.declaredAt !== null && item.phases.length > 1).sort((a, b) => b.lastAt - a.lastAt)[0]
    || journeys.sort((a, b) => b.phases.length - a.phases.length || b.lastAt - a.lastAt)[0]
  const journeyPhases = journey
    ? journey.phases.length <= 4
      ? journey.phases
      : [journey.phases.find(phase => phase.class === 'declared') || journey.phases[0], ...journey.phases.slice(-3)].filter((phase, index, phases) => phases.findIndex(candidate => candidate.seq === phase.seq) === index)
    : []
  const summaryLines = wrap(summarizeEvent(event), 44)
  const target = projection.session?.target || 'WordPress project'
  const progress = Math.max(0, Math.min(1, options.progress || 0))
  const evidenceStart = journeyPhases.length || components.length ? 386 : 348
  const evidence = recent.slice(0, journeyPhases.length || components.length ? 6 : 7).map((item, index) => {
    const y = evidenceStart + index * 42
    const color = item.kind.startsWith('wp.') || item.kind.startsWith('file.') ? '#e5ad4f' : item.kind.startsWith('presence.') ? '#52d68f' : '#65a7ff'
    return `<circle cx="79" cy="${y - 5}" r="5" fill="${color}"/><text x="98" y="${y}" class="row">${xml(item.summary).slice(0, 83)}</text><text x="1134" y="${y}" text-anchor="end" class="meta">${xml(item.source)}</text>`
  }).join('')
  const componentWidth = 162
  const componentNodes = components.map((component, index) => {
    const x = 60 + index * (componentWidth + 10)
    const stroke = component.status === 'done' ? '#3b845d' : component.status === 'active' ? '#65a7ff' : '#353b46'
    return `<rect x="${x}" y="224" width="${componentWidth}" height="72" rx="8" fill="#151922" stroke="${stroke}"/><text x="${x + 12}" y="250" class="component">${xml(component.title).slice(0, 21)}</text><text x="${x + 12}" y="276" class="meta">${xml(component.status)}</text>`
  }).join('')
  const journeyEdges = journeyPhases.slice(1).map((phase, index) => {
    const x1 = 310 + index * 290, x2 = 350 + index * 290, y = 260
    return `<path d="M${x1} ${y}C${x1 + 14} ${y} ${x2 - 14} ${y} ${x2} ${y}" fill="none" stroke="#4e627e" stroke-width="1.5"/><path d="M${x2 - 6} ${y - 3.5} ${x2} ${y} ${x2 - 6} ${y + 3.5}" fill="none" stroke="#6e829f" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>`
  }).join('')
  const journeyNodes = journeyPhases.map((phase, index) => {
    const x = 60 + index * 290
    const stroke = phase.class === 'observed' ? '#e5ad4f' : phase.class === 'presence' ? '#52d68f' : '#65a7ff'
    const gap = index ? Math.max(0, phase.ts - journeyPhases[index - 1].ts) : 0
    const gapLabel = gap >= 1000 ? `+${(gap / 1000).toFixed(gap < 10_000 ? 1 : 0)}s` : index ? `+${gap}ms` : 'origin'
    return `<rect x="${x}" y="224" width="250" height="74" rx="8" fill="#151922" stroke="${stroke}"/><circle cx="${x}" cy="261" r="3" fill="#11141b" stroke="#596273"/><circle cx="${x + 250}" cy="261" r="3" fill="#11141b" stroke="#596273"/><text x="${x + 12}" y="244" class="micro">${xml(phase.class).toUpperCase()}</text><text x="${x + 12}" y="267" class="component">${xml(phase.summary).slice(0, 34)}</text><text x="${x + 12}" y="288" class="meta">${xml(phase.channel || phase.source)} · ${xml(phase.transport || phase.kind)} · ${gapLabel}</text>`
  }).join('')
  const summary = summaryLines.map((line, index) => `<text x="60" y="${126 + index * 45}" class="headline">${xml(line)}</text>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#090b10"/>
  <defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#202631"/></pattern><filter id="glow"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect width="1280" height="720" fill="url(#grid)" opacity=".42"/>
  <style>.brand{font-family:Arial,sans-serif;font-size:25px;font-weight:600;fill:#f2f4f7}.target{font-family:monospace;font-size:13px;fill:#858d9b}.headline{font-family:Arial,sans-serif;font-size:38px;font-weight:600;fill:#f2f4f7}.component{font-family:Arial,sans-serif;font-size:13px;font-weight:600;fill:#e6e9ee}.row{font-family:Arial,sans-serif;font-size:15px;fill:#d2d7df}.meta{font-family:monospace;font-size:12px;fill:#858d9b}.micro{font-family:monospace;font-size:9px;font-weight:600;letter-spacing:1px;fill:#858d9b}</style>
  <rect x="0" y="0" width="1280" height="68" fill="#11141b"/><line x1="0" y1="68" x2="1280" y2="68" stroke="#292f39"/>
  <circle cx="39" cy="34" r="14" fill="none" stroke="#65a7ff" stroke-width="1.5"/><ellipse cx="39" cy="34" rx="21" ry="7" fill="none" stroke="#65a7ff" stroke-width="1.5" transform="rotate(-24 39 34)"/><circle cx="24" cy="40" r="3" fill="#65a7ff" filter="url(#glow)"/>
  <text x="68" y="42" class="brand">aphelion</text><text x="1208" y="39" text-anchor="end" class="target">${xml(target).slice(0, 70)}</text>
  ${summary}
  <line x1="60" y1="201" x2="1220" y2="201" stroke="#292f39"/>
  ${journeyEdges}${journeyNodes}${journeyPhases.length ? '' : componentNodes}
  <text x="60" y="${evidenceStart - 18}" class="component">Evidence ledger</text><text x="1220" y="${evidenceStart - 18}" text-anchor="end" class="meta">event ${event.seq} · ${xml(event.kind)}</text>
  ${evidence}
  <line x1="60" y1="669" x2="1220" y2="669" stroke="#292f39"/>
  <line x1="60" y1="669" x2="${60 + 1160 * progress}" y2="669" stroke="#65a7ff" stroke-width="4"/>
  <circle cx="${60 + 1160 * progress}" cy="669" r="8" fill="#e5ad4f" stroke="#090b10" stroke-width="3" filter="url(#glow)"/>
  <text x="60" y="699" class="meta">DECLARED ${projection.counts.declared}</text><text x="220" y="699" class="meta">OBSERVED ${projection.counts.observed}</text><text x="1220" y="699" text-anchor="end" class="meta">${new Date(event.ts).toISOString()}</text>
  </svg>`
}

function htmlDocument(frames, metadata) {
  const payload = JSON.stringify(frames).replaceAll('<', '\\u003c')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Aphelion timelapse — ${xml(metadata.sessionId)}</title><style>html{color-scheme:dark;background:#090b10}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px system-ui;color:#f2f4f7}.player{width:min(1280px,100%);padding:24px}#frame{display:block;width:100%;height:auto;background:#090b10;border:1px solid #292f39;box-shadow:0 24px 70px #000b}footer{display:flex;align-items:center;gap:14px;margin-top:16px}button{min-height:40px;padding:0 17px;border:1px solid #353b46;border-radius:7px;background:#151922;color:#f2f4f7;font:600 14px system-ui;cursor:pointer}input{flex:1;accent-color:#65a7ff}span{font:12px ui-monospace,monospace;color:#858d9b}@media(max-width:600px){.player{padding:10px}footer{flex-wrap:wrap}input{flex-basis:100%;order:-1}}</style></head><body><main class="player"><img id="frame" alt="Aphelion trail frame"><footer><button id="play">Play timelapse</button><input id="range" type="range" min="0" max="${Math.max(0, frames.length - 1)}" value="0" aria-label="Timelapse position"><span id="position">1 / ${frames.length}</span></footer></main><script>const frames=${payload};const image=document.querySelector('#frame');const range=document.querySelector('#range');const play=document.querySelector('#play');const position=document.querySelector('#position');let timer=null;function show(i){range.value=i;image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(frames[i]);position.textContent=(+i+1)+' / '+frames.length}function stop(){clearInterval(timer);timer=null;play.textContent='Play timelapse'}range.oninput=()=>{stop();show(range.value)};play.onclick=()=>{if(timer){stop();return}if(+range.value>=frames.length-1)show(0);play.textContent='Pause';timer=setInterval(()=>{const next=+range.value+1;if(next>=frames.length){stop();return}show(next)},180)};show(0)</script></body></html>`
}

export async function renderTimelapse(input, output, options = {}) {
  const events = Array.isArray(input) ? input : await readTrail(input)
  if (!events.length) throw new Error('Cannot render an empty trail')
  const indices = sampleIndices(events.length, options.maxFrames || 150)
  const frames = indices.map(index => renderFrameSvg(projectEvents(events.slice(0, index + 1)), events[index], { progress: index / Math.max(1, events.length - 1) }))
  const outputPath = path.resolve(output)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  if (path.extname(outputPath).toLowerCase() === '.html') {
    fs.writeFileSync(outputPath, htmlDocument(frames, { sessionId: events[0].data?.sessionId || 'session' }))
    return { output: outputPath, format: 'html', frames: frames.length }
  }
  if (path.extname(outputPath).toLowerCase() !== '.mp4') throw new Error('Timelapse output must end in .html or .mp4')
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aphelion-frames-'))
  try {
    const magick = spawnSync('magick', ['-version'], { stdio: 'ignore' })
    const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    if (magick.status !== 0 || ffmpeg.status !== 0) throw new Error('MP4 rendering requires local magick and ffmpeg commands; render .html when unavailable')
    const font = renderFont()
    if (!font) throw new Error('MP4 rendering requires an Arial-, Verdana-, DejaVu-, or Liberation-compatible local font; render .html when unavailable')
    frames.forEach((frame, index) => {
      const sequence = String(index).padStart(6, '0')
      const svgPath = path.join(temporary, `frame-${sequence}.svg`)
      const pngPath = path.join(temporary, `frame-${sequence}.png`)
      fs.writeFileSync(svgPath, frame)
      const converted = spawnSync('magick', ['-font', font, svgPath, pngPath], { encoding: 'utf8', timeout: 30_000 })
      if (converted.status !== 0) throw new Error(`Frame conversion failed: ${(converted.stderr || '').trim()}`)
    })
    const rendered = spawnSync('ffmpeg', ['-y', '-framerate', String(options.fps || 12), '-i', path.join(temporary, 'frame-%06d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath], { encoding: 'utf8', timeout: 180_000 })
    if (rendered.status !== 0) throw new Error(`ffmpeg failed: ${(rendered.stderr || '').split('\n').slice(-4).join(' ')}`)
    return { output: outputPath, format: 'mp4', frames: frames.length }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}
