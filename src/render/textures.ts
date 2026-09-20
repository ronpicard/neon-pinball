import * as THREE from 'three'
import type { Insert, Table, Vec2 } from '../game/types.ts'

// -------------------------------------------------------------------------------------------
// Sizes
// -------------------------------------------------------------------------------------------

const TABLE_WIDTH_INCHES = 22
const TABLE_HEIGHT_INCHES = 42
const PLAYFIELD_PX_HEIGHT = 2048
/** Pixels per table inch, per the spec: `2048 / 42`. Fixed, independent of any `Table` argument. */
const PLAYFIELD_PX_PER_INCH = PLAYFIELD_PX_HEIGHT / TABLE_HEIGHT_INCHES
const PLAYFIELD_PX_WIDTH = Math.round(TABLE_WIDTH_INCHES * PLAYFIELD_PX_PER_INCH)

// The translite is drawn to the cabinet's actual 26 x 17 in aspect, so its mesh needs no UV offset.
const BACKGLASS_ASPECT = 26 / 17
const BACKGLASS_WIDTH = 1024
const BACKGLASS_HEIGHT = Math.round(BACKGLASS_WIDTH / BACKGLASS_ASPECT)
const CABINET_SIDE_WIDTH = 1024
const CABINET_SIDE_HEIGHT = 512
const APRON_WIDTH = 1024
const APRON_HEIGHT = 256
const FLOOR_SIZE = 512
const FLOOR_TILES = 8
const FLOOR_SPECKLES = 4000
const SCORE_WIDTH = 1024
const SCORE_HEIGHT = 256

// -------------------------------------------------------------------------------------------
// Palette (retro arcade neon)
// -------------------------------------------------------------------------------------------

const MAGENTA = '#ff2bd6'
const CYAN = '#22e4ff'
const YELLOW = '#ffe14a'
const PURPLE = '#9b5cff'
const ORANGE = '#ff8a1f'
const GREEN = '#3dff8b'
const BG_DEEP = '#0a0614'
const PANEL_NAVY = '#140b2e'
const AMBER = '#ffb347'

/** No image files and no external fonts: a heavy system stack stands in for a chunky arcade face. */
const DISPLAY_FONT = "'Impact', 'Arial Black', sans-serif"
const MONO_FONT = "'Courier New', ui-monospace, monospace"

// -------------------------------------------------------------------------------------------
// Small deterministic helpers
// -------------------------------------------------------------------------------------------

/** A point in canvas pixels, as opposed to `Vec2` which is table inches. */
type Px = { x: number; y: number }

/** Deterministic 32-bit PRNG (mulberry32), so decorative grain and starfields are stable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {}
  for (const item of items) {
    const key = keyOf(item)
    const list = groups[key] ?? (groups[key] = [])
    list.push(item)
  }
  return groups
}

function makeCanvas(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable for texture')
  return { canvas, ctx }
}

function finishTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function toPx(p: Vec2): Px {
  return { x: p.x * PLAYFIELD_PX_PER_INCH, y: p.y * PLAYFIELD_PX_PER_INCH }
}

function toPxLen(inches: number): number {
  return inches * PLAYFIELD_PX_PER_INCH
}

// -------------------------------------------------------------------------------------------
// Generic glow-drawing helpers, reused by every texture in this module
// -------------------------------------------------------------------------------------------

function tracePath(ctx: CanvasRenderingContext2D, points: readonly Px[], closed: boolean): void {
  ctx.beginPath()
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  if (closed) ctx.closePath()
}

/** Strokes a glowing neon line: a soft coloured halo under a thin white-hot core. */
function neonPath(
  ctx: CanvasRenderingContext2D,
  points: readonly Px[],
  color: string,
  width: number,
  glow: number,
  closed = false,
): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = color
  ctx.shadowBlur = glow
  ctx.strokeStyle = color
  ctx.lineWidth = width
  tracePath(ctx, points, closed)
  ctx.stroke()
  ctx.shadowBlur = glow * 0.5
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.lineWidth = Math.max(1, width * 0.32)
  tracePath(ctx, points, closed)
  ctx.stroke()
  ctx.restore()
}

function neonRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  width: number,
  glow: number,
): void {
  if (r <= 0) return
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = glow
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

function neonDisc(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  glow: number,
  alpha: number,
): void {
  if (r <= 0) return
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.shadowColor = color
  ctx.shadowBlur = glow
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawStarburst(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  spikes: number,
  color: string,
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 10
  ctx.lineWidth = 1.5
  ctx.globalAlpha = 0.55
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(x + Math.cos(a) * r * 0.35, y + Math.sin(a) * r * 0.35)
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
    ctx.stroke()
  }
  ctx.restore()
}

const STAR_BRIGHT_CHANCE = 0.82

function drawStarfield(
  ctx: CanvasRenderingContext2D,
  width: number,
  zoneHeight: number,
  rand: () => number,
  count: number,
): void {
  ctx.save()
  for (let i = 0; i < count; i++) {
    const x = rand() * width
    const y = rand() * zoneHeight
    const r = 0.6 + rand() * 1.6
    const bright = rand() > STAR_BRIGHT_CHANCE
    ctx.globalAlpha = bright ? 0.9 : 0.35 + rand() * 0.3
    ctx.fillStyle = bright ? '#ffffff' : CYAN
    ctx.shadowColor = bright ? '#bfe9ff' : 'transparent'
    ctx.shadowBlur = bright ? 6 : 0
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

const SUN_BAND_MIN = 3
const SUN_BAND_GAP = 5
const SUN_BAND_GROWTH = 1.4

/** A big banded synthwave sun: a warm vertical gradient sliced by growing horizontal gaps. */
function drawSynthwaveSun(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()
  const gradient = ctx.createLinearGradient(cx, cy - r, cx, cy + r)
  gradient.addColorStop(0, YELLOW)
  gradient.addColorStop(0.45, ORANGE)
  gradient.addColorStop(1, MAGENTA)
  ctx.shadowColor = ORANGE
  ctx.shadowBlur = r * 0.4
  ctx.fillStyle = gradient
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  ctx.shadowBlur = 0
  ctx.fillStyle = BG_DEEP
  let bandY = cy - r * 0.05
  let bandHeight = SUN_BAND_MIN
  while (bandY < cy + r) {
    ctx.fillRect(cx - r, bandY, r * 2, bandHeight)
    bandY += bandHeight + SUN_BAND_GAP
    bandHeight += SUN_BAND_GROWTH
  }
  ctx.restore()
  neonRing(ctx, cx, cy, r, ORANGE, r * 0.03 + 2, r * 0.5)
}

const GRID_RUNGS = 14
const GRID_COLUMNS = 9

/** A perspective floor grid converging on `(vanishX, vanishY)`, filled down to `floorY`. */
function drawPerspectiveGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  vanishX: number,
  vanishY: number,
  floorY: number,
): void {
  ctx.save()
  ctx.globalAlpha = 0.55
  for (let i = 1; i <= GRID_RUNGS; i++) {
    const t = i / GRID_RUNGS
    const y = vanishY + (floorY - vanishY) * (t * t) // ease so rungs bunch near the horizon
    neonPath(ctx, [{ x: 0, y }, { x: width, y }], i % 3 === 0 ? CYAN : MAGENTA, 1.4, 6)
  }
  const spread = width * 0.9
  for (let i = -GRID_COLUMNS; i <= GRID_COLUMNS; i++) {
    const x = vanishX + (i / GRID_COLUMNS) * spread
    neonPath(ctx, [{ x: vanishX, y: vanishY }, { x, y: floorY }], i % 2 === 0 ? MAGENTA : CYAN, 1.2, 5)
  }
  ctx.restore()
}

const LIGHTNING_SEGMENTS = 7
const LIGHTNING_JITTER = 16

/** A jagged glowing energy stripe from `from` to `to`, printed lane art guiding toward a feature. */
function drawLightningStripe(
  ctx: CanvasRenderingContext2D,
  from: Px,
  to: Px,
  color: string,
  rand: () => number,
): void {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const points: Px[] = [from]
  for (let i = 1; i < LIGHTNING_SEGMENTS; i++) {
    const t = i / LIGHTNING_SEGMENTS
    const wobble = (rand() - 0.5) * LIGHTNING_JITTER * Math.sin(t * Math.PI)
    points.push({ x: from.x + dx * t + nx * wobble, y: from.y + dy * t + ny * wobble })
  }
  points.push(to)
  neonPath(ctx, points, color, 5, 18)
}

/** Chrome-and-neon 'NEON PINBALL' wordmark, two lines, centred on `(cx, cy)`. */
function drawTitle(ctx: CanvasRenderingContext2D, cx: number, cy: number, fontSize: number): void {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `900 ${fontSize}px ${DISPLAY_FONT}`
  ctx.shadowColor = MAGENTA
  ctx.shadowBlur = fontSize * 0.35
  ctx.fillStyle = MAGENTA
  ctx.fillText('NEON', cx, cy - fontSize * 0.55)
  ctx.shadowColor = CYAN
  ctx.fillStyle = CYAN
  ctx.fillText('PINBALL', cx, cy + fontSize * 0.55)
  ctx.shadowBlur = fontSize * 0.12
  ctx.fillStyle = '#ffffff'
  ctx.globalAlpha = 0.75
  ctx.fillText('NEON', cx, cy - fontSize * 0.55)
  ctx.fillText('PINBALL', cx, cy + fontSize * 0.55)
  ctx.restore()
}

// Small pixel-art motifs, 11x8 and 5x8 bitmaps, drawn sparingly for arcade flavour.
const INVADER_BITMAP: readonly (0 | 1)[][] = [
  [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0],
  [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  [0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0],
  [0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 1],
  [1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1],
  [0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0],
]

function drawPixelBitmap(
  ctx: CanvasRenderingContext2D,
  bitmap: readonly (0 | 1)[][],
  x: number,
  y: number,
  cell: number,
  color: string,
): void {
  ctx.save()
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = cell * 0.8
  ctx.globalAlpha = 0.85
  bitmap.forEach((row, ry) => {
    row.forEach((v, rx) => {
      if (v) ctx.fillRect(x + rx * cell, y + ry * cell, cell, cell)
    })
  })
  ctx.restore()
}

function drawPixelJoystick(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cell: number,
  color: string,
): void {
  ctx.save()
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = cell * 0.8
  ctx.globalAlpha = 0.85
  ctx.fillRect(x, y + cell * 6, cell * 5, cell * 2)
  ctx.fillRect(x + cell * 2, y + cell * 2, cell, cell * 4)
  ctx.fillRect(x + cell, y, cell * 3, cell * 2)
  ctx.restore()
}

// -------------------------------------------------------------------------------------------
// Playfield
// -------------------------------------------------------------------------------------------

/**
 * The inches the full playfield canvas covers, for mapping table coordinates into its UVs:
 * `u = x / PLAYFIELD_TEXTURE_INCHES.width`, `v = y / PLAYFIELD_TEXTURE_INCHES.height`.
 */
export const PLAYFIELD_TEXTURE_INCHES: { width: number; height: number } = {
  width: TABLE_WIDTH_INCHES,
  height: TABLE_HEIGHT_INCHES,
}

const BUMPER_COLORS = [MAGENTA, CYAN, YELLOW]
const SUN_RADIUS_INCHES = 5
const TITLE_FONT_INCHES = 3
const PIXEL_CELL_PX = 8
const RAMP_STRIPE_LENGTH_INCHES = 8
const APRON_SHADE_MARGIN_INCHES = 1.5
const ARROW_LENGTH_PX = toPxLen(1.1)
const ARROW_WIDTH_PX = toPxLen(0.55)
const PLAYFIELD_STAR_COUNT = 160
const PLAYFIELD_SEED = 0x9e17

function drawBumperArt(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  neonDisc(ctx, x, y, r * 1.9, color, r * 2, 0.12)
  neonRing(ctx, x, y, r * 1.5, color, 3, r * 0.9)
  neonRing(ctx, x, y, r * 1.05, '#ffffff', 1.5, r * 0.5)
  drawStarburst(ctx, x, y, r * 2.6, 10, color)
}

function drawPostArt(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  drawStarburst(ctx, x, y, r * 5, 8, CYAN)
  neonRing(ctx, x, y, r * 1.6, '#ffffff', 1, 6)
}

function drawSlingshotArt(ctx: CanvasRenderingContext2D, a: Px, b: Px, c: Px, color: string): void {
  ctx.save()
  ctx.globalAlpha = 0.14
  ctx.fillStyle = color
  tracePath(ctx, [a, b, c], true)
  ctx.fill()
  ctx.restore()
  neonPath(ctx, [b, c], color, 3, 8)
  neonPath(ctx, [c, a], color, 3, 8)
  neonPath(ctx, [a, b], color, 6, 16)
}

function drawFlipperArt(ctx: CanvasRenderingContext2D, pivot: Px, tip: Px, color: string): void {
  neonPath(ctx, [pivot, tip], color, 2, 10)
  ctx.save()
  ctx.globalAlpha = 0.1
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(pivot.x, pivot.y, 9, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawArrowHead(ctx: CanvasRenderingContext2D, from: Px, toward: Px, color: string): void {
  const dx = toward.x - from.x
  const dy = toward.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const tip: Px = { x: from.x + ux * ARROW_LENGTH_PX, y: from.y + uy * ARROW_LENGTH_PX }
  const left: Px = {
    x: from.x - uy * ARROW_WIDTH_PX - ux * ARROW_LENGTH_PX * 0.2,
    y: from.y + ux * ARROW_WIDTH_PX - uy * ARROW_LENGTH_PX * 0.2,
  }
  const right: Px = {
    x: from.x + uy * ARROW_WIDTH_PX - ux * ARROW_LENGTH_PX * 0.2,
    y: from.y - ux * ARROW_WIDTH_PX - uy * ARROW_LENGTH_PX * 0.2,
  }
  neonPath(ctx, [left, tip, right], color, 4, 14)
}

function drawTargetBankArt(
  ctx: CanvasRenderingContext2D,
  faces: readonly { a: Px; b: Px }[],
  color: string,
): void {
  if (faces.length === 0) return
  const xs = faces.flatMap((f) => [f.a.x, f.b.x])
  const ys = faces.flatMap((f) => [f.a.y, f.b.y])
  const minX = Math.min(...xs) - 16
  const maxX = Math.max(...xs) + 16
  const minY = Math.min(...ys) - 10
  const maxY = Math.max(...ys) + 10
  ctx.save()
  ctx.globalAlpha = 0.16
  ctx.fillStyle = color
  ctx.fillRect(minX, minY, maxX - minX, maxY - minY)
  ctx.restore()
  neonPath(ctx, [{ x: minX, y: minY }, { x: maxX, y: minY }], color, 1.5, 8)
  neonPath(ctx, [{ x: minX, y: maxY }, { x: maxX, y: maxY }], color, 1.5, 8)
}

function drawArrowInsert(
  ctx: CanvasRenderingContext2D,
  p: Px,
  angle: number,
  r: number,
  color: string,
): void {
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.rotate(angle)
  neonPath(ctx, [
    { x: -r, y: r * 0.6 },
    { x: r * 0.95, y: 0 },
    { x: -r, y: -r * 0.6 },
  ], color, 3, r)
  ctx.restore()
}

/** A flush disc or arrow insert with a printed keyline, plus its caption below it. */
function drawInsertArt(ctx: CanvasRenderingContext2D, insert: Insert, p: Px, r: number): void {
  const color = insert.color
  if (insert.shape === 'circle') {
    neonDisc(ctx, p.x, p.y, r, color, r * 1.4, 0.22)
    neonRing(ctx, p.x, p.y, r, color, 2.4, r * 0.9)
    neonRing(ctx, p.x, p.y, r * 0.7, '#ffffff', 1, r * 0.4)
  } else {
    drawArrowInsert(ctx, p, insert.angle, r, color)
  }
  if (insert.label) {
    ctx.save()
    ctx.font = `700 ${Math.max(10, r * 0.9)}px ${DISPLAY_FONT}`
    ctx.fillStyle = color
    ctx.shadowColor = color
    ctx.shadowBlur = r * 0.6
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    // Text is kept upright (never rotated with an arrow's angle) so it always reads from the
    // player's end at the bottom of the table.
    ctx.fillText(insert.label, p.x, p.y + r * 1.15)
    ctx.restore()
  }
}

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, h)
  gradient.addColorStop(0, '#050310')
  gradient.addColorStop(0.35, BG_DEEP)
  gradient.addColorStop(0.75, PANEL_NAVY)
  gradient.addColorStop(1, '#1b0f3a')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, w, h)

  // A faint wood-grain sheen shows through the lacquer, like a real printed playfield.
  ctx.save()
  ctx.globalAlpha = 0.05
  for (let y = 0; y < h; y += 3) {
    ctx.fillStyle = y % 6 === 0 ? '#3a2a55' : '#0d0820'
    ctx.fillRect(0, y, w, 1.5)
  }
  ctx.restore()
}

function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const gradient = ctx.createRadialGradient(w / 2, h * 0.42, h * 0.15, w / 2, h * 0.5, h * 0.72)
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.55)')
  ctx.save()
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}

/**
 * Playfield art. The canvas covers exactly `PLAYFIELD_TEXTURE_INCHES` of table space: canvas x
 * matches table x, canvas y matches table y (so the top of the canvas is the top arch and the
 * bottom is the drain/player end). Callers building the playfield mesh are responsible for any
 * UV flip they need; this texture is drawn in the table's own coordinate sense, unflipped.
 */
export function makePlayfieldTexture(table: Table): THREE.CanvasTexture {
  const width = PLAYFIELD_PX_WIDTH
  const height = PLAYFIELD_PX_HEIGHT
  const { canvas, ctx } = makeCanvas(width, height)
  const rand = mulberry32(PLAYFIELD_SEED)

  drawBackground(ctx, width, height)
  drawStarfield(ctx, width, height * 0.22, rand, PLAYFIELD_STAR_COUNT)

  const vanish = toPx({ x: table.width / 2, y: table.height * 0.24 })
  drawPerspectiveGrid(ctx, width, vanish.x, vanish.y, height)

  if (table.bumpers.length > 0) {
    const cx = table.bumpers.reduce((s, b) => s + b.pos.x, 0) / table.bumpers.length
    const cy = table.bumpers.reduce((s, b) => s + b.pos.y, 0) / table.bumpers.length
    const centre = toPx({ x: cx, y: cy })
    drawSynthwaveSun(ctx, centre.x, centre.y, toPxLen(SUN_RADIUS_INCHES))
  }

  // Printed lane guides: a faint neon stripe traces every 'guide' wall segment.
  table.walls.forEach((wall, i) => {
    if (wall.kind !== 'guide') return
    ctx.save()
    ctx.globalAlpha = 0.35
    neonPath(ctx, [toPx(wall.a), toPx(wall.b)], i % 2 === 0 ? MAGENTA : CYAN, 1.5, 7)
    ctx.restore()
  })

  // Lightning-stripe lane art guiding toward each ramp entry and the left orbit.
  for (const ramp of table.ramps) {
    const entryMid: Vec2 = {
      x: (ramp.entry.a.x + ramp.entry.b.x) / 2,
      y: (ramp.entry.a.y + ramp.entry.b.y) / 2,
    }
    const start: Vec2 = { x: entryMid.x, y: Math.min(table.height, entryMid.y + RAMP_STRIPE_LENGTH_INCHES) }
    drawLightningStripe(ctx, toPx(start), toPx(entryMid), MAGENTA, rand)
  }
  const leftOrbit = table.walls.find((w) => w.id === 'guide.orbitLeft')
  if (leftOrbit) {
    const orbitStartY = Math.min(table.height, leftOrbit.b.y + RAMP_STRIPE_LENGTH_INCHES)
    const start: Vec2 = { x: leftOrbit.b.x, y: orbitStartY }
    drawLightningStripe(ctx, toPx(start), toPx(leftOrbit.a), CYAN, rand)
  }

  for (const gate of table.gates) {
    ctx.save()
    ctx.globalAlpha = 0.5
    neonPath(ctx, [toPx(gate.a), toPx(gate.b)], CYAN, 1.5, 6)
    ctx.restore()
  }

  for (const rollover of table.rollovers) {
    const p = toPx(rollover.pos)
    neonRing(ctx, p.x, p.y, toPxLen(rollover.radius) * 1.35, '#ffffff', 1, 4)
  }

  for (const saucer of table.saucers) {
    const p = toPx(saucer.pos)
    const r = toPxLen(saucer.radius)
    neonRing(ctx, p.x, p.y, r * 1.3, ORANGE, 3, r)
    neonRing(ctx, p.x, p.y, r * 0.9, '#ffffff', 1.5, r * 0.5)
  }

  for (const spinner of table.spinners) {
    neonPath(ctx, [toPx(spinner.a), toPx(spinner.b)], YELLOW, 3, 10)
  }

  const dropBanks = groupBy(table.dropTargets, (t) => t.bank)
  for (const bank of Object.values(dropBanks)) {
    drawTargetBankArt(ctx, bank.map((t) => ({ a: toPx(t.a), b: toPx(t.b) })), MAGENTA)
  }
  const standupGroups = groupBy(table.standups, (t) => t.group)
  for (const group of Object.values(standupGroups)) {
    drawTargetBankArt(ctx, group.map((t) => ({ a: toPx(t.a), b: toPx(t.b) })), CYAN)
  }

  table.bumpers.forEach((bumper, i) => {
    const p = toPx(bumper.pos)
    drawBumperArt(ctx, p.x, p.y, toPxLen(bumper.radius), BUMPER_COLORS[i % BUMPER_COLORS.length] ?? MAGENTA)
  })

  for (const post of table.posts) {
    const p = toPx(post.pos)
    drawPostArt(ctx, p.x, p.y, toPxLen(post.radius))
  }

  for (const sling of table.slingshots) {
    drawSlingshotArt(ctx, toPx(sling.a), toPx(sling.b), toPx(sling.c), PURPLE)
  }

  for (const flipper of table.flippers) {
    const tipInches: Vec2 = {
      x: flipper.pivot.x + flipper.length * Math.cos(flipper.restAngle),
      y: flipper.pivot.y + flipper.length * Math.sin(flipper.restAngle),
    }
    drawFlipperArt(ctx, toPx(flipper.pivot), toPx(tipInches), MAGENTA)
  }

  for (const ramp of table.ramps) {
    const a = toPx(ramp.entry.a)
    const b = toPx(ramp.entry.b)
    const mid: Px = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const ahead = ramp.path[1] ?? ramp.path[0]
    neonPath(ctx, [a, b], PURPLE, 5, 14)
    if (ahead) drawArrowHead(ctx, mid, toPx(ahead), PURPLE)
  }

  for (const insert of table.inserts) {
    const p = toPx(insert.pos)
    drawInsertArt(ctx, insert, p, toPxLen(insert.radius))
  }

  if (table.bumpers.length > 0 && table.slingshots.length > 0) {
    const bumperY = table.bumpers.reduce((s, b) => s + b.pos.y, 0) / table.bumpers.length
    const slingY = table.slingshots.reduce((s, sl) => s + sl.a.y, 0) / table.slingshots.length
    const title = toPx({ x: table.width / 2, y: (bumperY + slingY) / 2 })
    drawTitle(ctx, title.x, title.y, toPxLen(TITLE_FONT_INCHES))
  }

  drawPixelBitmap(ctx, INVADER_BITMAP, width * 0.06, height * 0.045, PIXEL_CELL_PX, GREEN)
  drawPixelBitmap(ctx, INVADER_BITMAP, width * 0.82, height * 0.045, PIXEL_CELL_PX, GREEN)
  drawPixelJoystick(ctx, width * 0.05, height * 0.945, PIXEL_CELL_PX, PURPLE)
  drawPixelJoystick(ctx, width * 0.88, height * 0.945, PIXEL_CELL_PX, PURPLE)

  if (table.flippers.length > 0) {
    const minPivotY = Math.min(...table.flippers.map((f) => f.pivot.y))
    const apronTop = toPx({ x: 0, y: minPivotY - APRON_SHADE_MARGIN_INCHES }).y
    const gradient = ctx.createLinearGradient(0, apronTop, 0, height)
    gradient.addColorStop(0, 'rgba(5, 3, 12, 0)')
    gradient.addColorStop(0.3, 'rgba(5, 3, 12, 0.55)')
    gradient.addColorStop(1, 'rgba(5, 3, 12, 0.92)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, apronTop, width, height - apronTop)
  }

  drawVignette(ctx, width, height)

  return finishTexture(canvas)
}

// -------------------------------------------------------------------------------------------
// Backglass
// -------------------------------------------------------------------------------------------

const BACKGLASS_SEED = 0x1057
const BACKGLASS_STAR_COUNT = 70
const BACKGLASS_HEADER_TEXT = '1UP   HI-SCORE   2UP'
const BACKGLASS_CHEVRON_SIZE = 26

function drawPalm(ctx: CanvasRenderingContext2D, x: number, baseY: number, height: number): void {
  ctx.save()
  ctx.fillStyle = '#0a0614'
  ctx.strokeStyle = '#0a0614'
  ctx.fillRect(x - height * 0.06, baseY - height, height * 0.12, height)
  ctx.lineWidth = height * 0.08
  for (let i = 0; i < 5; i++) {
    const angle = -Math.PI / 2 + (i - 2) * 0.35
    ctx.beginPath()
    ctx.moveTo(x, baseY - height)
    ctx.quadraticCurveTo(
      x + Math.cos(angle) * height * 0.5,
      baseY - height + Math.sin(angle) * height * 0.3,
      x + Math.cos(angle) * height * 0.9,
      baseY - height + Math.sin(angle) * height * 0.7,
    )
    ctx.stroke()
  }
  ctx.restore()
}

/** A thin banner across the top reading `1UP   HI-SCORE   2UP` in pixel-style lettering. */
function drawBackglassHeader(ctx: CanvasRenderingContext2D, width: number, bandHeight: number): void {
  ctx.save()
  ctx.fillStyle = 'rgba(4, 2, 12, 0.65)'
  ctx.fillRect(0, 0, width, bandHeight)
  ctx.font = `700 ${bandHeight * 0.6}px ${MONO_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = YELLOW
  ctx.shadowBlur = bandHeight * 0.5
  ctx.fillStyle = YELLOW
  ctx.fillText(BACKGLASS_HEADER_TEXT, width / 2, bandHeight / 2)
  ctx.restore()
}

/** A checkerboard/chevron strip framing the top and bottom edges of the panel. */
function drawChevronBorder(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.save()
  ctx.globalAlpha = 0.8
  for (const y of [0, height - BACKGLASS_CHEVRON_SIZE]) {
    for (let x = 0; x < width; x += BACKGLASS_CHEVRON_SIZE * 2) {
      ctx.fillStyle = ((x / (BACKGLASS_CHEVRON_SIZE * 2)) | 0) % 2 === 0 ? MAGENTA : CYAN
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + BACKGLASS_CHEVRON_SIZE, y)
      ctx.lineTo(x + BACKGLASS_CHEVRON_SIZE * 1.5, y + BACKGLASS_CHEVRON_SIZE)
      ctx.lineTo(x + BACKGLASS_CHEVRON_SIZE * 0.5, y + BACKGLASS_CHEVRON_SIZE)
      ctx.closePath()
      ctx.fill()
    }
  }
  ctx.restore()
}

/** A small pixel-art cassette tape, for arcade-era set dressing. */
function drawPixelCassette(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number, color: string): void {
  ctx.save()
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = cell * 0.8
  ctx.globalAlpha = 0.85
  ctx.fillRect(x, y, cell * 10, cell * 6)
  ctx.fillStyle = BG_DEEP
  ctx.fillRect(x + cell, y + cell, cell * 3, cell * 2)
  ctx.fillRect(x + cell * 6, y + cell, cell * 3, cell * 2)
  ctx.restore()
}

/**
 * Generic retro-arcade backglass art, richly layered: a `1UP HI-SCORE 2UP` header, a banded
 * synthwave sun over a neon perspective grid, a palm-lined city skyline, the chrome-and-neon
 * 'NEON PINBALL' logo, pixel-art invaders, a joystick, a cassette, lightning bolts, stars, and a
 * chevron border. Drawn to the cabinet's 26 x 17 in aspect so the translite mesh needs no UV crop.
 */
export function makeBackglassTexture(): THREE.CanvasTexture {
  const width = BACKGLASS_WIDTH
  const height = BACKGLASS_HEIGHT
  const { canvas, ctx } = makeCanvas(width, height)
  const rand = mulberry32(BACKGLASS_SEED)

  const sky = ctx.createLinearGradient(0, 0, 0, height)
  sky.addColorStop(0, '#170a34')
  sky.addColorStop(0.55, '#2a0f4a')
  sky.addColorStop(1, BG_DEEP)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, width, height)

  drawStarfield(ctx, width, height * 0.5, rand, BACKGLASS_STAR_COUNT)

  const sunCx = width * 0.5
  const sunCy = height * 0.36
  drawSynthwaveSun(ctx, sunCx, sunCy, height * 0.34)
  drawPerspectiveGrid(ctx, width, sunCx, sunCy + height * 0.02, height)

  const baseY = height * 0.62
  ctx.save()
  ctx.fillStyle = '#0a0614'
  ctx.beginPath()
  ctx.moveTo(0, baseY)
  let x = 0
  while (x < width) {
    const w = 26 + rand() * 60
    const h = 32 + rand() * (height * 0.28)
    ctx.lineTo(x, baseY - h)
    ctx.lineTo(x + w, baseY - h)
    x += w
  }
  ctx.lineTo(width, baseY)
  ctx.lineTo(width, height)
  ctx.lineTo(0, height)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  for (let p = 0; p < 5; p++) {
    drawPalm(ctx, width * (0.06 + p * 0.22) + rand() * 24, baseY, height * 0.09)
  }

  drawLightningStripe(ctx, { x: width * 0.06, y: height * 0.2 }, { x: width * 0.06, y: height * 0.5 }, CYAN, rand)
  drawLightningStripe(
    ctx,
    { x: width * 0.94, y: height * 0.2 },
    { x: width * 0.94, y: height * 0.5 },
    MAGENTA,
    rand,
  )

  drawPixelBitmap(ctx, INVADER_BITMAP, width * 0.03, height * 0.66, PIXEL_CELL_PX * 0.8, GREEN)
  drawPixelBitmap(ctx, INVADER_BITMAP, width * 0.87, height * 0.66, PIXEL_CELL_PX * 0.8, GREEN)
  drawPixelJoystick(ctx, width * 0.03, height * 0.82, PIXEL_CELL_PX * 0.8, PURPLE)
  drawPixelCassette(ctx, width * 0.85, height * 0.83, PIXEL_CELL_PX * 0.7, ORANGE)

  drawTitle(ctx, width / 2, height * 0.82, height * 0.17)

  drawChevronBorder(ctx, width, height)
  drawBackglassHeader(ctx, width, height * 0.075)

  return finishTexture(canvas)
}

// -------------------------------------------------------------------------------------------
// Cabinet side
// -------------------------------------------------------------------------------------------

const CABINET_SEED = 0x2044
const CABINET_STAR_COUNT = 60
const STRIPE_COLORS = [MAGENTA, CYAN, PURPLE, ORANGE]

/** Cabinet-side art: black with bold diagonal neon stripes and a scatter of stars. */
export function makeCabinetSideTexture(): THREE.CanvasTexture {
  const w = CABINET_SIDE_WIDTH
  const h = CABINET_SIDE_HEIGHT
  const { canvas, ctx } = makeCanvas(w, h)
  const rand = mulberry32(CABINET_SEED)

  ctx.fillStyle = '#050308'
  ctx.fillRect(0, 0, w, h)
  drawStarfield(ctx, w, h, rand, CABINET_STAR_COUNT)

  const stripeWidth = h * 0.14
  const stripePitch = stripeWidth * 1.6
  const steps = Math.ceil((w + h) / stripePitch) + 2
  for (let i = -2; i < steps; i++) {
    const color = STRIPE_COLORS[((i % STRIPE_COLORS.length) + STRIPE_COLORS.length) % STRIPE_COLORS.length]
    const x0 = i * stripePitch
    ctx.save()
    ctx.globalAlpha = 0.85
    ctx.shadowColor = color
    ctx.shadowBlur = 18
    ctx.strokeStyle = color
    ctx.lineWidth = stripeWidth
    ctx.beginPath()
    ctx.moveTo(x0, h)
    ctx.lineTo(x0 + h, 0)
    ctx.stroke()
    ctx.restore()
  }

  drawTitle(ctx, w * 0.5, h * 0.5, h * 0.26)

  return finishTexture(canvas)
}

// -------------------------------------------------------------------------------------------
// Apron
// -------------------------------------------------------------------------------------------

/** Apron art: the dark plastic panel under the flippers, with the logo and a launch callout. */
export function makeApronTexture(): THREE.CanvasTexture {
  const w = APRON_WIDTH
  const h = APRON_HEIGHT
  const { canvas, ctx } = makeCanvas(w, h)

  const gradient = ctx.createLinearGradient(0, 0, 0, h)
  gradient.addColorStop(0, '#1c1030')
  gradient.addColorStop(1, '#07040f')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, w, h)

  neonPath(ctx, [
    { x: 8, y: 8 },
    { x: w - 8, y: 8 },
    { x: w - 8, y: h - 8 },
    { x: 8, y: h - 8 },
  ], CYAN, 3, 10, true)

  drawTitle(ctx, w * 0.34, h * 0.5, h * 0.4)

  const calloutX = w * 0.82
  drawArrowHead(ctx, { x: calloutX, y: h * 0.62 }, { x: calloutX, y: h * 0.18 }, ORANGE)

  ctx.save()
  ctx.font = `700 ${h * 0.12}px ${DISPLAY_FONT}`
  ctx.fillStyle = ORANGE
  ctx.shadowColor = ORANGE
  ctx.shadowBlur = 10
  ctx.textAlign = 'center'
  ctx.fillText('LAUNCH', calloutX, h * 0.82)
  ctx.restore()

  return finishTexture(canvas)
}

// -------------------------------------------------------------------------------------------
// Floor
// -------------------------------------------------------------------------------------------

const FLOOR_SEED = 0x3091

/** A tiling retro-arcade carpet: a dark diamond grid with fine speckle grain. */
export function makeFloorTexture(): THREE.CanvasTexture {
  const size = FLOOR_SIZE
  const { canvas, ctx } = makeCanvas(size, size)

  ctx.fillStyle = '#0c0818'
  ctx.fillRect(0, 0, size, size)

  const cell = size / FLOOR_TILES
  ctx.save()
  for (let gy = 0; gy < FLOOR_TILES; gy++) {
    for (let gx = 0; gx < FLOOR_TILES; gx++) {
      const cx = gx * cell + cell / 2
      const cy = gy * cell + cell / 2
      const parity = (gx + gy) % 2
      ctx.fillStyle = parity === 0 ? rgba(PURPLE, 0.3) : rgba(MAGENTA, 0.18)
      ctx.beginPath()
      ctx.moveTo(cx, cy - cell / 2)
      ctx.lineTo(cx + cell / 2, cy)
      ctx.lineTo(cx, cy + cell / 2)
      ctx.lineTo(cx - cell / 2, cy)
      ctx.closePath()
      ctx.fill()
    }
  }
  ctx.restore()

  ctx.save()
  ctx.globalAlpha = 0.05
  const rand = mulberry32(FLOOR_SEED)
  for (let i = 0; i < FLOOR_SPECKLES; i++) {
    ctx.fillStyle = rand() > 0.5 ? '#000000' : '#ffffff'
    ctx.fillRect(rand() * size, rand() * size, 1, 1)
  }
  ctx.restore()

  const texture = finishTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

// -------------------------------------------------------------------------------------------
// Score display
// -------------------------------------------------------------------------------------------

const DOT_PITCH = 4
const DOT_RADIUS = 1.5
const DOT_GLOW = 5
const DOT_THRESHOLD = 40
const DOT_DIM_ALPHA = 0.08 // unlit dots still show, faintly, so the panel reads as a real LED grid
const SCORE_FONT_MAX_FRACTION = 0.74 // the biggest a score may be sized, as a fraction of panel height
const SCORE_FONT_MIN_FRACTION = 0.22
const MESSAGE_FONT_MAX_FRACTION = 0.3
const MESSAGE_FONT_MIN_FRACTION = 0.12
const TEXT_FIT_WIDTH_FRACTION = 0.9 // how much of the panel width fitted text may fill

interface DotMatrixLine {
  text: string
  x: number
  y: number
  font: string
  align: CanvasTextAlign
}

/**
 * The largest size (in px) for `${weight} ${size}px ${fontFamily}` that keeps `text` narrower
 * than `maxWidthPx`, without going below `minSizePx`.
 */
function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontFamily: string,
  weight: number,
  maxWidthPx: number,
  maxSizePx: number,
  minSizePx: number,
): number {
  let size = maxSizePx
  while (size > minSizePx) {
    ctx.font = `${weight} ${size}px ${fontFamily}`
    if (ctx.measureText(text).width <= maxWidthPx) break
    size -= 2
  }
  return size
}

/**
 * Renders `lines` through an offscreen mask and stipples the whole panel as a real dot-matrix
 * grid: every dot position gets a dim, always-visible base, and the ones the mask lights up glow
 * brighter on top of it.
 */
function drawDotMatrix(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  lines: readonly DotMatrixLine[],
  color: string,
): void {
  const { ctx: bctx } = makeCanvas(width, height)
  bctx.fillStyle = '#000000'
  bctx.fillRect(0, 0, width, height)
  bctx.fillStyle = '#ffffff'
  bctx.textBaseline = 'alphabetic'
  for (const line of lines) {
    bctx.font = line.font
    bctx.textAlign = line.align
    bctx.fillText(line.text, line.x, line.y)
  }
  const { data } = bctx.getImageData(0, 0, width, height)
  ctx.save()
  ctx.fillStyle = color
  ctx.shadowColor = color
  for (let py = DOT_PITCH / 2; py < height; py += DOT_PITCH) {
    for (let px = DOT_PITCH / 2; px < width; px += DOT_PITCH) {
      const idx = (Math.floor(py) * width + Math.floor(px)) * 4
      const brightness = data[idx] ?? 0
      const lit = brightness > DOT_THRESHOLD
      ctx.globalAlpha = lit ? Math.min(1, brightness / 255) : DOT_DIM_ALPHA
      ctx.shadowBlur = lit ? DOT_GLOW : 0
      ctx.beginPath()
      ctx.arc(px, py, DOT_RADIUS, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** The cabinet's dot-matrix score panel: a texture plus a `set` to redraw it. */
export interface ScoreDisplay {
  texture: THREE.CanvasTexture
  set(score: number, ball: number, message: string | null): void
}

/**
 * Builds the amber/orange plasma dot-matrix score display, 1024x256, the machine's scoreboard:
 * a real dot grid with dim unlit dots visible, chunky digits filling most of the panel, and a
 * small 'BALL n' readout in the corner. A `message` replaces the score line, auto-shrunk to fit.
 */
export function makeScoreDisplay(): ScoreDisplay {
  const width = SCORE_WIDTH
  const height = SCORE_HEIGHT
  const { canvas, ctx } = makeCanvas(width, height)
  const texture = finishTexture(canvas)

  const paintPanel = (): void => {
    const gradient = ctx.createLinearGradient(0, 0, 0, height)
    gradient.addColorStop(0, '#241407')
    gradient.addColorStop(1, '#0a0503')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
    neonPath(ctx, [
      { x: 4, y: 4 },
      { x: width - 4, y: 4 },
      { x: width - 4, y: height - 4 },
      { x: 4, y: height - 4 },
    ], rgba(AMBER, 0.5), 2, 6, true)
    ctx.save()
    ctx.font = `700 ${height * 0.09}px ${MONO_FONT}`
    ctx.fillStyle = rgba(AMBER, 0.35)
    ctx.textAlign = 'left'
    ctx.fillText('SCORE', width * 0.05, height * 0.2)
    ctx.restore()
  }

  const set = (score: number, ball: number, message: string | null): void => {
    paintPanel()
    if (message) {
      const text = message.toUpperCase()
      const size = fitFontSize(
        ctx,
        text,
        MONO_FONT,
        700,
        width * TEXT_FIT_WIDTH_FRACTION,
        height * MESSAGE_FONT_MAX_FRACTION,
        height * MESSAGE_FONT_MIN_FRACTION,
      )
      const messageFont = `700 ${size}px ${MONO_FONT}`
      drawDotMatrix(
        ctx,
        width,
        height,
        [{ text, x: width / 2, y: height * 0.58, font: messageFont, align: 'center' }],
        AMBER,
      )
    } else {
      const scoreText = score <= 0 ? '00' : Math.max(0, Math.floor(score)).toLocaleString('en-US')
      const scoreSize = fitFontSize(
        ctx,
        scoreText,
        MONO_FONT,
        700,
        width * 0.9,
        height * SCORE_FONT_MAX_FRACTION,
        height * SCORE_FONT_MIN_FRACTION,
      )
      const scoreFont = `700 ${scoreSize}px ${MONO_FONT}`
      const ballFont = `700 ${height * 0.14}px ${MONO_FONT}`
      drawDotMatrix(
        ctx,
        width,
        height,
        [
          { text: scoreText, x: width / 2, y: height * 0.68, font: scoreFont, align: 'center' },
          { text: `BALL ${ball}`, x: width * 0.97, y: height * 0.9, font: ballFont, align: 'right' },
        ],
        AMBER,
      )
    }
    texture.needsUpdate = true
  }

  set(0, 1, null)
  return { texture, set }
}
