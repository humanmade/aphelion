import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { readTrail } from '../trail/reader.mjs'
import { buildSiteFrame, desktopContentColumnsForTopology, displayChannel, routeContainmentElbows, routeSiteTopologyEdges, topologyCameraFrames, visibleTopologyEdges } from '../board/topology.mjs'
import { recordedTopologyVersion } from '../trail/topology-version.mjs'

function xml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]))
}

function sampleIndices(length, maxFrames) {
  if (!length) return []
  const count = Math.min(length, Math.max(2, maxFrames))
  return [...new Set(Array.from({ length: count }, (_, index) => Math.round(index * (length - 1) / (count - 1))))]
}

function renderFont() {
  return [
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Supplemental/Verdana.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
  ].find(candidate => fs.existsSync(candidate)) || null
}

function placeType(node) {
  if (node.id === 'wp:site') return 'Site'
  return ({ option: 'Setting', ability: 'Ability', plugin: 'Plugin', page: 'Page', post: 'Post' })[node.type] || 'Place'
}

export function renderFrameGeometry(events, cursor, options = {}) {
  const index = Math.max(0, Math.min(Number(cursor) || 0, events.length - 1))
  const visibleEvents = events.slice(0, index + 1)
  const compact = Boolean(options.compact)
  const nodeW = options.nodeW || 320
  const layoutOptions = {
    blueprintEvents: events,
    compact,
    nodeW,
    nodeH: compact ? 238 : 220,
    gapX: compact ? 38 : 112,
    gapY: compact ? 28 : 24,
    padX: compact ? 24 : 42,
    padY: compact ? 56 : 44,
    layoutSeed: options.layoutSeed || { desktopWrapColumns: desktopContentColumnsForTopology(recordedTopologyVersion(events)) },
  }
  const frame = buildSiteFrame(visibleEvents, layoutOptions)
  const nodes = frame.layout.nodes.map(node => ({
    ...node,
    group: 'site',
    topologyRoot: node.id === 'wp:site',
    height: frame.nodeHeights[node.id],
  }))
  const edges = visibleTopologyEdges(frame.topology.edges.map(edge => ({ ...edge, kind: 'channel' })), frame.topology.nodes.filter(node => !node.future).length)
  const channelRepresentatives = new Map()
  for (const edge of edges) if (!channelRepresentatives.has(edge.channel) || edge.active) channelRepresentatives.set(edge.channel, edge.id)
  for (const edge of edges) edge.label = channelRepresentatives.get(edge.channel) === edge.id ? displayChannel(edge.channel) : null
  const routedEdges = routeSiteTopologyEdges(nodes, edges, { compact, nodeW, metrics: frame.nodeHeights })
  const containments = routeContainmentElbows(nodes, frame.topology.containments || [], { nodeW, metrics: frame.nodeHeights })
  const width = options.width || 1280
  const height = options.height || 720
  const cameraFrames = topologyCameraFrames({ nodes: nodes.filter(node => !node.future), edges: routedEdges, lanes: frame.layout.lanes, metrics: frame.nodeHeights, nodeW }, { aspect: width / height, minWidth: compact ? 390 : 720, minHeight: compact ? 720 : 420 })
  return {
    ...frame,
    cursor: index,
    event: events[index],
    nodes,
    edges: routedEdges,
    containments,
    camera: cameraFrames.mode === 'sentence' ? cameraFrames.sentence : cameraFrames.full,
    cameraMode: cameraFrames.mode,
    width: Math.max(compact ? 390 : 720, frame.layout.width),
    height: Math.max(compact ? 720 : 420, frame.layout.height),
    nodeW,
  }
}

export function renderFrameSvg(events, cursor, options = {}) {
  if (!Array.isArray(events) || !events.length) throw new TypeError('renderFrameSvg requires a non-empty trail event array')
  const frame = renderFrameGeometry(events, cursor, options)
  const width = options.width || 1280
  const height = options.height || 720
  const nodeById = new Map(frame.nodes.map(node => [node.id, node]))
  const lanes = frame.layout.lanes.map(lane => `<g class="territory-region${lane.kind === 'plugin' ? ' plugin-subregion' : ''}" data-region-id="${xml(lane.id)}"><rect x="${lane.x}" y="${lane.y}" width="${lane.width}" height="${lane.height}" rx="12"/><text x="${lane.labelX ?? lane.x + 12}" y="${lane.labelY ?? lane.y + (lane.empty ? 15 : 16)}">${xml(lane.label || lane.category).toUpperCase()}</text></g>`).join('')
  const edges = frame.edges.filter(edge => !edge.future && edge.path).map(edge => `<path class="flow ${xml(edge.flowState || 'idle')}" data-edge-id="${xml(edge.id)}" data-from="${xml(edge.from)}" data-to="${xml(edge.to)}" d="${xml(edge.path)}"/>`).join('')
  const containments = frame.containments.filter(relation => relation.path).map(relation => `<path class="containment-guide" data-containment-id="${xml(relation.id)}" data-parent-id="${xml(relation.parentId)}" data-child-id="${xml(relation.childId)}" d="${xml(relation.path)}"/>`).join('')
  const cards = frame.nodes.filter(node => !node.future).map(node => {
    const source = node.id === 'wp:site' ? frame.topology.root : frame.topology.nodes.find(item => item.id === node.id)
    const last = source?.lastChange
    const strokeClass = source?.visibility === 'declared' ? ' provisional' : source?.current ? ' current' : ''
    return `<g class="place${strokeClass}" data-node-id="${xml(node.id)}" transform="translate(${node.x} ${node.y})"><rect width="${frame.nodeW}" height="${node.height}" rx="8"/><line x1="0" y1="30" x2="${frame.nodeW}" y2="30"/><text x="12" y="20" class="kicker">${xml(placeType(source))}${source?.identity ? ` · ${xml(source.identity)}` : ''}</text><text x="12" y="55" class="name">${xml(source?.title || node.title).slice(0, 42)}</text>${source?.stateLine ? `<text x="12" y="75" class="state">${xml(source.stateLine).slice(0, 48)}</text>` : ''}${last ? `<line x1="0" y1="${node.height - 29}" x2="${frame.nodeW}" y2="${node.height - 29}"/><text x="12" y="${node.height - 10}" class="change">${xml(last.verb)}</text>` : ''}<circle cx="0" cy="15" r="4"/><circle cx="${frame.nodeW}" cy="15" r="4"/></g>`
  }).join('')
  const channelLabels = []
  const seenChannels = new Set()
  for (const edge of frame.edges.filter(edge => !edge.future && edge.path)) {
    if (seenChannels.has(edge.channel)) continue
    seenChannels.add(edge.channel)
    channelLabels.push(`<text class="channel" x="${edge.labelX}" y="${edge.labelY}" text-anchor="${edge.labelAnchor}">${xml(displayChannel(edge.channel))}</text>`)
  }
  const event = frame.event
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${frame.camera.x} ${frame.camera.y} ${frame.camera.width} ${frame.camera.height}" data-seq="${event.seq}" data-topology-version="${frame.topology.topologyVersion || 1}">
  <defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#2a2a2a"/></pattern></defs>
  <rect width="100%" height="100%" fill="#111"/><rect width="100%" height="100%" fill="url(#grid)" opacity=".42"/>
  <style>.territory-region rect{fill:#171717;fill-opacity:.2;stroke:#383838;stroke-width:1;stroke-dasharray:2 7}.territory-region text,.kicker,.state,.change,.channel{font-family:monospace;font-size:10px;fill:#8b8b8b}.containment-guide{fill:none;stroke:#555;stroke-width:1}.flow{fill:none;stroke:#454545;stroke-width:1}.flow.claimed{stroke:#5b91e8}.flow.live{stroke:#55bd8a}.place rect{fill:#151515;stroke:#3b3b3b}.place line{stroke:#2e2e2e}.place circle{fill:#111;stroke:#555}.place.provisional rect{stroke:#5b91e8;stroke-dasharray:3 5}.place.current rect{stroke:#6a6a6a}.name{font-family:Arial,sans-serif;font-size:15px;font-weight:600;fill:#f1f1f1}.state{font-size:11px;fill:#aaa}.change{font-size:11px;fill:#ddd}.channel{font-size:11px;fill:#9a9a9a}</style>
  ${lanes}${containments}${edges}${channelLabels.join('')}${cards}
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
  const frames = indices.map(index => renderFrameSvg(events, index, options))
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
