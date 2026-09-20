/**
 * Everything that sits on the playfield: the art, walls, posts, targets, ramp, flippers, balls
 * and the lamps that light through the playfield art. Pure three.js: nothing here reads or
 * mutates `TableState`/`GameState` except by copying numbers into meshes each frame.
 */

import * as THREE from 'three'
import type {
  Ball,
  GameState,
  Insert,
  LampState,
  PhysicsEvent,
  Ramp,
  Table,
  TableState,
  Vec2,
  Wall,
} from '../game/types.ts'
import { flipperTip, rampLength, rampPoint } from '../game/physics.ts'
import {
  makeBrushedMetalBump,
  makeBrushedMetalRoughness,
  makePebbleBump,
  makePowderCoatBump,
  makeScratchRoughness,
  makeWoodBump,
  makeWoodGrain,
} from './materialTextures.ts'
import { makeApronTexture, makePlayfieldTexture, PLAYFIELD_TEXTURE_INCHES } from './textures.ts'

// -------------------------------------------------------------------------------------------
// Palette (SPEC.md "Palette")
// -------------------------------------------------------------------------------------------

const MAGENTA = 0xff2bd6
const CYAN = 0x22e4ff
const YELLOW = 0xffe14a
const PURPLE = 0x9b5cff
const ORANGE = 0xff8a1f

/** Cycled across posts and bumper caps so neighbouring parts read as different colours. */
const ACCENT_CYCLE = [MAGENTA, CYAN, YELLOW, ORANGE]

// -------------------------------------------------------------------------------------------
// Height scale, in inches above the playfield (SPEC.md S9 "Height scale")
// -------------------------------------------------------------------------------------------

const WALL_HEIGHT = 1.1
const POST_HEIGHT = 1.2
const BUMPER_HEIGHT = 2.1
const TARGET_HEIGHT = 1.2
const SLINGSHOT_PLASTIC_HEIGHT = 1.3
const GATE_HEIGHT = 0.55
const RAMP_WIDTH = 1.7
const RAMP_WALL_HEIGHT = 0.5
/** Distance along the ramp between visual samples; the geometry is one ribbon, not one mesh per sample. */
const RAMP_SAMPLE_STEP = 0.5
const RAMP_STANDOFF_STRIDE = 5

const WALL_THICKNESS: Record<Wall['kind'], number> = { rail: 0.35, guide: 0.12, rubber: 0.25 }

// -------------------------------------------------------------------------------------------
// Material realism (SPEC.md realism pass, section R1)
// -------------------------------------------------------------------------------------------

/** Any white/near-white diffuse surface (flippers, bumper skirts, rubber) is capped at this. */
const NEAR_WHITE = 0xd9d6d0
/** `bumpScale` values, in inches: small enough that the maps read as texture, not topography. */
const METAL_BUMP_SCALE = 0.015
const WOOD_BUMP_SCALE = 0.03
const RUBBER_BUMP_SCALE = 0.04
const PLASTIC_BUMP_SCALE = 0.012
const POWDER_BUMP_SCALE = 0.02
const RAIL_WOOD_TINT = '#15121a'
const RAIL_WOOD_GRAIN = '#2a2433'
const PLAYFIELD_SCRATCH_REPEAT_U = 3
const PLAYFIELD_SCRATCH_REPEAT_V = 6

// -------------------------------------------------------------------------------------------
// Timings
// -------------------------------------------------------------------------------------------

const BUMPER_FLASH_SECONDS = 0.08
const SLINGSHOT_KICK_SECONDS = 0.07
const STANDUP_FLASH_SECONDS = 0.12
const DROP_TARGET_MOVE_SECONDS = 0.09
const INSERT_BLINK_HZ = 3
const LIGHT_SHOW_BLINK_HZ = 8
/** Cycles per second of the attract chase pattern travelling across the lamp chain. */
const ATTRACT_CHASE_SPEED = 0.6
const ATTRACT_CHASE_WIDTH = 0.18

const INSERT_OFF_INTENSITY = 0.05
/** A lamp fully "on" or blinking-on. */
const INSERT_ON_INTENSITY = 1.3
/**
 * The "big flash" cap shared by the award light-show sweep, the attract chase, a standup's hit
 * flash and a saucer's held glow: brighter than a single lamp, still capped against glare.
 */
const GLOW_CAP_INTENSITY = 1.5

const MAX_BALLS = 8

// -------------------------------------------------------------------------------------------
// Coordinate frame
//
// `TableView.group`'s local frame: X = table x - width/2, Y = up, Z = table y - height/2. A
// table angle `t` means direction (cos t, sin t) in table (x, y); this frame's Y-rotation
// `Ry(theta)` sends local +X to (cos theta, 0, -sin theta), so `Ry(-t)` sends it to
// (cos t, 0, sin t) - exactly `t`'s table offset carried straight across by `localX`/`localZ`.
// That is the `angleToRotationY` rule below, used for every part whose rest pose is built
// pointing along local +X for table angle 0 (flippers, insert arrows, the spinner plate, and
// every wall/box segment oriented along a table-space direction).
// -------------------------------------------------------------------------------------------

function localX(table: Table, x: number): number {
  return x - table.width / 2
}

function localZ(table: Table, y: number): number {
  return y - table.height / 2
}

function angleToRotationY(t: number): number {
  return -t
}

function segmentAngle(a: Vec2, b: Vec2): number {
  return Math.atan2(b.y - a.y, b.x - a.x)
}

function segmentLength(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function segmentMidLocal(table: Table, a: Vec2, b: Vec2): THREE.Vector2 {
  return new THREE.Vector2(localX(table, (a.x + b.x) / 2), localZ(table, (a.y + b.y) / 2))
}

/** True on a `hz`-cycle-per-second square wave, driven by the (deterministic) physics clock. */
function isBlinkOn(time: number, hz: number): boolean {
  return Math.floor(time * hz * 2) % 2 === 0
}

// -------------------------------------------------------------------------------------------
// Disposal bookkeeping
// -------------------------------------------------------------------------------------------

interface Disposable {
  dispose(): void
}

function disposeAll(items: Disposable[]): void {
  for (const item of items) item.dispose()
}

// -------------------------------------------------------------------------------------------
// Shared material kit
//
// One instance per `createTableView` call, built once and handed to every builder that needs a
// "brushed stainless", "white rubber" or "ABS plastic" look, so the underlying textures and (where
// the colour is identical) the materials themselves are shared rather than rebuilt per part.
// -------------------------------------------------------------------------------------------

interface MaterialKit {
  /** Guide walls, rollover wires, spinner bracket, gate wire, ramp stand-offs, plunger rod, screws. */
  brushedMaterial: THREE.MeshStandardMaterial
  /** White rubber: `rubber`-kind walls, post rings, slingshot bands. */
  rubberMaterial: THREE.MeshStandardMaterial
  /** Shared bump map for every ABS-plastic part (each keeps its own colour/emissive material). */
  pebbleBump: THREE.CanvasTexture
  /** Black-painted plywood for `rail`-kind walls. */
  railWoodMaterial: THREE.MeshPhysicalMaterial
}

function createMaterialKit(envMap: THREE.Texture | null): MaterialKit & Disposable {
  const brushedRoughness = makeBrushedMetalRoughness()
  const brushedBump = makeBrushedMetalBump()
  const brushedMaterial = new THREE.MeshStandardMaterial({
    color: 0xdadde3,
    roughness: 0.45,
    roughnessMap: brushedRoughness,
    metalness: 1,
    bumpMap: brushedBump,
    bumpScale: METAL_BUMP_SCALE,
    envMap: envMap ?? null,
    envMapIntensity: envMap ? 0.7 : 0,
  })

  const pebbleBump = makePebbleBump()
  const rubberMaterial = new THREE.MeshStandardMaterial({
    color: NEAR_WHITE,
    roughness: 0.85,
    bumpMap: pebbleBump,
    bumpScale: RUBBER_BUMP_SCALE,
  })

  const railWoodColor = makeWoodGrain(RAIL_WOOD_TINT, RAIL_WOOD_GRAIN)
  const railWoodBump = makeWoodBump()
  const railWoodMaterial = new THREE.MeshPhysicalMaterial({
    map: railWoodColor,
    bumpMap: railWoodBump,
    bumpScale: WOOD_BUMP_SCALE,
    roughness: 0.55,
    clearcoat: 0.25,
    clearcoatRoughness: 0.3,
  })

  return {
    brushedMaterial,
    rubberMaterial,
    pebbleBump,
    railWoodMaterial,
    dispose() {
      brushedRoughness.dispose()
      brushedBump.dispose()
      brushedMaterial.dispose()
      pebbleBump.dispose()
      rubberMaterial.dispose()
      railWoodColor.dispose()
      railWoodBump.dispose()
      railWoodMaterial.dispose()
    },
  }
}

// -------------------------------------------------------------------------------------------
// Playfield
// -------------------------------------------------------------------------------------------

/**
 * The playfield surface, textured by `makePlayfieldTexture`.
 *
 * Orientation, verified by hand: the texture is drawn with canvas x = table x and canvas
 * y = table y (0 at the top arch). `PlaneGeometry`'s default UVs run u: 0..1 across local +X and
 * v: 0..1 across local +Y, and a `CanvasTexture` defaults to `flipY = true`, which is exactly the
 * convention that samples an un-flipped canvas's top row (table y = 0) at v = 1 - so table y = 0
 * lands on the plane's own +Y edge and table x = 0 lands on its -X edge, with no UV changes
 * needed. Rotating the geometry -90 degrees about X (the same "lay flat, normal up" rotation
 * used for floors) maps a local point (x, y, 0) to (x, 0, -y) (since cos(-90deg) = 0,
 * sin(-90deg) = -1), which sends the plane's own +Y edge to local Z = -height/2 and its -Y edge
 * to Z = +height/2. So after the rotation: table (0, 0) sits at local (-width/2, 0, -height/2)
 * and table (width, height) at (+width/2, 0, +height/2) - matching `localX`/`localZ` exactly,
 * with table x running along local +X and table y along local +Z, unrotated and unflipped.
 */
function buildPlayfield(table: Table): { mesh: THREE.Mesh } & Disposable {
  const geometry = new THREE.PlaneGeometry(PLAYFIELD_TEXTURE_INCHES.width, PLAYFIELD_TEXTURE_INCHES.height)
  geometry.rotateX(-Math.PI / 2)
  const texture = makePlayfieldTexture(table)
  const roughnessMap = makeScratchRoughness()
  roughnessMap.repeat.set(PLAYFIELD_SCRATCH_REPEAT_U, PLAYFIELD_SCRATCH_REPEAT_V)
  const material = new THREE.MeshPhysicalMaterial({
    map: texture,
    roughness: 0.5,
    roughnessMap,
    clearcoat: 1,
    clearcoatRoughness: 0.22,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  return {
    mesh,
    dispose() {
      geometry.dispose()
      material.dispose()
      texture.dispose()
      roughnessMap.dispose()
    },
  }
}

/** The gap, in inches, between the flippers' lowest reach and the apron's top edge. */
const APRON_FLIPPER_CLEARANCE = 0.5

interface ApronRect {
  rightX: number
  topY: number
  width: number
  depth: number
}

/**
 * The apron's footprint, derived from the table (not hard-coded): it runs from just below the
 * flippers' resting tips to the bottom edge, and stops at the plunger zone's left edge so the
 * shooter lane stays open. Shared by `buildApron` (the mesh) and `buildScrews` (corner screws).
 */
function computeApronRect(table: Table): ApronRect {
  // Just below the lowest point the flippers reach (their tips at rest), so they are never covered.
  let topY = 0
  for (const flipper of table.flippers) {
    const tipY = flipperTip(flipper, flipper.restAngle).y + flipper.radius
    topY = Math.max(topY, tipY + APRON_FLIPPER_CLEARANCE)
  }
  topY = Math.min(topY, table.height - 0.5)
  const rightX = table.plunger.zone.min.x
  const width = Math.max(0.1, rightX)
  const depth = Math.max(0.1, table.height - topY)
  return { rightX, topY, width, depth }
}

/** The powder-coated steel apron under the flippers, keeping its printed art texture. */
function buildApron(table: Table): { mesh: THREE.Mesh } & Disposable {
  const { rightX, topY, width, depth } = computeApronRect(table)

  const geometry = new THREE.BoxGeometry(width, 0.3, depth)
  const texture = makeApronTexture()
  const bumpMap = makePowderCoatBump()
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    bumpMap,
    bumpScale: POWDER_BUMP_SCALE,
    roughness: 0.6,
    metalness: 0.3,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(localX(table, rightX / 2), 1, localZ(table, (topY + table.height) / 2))
  mesh.castShadow = true
  mesh.receiveShadow = true
  return {
    mesh,
    dispose() {
      geometry.dispose()
      material.dispose()
      texture.dispose()
      bumpMap.dispose()
    },
  }
}

// -------------------------------------------------------------------------------------------
// Walls (rail / guide / rubber), including the arch
// -------------------------------------------------------------------------------------------

/**
 * Rail (black-painted wood), guide (brushed stainless) and rubber (white, pebbled) all come from
 * the shared `MaterialKit`, so this view builds no wall material of its own and disposes none:
 * the kit owns them.
 */
function wallMaterialFor(kind: Wall['kind'], kit: MaterialKit): THREE.Material {
  if (kind === 'rail') return kit.railWoodMaterial
  if (kind === 'guide') return kit.brushedMaterial
  return kit.rubberMaterial
}

function buildWalls(table: Table, kit: MaterialKit): { group: THREE.Group } & Disposable {
  const group = new THREE.Group()
  const disposables: Disposable[] = []

  const materials: Record<Wall['kind'], THREE.Material> = {
    rail: wallMaterialFor('rail', kit),
    guide: wallMaterialFor('guide', kit),
    rubber: wallMaterialFor('rubber', kit),
  }

  for (const wall of table.walls) {
    const thickness = WALL_THICKNESS[wall.kind]
    const length = Math.max(0.01, segmentLength(wall.a, wall.b))
    const mid = segmentMidLocal(table, wall.a, wall.b)
    const angle = angleToRotationY(segmentAngle(wall.a, wall.b))

    const geometry = new THREE.BoxGeometry(length, WALL_HEIGHT, thickness)
    const mesh = new THREE.Mesh(geometry, materials[wall.kind])
    mesh.position.set(mid.x, WALL_HEIGHT / 2, mid.y)
    mesh.rotation.y = angle
    mesh.castShadow = true
    mesh.receiveShadow = true
    disposables.push(geometry)
    group.add(mesh)

    if (wall.kind === 'rail') {
      const stripHeight = 0.08
      const stripGeometry = new THREE.BoxGeometry(length, stripHeight, thickness * 0.7)
      const strip = new THREE.Mesh(stripGeometry, kit.brushedMaterial)
      strip.position.set(mid.x, WALL_HEIGHT - stripHeight / 2, mid.y)
      strip.rotation.y = angle
      strip.castShadow = true
      disposables.push(stripGeometry)
      group.add(strip)
    }
  }

  // Join shared endpoints (the arch's 28 segments, and the arch meeting the side walls) with a
  // small cylinder so the run reads as one smooth rail instead of a chain of visible seams.
  const joints = new Map<string, { pos: Vec2; kind: Wall['kind']; count: number }>()
  for (const wall of table.walls) {
    for (const point of [wall.a, wall.b]) {
      const key = `${wall.kind}:${point.x.toFixed(3)}:${point.y.toFixed(3)}`
      const existing = joints.get(key)
      if (existing) existing.count += 1
      else joints.set(key, { pos: point, kind: wall.kind, count: 1 })
    }
  }
  for (const joint of joints.values()) {
    if (joint.count < 2) continue
    const thickness = WALL_THICKNESS[joint.kind]
    const geometry = new THREE.CylinderGeometry(thickness / 2, thickness / 2, WALL_HEIGHT, 12)
    const mesh = new THREE.Mesh(geometry, materials[joint.kind])
    mesh.position.set(localX(table, joint.pos.x), WALL_HEIGHT / 2, localZ(table, joint.pos.y))
    mesh.castShadow = true
    mesh.receiveShadow = true
    disposables.push(geometry)
    group.add(mesh)
  }

  return { group, dispose: () => disposeAll(disposables) }
}

// -------------------------------------------------------------------------------------------
// Posts
// -------------------------------------------------------------------------------------------

function buildPosts(
  table: Table,
  envMap: THREE.Texture | null,
  kit: MaterialKit,
): { group: THREE.Group } & Disposable {
  const group = new THREE.Group()
  const disposables: Disposable[] = []

  table.posts.forEach((post, index) => {
    const color = ACCENT_CYCLE[index % ACCENT_CYCLE.length]
    const bodyGeometry = new THREE.CylinderGeometry(post.radius * 0.7, post.radius * 0.7, POST_HEIGHT, 16)
    const bodyMaterial = new THREE.MeshPhysicalMaterial({
      color,
      transparent: true,
      opacity: 0.55,
      roughness: 0.45,
      bumpMap: kit.pebbleBump,
      bumpScale: PLASTIC_BUMP_SCALE,
      emissive: color,
      emissiveIntensity: 0.25,
      envMap: envMap ?? null,
      envMapIntensity: envMap ? 0.6 : 0,
    })
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
    body.position.set(localX(table, post.pos.x), POST_HEIGHT / 2, localZ(table, post.pos.y))
    body.castShadow = true
    body.receiveShadow = true

    // The rubber ring uses the shared `kit.rubberMaterial`; only the post body is disposed here.
    const ringGeometry = new THREE.TorusGeometry(post.radius * 0.85, Math.min(0.09, post.radius * 0.3), 10, 20)
    const ring = new THREE.Mesh(ringGeometry, kit.rubberMaterial)
    ring.rotation.x = Math.PI / 2
    ring.position.set(localX(table, post.pos.x), table.ballRadius, localZ(table, post.pos.y))
    ring.castShadow = true

    disposables.push(bodyGeometry, bodyMaterial, ringGeometry)
    group.add(body, ring)
  })

  return { group, dispose: () => disposeAll(disposables) }
}

// -------------------------------------------------------------------------------------------
// Bumpers
// -------------------------------------------------------------------------------------------

/** A bumper lamp's glow on the playfield while idle. The scene is in inches, so lights use linear falloff. */
const BUMPER_LIGHT_IDLE = 1.4
/** Added to the idle light while the bumper's lamp is blinking. */
const BUMPER_LIGHT_BLINK_BONUS = 1.5
/** Added to the idle light for a hit's brief flash; the flash is binary, so this is also its max. */
const BUMPER_LIGHT_HIT_BONUS = 5
const BUMPER_CAP_IDLE_INTENSITY = 0.5
const BUMPER_CAP_BLINK_INTENSITY = 0.9
const BUMPER_CAP_FLASH_INTENSITY = 1.8

interface BumperVisual {
  id: string
  capMaterial: THREE.MeshPhysicalMaterial
  ringMaterial: THREE.MeshStandardMaterial
  ring: THREE.Mesh
  ringBaseY: number
  light: THREE.PointLight
  flashT: number
}

function buildBumpers(
  table: Table,
  envMap: THREE.Texture | null,
  kit: MaterialKit,
): { group: THREE.Group; visuals: BumperVisual[] } & Disposable {
  const group = new THREE.Group()
  const disposables: Disposable[] = []
  const visuals: BumperVisual[] = []

  // Skirt and body are moulded ABS plastic, sharing the kit's pebbled bump map.
  const skirtMaterial = new THREE.MeshStandardMaterial({
    color: NEAR_WHITE,
    roughness: 0.45,
    bumpMap: kit.pebbleBump,
    bumpScale: PLASTIC_BUMP_SCALE,
  })
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x1c1626,
    roughness: 0.45,
    bumpMap: kit.pebbleBump,
    bumpScale: PLASTIC_BUMP_SCALE,
  })
  disposables.push(skirtMaterial, bodyMaterial)

  table.bumpers.forEach((bumper, index) => {
    const color = [MAGENTA, CYAN, YELLOW][index % 3]
    const bumperGroup = new THREE.Group()
    bumperGroup.position.set(localX(table, bumper.pos.x), 0, localZ(table, bumper.pos.y))

    const skirtGeometry = new THREE.ConeGeometry(bumper.radius * 1.3, 0.22, 20)
    const skirt = new THREE.Mesh(skirtGeometry, skirtMaterial)
    skirt.position.y = 0.11
    skirt.castShadow = true
    skirt.receiveShadow = true

    const bodyHeight = BUMPER_HEIGHT * 0.55
    const bodyGeometry = new THREE.CylinderGeometry(bumper.radius * 0.8, bumper.radius * 0.85, bodyHeight, 20)
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
    body.position.y = 0.22 + bodyHeight / 2
    body.castShadow = true

    const capGeometry = new THREE.SphereGeometry(bumper.radius, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2)
    const capMaterial = new THREE.MeshPhysicalMaterial({
      color,
      transparent: true,
      opacity: 0.6,
      roughness: 0.15,
      emissive: color,
      emissiveIntensity: 0.6,
      envMap: envMap ?? null,
      envMapIntensity: envMap ? 0.8 : 0,
    })
    const cap = new THREE.Mesh(capGeometry, capMaterial)
    cap.position.y = BUMPER_HEIGHT - bumper.radius
    cap.castShadow = true

    const ringGeometry = new THREE.TorusGeometry(bumper.radius * 0.95, 0.06, 10, 24)
    const ringMaterial = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.4,
      roughness: 0.4,
    })
    const ring = new THREE.Mesh(ringGeometry, ringMaterial)
    ring.rotation.x = Math.PI / 2
    const ringBaseY = BUMPER_HEIGHT - bumper.radius * 0.4
    ring.position.y = ringBaseY

    const light = new THREE.PointLight(color, BUMPER_LIGHT_IDLE, bumper.radius * 7, 1)
    light.position.y = BUMPER_HEIGHT

    bumperGroup.add(skirt, body, cap, ring, light)
    group.add(bumperGroup)

    disposables.push(skirtGeometry, bodyGeometry, capGeometry, capMaterial, ringGeometry, ringMaterial)
    visuals.push({ id: bumper.id, capMaterial, ringMaterial, ring, ringBaseY, light, flashT: 0 })
  })

  return { group, visuals, dispose: () => disposeAll(disposables) }
}

function updateBumpers(visuals: BumperVisual[], game: GameState, events: readonly PhysicsEvent[], dt: number): void {
  for (const v of visuals) v.flashT = Math.max(0, v.flashT - dt)
  for (const event of events) {
    if (event.type !== 'bumper') continue
    for (const v of visuals) {
      if (v.id === event.id) v.flashT = BUMPER_FLASH_SECONDS
    }
  }
  for (const v of visuals) {
    const flashing = v.flashT > 0
    const lamp: LampState = game.lamps[v.id] ?? 'off'
    v.capMaterial.emissiveIntensity = flashing
      ? BUMPER_CAP_FLASH_INTENSITY
      : lamp === 'blink'
        ? BUMPER_CAP_BLINK_INTENSITY
        : BUMPER_CAP_IDLE_INTENSITY
    const blinkBonus = lamp === 'blink' ? BUMPER_LIGHT_BLINK_BONUS : 0
    const hitBonus = flashing ? BUMPER_LIGHT_HIT_BONUS : 0
    v.light.intensity = BUMPER_LIGHT_IDLE + blinkBonus + hitBonus
    v.ring.position.y = flashing ? v.ringBaseY - 0.25 : v.ringBaseY
  }
}

// -------------------------------------------------------------------------------------------
// Slingshots
// -------------------------------------------------------------------------------------------

interface SlingshotVisual {
  id: string
  face: THREE.Mesh
  baseX: number
  baseY: number
  baseZ: number
  outX: number
  outZ: number
  kickT: number
}

/** A flat, explicit 3-vertex triangle - built directly in local space, so there is no rotation to get backwards. */
function buildFlatTriangle(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z])
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex([0, 1, 2])
  geometry.computeVertexNormals()
  return geometry
}

function buildSlingshots(
  table: Table,
  envMap: THREE.Texture | null,
  kit: MaterialKit,
): { group: THREE.Group; visuals: SlingshotVisual[] } & Disposable {
  const group = new THREE.Group()
  const disposables: Disposable[] = []
  const visuals: SlingshotVisual[] = []
  // Rubber bands share the kit's white rubber material; only the edge line is owned here.
  const edgeMaterial = new THREE.LineBasicMaterial({ color: MAGENTA, toneMapped: false })
  disposables.push(edgeMaterial)

  const rubberY = 0.55
  const rubberHeight = 0.4

  table.slingshots.forEach((sling) => {
    const color = MAGENTA
    const plasticGeometry = buildFlatTriangle(
      new THREE.Vector3(localX(table, sling.a.x), SLINGSHOT_PLASTIC_HEIGHT, localZ(table, sling.a.y)),
      new THREE.Vector3(localX(table, sling.b.x), SLINGSHOT_PLASTIC_HEIGHT, localZ(table, sling.b.y)),
      new THREE.Vector3(localX(table, sling.c.x), SLINGSHOT_PLASTIC_HEIGHT, localZ(table, sling.c.y)),
    )
    const plasticMaterial = new THREE.MeshPhysicalMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      roughness: 0.2,
      emissive: color,
      emissiveIntensity: 0.5,
      side: THREE.DoubleSide,
      envMap: envMap ?? null,
      envMapIntensity: envMap ? 0.6 : 0,
    })
    const plastic = new THREE.Mesh(plasticGeometry, plasticMaterial)
    plastic.castShadow = true
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(plasticGeometry), edgeMaterial)
    disposables.push(plasticGeometry, plasticMaterial, edges.geometry)
    group.add(plastic, edges)

    // b-c and c-a: plain static rubber faces.
    for (const [from, to] of [
      [sling.b, sling.c],
      [sling.c, sling.a],
    ] as const) {
      const length = Math.max(0.01, segmentLength(from, to))
      const mid = segmentMidLocal(table, from, to)
      const geometry = new THREE.BoxGeometry(length, rubberHeight, 0.18)
      const mesh = new THREE.Mesh(geometry, kit.rubberMaterial)
      mesh.position.set(mid.x, rubberY, mid.y)
      mesh.rotation.y = angleToRotationY(segmentAngle(from, to))
      mesh.castShadow = true
      mesh.receiveShadow = true
      disposables.push(geometry)
      group.add(mesh)
    }

    // a-b: the kicking face, kept as its own mesh so it can bulge outward on a `slingshot` event.
    const abLength = Math.max(0.01, segmentLength(sling.a, sling.b))
    const abMid = segmentMidLocal(table, sling.a, sling.b)
    const abGeometry = new THREE.BoxGeometry(abLength, rubberHeight, 0.18)
    const abMesh = new THREE.Mesh(abGeometry, kit.rubberMaterial)
    abMesh.rotation.y = angleToRotationY(segmentAngle(sling.a, sling.b))
    abMesh.castShadow = true
    abMesh.receiveShadow = true
    disposables.push(abGeometry)
    group.add(abMesh)

    // Outward normal of the a-b face, pointing away from c. Direction vectors carry straight
    // across from table space into this local frame (same relabelling `localX`/`localZ` use).
    const dirX = sling.b.x - sling.a.x
    const dirY = sling.b.y - sling.a.y
    let normX = -dirY
    let normY = dirX
    const midX = (sling.a.x + sling.b.x) / 2
    const midY = (sling.a.y + sling.b.y) / 2
    const towardC = normX * (sling.c.x - midX) + normY * (sling.c.y - midY)
    if (towardC > 0) {
      normX = -normX
      normY = -normY
    }
    const normLen = Math.hypot(normX, normY) || 1
    normX /= normLen
    normY /= normLen

    visuals.push({
      id: sling.id,
      face: abMesh,
      baseX: abMid.x,
      baseY: rubberY,
      baseZ: abMid.y,
      outX: normX,
      outZ: normY,
      kickT: 0,
    })
  })

  return { group, visuals, dispose: () => disposeAll(disposables) }
}

function updateSlingshots(visuals: SlingshotVisual[], events: readonly PhysicsEvent[], dt: number): void {
  for (const v of visuals) v.kickT = Math.max(0, v.kickT - dt)
  for (const event of events) {
    if (event.type !== 'slingshot') continue
    for (const v of visuals) {
      if (v.id === event.id) v.kickT = SLINGSHOT_KICK_SECONDS
    }
  }
  for (const v of visuals) {
    const eased = v.kickT > 0 ? Math.sin((v.kickT / SLINGSHOT_KICK_SECONDS) * Math.PI) : 0
    const bulge = eased * 0.16
    v.face.position.set(v.baseX + v.outX * bulge, v.baseY, v.baseZ + v.outZ * bulge)
  }
}

// -------------------------------------------------------------------------------------------
// Standups
// -------------------------------------------------------------------------------------------

interface StandupVisual {
  id: string
  material: THREE.MeshStandardMaterial
  baseColor: THREE.Color
  flashT: number
}

function buildStandups(
  table: Table,
  kit: MaterialKit,
): { group: THREE.Group; visuals: StandupVisual[] } & Disposable {
  const group = new THREE.Group()
  const disposables: Disposable[] = []
  const visuals: StandupVisual[] = []
  const bracketMaterial = new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.4, metalness: 0.7 })
  disposables.push(bracketMaterial)

  for (const standup of table.standups) {
    const length = Math.max(0.01, segmentLength(standup.a, standup.b))
    const mid = segmentMidLocal(table, standup.a, standup.b)
    const angle = angleToRotationY(segmentAngle(standup.a, standup.b))

    const bracketGeometry = new THREE.BoxGeometry(length * 0.3, TARGET_HEIGHT * 0.5, 0.15)
    const bracket = new THREE.Mesh(bracketGeometry, bracketMaterial)
    bracket.position.set(mid.x, TARGET_HEIGHT * 0.25, mid.y)
    bracket.rotation.y = angle
    bracket.castShadow = true
    disposables.push(bracketGeometry)

    // The target face is moulded ABS plastic: roughness 0.45 with the kit's pebbled bump map.
    const color = new THREE.Color(CYAN)
    const plateGeometry = new THREE.BoxGeometry(length, TARGET_HEIGHT, 0.1)
    const plateMaterial = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.2,
      roughness: 0.45,
      bumpMap: kit.pebbleBump,
      bumpScale: PLASTIC_BUMP_SCALE,
    })
    const plate = new THREE.Mesh(plateGeometry, plateMaterial)
    plate.position.set(mid.x, TARGET_HEIGHT / 2, mid.y)
    plate.rotation.set(0.12, angle, 0)
    plate.castShadow = true
    plate.receiveShadow = true

    disposables.push(plateGeometry, plateMaterial)
    group.add(bracket, plate)
    visuals.push({ id: standup.id, material: plateMaterial, baseColor: color, flashT: 0 })
  }

  return { group, visuals, dispose: () => disposeAll(disposables) }
}

function updateStandups(visuals: StandupVisual[], events: readonly PhysicsEvent[], dt: number): void {
  for (const v of visuals) v.flashT = Math.max(0, v.flashT - dt)
  for (const event of events) {
    if (event.type !== 'standup') continue
    for (const v of visuals) {
      if (v.id === event.id) v.flashT = STANDUP_FLASH_SECONDS
    }
  }
  for (const v of visuals) v.material.emissiveIntensity = v.flashT > 0 ? GLOW_CAP_INTENSITY : 0.2
}

// -------------------------------------------------------------------------------------------
// Drop targets
// -------------------------------------------------------------------------------------------

interface DropTargetVisual {
  id: string
  mesh: THREE.Mesh
  upY: number
  downY: number
  currentY: number
  down: boolean
}

function buildDropTargets(
  table: Table,
  kit: MaterialKit,
): { group: THREE.Group; visuals: DropTargetVisual[] } & Disposable {
  const group = new THREE.Group()
  const disposables: Disposable[] = []
  const visuals: DropTargetVisual[] = []
  // The target face is moulded ABS plastic: roughness 0.45 with the kit's pebbled bump map.
  const color = new THREE.Color(MAGENTA)
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.35,
    roughness: 0.45,
    bumpMap: kit.pebbleBump,
    bumpScale: PLASTIC_BUMP_SCALE,
  })
  disposables.push(material)

  for (const target of table.dropTargets) {
    const length = Math.max(0.01, segmentLength(target.a, target.b))
    const mid = segmentMidLocal(table, target.a, target.b)
    const geometry = new THREE.BoxGeometry(length, TARGET_HEIGHT, 0.12)
    const mesh = new THREE.Mesh(geometry, material)
    const upY = TARGET_HEIGHT / 2
    const downY = -TARGET_HEIGHT * 0.85
    mesh.position.set(mid.x, upY, mid.y)
    mesh.rotation.y = angleToRotationY(segmentAngle(target.a, target.b))
    mesh.castShadow = true
    mesh.receiveShadow = true
    disposables.push(geometry)
    group.add(mesh)
    visuals.push({ id: target.id, mesh, upY, downY, currentY: upY, down: false })
  }

  return { group, visuals, dispose: () => disposeAll(disposables) }
}

function updateDropTargets(visuals: DropTargetVisual[], state: TableState, dt: number): void {
  const ease = 1 - Math.exp(-dt / DROP_TARGET_MOVE_SECONDS)
  for (const v of visuals) {
    let down = false
    for (const id of state.droppedTargets) {
      if (id === v.id) {
        down = true
        break
      }
    }
    v.down = down
    const target = down ? v.downY : v.upY
    v.currentY += (target - v.currentY) * ease
    v.mesh.position.y = v.currentY
  }
}

// -------------------------------------------------------------------------------------------
// Rollovers
// -------------------------------------------------------------------------------------------

/** The rollover wire is brushed stainless, sharing `kit.brushedMaterial`. */
function buildRollovers(table: Table, kit: MaterialKit): { group: THREE.Group } & Disposable {
  const group = new THREE.Group()
  const disposables: Disposable[] = []

  for (const rollover of table.rollovers) {
    const geometry = new THREE.TorusGeometry(rollover.radius * 0.9, 0.035, 8, 16, Math.PI)
    const mesh = new THREE.Mesh(geometry, kit.brushedMaterial)
    mesh.rotation.x = Math.PI / 2
    mesh.position.set(localX(table, rollover.pos.x), 0.02, localZ(table, rollover.pos.y))
    mesh.castShadow = true
    disposables.push(geometry)
    group.add(mesh)
  }

  return { group, dispose: () => disposeAll(disposables) }
}

// -------------------------------------------------------------------------------------------
// Spinners
// -------------------------------------------------------------------------------------------

interface SpinnerVisual {
  plate: THREE.Mesh
}

function buildSpinners(
  table: Table,
  kit: MaterialKit,
): { group: THREE.Group; visuals: SpinnerVisual[] } & Disposable {
  const group = new THREE.Group()
  const disposables: Disposable[] = []
  const visuals: SpinnerVisual[] = []
  // The bracket is brushed stainless, sharing `kit.brushedMaterial`; the flag stays its own plastic.
  const plateMaterial = new THREE.MeshStandardMaterial({
    color: YELLOW,
    emissive: YELLOW,
    emissiveIntensity: 0.4,
    roughness: 0.4,
    side: THREE.DoubleSide,
  })
  disposables.push(plateMaterial)

  for (const spinner of table.spinners) {
    const length = Math.max(0.01, segmentLength(spinner.a, spinner.b))
    const mid = segmentMidLocal(table, spinner.a, spinner.b)
    const yaw = angleToRotationY(segmentAngle(spinner.a, spinner.b))

    const bracketGroup = new THREE.Group()
    bracketGroup.position.set(mid.x, 0.9, mid.y)
    bracketGroup.rotation.y = yaw

    const postGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8)
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeometry, kit.brushedMaterial)
      post.position.set((length / 2) * side, -0.45, 0)
      post.rotation.z = Math.PI / 2
      post.castShadow = true
      bracketGroup.add(post)
    }
    disposables.push(postGeometry)

    const plateGeometry = new THREE.BoxGeometry(length, 0.03, 0.85)
    const plate = new THREE.Mesh(plateGeometry, plateMaterial)
    plate.castShadow = true
    disposables.push(plateGeometry)
    bracketGroup.add(plate)

    group.add(bracketGroup)
    visuals.push({ plate })
  }

  return { group, visuals, dispose: () => disposeAll(disposables) }
}

function updateSpinners(visuals: SpinnerVisual[], state: TableState): void {
  for (let i = 0; i < visuals.length; i++) {
    const spinnerState = state.spinners[i]
    if (spinnerState) visuals[i].plate.rotation.x = spinnerState.angle
  }
}

// -------------------------------------------------------------------------------------------
// Saucers
// -------------------------------------------------------------------------------------------

interface SaucerVisual {
  id: string
  material: THREE.MeshStandardMaterial
}

function buildSaucers(table: Table): { group: THREE.Group; visuals: SaucerVisual[] } & Disposable {
  const group = new THREE.Group()
  const disposables: Disposable[] = []
  const visuals: SaucerVisual[] = []
  const ringMaterial = new THREE.MeshStandardMaterial({ color: 0xdadde3, roughness: 0.2, metalness: 1 })
  disposables.push(ringMaterial)

  for (const saucer of table.saucers) {
    const color = new THREE.Color(PURPLE)
    const discGeometry = new THREE.CircleGeometry(saucer.radius, 24)
    discGeometry.rotateX(-Math.PI / 2)
    const discMaterial = new THREE.MeshStandardMaterial({ color: 0x100c18, emissive: color, emissiveIntensity: 0.2, roughness: 0.6 })
    const disc = new THREE.Mesh(discGeometry, discMaterial)
    disc.position.set(localX(table, saucer.pos.x), -0.15, localZ(table, saucer.pos.y))
    disc.receiveShadow = true

    const ringGeometry = new THREE.TorusGeometry(saucer.radius, 0.06, 10, 28)
    const ring = new THREE.Mesh(ringGeometry, ringMaterial)
    ring.rotation.x = Math.PI / 2
    ring.position.set(localX(table, saucer.pos.x), 0, localZ(table, saucer.pos.y))
    ring.castShadow = true

    disposables.push(discGeometry, discMaterial, ringGeometry)
    group.add(disc, ring)
    visuals.push({ id: saucer.id, material: discMaterial })
  }

  return { group, visuals, dispose: () => disposeAll(disposables) }
}

function updateSaucers(visuals: SaucerVisual[], state: TableState): void {
  for (const v of visuals) {
    let held = false
    for (const ball of state.balls) {
      if (ball.saucer && ball.saucer.id === v.id) {
        held = true
        break
      }
    }
    v.material.emissiveIntensity = held ? GLOW_CAP_INTENSITY : 0.2
  }
}

// -------------------------------------------------------------------------------------------
// Ramp
// -------------------------------------------------------------------------------------------

/** A quad-strip ribbon geometry from paired left/right edge samples - one mesh, however many samples. */
function buildRibbon(edges: { left: THREE.Vector3; right: THREE.Vector3 }[]): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  for (let i = 0; i < edges.length; i++) {
    const { left, right } = edges[i]
    positions.push(left.x, left.y, left.z, right.x, right.y, right.z)
    const v = edges.length > 1 ? i / (edges.length - 1) : 0
    uvs.push(0, v, 1, v)
  }
  const indices: number[] = []
  for (let i = 0; i < edges.length - 1; i++) {
    const a = i * 2
    const b = a + 1
    const c = a + 2
    const d = a + 3
    indices.push(a, c, b, b, c, d)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function buildRamp(
  table: Table,
  ramp: Ramp,
  envMap: THREE.Texture | null,
  kit: MaterialKit,
): { group: THREE.Group } & Disposable {
  const group = new THREE.Group()
  const disposables: Disposable[] = []

  const length = rampLength(ramp)
  const sampleCount = Math.max(2, Math.ceil(length / RAMP_SAMPLE_STEP) + 1)
  const floorEdges: { left: THREE.Vector3; right: THREE.Vector3 }[] = []
  const standoffs: { x: number; z: number; height: number }[] = []

  for (let i = 0; i < sampleCount; i++) {
    const s = (i / (sampleCount - 1)) * length
    const sample = rampPoint(ramp, s)
    const perpX = -sample.tangent.y
    const perpY = sample.tangent.x
    const cx = localX(table, sample.pos.x)
    const cz = localZ(table, sample.pos.y)
    floorEdges.push({
      left: new THREE.Vector3(cx + (perpX * RAMP_WIDTH) / 2, sample.z, cz + (perpY * RAMP_WIDTH) / 2),
      right: new THREE.Vector3(cx - (perpX * RAMP_WIDTH) / 2, sample.z, cz - (perpY * RAMP_WIDTH) / 2),
    })
    if (i % RAMP_STANDOFF_STRIDE === 0 && sample.z > 0.3) standoffs.push({ x: cx, z: cz, height: sample.z })
  }

  const floorGeometry = buildRibbon(floorEdges)
  const leftWallGeometry = buildRibbon(
    floorEdges.map((e) => ({ left: e.left.clone(), right: new THREE.Vector3(e.left.x, e.left.y + RAMP_WALL_HEIGHT, e.left.z) })),
  )
  const rightWallGeometry = buildRibbon(
    floorEdges.map((e) => ({ left: e.right.clone(), right: new THREE.Vector3(e.right.x, e.right.y + RAMP_WALL_HEIGHT, e.right.z) })),
  )

  // Less glare: a dimmer, more transparent plastic so the playfield art reads through it.
  const plasticMaterial = new THREE.MeshPhysicalMaterial({
    color: MAGENTA,
    transparent: true,
    opacity: 0.3,
    roughness: 0.15,
    emissive: MAGENTA,
    emissiveIntensity: 0.25,
    side: THREE.DoubleSide,
    envMap: envMap ?? null,
    envMapIntensity: envMap ? 0.6 : 0,
  })
  const edgeMaterial = new THREE.LineBasicMaterial({ color: MAGENTA, toneMapped: false })

  const floorMesh = new THREE.Mesh(floorGeometry, plasticMaterial)
  floorMesh.receiveShadow = true
  const leftWallMesh = new THREE.Mesh(leftWallGeometry, plasticMaterial)
  const rightWallMesh = new THREE.Mesh(rightWallGeometry, plasticMaterial)
  const floorEdgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(floorGeometry), edgeMaterial)

  disposables.push(floorGeometry, leftWallGeometry, rightWallGeometry, plasticMaterial, edgeMaterial, floorEdgeLines.geometry)
  group.add(floorMesh, leftWallMesh, rightWallMesh, floorEdgeLines)

  // Stand-offs are brushed stainless, sharing `kit.brushedMaterial`.
  for (const standoff of standoffs) {
    const geometry = new THREE.CylinderGeometry(0.07, 0.07, standoff.height, 8)
    const mesh = new THREE.Mesh(geometry, kit.brushedMaterial)
    mesh.position.set(standoff.x, standoff.height / 2, standoff.z)
    mesh.castShadow = true
    disposables.push(geometry)
    group.add(mesh)
  }

  // The entry flap: a flat lip flush with the playfield at the entry line.
  const entryLength = Math.max(0.01, segmentLength(ramp.entry.a, ramp.entry.b))
  const entryMid = segmentMidLocal(table, ramp.entry.a, ramp.entry.b)
  const flapGeometry = new THREE.BoxGeometry(entryLength, 0.12, 0.4)
  const flap = new THREE.Mesh(flapGeometry, plasticMaterial)
  flap.position.set(entryMid.x, 0.06, entryMid.y)
  flap.rotation.y = angleToRotationY(segmentAngle(ramp.entry.a, ramp.entry.b))
  flap.castShadow = true
  disposables.push(flapGeometry)
  group.add(flap)

  return { group, dispose: () => disposeAll(disposables) }
}

function buildRamps(
  table: Table,
  envMap: THREE.Texture | null,
  kit: MaterialKit,
): { group: THREE.Group } & Disposable {
  const group = new THREE.Group()
  const parts = table.ramps.map((ramp) => buildRamp(table, ramp, envMap, kit))
  for (const part of parts) group.add(part.group)
  return { group, dispose: () => disposeAll(parts) }
}

// -------------------------------------------------------------------------------------------
// Gates
// -------------------------------------------------------------------------------------------

/** The gate wire is brushed stainless, sharing `kit.brushedMaterial`; this builder disposes only geometry. */
function buildGates(table: Table, kit: MaterialKit): { group: THREE.Group } & Disposable {
  const group = new THREE.Group()
  const disposables: Disposable[] = []

  for (const gate of table.gates) {
    const length = Math.max(0.01, segmentLength(gate.a, gate.b))
    const mid = segmentMidLocal(table, gate.a, gate.b)
    const geometry = new THREE.BoxGeometry(length, GATE_HEIGHT, 0.04)
    const mesh = new THREE.Mesh(geometry, kit.brushedMaterial)
    mesh.position.set(mid.x, GATE_HEIGHT / 2, mid.y)
    mesh.rotation.y = angleToRotationY(segmentAngle(gate.a, gate.b))
    mesh.rotation.x = 0.08
    disposables.push(geometry)
    group.add(mesh)
  }

  return { group, dispose: () => disposeAll(disposables) }
}

// -------------------------------------------------------------------------------------------
// Flippers
// -------------------------------------------------------------------------------------------

/**
 * A tapered capsule (big circle at the pivot, smaller circle at the tip, joined by the external
 * tangent lines) built pointing along local +X for table angle 0, in the pivot's own frame. It is
 * symmetric about its local x-axis, so it is unaffected by the flat-shape sign flip described on
 * `buildPlayfield`/`angleToRotationY` (mirroring a shape across its own axis of symmetry is a
 * no-op).
 */
function buildFlipperShape(pivotRadius: number, tipRadius: number, length: number): THREE.Shape {
  const phi = Math.asin(THREE.MathUtils.clamp((pivotRadius - tipRadius) / length, -1, 1))
  const sweep = Math.PI / 2 - phi
  const sinPhi = Math.sin(phi)
  const cosPhi = Math.cos(phi)

  const shape = new THREE.Shape()
  shape.moveTo(-sinPhi * pivotRadius, cosPhi * pivotRadius)
  shape.lineTo(length - sinPhi * tipRadius, cosPhi * tipRadius)
  shape.absarc(length, 0, tipRadius, sweep, -sweep, true)
  shape.lineTo(-sinPhi * pivotRadius, -cosPhi * pivotRadius)
  shape.absarc(0, 0, pivotRadius, -sweep, sweep, true)
  return shape
}

interface FlipperVisual {
  pivotGroup: THREE.Group
  tipMarker: THREE.Mesh
}

function buildFlippers(
  table: Table,
  envMap: THREE.Texture | null,
  kit: MaterialKit,
): { group: THREE.Group; visuals: FlipperVisual[] } & Disposable {
  const group = new THREE.Group()
  const disposables: Disposable[] = []
  const visuals: FlipperVisual[] = []

  // The body is moulded ABS plastic (roughness 0.45, pebbled bump, no clearcoat); the tip is the
  // rubber "flipper band" (roughness 0.85, pebbled bump), keeping its neon magenta glow.
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: NEAR_WHITE,
    roughness: 0.45,
    bumpMap: kit.pebbleBump,
    bumpScale: PLASTIC_BUMP_SCALE,
    envMap: envMap ?? null,
    envMapIntensity: envMap ? 0.3 : 0,
  })
  const edgeMaterial = new THREE.LineBasicMaterial({ color: MAGENTA, toneMapped: false })
  const tipMaterial = new THREE.MeshStandardMaterial({
    color: MAGENTA,
    emissive: MAGENTA,
    emissiveIntensity: 1.4,
    roughness: 0.85,
    bumpMap: kit.pebbleBump,
    bumpScale: RUBBER_BUMP_SCALE,
  })
  disposables.push(bodyMaterial, edgeMaterial, tipMaterial)

  for (const flipper of table.flippers) {
    const pivotRadius = flipper.radius * 1.9
    const tipRadius = flipper.radius * 0.95
    const shape = buildFlipperShape(pivotRadius, tipRadius, flipper.length)
    const bodyGeometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.5,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.03,
      bevelSegments: 2,
      curveSegments: 16,
    })
    // Extrusion depth (shape local z) becomes this frame's up axis; see `buildPlayfield` for the
    // Rx(-90deg) derivation. The shape is symmetric about its local x-axis so the accompanying
    // sign flip on that axis does not matter here either.
    bodyGeometry.rotateX(-Math.PI / 2)
    bodyGeometry.translate(0, 0.06, 0)

    const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
    body.castShadow = true
    body.receiveShadow = true
    const edgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeometry), edgeMaterial)
    disposables.push(bodyGeometry, edgeLines.geometry)

    const pivotGroup = new THREE.Group()
    pivotGroup.position.set(localX(table, flipper.pivot.x), 0, localZ(table, flipper.pivot.y))
    pivotGroup.rotation.y = angleToRotationY(flipper.restAngle)
    pivotGroup.add(body, edgeLines)
    group.add(pivotGroup)

    const tipGeometry = new THREE.SphereGeometry(tipRadius * 0.5, 12, 10)
    const tipMarker = new THREE.Mesh(tipGeometry, tipMaterial)
    tipMarker.position.set(localX(table, flipper.pivot.x) + flipper.length, 0.3, localZ(table, flipper.pivot.y))
    disposables.push(tipGeometry)
    group.add(tipMarker)

    visuals.push({ pivotGroup, tipMarker })
  }

  return { group, visuals, dispose: () => disposeAll(disposables) }
}

/**
 * Rotates each flipper to its current physics angle and re-checks the tip against `flipperTip`
 * every frame (two calls, negligible next to a `requestAnimationFrame` budget) rather than
 * trusting the rotation math alone, so the glowing tip marker always sits exactly on the
 * collision capsule's end even if `flipperTip`'s formula ever grows more than the plain
 * `pivot + length * (cos, sin)` this file assumes elsewhere.
 */
function updateFlippers(visuals: FlipperVisual[], table: Table, state: TableState): void {
  for (let i = 0; i < visuals.length; i++) {
    const flipper = table.flippers[i]
    const flipperState = state.flippers[i]
    if (!flipper || !flipperState) continue
    const v = visuals[i]
    v.pivotGroup.rotation.y = angleToRotationY(flipperState.angle)
    const tip = flipperTip(flipper, flipperState.angle)
    v.tipMarker.position.set(localX(table, tip.x), 0.3, localZ(table, tip.y))
  }
}

// -------------------------------------------------------------------------------------------
// Plunger
// -------------------------------------------------------------------------------------------

/** The rod is brushed stainless, sharing `kit.brushedMaterial`; the knob keeps its own dark plastic. */
function buildPlunger(table: Table, kit: MaterialKit): { group: THREE.Group; baseZ: number } & Disposable {
  const disposables: Disposable[] = []
  const group = new THREE.Group()
  const baseX = localX(table, table.plunger.rest.x)
  const baseZ = localZ(table, table.plunger.rest.y)
  group.position.set(baseX, 0, baseZ)

  const knobMaterial = new THREE.MeshStandardMaterial({ color: 0x201626, roughness: 0.5 })
  disposables.push(knobMaterial)

  const rodGeometry = new THREE.CylinderGeometry(0.09, 0.09, 1.4, 12)
  const rod = new THREE.Mesh(rodGeometry, kit.brushedMaterial)
  rod.rotation.x = Math.PI / 2
  rod.position.set(0, 0.3, 0.7)
  rod.castShadow = true
  disposables.push(rodGeometry)

  const knobGeometry = new THREE.SphereGeometry(0.22, 16, 12)
  const knob = new THREE.Mesh(knobGeometry, knobMaterial)
  knob.position.set(0, 0.3, 1.45)
  knob.castShadow = true
  disposables.push(knobGeometry)

  group.add(rod, knob)

  return { group, baseZ, dispose: () => disposeAll(disposables) }
}

function updatePlunger(plunger: { group: THREE.Group; baseZ: number }, state: TableState): void {
  plunger.group.position.z = plunger.baseZ + state.plungerPull * 1.6
}

// -------------------------------------------------------------------------------------------
// Inserts (lamps)
// -------------------------------------------------------------------------------------------

interface InsertVisual {
  id: string
  material: THREE.MeshStandardMaterial
}

/** Symmetric about the local x-axis, same reasoning as `buildFlipperShape`. */
function buildInsertShape(insert: Insert): THREE.Shape {
  const shape = new THREE.Shape()
  if (insert.shape === 'circle') {
    shape.absarc(0, 0, insert.radius, 0, Math.PI * 2, false)
    return shape
  }
  const r = insert.radius
  shape.moveTo(-r, r * 0.35)
  shape.lineTo(r * 0.15, r * 0.35)
  shape.lineTo(r * 0.15, r * 0.75)
  shape.lineTo(r, 0)
  shape.lineTo(r * 0.15, -r * 0.75)
  shape.lineTo(r * 0.15, -r * 0.35)
  shape.lineTo(-r, -r * 0.35)
  shape.closePath()
  return shape
}

function buildInserts(table: Table): { group: THREE.Group; visuals: InsertVisual[] } & Disposable {
  const group = new THREE.Group()
  const disposables: Disposable[] = []
  const visuals: InsertVisual[] = []

  for (const insert of table.inserts) {
    const shape = buildInsertShape(insert)
    const geometry = new THREE.ShapeGeometry(shape, 20)
    geometry.rotateX(-Math.PI / 2)
    const color = new THREE.Color(insert.color)
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: INSERT_OFF_INTENSITY,
      roughness: 0.5,
      transparent: true,
      opacity: 0.95,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(localX(table, insert.pos.x), 0.01, localZ(table, insert.pos.y))
    mesh.rotation.y = angleToRotationY(insert.angle)
    disposables.push(geometry, material)
    group.add(mesh)
    visuals.push({ id: insert.id, material })
  }

  return { group, visuals, dispose: () => disposeAll(disposables) }
}

function updateInserts(
  visuals: InsertVisual[],
  game: GameState,
  time: number,
  attract: boolean,
  lightShowRemaining: number,
): void {
  for (let i = 0; i < visuals.length; i++) {
    const v = visuals[i]
    let intensity = INSERT_OFF_INTENSITY
    if (lightShowRemaining > 0) {
      intensity = isBlinkOn(time, LIGHT_SHOW_BLINK_HZ) ? GLOW_CAP_INTENSITY : GLOW_CAP_INTENSITY * 0.35
    } else if (attract) {
      const phase = ((time * ATTRACT_CHASE_SPEED + i / visuals.length) % 1 + 1) % 1
      intensity = phase < ATTRACT_CHASE_WIDTH ? GLOW_CAP_INTENSITY : INSERT_OFF_INTENSITY
    } else {
      const lamp: LampState = game.lamps[v.id] ?? 'off'
      if (lamp === 'on') intensity = INSERT_ON_INTENSITY
      else if (lamp === 'blink') intensity = isBlinkOn(time, INSERT_BLINK_HZ) ? INSERT_ON_INTENSITY : INSERT_OFF_INTENSITY
    }
    v.material.emissiveIntensity = intensity
  }
}

// -------------------------------------------------------------------------------------------
// Balls
// -------------------------------------------------------------------------------------------

interface BallSlot {
  mesh: THREE.Mesh
  hasPrev: boolean
  prevX: number
  prevZ: number
  seen: boolean
}

/**
 * A real steel pinball: polished but broken up by hairline scratches (`roughnessMap`) so it reads
 * as metal reflecting the room, not a glowing white orb. No emissive, no light attached.
 */
function buildBallPool(envMap: THREE.Texture | null, ballRadius: number): { group: THREE.Group; pool: BallSlot[] } & Disposable {
  const group = new THREE.Group()
  const geometry = new THREE.SphereGeometry(ballRadius, 48, 32)
  const roughnessMap = makeScratchRoughness()
  const material = new THREE.MeshStandardMaterial({
    color: 0xc9ccd2,
    metalness: 1,
    roughness: 0.16,
    roughnessMap,
    envMap: envMap ?? null,
    envMapIntensity: envMap ? 1 : 0,
  })
  const pool: BallSlot[] = []
  for (let i = 0; i < MAX_BALLS; i++) {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true
    mesh.visible = false
    group.add(mesh)
    pool.push({ mesh, hasPrev: false, prevX: 0, prevZ: 0, seen: false })
  }
  return {
    group,
    pool,
    dispose() {
      geometry.dispose()
      material.dispose()
      roughnessMap.dispose()
    },
  }
}

/**
 * Syncs the ball pool to `state.balls` by id and rolls each visible ball by the distance it moved
 * this frame. `axis`/`quat` are scratch objects owned by the caller and reused every frame, so
 * this never allocates beyond the rare case of a brand-new ball id needing a `Map` entry.
 */
function updateBalls(
  table: Table,
  pool: BallSlot[],
  idToSlot: Map<number, number>,
  state: TableState,
  axis: THREE.Vector3,
  quat: THREE.Quaternion,
): void {
  for (let i = 0; i < pool.length; i++) pool[i].seen = false

  for (let b = 0; b < state.balls.length; b++) {
    const ball: Ball = state.balls[b]
    let slotIndex = idToSlot.get(ball.id)
    if (slotIndex === undefined) {
      slotIndex = -1
      for (let i = 0; i < pool.length; i++) {
        if (!pool[i].mesh.visible) {
          slotIndex = i
          break
        }
      }
      if (slotIndex === -1) continue
      idToSlot.set(ball.id, slotIndex)
      pool[slotIndex].mesh.visible = true
      pool[slotIndex].hasPrev = false
    }

    const slot = pool[slotIndex]
    slot.seen = true
    const heldSink = ball.saucer ? 0.3 : 0
    const x = localX(table, ball.pos.x)
    const z = localZ(table, ball.pos.y)
    const y = table.ballRadius + ball.z - heldSink

    if (slot.hasPrev) {
      const dx = x - slot.prevX
      const dz = z - slot.prevZ
      const dist = Math.hypot(dx, dz)
      if (dist > 1e-6) {
        axis.set(dz, 0, -dx).normalize()
        quat.setFromAxisAngle(axis, dist / table.ballRadius)
        slot.mesh.quaternion.premultiply(quat)
      }
    }
    slot.mesh.position.set(x, y, z)
    slot.prevX = x
    slot.prevZ = z
    slot.hasPrev = true
  }

  for (let i = 0; i < pool.length; i++) {
    if (!pool[i].seen && pool[i].mesh.visible) {
      pool[i].mesh.visible = false
      pool[i].hasPrev = false
    }
  }
  for (const [id, slotIndex] of idToSlot) {
    if (!pool[slotIndex].seen) idToSlot.delete(id)
  }
}

// -------------------------------------------------------------------------------------------
// Screws (cheap realism detail)
// -------------------------------------------------------------------------------------------

const SCREW_RADIUS = 0.09
const SCREW_HEIGHT = 0.05
/** Budget from SPEC.md: at most this many screw-head instances. */
const MAX_SCREWS = 48

/** A flat disc with a rectangular through-slot: cheap stand-in for a slotted screw head. */
function buildScrewGeometry(radius: number, height: number): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.absarc(0, 0, radius, 0, Math.PI * 2, false)
  const slotWidth = radius * 0.22
  const slotLength = radius * 1.6
  const slot = new THREE.Path()
  slot.moveTo(-slotLength / 2, -slotWidth / 2)
  slot.lineTo(slotLength / 2, -slotWidth / 2)
  slot.lineTo(slotLength / 2, slotWidth / 2)
  slot.lineTo(-slotLength / 2, slotWidth / 2)
  slot.closePath()
  shape.holes.push(slot)
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 12 })
  // Extrusion depth (shape local z) becomes this frame's up axis; see `buildPlayfield` for the
  // Rx(-90deg) derivation.
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

/**
 * Tiny chrome screw heads at the slingshot plastic corners, the apron corners, each standup
 * bracket and each lane guide end: one shared geometry, drawn as a single `InstancedMesh`,
 * capped at `MAX_SCREWS` instances.
 */
function buildScrews(table: Table, kit: MaterialKit): { mesh: THREE.InstancedMesh | null } & Disposable {
  const positions: THREE.Vector3[] = []

  for (const sling of table.slingshots) {
    for (const p of [sling.a, sling.b, sling.c]) {
      positions.push(new THREE.Vector3(localX(table, p.x), SLINGSHOT_PLASTIC_HEIGHT, localZ(table, p.y)))
    }
  }

  const apronRect = computeApronRect(table)
  const apronScrewY = 1.16
  const apronMargin = 0.15
  for (const x of [apronMargin, apronRect.rightX - apronMargin]) {
    for (const y of [apronRect.topY + apronMargin, table.height - apronMargin]) {
      positions.push(new THREE.Vector3(localX(table, x), apronScrewY, localZ(table, y)))
    }
  }

  for (const standup of table.standups) {
    const mid = segmentMidLocal(table, standup.a, standup.b)
    positions.push(new THREE.Vector3(mid.x, TARGET_HEIGHT * 0.5, mid.y))
  }

  for (const wall of table.walls) {
    if (wall.kind !== 'guide') continue
    positions.push(new THREE.Vector3(localX(table, wall.a.x), WALL_HEIGHT, localZ(table, wall.a.y)))
    positions.push(new THREE.Vector3(localX(table, wall.b.x), WALL_HEIGHT, localZ(table, wall.b.y)))
  }

  const capped = positions.slice(0, MAX_SCREWS)
  if (capped.length === 0) return { mesh: null, dispose() {} }

  const geometry = buildScrewGeometry(SCREW_RADIUS, SCREW_HEIGHT)
  const mesh = new THREE.InstancedMesh(geometry, kit.brushedMaterial, capped.length)
  const matrix = new THREE.Matrix4()
  capped.forEach((pos, i) => {
    matrix.makeTranslation(pos.x, pos.y, pos.z)
    mesh.setMatrixAt(i, matrix)
  })
  mesh.instanceMatrix.needsUpdate = true

  return { mesh, dispose: () => geometry.dispose() }
}

// -------------------------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------------------------

/** Everything on the playfield, built once from `Table` and animated from `TableState`/`GameState`. */
export interface TableView {
  /** Local frame: X = table x - width/2, Y = up out of the playfield, Z = table y - height/2, in inches. */
  group: THREE.Group
  /** Syncs meshes to the physics and the lamps. `events` are this frame's physics events, for flashes. */
  update(state: TableState, game: GameState, events: readonly PhysicsEvent[], dt: number): void
  /** Flashes every lamp for a moment (award light show). */
  lightShow(seconds: number): void
  /** When true the lamps run a chasing attract pattern instead of following `game.lamps`. */
  setAttract(attract: boolean): void
  dispose(): void
}

/** Builds every part above and wires their per-frame updates together. */
export function createTableView(table: Table, envMap: THREE.Texture | null): TableView {
  const group = new THREE.Group()
  const disposables: Disposable[] = []

  const kit = createMaterialKit(envMap)
  const playfield = buildPlayfield(table)
  const apron = buildApron(table)
  const walls = buildWalls(table, kit)
  const posts = buildPosts(table, envMap, kit)
  const bumpers = buildBumpers(table, envMap, kit)
  const slingshots = buildSlingshots(table, envMap, kit)
  const standups = buildStandups(table, kit)
  const dropTargets = buildDropTargets(table, kit)
  const rollovers = buildRollovers(table, kit)
  const spinners = buildSpinners(table, kit)
  const saucers = buildSaucers(table)
  const ramps = buildRamps(table, envMap, kit)
  const gates = buildGates(table, kit)
  const flippers = buildFlippers(table, envMap, kit)
  const plunger = buildPlunger(table, kit)
  const inserts = buildInserts(table)
  const balls = buildBallPool(envMap, table.ballRadius)
  const screws = buildScrews(table, kit)

  group.add(
    playfield.mesh,
    apron.mesh,
    walls.group,
    posts.group,
    bumpers.group,
    slingshots.group,
    standups.group,
    dropTargets.group,
    rollovers.group,
    spinners.group,
    saucers.group,
    ramps.group,
    gates.group,
    flippers.group,
    plunger.group,
    inserts.group,
    balls.group,
  )
  if (screws.mesh) group.add(screws.mesh)
  disposables.push(
    kit,
    playfield,
    apron,
    walls,
    posts,
    bumpers,
    slingshots,
    standups,
    dropTargets,
    rollovers,
    spinners,
    saucers,
    ramps,
    gates,
    flippers,
    plunger,
    inserts,
    balls,
    screws,
  )

  // Reused every frame so rolling the balls never allocates a Vector3/Quaternion.
  const scratchAxis = new THREE.Vector3()
  const scratchQuat = new THREE.Quaternion()
  const ballSlotById = new Map<number, number>()

  let attract = false
  let lightShowRemaining = 0

  function update(state: TableState, game: GameState, events: readonly PhysicsEvent[], dt: number): void {
    lightShowRemaining = Math.max(0, lightShowRemaining - dt)

    updateFlippers(flippers.visuals, table, state)
    updatePlunger(plunger, state)
    updateDropTargets(dropTargets.visuals, state, dt)
    updateSpinners(spinners.visuals, state)
    updateSaucers(saucers.visuals, state)
    updateBalls(table, balls.pool, ballSlotById, state, scratchAxis, scratchQuat)
    updateBumpers(bumpers.visuals, game, events, dt)
    updateSlingshots(slingshots.visuals, events, dt)
    updateStandups(standups.visuals, events, dt)
    updateInserts(inserts.visuals, game, state.time, attract, lightShowRemaining)
  }

  function lightShow(seconds: number): void {
    lightShowRemaining = seconds
  }

  function setAttract(next: boolean): void {
    attract = next
  }

  function dispose(): void {
    disposeAll(disposables)
  }

  return { group, update, lightShow, setAttract, dispose }
}
