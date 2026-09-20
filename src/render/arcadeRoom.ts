/**
 * The dim 80s/90s arcade the pinball machine stands inside: blacklight carpet, back and side walls
 * carrying neon signage, a ring of upright arcade cabinets with animated screens, a couple of
 * neighbouring pinball machines, and light set dressing. Everything here is code-built from three.js
 * primitives and canvas textures - no models, no image files.
 *
 * The engine owns every `THREE.Light`; nothing in this file is a light source, only emissive
 * surfaces that read as lit under the engine's own lighting and bloom pass.
 *
 * World frame: the floor is Y = 0, the pinball machine stands at the origin facing +Z (the
 * player's side). A clear aisle - nothing but floor - is kept for X in [-20, 20], Z in [-40, 60].
 */

import * as THREE from 'three'

/** What the engine gets back: the room's group to add to the scene, an animator, and a disposer. */
export interface ArcadeRoom {
  /** World frame in inches: floor at Y = 0, the pinball machine stands on the origin facing +Z. */
  group: THREE.Group
  /** Animates screens, flickering neon and marquee chases. `time` is seconds since start. */
  update(time: number): void
  dispose(): void
}

interface Disposable {
  dispose(): void
}

// -------------------------------------------------------------------------------------------
// Palette (kept in step with the rest of the machine's neon look)
// -------------------------------------------------------------------------------------------

const MAGENTA = '#ff2bd6'
const CYAN = '#22e4ff'
const YELLOW = '#ffe14a'
const PURPLE = '#9b5cff'
const ORANGE = '#ff8a1f'
const GREEN = '#3dff8b'
const PALETTE: readonly string[] = [MAGENTA, CYAN, YELLOW, PURPLE, ORANGE, GREEN]

const CARPET_BASE = '#07040d'
const WALL_BASE = '#140b26'
const WALL_WAINSCOT = '#241436'
const CEILING_BASE = '#0a0714'
const CABINET_BLACK = '#0b0810'

// -------------------------------------------------------------------------------------------
// Room shell sizes (inches)
// -------------------------------------------------------------------------------------------

const FLOOR_SIZE = 400
const FLOOR_TEXTURE_SIZE = 512
const FLOOR_REPEAT = 20

const BACK_WALL_Z = -110
const SIDE_WALL_X = 120
const WALL_HEIGHT = 110
const WALL_LENGTH = 320 // side walls run this far along Z, centred a little ahead of the back wall
const WALL_Z_CENTER = 10
const WAINSCOT_TOP_FRACTION = 0.32 // fraction of WALL_HEIGHT the lighter wainscot band reaches
const CHAIR_RAIL_HEIGHT = WALL_HEIGHT * WAINSCOT_TOP_FRACTION

const CEILING_Y = 110
const CEILING_TEXTURE_SIZE = 512
const CEILING_REPEAT = 6

// -------------------------------------------------------------------------------------------
// Arcade cabinet sizes and layout
// -------------------------------------------------------------------------------------------

const CABINET_WIDTH = 26
const CABINET_HEIGHT = 70
const CABINET_DEPTH = 32
const CABINET_SPACING = 30
const BACK_ROW_COUNT = 6
const SIDE_ROW_COUNT = 5
const BACK_ROW_Z = BACK_WALL_Z + CABINET_DEPTH * 0.5 + 2
const LEFT_ROW_X = -SIDE_WALL_X + CABINET_DEPTH * 0.5 + 2
const RIGHT_ROW_X = SIDE_WALL_X - CABINET_DEPTH * 0.5 - 2

// Rotating a cabinet group by these `rotation.y` values turns its screen face to point this way
// (derived so that local +Z, the direction from the cabinet's back edge toward its front, maps to
// world (sin r, 0, cos r) - see `makeCabinetBodyGeometry` for why local +Z is the front).
const FACE_POS_Z = 0
const FACE_POS_X = Math.PI / 2
const FACE_NEG_X = -Math.PI / 2

// Side-profile fractions (of CABINET_DEPTH / CABINET_HEIGHT) shared between the extruded body, the
// screen bezel plane and the marquee box so all three line up.
const KICK_FRONT = CABINET_DEPTH * 0.15
const BODY_FRONT = CABINET_DEPTH * 0.42
const SHELF_INNER = CABINET_DEPTH * 0.5
const SHELF_FRONT = CABINET_DEPTH * 0.75
const SHELF_TOP_HEIGHT = CABINET_HEIGHT * 0.48
const SHELF_UNDER_HEIGHT = CABINET_HEIGHT * 0.44
const BEZEL_BOTTOM_FRONT = CABINET_DEPTH * 0.35
const BEZEL_BOTTOM_HEIGHT = CABINET_HEIGHT * 0.52
const BEZEL_TOP_FRONT = CABINET_DEPTH * 0.58
const BEZEL_TOP_HEIGHT = CABINET_HEIGHT * 0.82
const MARQUEE_FRONT = CABINET_DEPTH * 0.85
const MARQUEE_TOP_HEIGHT = CABINET_HEIGHT
const MARQUEE_UNDER_HEIGHT = CABINET_HEIGHT * 0.9
const BODY_TOP_HEIGHT = CABINET_HEIGHT * 0.86

const SCREEN_MID_FRONT = (BEZEL_BOTTOM_FRONT + BEZEL_TOP_FRONT) / 2
const SCREEN_MID_HEIGHT = (BEZEL_BOTTOM_HEIGHT + BEZEL_TOP_HEIGHT) / 2
const SCREEN_SPAN = Math.hypot(BEZEL_TOP_FRONT - BEZEL_BOTTOM_FRONT, BEZEL_TOP_HEIGHT - BEZEL_BOTTOM_HEIGHT)
const SCREEN_TILT = Math.atan2(BEZEL_TOP_FRONT - BEZEL_BOTTOM_FRONT, BEZEL_TOP_HEIGHT - BEZEL_BOTTOM_HEIGHT)
const SCREEN_WIDTH = CABINET_WIDTH * 0.66

const CONTROL_HEIGHT = (SHELF_TOP_HEIGHT + SHELF_UNDER_HEIGHT) / 2
const CONTROL_FRONT = SHELF_FRONT - 1

// -------------------------------------------------------------------------------------------
// Screen mini-games (sprite sheets, cycled by `update`)
// -------------------------------------------------------------------------------------------

const SCREEN_FRAME_SIZE = 128
const SCREEN_FRAMES = 3
const SCREEN_SHEET_WIDTH = SCREEN_FRAME_SIZE * SCREEN_FRAMES
const SCREEN_FRAME_SECONDS = 0.45

// -------------------------------------------------------------------------------------------
// Neighbouring pinball machines
// -------------------------------------------------------------------------------------------

const NEIGHBOUR_X = 42
const NEIGHBOUR_Z = 4
const NEIGHBOUR_COUNT = 2 // one to either side, mirrored
const NEIGHBOUR_LEG_HEIGHT = 26
const NEIGHBOUR_WIDTH = 22
const NEIGHBOUR_BODY_HEIGHT = 14
const NEIGHBOUR_BODY_DEPTH = 46
const NEIGHBOUR_BACKBOX_HEIGHT = 22
const NEIGHBOUR_BACKBOX_DEPTH = 7

// -------------------------------------------------------------------------------------------
// Small deterministic helpers (local copies: textures.ts does not export these)
// -------------------------------------------------------------------------------------------

/** Deterministic 32-bit PRNG (mulberry32), so confetti and grain are stable frame to frame. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeCanvas(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable for arcade room texture')
  return { canvas, ctx }
}

function finishTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

/** Strokes a glowing neon line: a soft coloured halo under a thin white-hot core. */
function neonPath(
  ctx: CanvasRenderingContext2D,
  points: ReadonlyArray<readonly [number, number]>,
  color: string,
  width: number,
  glow: number,
  closed = false,
): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const trace = (): void => {
    ctx.beginPath()
    points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
    if (closed) ctx.closePath()
  }
  ctx.shadowColor = color
  ctx.shadowBlur = glow
  ctx.strokeStyle = color
  ctx.lineWidth = width
  trace()
  ctx.stroke()
  ctx.shadowBlur = glow * 0.5
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.lineWidth = Math.max(1, width * 0.3)
  trace()
  ctx.stroke()
  ctx.restore()
}

function neonDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  glow: number,
): void {
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = glow
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Fills glowing text: a soft coloured halo under a bright core, the same feel as the neon paths. */
function neonText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
  glow: number,
): void {
  ctx.save()
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = color
  ctx.shadowBlur = glow
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
  ctx.fillText(text, x, y)
  ctx.shadowBlur = glow * 0.35
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.fillText(text, x, y)
  ctx.restore()
}

// -------------------------------------------------------------------------------------------
// Floor: blacklight arcade carpet
// -------------------------------------------------------------------------------------------

const CARPET_SEED = 0x4a11
const CARPET_CONFETTI_COUNT = 140

/** A tiling blacklight-carpet tile: near-black ground scattered with glowing neon confetti. */
function makeArcadeCarpetTexture(): THREE.CanvasTexture {
  const size = FLOOR_TEXTURE_SIZE
  const { canvas, ctx } = makeCanvas(size, size)
  const rand = mulberry32(CARPET_SEED)

  ctx.fillStyle = CARPET_BASE
  ctx.fillRect(0, 0, size, size)

  // A faint mottled weave so the carpet is not a flat colour under close lighting.
  ctx.save()
  ctx.globalAlpha = 0.05
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = rand() > 0.5 ? '#000000' : '#2a1c3d'
    ctx.fillRect(rand() * size, rand() * size, 1, 1)
  }
  ctx.restore()

  for (let i = 0; i < CARPET_CONFETTI_COUNT; i++) {
    const x = rand() * size
    const y = rand() * size
    const color = PALETTE[Math.floor(rand() * PALETTE.length)] ?? MAGENTA
    const shape = Math.floor(rand() * 4)
    const s = 5 + rand() * 10
    ctx.save()
    ctx.globalAlpha = 0.5 + rand() * 0.3
    if (shape === 0) {
      // squiggle
      neonPath(
        ctx,
        [
          [x, y],
          [x + s, y - s * 0.6],
          [x + s * 1.8, y + s * 0.4],
        ],
        color,
        1.6,
        6,
      )
    } else if (shape === 1) {
      // triangle
      neonPath(
        ctx,
        [
          [x, y - s],
          [x + s, y + s],
          [x - s, y + s],
        ],
        color,
        1.4,
        5,
        true,
      )
    } else if (shape === 2) {
      // zigzag
      neonPath(
        ctx,
        [
          [x, y],
          [x + s * 0.6, y - s * 0.7],
          [x + s * 1.2, y],
          [x + s * 1.8, y - s * 0.7],
        ],
        color,
        1.4,
        5,
      )
    } else {
      // dot
      neonDot(ctx, x, y, 1.6 + rand() * 1.4, color, 5)
    }
    ctx.restore()
  }

  const texture = finishTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(FLOOR_REPEAT, FLOOR_REPEAT)
  return texture
}

// -------------------------------------------------------------------------------------------
// Walls and ceiling
// -------------------------------------------------------------------------------------------

/** A dark purple-navy wall with a lighter wainscot band low down (the neon chair rail is a mesh). */
function makeWallTexture(): THREE.CanvasTexture {
  const w = 256
  const h = 512
  const { canvas, ctx } = makeCanvas(w, h)
  ctx.fillStyle = WALL_BASE
  ctx.fillRect(0, 0, w, h)
  const wainscotTop = h * (1 - WAINSCOT_TOP_FRACTION)
  ctx.fillStyle = WALL_WAINSCOT
  ctx.fillRect(0, wainscotTop, w, h - wainscotTop)
  // Faint vertical panel seams.
  ctx.save()
  ctx.globalAlpha = 0.08
  ctx.strokeStyle = '#000000'
  for (let x = 0; x <= w; x += w / 4) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
  }
  ctx.restore()
  return finishTexture(canvas)
}

const CEILING_SEED = 0x77c1
const CEILING_LIGHT_ROWS = 3
const CEILING_LIGHTS_PER_ROW = 6

/** A dark ceiling-tile grid with a few rows of small coloured can lights (used as map + emissiveMap). */
function makeCeilingTexture(): THREE.CanvasTexture {
  const size = CEILING_TEXTURE_SIZE
  const { canvas, ctx } = makeCanvas(size, size)
  const rand = mulberry32(CEILING_SEED)

  ctx.fillStyle = CEILING_BASE
  ctx.fillRect(0, 0, size, size)
  ctx.save()
  ctx.globalAlpha = 0.35
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = 2
  const tiles = 6
  for (let i = 0; i <= tiles; i++) {
    const p = (i / tiles) * size
    ctx.beginPath()
    ctx.moveTo(p, 0)
    ctx.lineTo(p, size)
    ctx.moveTo(0, p)
    ctx.lineTo(size, p)
    ctx.stroke()
  }
  ctx.restore()

  for (let row = 0; row < CEILING_LIGHT_ROWS; row++) {
    const y = size * ((row + 1) / (CEILING_LIGHT_ROWS + 1))
    for (let i = 0; i < CEILING_LIGHTS_PER_ROW; i++) {
      const x = size * ((i + 0.5) / CEILING_LIGHTS_PER_ROW)
      const color = PALETTE[Math.floor(rand() * PALETTE.length)] ?? CYAN
      neonDot(ctx, x, y, 6, color, 14)
    }
  }

  const texture = finishTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(CEILING_REPEAT, CEILING_REPEAT)
  return texture
}

// -------------------------------------------------------------------------------------------
// Neon signs
// -------------------------------------------------------------------------------------------

const SIGN_TEXT_SIZE = { width: 1024, height: 256 }
const SIGN_ICON_SIZE = { width: 512, height: 256 }

/** The big cursive-ish `ARCADE` marquee sign, glowing on a transparent canvas. */
function makeArcadeWordSignTexture(): THREE.CanvasTexture {
  const { width, height } = SIGN_TEXT_SIZE
  const { canvas, ctx } = makeCanvas(width, height)
  neonText(ctx, 'Arcade', width / 2, height / 2, "italic 900 150px 'Brush Script MT', cursive", MAGENTA, 34)
  return finishTexture(canvas)
}

/** A small pictogram sign: a glowing star, lightning bolt, or joystick silhouette. */
function makePictogramSignTexture(kind: 'star' | 'lightning' | 'joystick'): THREE.CanvasTexture {
  const { width, height } = SIGN_ICON_SIZE
  const { canvas, ctx } = makeCanvas(width, height)
  const cx = width / 2
  const cy = height / 2
  if (kind === 'star') {
    const points: Array<[number, number]> = []
    const spikes = 5
    const outer = height * 0.4
    const inner = outer * 0.45
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outer : inner
      const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2
      points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
    }
    neonPath(ctx, points, YELLOW, 5, 22, true)
  } else if (kind === 'lightning') {
    const s = height * 0.38
    neonPath(
      ctx,
      [
        [cx - s * 0.3, cy - s],
        [cx + s * 0.35, cy - s * 0.1],
        [cx - s * 0.05, cy - s * 0.1],
        [cx + s * 0.3, cy + s],
        [cx - s * 0.35, cy + s * 0.15],
        [cx + s * 0.05, cy + s * 0.15],
      ],
      CYAN,
      6,
      24,
      true,
    )
  } else {
    const s = height * 0.32
    neonPath(
      ctx,
      [
        [cx - s * 0.9, cy + s * 0.9],
        [cx + s * 0.9, cy + s * 0.9],
      ],
      GREEN,
      8,
      18,
    )
    neonPath(
      ctx,
      [
        [cx, cy + s * 0.7],
        [cx, cy - s * 0.1],
      ],
      GREEN,
      6,
      16,
    )
    const ballPoints: Array<[number, number]> = []
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2
      ballPoints.push([cx + Math.cos(a) * s * 0.35, cy - s * 0.4 + Math.sin(a) * s * 0.35])
    }
    neonPath(ctx, ballPoints, GREEN, 5, 16, true)
  }
  return finishTexture(canvas)
}

// -------------------------------------------------------------------------------------------
// Screen mini-games: each draws SCREEN_FRAMES frames into one sprite-sheet canvas
// -------------------------------------------------------------------------------------------

type FrameDrawer = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  frame: number,
  rand: () => number,
) => void

function drawInvadersFrame(ctx: CanvasRenderingContext2D, cx: number, cy: number, frame: number): void {
  const cell = 6
  const shiftX = (frame - 1) * cell * 0.6
  ctx.save()
  ctx.fillStyle = GREEN
  ctx.shadowColor = GREEN
  ctx.shadowBlur = 5
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 6; col++) {
      if ((row + col) % 3 === 2) continue
      const x = cx - 40 + col * 14 + shiftX
      const y = cy - 30 + row * 16
      ctx.fillRect(x, y, cell * 1.6, cell)
      ctx.fillRect(x - cell * 0.4, y + cell, cell * 2.4, cell)
    }
  }
  ctx.fillStyle = CYAN
  ctx.fillRect(cx - 6, cy + 40, 12, 6)
  ctx.restore()
}

function drawMazeChaseFrame(ctx: CanvasRenderingContext2D, cx: number, cy: number, frame: number): void {
  ctx.save()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
  for (let i = 0; i < 6; i++) neonDot(ctx, cx - 44 + i * 16, cy + 30, 2, '#ffe14a', 4)
  const mouth = frame === 1 ? 0.05 : 0.28
  ctx.fillStyle = YELLOW
  ctx.shadowColor = YELLOW
  ctx.shadowBlur = 10
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.arc(cx, cy, 18, mouth * Math.PI, (2 - mouth) * Math.PI)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = ORANGE
  ctx.shadowColor = ORANGE
  ctx.beginPath()
  ctx.arc(cx + 40, cy - 4, 12, Math.PI, Math.PI * 2)
  ctx.fillRect(cx + 28, cy - 4, 24, 12)
  ctx.fill()
  ctx.restore()
}

function drawPongFrame(ctx: CanvasRenderingContext2D, cx: number, cy: number, frame: number): void {
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'
  ctx.setLineDash([4, 6])
  ctx.beginPath()
  ctx.moveTo(cx, cy - 48)
  ctx.lineTo(cx, cy + 48)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = CYAN
  ctx.shadowColor = CYAN
  ctx.shadowBlur = 8
  ctx.fillRect(cx - 52, cy - 14, 6, 28)
  ctx.fillRect(cx + 46, cy - 10, 6, 28)
  const ballX = cx - 30 + frame * 30
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = '#ffffff'
  ctx.fillRect(ballX, cy - 3, 6, 6)
  ctx.restore()
}

function drawAsteroidFrame(ctx: CanvasRenderingContext2D, cx: number, cy: number, frame: number): void {
  ctx.save()
  ctx.strokeStyle = '#ffffff'
  ctx.shadowColor = '#ffffff'
  ctx.shadowBlur = 6
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.moveTo(cx, cy - 14)
  ctx.lineTo(cx - 9, cy + 10)
  ctx.lineTo(cx, cy + 5)
  ctx.lineTo(cx + 9, cy + 10)
  ctx.closePath()
  ctx.stroke()
  const rockAngle = frame * 0.6
  ctx.strokeStyle = ORANGE
  ctx.shadowColor = ORANGE
  ctx.save()
  ctx.translate(cx + 40, cy - 30)
  ctx.rotate(rockAngle)
  ctx.beginPath()
  ctx.moveTo(14, 0)
  ctx.lineTo(6, 10)
  ctx.lineTo(-10, 6)
  ctx.lineTo(-8, -8)
  ctx.lineTo(4, -12)
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
  ctx.restore()
}

function drawRacerFrame(ctx: CanvasRenderingContext2D, cx: number, cy: number, frame: number): void {
  ctx.save()
  ctx.fillStyle = '#221830'
  ctx.beginPath()
  ctx.moveTo(cx - 46, cy + 48)
  ctx.lineTo(cx + 46, cy + 48)
  ctx.lineTo(cx + 8, cy - 30)
  ctx.lineTo(cx - 8, cy - 30)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = YELLOW
  ctx.shadowColor = YELLOW
  ctx.shadowBlur = 6
  ctx.setLineDash([8, 10])
  ctx.lineDashOffset = -frame * 12
  ctx.beginPath()
  ctx.moveTo(cx, cy + 48)
  ctx.lineTo(cx, cy - 30)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = MAGENTA
  ctx.shadowColor = MAGENTA
  ctx.fillRect(cx - 10, cy + 24, 20, 12)
  ctx.restore()
}

function drawStackerFrame(ctx: CanvasRenderingContext2D, cx: number, cy: number, frame: number): void {
  ctx.save()
  const cell = 10
  const stack = [
    [0, 0, 1, 1],
    [1, 1, 0, 0],
    [0, 1, 1, 0],
  ]
  stack.forEach((row, ry) => {
    row.forEach((v, rx) => {
      if (!v) return
      ctx.fillStyle = PALETTE[(rx + ry) % PALETTE.length] ?? PURPLE
      ctx.shadowColor = ctx.fillStyle
      ctx.shadowBlur = 4
      ctx.fillRect(cx - 24 + rx * cell, cy + 20 - ry * cell, cell - 1, cell - 1)
    })
  })
  const fallY = cy - 30 + frame * 14
  ctx.fillStyle = CYAN
  ctx.shadowColor = CYAN
  ctx.fillRect(cx + 4, fallY, cell - 1, cell - 1)
  ctx.fillRect(cx + 4 + cell, fallY, cell - 1, cell - 1)
  ctx.restore()
}

const SCREEN_GAMES: readonly FrameDrawer[] = [
  drawInvadersFrame,
  drawMazeChaseFrame,
  drawPongFrame,
  drawAsteroidFrame,
  drawRacerFrame,
  drawStackerFrame,
]

/** Builds one game's sprite sheet: `SCREEN_FRAMES` frames of dark background plus its drawer. */
function makeScreenSheetTexture(drawer: FrameDrawer, seed: number): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(SCREEN_SHEET_WIDTH, SCREEN_FRAME_SIZE)
  const rand = mulberry32(seed)
  for (let f = 0; f < SCREEN_FRAMES; f++) {
    const originX = f * SCREEN_FRAME_SIZE
    ctx.save()
    ctx.fillStyle = '#020103'
    ctx.fillRect(originX, 0, SCREEN_FRAME_SIZE, SCREEN_FRAME_SIZE)
    ctx.restore()
    drawer(ctx, originX + SCREEN_FRAME_SIZE / 2, SCREEN_FRAME_SIZE / 2, f, rand)
  }
  const texture = finishTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.repeat.set(1 / SCREEN_FRAMES, 1)
  return texture
}

// -------------------------------------------------------------------------------------------
// Arcade cabinet geometry
// -------------------------------------------------------------------------------------------

interface ProfilePoint {
  front: number
  height: number
}

/** Kick plate, control-panel shelf, angled screen bezel and marquee overhang, in silhouette order. */
const CABINET_PROFILE: readonly ProfilePoint[] = [
  { front: 0, height: 0 },
  { front: 0, height: BODY_TOP_HEIGHT },
  { front: 0, height: MARQUEE_TOP_HEIGHT },
  { front: MARQUEE_FRONT, height: MARQUEE_TOP_HEIGHT },
  { front: MARQUEE_FRONT, height: MARQUEE_UNDER_HEIGHT },
  { front: BEZEL_TOP_FRONT, height: BEZEL_TOP_HEIGHT },
  { front: BEZEL_BOTTOM_FRONT, height: BEZEL_BOTTOM_HEIGHT },
  { front: SHELF_FRONT, height: SHELF_TOP_HEIGHT },
  { front: SHELF_FRONT, height: SHELF_UNDER_HEIGHT },
  { front: SHELF_INNER, height: SHELF_UNDER_HEIGHT * 0.9 },
  { front: BODY_FRONT, height: CABINET_HEIGHT * 0.06 },
  { front: KICK_FRONT, height: 0 },
]

/**
 * Extrudes `CABINET_PROFILE` sideways into a full cabinet body. Local frame: X is width (centred),
 * Y is height off the floor, Z is depth from the back edge (the origin) toward the front, where the
 * screen and control panel are. Unrotated, the front faces world +Z.
 */
function makeCabinetBodyGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  CABINET_PROFILE.forEach((p, i) => {
    // The shape's own x runs opposite `front`: after `rotateY(PI / 2)` below that puts the back
    // face (front = 0) at local Z = 0 and the screen face (front = CABINET_DEPTH) at local Z > 0.
    const x = -p.front
    if (i === 0) shape.moveTo(x, p.height)
    else shape.lineTo(x, p.height)
  })
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: CABINET_WIDTH, bevelEnabled: false, steps: 1 })
  geometry.rotateY(Math.PI / 2)
  geometry.translate(-CABINET_WIDTH / 2, 0, 0)
  geometry.computeVertexNormals()
  return geometry
}

interface CabinetPlacement {
  x: number
  z: number
  rotY: number
  colorIndex: number
  gameIndex: number
}

function buildCabinetPlacements(): CabinetPlacement[] {
  const placements: CabinetPlacement[] = []
  let n = 0
  for (let i = 0; i < BACK_ROW_COUNT; i++) {
    const x = (i - (BACK_ROW_COUNT - 1) / 2) * CABINET_SPACING
    placements.push({
      x,
      z: BACK_ROW_Z,
      rotY: FACE_POS_Z,
      colorIndex: n % PALETTE.length,
      gameIndex: n % SCREEN_GAMES.length,
    })
    n++
  }
  for (let i = 0; i < SIDE_ROW_COUNT; i++) {
    const z = (i - (SIDE_ROW_COUNT - 1) / 2) * CABINET_SPACING
    placements.push({
      x: LEFT_ROW_X,
      z,
      rotY: FACE_POS_X,
      colorIndex: n % PALETTE.length,
      gameIndex: n % SCREEN_GAMES.length,
    })
    n++
  }
  for (let i = 0; i < SIDE_ROW_COUNT; i++) {
    const z = (i - (SIDE_ROW_COUNT - 1) / 2) * CABINET_SPACING
    placements.push({
      x: RIGHT_ROW_X,
      z,
      rotY: FACE_NEG_X,
      colorIndex: n % PALETTE.length,
      gameIndex: n % SCREEN_GAMES.length,
    })
    n++
  }
  return placements
}

// -------------------------------------------------------------------------------------------
// Neighbouring pinball machine art
// -------------------------------------------------------------------------------------------

/** A small glowing playfield-ish pattern for a distant, low-detail neighbouring machine. */
function makeNeighbourPlayfieldTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(256, 256)
  ctx.fillStyle = '#0c0818'
  ctx.fillRect(0, 0, 256, 256)
  const rand = mulberry32(0x9931)
  for (let i = 0; i < 5; i++) {
    const color = PALETTE[Math.floor(rand() * PALETTE.length)] ?? CYAN
    neonDot(ctx, 40 + rand() * 176, 40 + rand() * 176, 10, color, 16)
  }
  neonPath(
    ctx,
    [
      [30, 220],
      [128, 60],
      [226, 220],
    ],
    PURPLE,
    3,
    10,
    true,
  )
  return finishTexture(canvas)
}

/** A simple glowing backglass-ish rectangle for a distant neighbouring machine. */
function makeNeighbourBackglassTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(256, 128)
  ctx.fillStyle = '#1a0f2e'
  ctx.fillRect(0, 0, 256, 128)
  neonText(ctx, 'PINBALL', 128, 64, "900 34px 'Impact', 'Arial Black', sans-serif", MAGENTA, 14)
  return finishTexture(canvas)
}

/** A generic retro flyer, used as wall-poster dressing. */
function makePosterTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(256, 384)
  const gradient = ctx.createLinearGradient(0, 0, 0, 384)
  gradient.addColorStop(0, '#1c0f3a')
  gradient.addColorStop(1, '#08040f')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 256, 384)
  neonPath(
    ctx,
    [
      [16, 16],
      [240, 16],
      [240, 368],
      [16, 368],
    ],
    ORANGE,
    2,
    8,
    true,
  )
  neonText(ctx, 'HIGH', 128, 150, "900 46px 'Impact', 'Arial Black', sans-serif", CYAN, 16)
  neonText(ctx, 'SCORE', 128, 210, "900 46px 'Impact', 'Arial Black', sans-serif", CYAN, 16)
  return finishTexture(canvas)
}

// -------------------------------------------------------------------------------------------
// Room assembly
// -------------------------------------------------------------------------------------------

/**
 * Builds the dim arcade the machine stands inside: floor, walls, ceiling, rows of upright cabinets
 * with animated screens, a couple of neighbouring pinball machines, neon signage and light set
 * dressing. Nothing here is a `THREE.Light`; the engine lights the scene.
 */
export function createArcadeRoom(): ArcadeRoom {
  const disposables: Disposable[] = []
  const own = <T extends Disposable>(item: T): T => {
    disposables.push(item)
    return item
  }

  const group = new THREE.Group()

  // --- Floor -----------------------------------------------------------------------------------
  {
    const texture = own(makeArcadeCarpetTexture())
    const geometry = own(new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE))
    const material = own(new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95, metalness: 0.02 }))
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.receiveShadow = true
    group.add(mesh)
  }

  // --- Ceiling -----------------------------------------------------------------------------------
  {
    const texture = own(makeCeilingTexture())
    const geometry = own(new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE))
    const material = own(
      new THREE.MeshStandardMaterial({
        map: texture,
        emissiveMap: texture,
        emissive: 0xffffff,
        emissiveIntensity: 0.55,
        roughness: 0.9,
      }),
    )
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = Math.PI / 2
    mesh.position.y = CEILING_Y
    mesh.receiveShadow = true
    group.add(mesh)
  }

  // --- Walls -----------------------------------------------------------------------------------
  const wallTexture = own(makeWallTexture())
  const wallMaterial = own(
    new THREE.MeshStandardMaterial({ map: wallTexture, roughness: 0.85, metalness: 0.04 }),
  )
  {
    const geometry = own(new THREE.PlaneGeometry(SIDE_WALL_X * 2 + 40, WALL_HEIGHT))
    const mesh = new THREE.Mesh(geometry, wallMaterial)
    mesh.position.set(0, WALL_HEIGHT / 2, BACK_WALL_Z)
    mesh.receiveShadow = true
    group.add(mesh)
  }
  for (const sign of [-1, 1] as const) {
    const geometry = own(new THREE.PlaneGeometry(WALL_LENGTH, WALL_HEIGHT))
    const mesh = new THREE.Mesh(geometry, wallMaterial)
    mesh.rotation.y = sign > 0 ? -Math.PI / 2 : Math.PI / 2
    mesh.position.set(sign * SIDE_WALL_X, WALL_HEIGHT / 2, WALL_Z_CENTER)
    mesh.receiveShadow = true
    group.add(mesh)
  }

  // Neon chair-rail line, running along all three walls at the top of the wainscot band.
  const chairRailMaterial = own(
    new THREE.MeshStandardMaterial({ color: CYAN, emissive: CYAN, emissiveIntensity: 1.3, roughness: 0.5 }),
  )
  {
    const geometry = own(new THREE.BoxGeometry(SIDE_WALL_X * 2 + 40, 1.2, 0.6))
    const mesh = new THREE.Mesh(geometry, chairRailMaterial)
    mesh.position.set(0, CHAIR_RAIL_HEIGHT, BACK_WALL_Z + 0.35)
    mesh.receiveShadow = true
    group.add(mesh)
  }
  for (const sign of [-1, 1] as const) {
    const geometry = own(new THREE.BoxGeometry(0.6, 1.2, WALL_LENGTH))
    const mesh = new THREE.Mesh(geometry, chairRailMaterial)
    mesh.position.set(sign * (SIDE_WALL_X - 0.35), CHAIR_RAIL_HEIGHT, WALL_Z_CENTER)
    mesh.receiveShadow = true
    group.add(mesh)
  }

  // --- Neon signs on the back wall -----------------------------------------------------------
  const arcadeSignTexture = own(makeArcadeWordSignTexture())
  const arcadeSignMaterial = own(
    new THREE.MeshStandardMaterial({
      map: arcadeSignTexture,
      emissiveMap: arcadeSignTexture,
      emissive: 0xffffff,
      emissiveIntensity: 1.4,
      transparent: true,
      roughness: 0.4,
      side: THREE.DoubleSide,
    }),
  )
  {
    const geometry = own(new THREE.PlaneGeometry(60, 15))
    const mesh = new THREE.Mesh(geometry, arcadeSignMaterial)
    mesh.position.set(0, WALL_HEIGHT * 0.82, BACK_WALL_Z + 4)
    group.add(mesh)
  }

  // One or two pictogram signs, per the spec; `makePictogramSignTexture` also supports 'joystick'
  // for reuse elsewhere, but only these two are placed here.
  const pictogramKinds = ['star', 'lightning'] as const
  const pictogramMaterials: THREE.MeshStandardMaterial[] = []
  pictogramKinds.forEach((kind, i) => {
    const texture = own(makePictogramSignTexture(kind))
    const material = own(
      new THREE.MeshStandardMaterial({
        map: texture,
        emissiveMap: texture,
        emissive: 0xffffff,
        emissiveIntensity: 1.4,
        transparent: true,
        roughness: 0.4,
        side: THREE.DoubleSide,
      }),
    )
    pictogramMaterials.push(material)
    const geometry = own(new THREE.PlaneGeometry(16, 8))
    const mesh = new THREE.Mesh(geometry, material)
    const x = i === 0 ? -SIDE_WALL_X * 0.55 : SIDE_WALL_X * 0.55
    mesh.position.set(x, WALL_HEIGHT * 0.8, BACK_WALL_Z + 4)
    group.add(mesh)
  })

  // --- Arcade cabinets ---------------------------------------------------------------------------
  const cabinetBodyGeometry = own(makeCabinetBodyGeometry())
  const cabinetBodyMaterials = PALETTE.map((color) =>
    own(
      new THREE.MeshStandardMaterial({
        color: CABINET_BLACK,
        emissive: color,
        emissiveIntensity: 0.05,
        roughness: 0.5,
      }),
    ),
  )
  const marqueeGeometry = own(
    new THREE.BoxGeometry(
      CABINET_WIDTH * 0.92,
      MARQUEE_TOP_HEIGHT - MARQUEE_UNDER_HEIGHT,
      MARQUEE_FRONT * 0.85,
    ),
  )
  const marqueeMaterials = PALETTE.map((color) =>
    own(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.5 })),
  )
  const screenGeometry = own(new THREE.PlaneGeometry(SCREEN_WIDTH, SCREEN_SPAN))
  const screenSheetSeeds = [0x1001, 0x1002, 0x1003, 0x1004, 0x1005, 0x1006]
  const screenTextures = SCREEN_GAMES.map((drawer, i) =>
    own(makeScreenSheetTexture(drawer, screenSheetSeeds[i] ?? i)),
  )
  const screenMaterials = screenTextures.map((texture) =>
    own(
      new THREE.MeshStandardMaterial({
        map: texture,
        emissiveMap: texture,
        emissive: 0xffffff,
        emissiveIntensity: 0.9,
        roughness: 0.6,
      }),
    ),
  )

  const controlBallMaterial = own(
    new THREE.MeshStandardMaterial({ color: '#1a1620', roughness: 0.35, metalness: 0.3 }),
  )
  const controlButtonMaterial = own(
    new THREE.MeshStandardMaterial({
      color: '#c81f3d',
      emissive: '#c81f3d',
      emissiveIntensity: 0.6,
      roughness: 0.4,
    }),
  )
  const controlBallGeometry = own(new THREE.SphereGeometry(0.9, 10, 8))
  const controlButtonGeometry = own(new THREE.CylinderGeometry(0.7, 0.7, 0.5, 12))

  const placements = buildCabinetPlacements()
  const controlBalls = own(
    new THREE.InstancedMesh(controlBallGeometry, controlBallMaterial, placements.length),
  )
  const controlButtons = own(
    new THREE.InstancedMesh(controlButtonGeometry, controlButtonMaterial, placements.length * 2),
  )
  const dummy = new THREE.Object3D()
  let buttonInstance = 0

  placements.forEach((p, i) => {
    const bodyMaterial = cabinetBodyMaterials[p.colorIndex] ?? cabinetBodyMaterials[0]
    const body = new THREE.Mesh(cabinetBodyGeometry, bodyMaterial)
    body.position.set(p.x, 0, p.z - CABINET_DEPTH / 2)
    body.rotation.y = p.rotY
    body.receiveShadow = true
    group.add(body)

    const marqueeMaterial = marqueeMaterials[p.colorIndex] ?? marqueeMaterials[0]
    const marquee = new THREE.Mesh(marqueeGeometry, marqueeMaterial)
    marquee.position.set(0, (MARQUEE_TOP_HEIGHT + MARQUEE_UNDER_HEIGHT) / 2, MARQUEE_FRONT * 0.45)
    body.add(marquee)

    const screenMaterial = screenMaterials[p.gameIndex] ?? screenMaterials[0]
    const screen = new THREE.Mesh(screenGeometry, screenMaterial)
    screen.position.set(0, SCREEN_MID_HEIGHT, SCREEN_MID_FRONT)
    // Positive so the top edge (local +Y) swings toward local +Z, matching the bezel's own slope:
    // BEZEL_TOP_FRONT sits further toward the cabinet's front than BEZEL_BOTTOM_FRONT.
    screen.rotation.x = SCREEN_TILT
    body.add(screen)

    dummy.position.set(p.x, CONTROL_HEIGHT, p.z - CABINET_DEPTH / 2)
    dummy.rotation.set(0, p.rotY, 0)
    dummy.updateMatrix()
    const ballOffset = new THREE.Matrix4().makeTranslation(0, 0, CONTROL_FRONT)
    const ballMatrix = dummy.matrix.clone().multiply(ballOffset)
    controlBalls.setMatrixAt(i, ballMatrix)

    for (const side of [-1, 1] as const) {
      const buttonOffset = new THREE.Matrix4().makeTranslation(side * 3.5, -0.8, CONTROL_FRONT - 2)
      const buttonMatrix = dummy.matrix.clone().multiply(buttonOffset)
      controlButtons.setMatrixAt(buttonInstance, buttonMatrix)
      buttonInstance++
    }
  })
  controlBalls.instanceMatrix.needsUpdate = true
  controlButtons.instanceMatrix.needsUpdate = true
  group.add(controlBalls, controlButtons)

  // --- Neighbouring pinball machines ------------------------------------------------------------
  const neighbourPlayfieldTexture = own(makeNeighbourPlayfieldTexture())
  const neighbourPlayfieldMaterial = own(
    new THREE.MeshStandardMaterial({
      map: neighbourPlayfieldTexture,
      emissiveMap: neighbourPlayfieldTexture,
      emissive: 0xffffff,
      emissiveIntensity: 0.6,
      roughness: 0.6,
    }),
  )
  const neighbourBackglassTexture = own(makeNeighbourBackglassTexture())
  const neighbourBackglassMaterial = own(
    new THREE.MeshStandardMaterial({
      map: neighbourBackglassTexture,
      emissiveMap: neighbourBackglassTexture,
      emissive: 0xffffff,
      emissiveIntensity: 0.7,
      roughness: 0.5,
    }),
  )
  const neighbourBodyMaterial = own(new THREE.MeshStandardMaterial({ color: '#0e0a18', roughness: 0.7 }))
  const neighbourLegGeometry = own(new THREE.CylinderGeometry(0.7, 0.9, NEIGHBOUR_LEG_HEIGHT, 8))
  const neighbourLegs = own(
    new THREE.InstancedMesh(neighbourLegGeometry, neighbourBodyMaterial, NEIGHBOUR_COUNT * 4),
  )
  let legInstance = 0
  const neighbourSigns: Array<-1 | 1> = [-1, 1]
  for (const sign of neighbourSigns) {
    const x = sign * NEIGHBOUR_X
    const z = NEIGHBOUR_Z
    const bodyGeometry = own(
      new THREE.BoxGeometry(NEIGHBOUR_WIDTH, NEIGHBOUR_BODY_HEIGHT, NEIGHBOUR_BODY_DEPTH),
    )
    const body = new THREE.Mesh(bodyGeometry, neighbourBodyMaterial)
    body.position.set(x, NEIGHBOUR_LEG_HEIGHT + NEIGHBOUR_BODY_HEIGHT / 2, z)
    body.receiveShadow = true
    group.add(body)

    const playfieldGeometry = own(
      new THREE.PlaneGeometry(NEIGHBOUR_WIDTH * 0.92, NEIGHBOUR_BODY_DEPTH * 0.92),
    )
    const playfield = new THREE.Mesh(playfieldGeometry, neighbourPlayfieldMaterial)
    playfield.rotation.x = -Math.PI / 2 + 0.12
    playfield.position.set(x, NEIGHBOUR_LEG_HEIGHT + NEIGHBOUR_BODY_HEIGHT + 0.2, z)
    group.add(playfield)

    const backboxGeometry = own(
      new THREE.BoxGeometry(NEIGHBOUR_WIDTH, NEIGHBOUR_BACKBOX_HEIGHT, NEIGHBOUR_BACKBOX_DEPTH),
    )
    const backbox = new THREE.Mesh(backboxGeometry, neighbourBodyMaterial)
    const backboxY = NEIGHBOUR_LEG_HEIGHT + NEIGHBOUR_BODY_HEIGHT + NEIGHBOUR_BACKBOX_HEIGHT / 2
    const backboxZ = z - NEIGHBOUR_BODY_DEPTH / 2 - NEIGHBOUR_BACKBOX_DEPTH / 2 + 1
    backbox.position.set(x, backboxY, backboxZ)
    backbox.receiveShadow = true
    group.add(backbox)

    const faceGeometry = own(new THREE.PlaneGeometry(NEIGHBOUR_WIDTH * 0.8, NEIGHBOUR_BACKBOX_HEIGHT * 0.75))
    const face = new THREE.Mesh(faceGeometry, neighbourBackglassMaterial)
    face.position.set(x, backboxY, backboxZ + NEIGHBOUR_BACKBOX_DEPTH / 2 + 0.05)
    group.add(face)

    for (const legX of [-1, 1] as const) {
      for (const legZ of [-1, 1] as const) {
        dummy.position.set(
          x + legX * (NEIGHBOUR_WIDTH / 2 - 1.2),
          NEIGHBOUR_LEG_HEIGHT / 2,
          z + legZ * (NEIGHBOUR_BODY_DEPTH / 2 - 2),
        )
        dummy.rotation.set(0, 0, 0)
        dummy.updateMatrix()
        neighbourLegs.setMatrixAt(legInstance, dummy.matrix)
        legInstance++
      }
    }
  }
  neighbourLegs.instanceMatrix.needsUpdate = true
  group.add(neighbourLegs)

  // --- Small set dressing ---------------------------------------------------------------------
  const dressingMaterial = own(new THREE.MeshStandardMaterial({ color: '#120c1e', roughness: 0.8 }))
  {
    // A change-machine silhouette tucked in the back-right corner, out of the aisle and the rows.
    const geometry = own(new THREE.BoxGeometry(10, 30, 8))
    const mesh = new THREE.Mesh(geometry, dressingMaterial)
    mesh.position.set(SIDE_WALL_X * 0.82, 15, BACK_WALL_Z + 6)
    mesh.receiveShadow = true
    group.add(mesh)
    const slot = own(
      new THREE.MeshStandardMaterial({
        color: ORANGE,
        emissive: ORANGE,
        emissiveIntensity: 1.4,
        roughness: 0.5,
      }),
    )
    const slotGeometry = own(new THREE.BoxGeometry(2.4, 0.6, 0.2))
    const slotMesh = new THREE.Mesh(slotGeometry, slot)
    slotMesh.position.set(SIDE_WALL_X * 0.82, 20, BACK_WALL_Z + 10.1)
    group.add(slotMesh)
  }

  const stoolMaterial = own(
    new THREE.MeshStandardMaterial({ color: '#1c1424', roughness: 0.6, metalness: 0.2 }),
  )
  const stoolGeometry = own(new THREE.CylinderGeometry(4, 3, 1.2, 10))
  const stoolLegGeometry = own(new THREE.CylinderGeometry(0.4, 0.4, 18, 6))
  const stoolSeats = own(new THREE.InstancedMesh(stoolGeometry, stoolMaterial, 2))
  const stoolLegs = own(new THREE.InstancedMesh(stoolLegGeometry, stoolMaterial, 2))
  const stoolSpots: Array<[number, number]> = [
    [SIDE_WALL_X * 0.5, BACK_WALL_Z + 10],
    [-SIDE_WALL_X * 0.5, BACK_WALL_Z + 10],
  ]
  stoolSpots.forEach(([x, z], i) => {
    dummy.position.set(x, 18.6, z)
    dummy.rotation.set(0, 0, 0)
    dummy.updateMatrix()
    stoolSeats.setMatrixAt(i, dummy.matrix)
    dummy.position.set(x, 9, z)
    dummy.updateMatrix()
    stoolLegs.setMatrixAt(i, dummy.matrix)
  })
  stoolSeats.instanceMatrix.needsUpdate = true
  stoolLegs.instanceMatrix.needsUpdate = true
  group.add(stoolSeats, stoolLegs)

  const posterTexture = own(makePosterTexture())
  const posterMaterial = own(
    new THREE.MeshStandardMaterial({
      map: posterTexture,
      emissiveMap: posterTexture,
      emissive: 0xffffff,
      emissiveIntensity: 0.4,
      roughness: 0.7,
    }),
  )
  const posterGeometry = own(new THREE.PlaneGeometry(12, 18))
  for (const sign of [-1, 1] as const) {
    const mesh = new THREE.Mesh(posterGeometry, posterMaterial)
    mesh.rotation.y = sign > 0 ? -Math.PI / 2 : Math.PI / 2
    mesh.position.set(sign * (SIDE_WALL_X - 0.5), CHAIR_RAIL_HEIGHT + 14, WALL_Z_CENTER - 60)
    group.add(mesh)
  }

  // --- Animation state --------------------------------------------------------------------------
  let lastFrame = -1

  return {
    group,
    update(time: number) {
      const frame = Math.floor(time / SCREEN_FRAME_SECONDS) % SCREEN_FRAMES
      if (frame !== lastFrame) {
        lastFrame = frame
        for (const texture of screenTextures) texture.offset.x = frame / SCREEN_FRAMES
      }

      marqueeMaterials.forEach((material, i) => {
        material.emissiveIntensity = 0.55 + 0.25 * (0.5 + 0.5 * Math.sin(time * 2.2 + i * 1.1))
      })

      // One pictogram sign flickers slightly, like a tube with a loose transformer.
      const flicker = pictogramMaterials[0]
      if (flicker) {
        const base = 1.4
        const dropout = Math.sin(time * 61.7) > 0.92 ? -0.6 : 0
        const wobble = Math.sin(time * 9.3) * 0.08 + Math.sin(time * 27.1) * 0.05 + dropout
        flicker.emissiveIntensity = Math.max(0.2, base + wobble)
      }
    },
    dispose() {
      for (const item of disposables) item.dispose()
    },
  }
}
