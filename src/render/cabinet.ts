/**
 * The physical machine: legs, cabinet body, backbox, glass, and the dim arcade room around it.
 * Everything here is code-built from three.js primitives (boxes, cylinders, and a couple of hand
 * built tapered slabs) - no models, no image files.
 *
 * World frame: the floor is Y = 0, +Z is toward the player, -Z runs away toward the backbox.
 */

import * as THREE from 'three'
import type { Table } from '../game/types.ts'
import {
  makeBackglassTexture,
  makeCabinetSideTexture,
  makeFloorTexture,
  makeScoreDisplay,
} from './textures.ts'

/** The playfield tilts back by this many radians: the far (-Z) end sits higher than the near end. */
export const PLAYFIELD_SLOPE = (6.5 * Math.PI) / 180

const SIDE_WALL_THICKNESS = 1 // inches, each side; playfield width + 2 of these = the outer cabinet width
const LEG_HEIGHT = 28 // floor to the underside of the cabinet body
const LEG_RADIUS_TOP = 1.1
const LEG_RADIUS_BOTTOM = 1.5
const PLAYFIELD_ANCHOR_HEIGHT = 36 // the playfield anchor's pivot height above the floor
const SIDE_RAIL_RISE = 2.5 // how far the side rail (and the glass resting on it) stands above the playfield
const FRONT_MARGIN = 2 // body footprint extends this far past the playfield's near edge, for the apron
const NECK_HEIGHT = 4 // the short riser between the cabinet body and the backbox
const NECK_DEPTH = 6
const BACKBOX_WIDTH = 28
const BACKBOX_HEIGHT = 27
const BACKBOX_DEPTH = 9
const BACKGLASS_MARGIN_X = 0.92 // fraction of the backbox width the backglass panel covers
const BACKGLASS_HEIGHT_FRACTION = 0.66
const SCORE_PANEL_HEIGHT = 4.4
const GLASS_MARGIN = 1.4 // the glass pane overhangs the playfield footprint by this much on every side
const ROOM_FLOOR_SIZE = 260
const ROOM_FLOOR_REPEAT = 22 // how many times the floor texture tiles across the room
const BACK_WALL_DISTANCE = 90 // how far behind the backbox the room's back wall stands
const BACK_WALL_WIDTH = 220
const BACK_WALL_HEIGHT = 110
const NEIGHBOUR_CABINET_DISTANCE = 46 // how far to either side the dim neighbouring cabinets stand
const NEIGHBOUR_CABINET_WIDTH = 24
const NEIGHBOUR_CABINET_HEIGHT = 62
const NEIGHBOUR_CABINET_DEPTH = 50
const COIN_DOOR_WIDTH = 9
const COIN_DOOR_HEIGHT = 6
const LOCKDOWN_BAR_RADIUS = 0.55
const CHROME_TRIM_HEIGHT = 0.35

/** Colour palette for the cabinet's own emissive/plastic bits (kept in step with the game's neon look). */
const NEON_MAGENTA = '#ff2bd6'
const NEON_CYAN = '#22e4ff'
const COIN_SLOT_ORANGE = '#ff8a1f'
const CABINET_BLACK = '#0c0912'
const CHROME_COLOR = '#d8dde3'

export interface Cabinet {
  /** World frame in inches: the floor is Y = 0, the player stands at +Z looking toward -Z. */
  group: THREE.Group
  /** Already placed and sloped. Add the table view's group here: its local frame is S9's frame. */
  playfieldAnchor: THREE.Group
  setDisplay(score: number, ball: number, message: string | null): void
  dispose(): void
}

interface Disposable {
  dispose(): void
}

/** The rail-top world height at local `z`: the tilted playfield surface at that point, plus the rise. */
function railTopY(z: number): number {
  return PLAYFIELD_ANCHOR_HEIGHT - z * Math.sin(PLAYFIELD_SLOPE) + SIDE_RAIL_RISE
}

/**
 * A thin trapezoid slab: a flat bottom at `bottomY`, a top that slants linearly from `(backZ, backTopY)`
 * to `(frontZ, frontTopY)`, and thickness `thickness` along X starting at `outerX` and reaching inward
 * (toward X = 0). Used for the tapered cabinet side walls and their chrome trim.
 */
function makeTaperedSlabGeometry(
  outerX: number,
  thickness: number,
  backZ: number,
  frontZ: number,
  backTopY: number,
  frontTopY: number,
  bottomY: number,
): THREE.BufferGeometry {
  const innerX = outerX > 0 ? outerX - thickness : outerX + thickness
  // prettier-ignore
  const positions = new Float32Array([
    outerX, bottomY, backZ,    // 0 outer-back-bottom
    outerX, bottomY, frontZ,   // 1 outer-front-bottom
    outerX, frontTopY, frontZ, // 2 outer-front-top
    outerX, backTopY, backZ,   // 3 outer-back-top
    innerX, bottomY, backZ,    // 4 inner-back-bottom
    innerX, bottomY, frontZ,   // 5 inner-front-bottom
    innerX, frontTopY, frontZ, // 6 inner-front-top
    innerX, backTopY, backZ,   // 7 inner-back-top
  ])
  // prettier-ignore
  const uvs = new Float32Array([
    0, 0,  1, 0,  1, 1,  0, 1,
    0, 0,  1, 0,  1, 1,  0, 1,
  ])
  const indices = [
    0, 1, 2, 0, 2, 3, // outer face
    4, 7, 6, 4, 6, 5, // inner face
    0, 1, 5, 0, 5, 4, // bottom
    3, 2, 6, 3, 6, 7, // slanted top
    0, 3, 7, 0, 7, 4, // back face
    1, 2, 6, 1, 6, 5, // front face
  ]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** A small emissive box, used for coin slots, buttons, and neon strip lights. */
function makeEmissiveBox(
  width: number,
  height: number,
  depth: number,
  color: string,
  intensity: number,
): { mesh: THREE.Mesh } & Disposable {
  const geometry = new THREE.BoxGeometry(width, height, depth)
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.5,
  })
  const mesh = new THREE.Mesh(geometry, material)
  return { mesh, dispose: () => { geometry.dispose(); material.dispose() } }
}

/**
 * A full machine standing in a dark arcade room: legs, a tapered cabinet body with a coin door and
 * lockdown bar, a backbox with a lit backglass and score panel, a near-invisible glass pane over the
 * playfield, and a dim room (floor, back wall, distant neighbouring cabinets) around it.
 */
export function createCabinet(table: Table): Cabinet {
  const disposables: Disposable[] = []
  const own = (item: Disposable): void => { disposables.push(item) }

  const outerWidth = table.width + 2 * SIDE_WALL_THICKNESS
  const halfOuterWidth = outerWidth / 2
  const backZ = -table.height / 2
  const frontZ = table.height / 2 + FRONT_MARGIN
  const backTopY = railTopY(backZ)
  const frontTopY = railTopY(frontZ)
  const bottomY = LEG_HEIGHT

  const group = new THREE.Group()

  // --- Playfield anchor: pivoted so the far (-Z) end lifts by PLAYFIELD_SLOPE -----------------------
  const playfieldAnchor = new THREE.Group()
  playfieldAnchor.position.set(0, PLAYFIELD_ANCHOR_HEIGHT, 0)
  playfieldAnchor.rotation.x = PLAYFIELD_SLOPE
  group.add(playfieldAnchor)

  // --- Glass: a nearly invisible pane resting at side-rail height, riding the same tilt ------------
  {
    const geometry = new THREE.PlaneGeometry(outerWidth + GLASS_MARGIN * 2, table.height + GLASS_MARGIN * 2)
    const material = new THREE.MeshPhysicalMaterial({
      // Black, so the pane adds only its reflections: a white pane lit from above hazes the playfield.
      color: 0x000000,
      roughness: 0,
      metalness: 0,
      // A mirror-smooth pane throws the key light straight back as one white-hot glare: keep a hint only.
      specularIntensity: 0.12,
      transparent: true,
      opacity: 0.05,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = SIDE_RAIL_RISE
    playfieldAnchor.add(mesh)
    own({ dispose: () => { geometry.dispose(); material.dispose() } })
  }

  // --- Cabinet body -----------------------------------------------------------------------------
  const sideTexture = makeCabinetSideTexture()
  own(sideTexture)
  const sideMaterial = new THREE.MeshStandardMaterial({
    color: CABINET_BLACK,
    map: sideTexture,
    emissiveMap: sideTexture,
    emissive: 0xffffff,
    emissiveIntensity: 0.4,
    roughness: 0.55,
    metalness: 0.1,
    side: THREE.DoubleSide,
  })
  own(sideMaterial)

  // Brushed, not mirror: a mirror-smooth trim throws the key light back as one long white streak.
  const chromeMaterial = new THREE.MeshStandardMaterial({ color: CHROME_COLOR, metalness: 1, roughness: 0.4 })
  own(chromeMaterial)

  for (const sign of [-1, 1] as const) {
    const outerX = sign * halfOuterWidth
    const panelGeometry = makeTaperedSlabGeometry(
      outerX,
      SIDE_WALL_THICKNESS,
      backZ,
      frontZ,
      backTopY,
      frontTopY,
      bottomY,
    )
    const panel = new THREE.Mesh(panelGeometry, sideMaterial)
    panel.castShadow = true
    panel.receiveShadow = true
    group.add(panel)
    own({ dispose: () => panelGeometry.dispose() })

    const trimGeometry = makeTaperedSlabGeometry(
      outerX,
      SIDE_WALL_THICKNESS,
      backZ,
      frontZ,
      backTopY + CHROME_TRIM_HEIGHT,
      frontTopY + CHROME_TRIM_HEIGHT,
      backTopY,
    )
    const trim = new THREE.Mesh(trimGeometry, chromeMaterial)
    trim.castShadow = true
    trim.receiveShadow = true
    group.add(trim)
    own({ dispose: () => trimGeometry.dispose() })

    // A flipper button on each side, near the front.
    const buttonGeometry = new THREE.CylinderGeometry(0.7, 0.7, 0.6, 16)
    const buttonMaterial = new THREE.MeshStandardMaterial({
      color: sign < 0 ? NEON_MAGENTA : NEON_CYAN,
      emissive: sign < 0 ? NEON_MAGENTA : NEON_CYAN,
      emissiveIntensity: 0.6,
      metalness: 0.6,
      roughness: 0.3,
    })
    const button = new THREE.Mesh(buttonGeometry, buttonMaterial)
    button.rotation.z = Math.PI / 2
    const buttonY = bottomY + (frontTopY - bottomY) * 0.4
    button.position.set(outerX - sign * 0.3, buttonY, frontZ - table.height * 0.12)
    button.castShadow = true
    group.add(button)
    own({ dispose: () => { buttonGeometry.dispose(); buttonMaterial.dispose() } })
  }

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: CABINET_BLACK,
    roughness: 0.6,
    metalness: 0.08,
  })
  own(bodyMaterial)

  // Front panel: from the box floor up to the (lower, near) rail height.
  {
    const geometry = new THREE.BoxGeometry(outerWidth, frontTopY - bottomY, SIDE_WALL_THICKNESS)
    const mesh = new THREE.Mesh(geometry, bodyMaterial)
    mesh.position.set(0, (bottomY + frontTopY) / 2, frontZ - SIDE_WALL_THICKNESS / 2)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    own({ dispose: () => geometry.dispose() })
  }

  // Back panel: from the box floor up to the (higher, far) rail height, where the neck begins.
  {
    const geometry = new THREE.BoxGeometry(outerWidth, backTopY - bottomY, SIDE_WALL_THICKNESS)
    const mesh = new THREE.Mesh(geometry, bodyMaterial)
    mesh.position.set(0, (bottomY + backTopY) / 2, backZ + SIDE_WALL_THICKNESS / 2)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    own({ dispose: () => geometry.dispose() })
  }

  // Bottom panel, mostly hidden but there to catch shadows and close the box visually.
  {
    const geometry = new THREE.BoxGeometry(outerWidth, 1, frontZ - backZ)
    const mesh = new THREE.Mesh(geometry, bodyMaterial)
    mesh.position.set(0, bottomY - 0.5, (backZ + frontZ) / 2)
    mesh.receiveShadow = true
    group.add(mesh)
    own({ dispose: () => geometry.dispose() })
  }

  // Lockdown bar across the front top edge.
  {
    const geometry = new THREE.CylinderGeometry(LOCKDOWN_BAR_RADIUS, LOCKDOWN_BAR_RADIUS, outerWidth, 16)
    const mesh = new THREE.Mesh(geometry, chromeMaterial)
    mesh.rotation.z = Math.PI / 2
    mesh.position.set(0, frontTopY + LOCKDOWN_BAR_RADIUS, frontZ - 0.4)
    mesh.castShadow = true
    group.add(mesh)
    own({ dispose: () => geometry.dispose() })
  }

  // Legs and feet.
  for (const xSign of [-1, 1] as const) {
    for (const zPos of [frontZ - 2, backZ + 2]) {
      const geometry = new THREE.CylinderGeometry(LEG_RADIUS_TOP, LEG_RADIUS_BOTTOM, bottomY, 12)
      const mesh = new THREE.Mesh(geometry, chromeMaterial)
      mesh.position.set(xSign * (halfOuterWidth - 1.5), bottomY / 2, zPos)
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)
      own({ dispose: () => geometry.dispose() })
    }
  }

  // Coin door: a recessed dark panel with two lit coin slots and a start button.
  {
    const doorGeometry = new THREE.BoxGeometry(COIN_DOOR_WIDTH, COIN_DOOR_HEIGHT, 0.3)
    const doorMaterial = new THREE.MeshStandardMaterial({ color: '#1a1520', metalness: 0.4, roughness: 0.5 })
    const door = new THREE.Mesh(doorGeometry, doorMaterial)
    const doorY = bottomY + (frontTopY - bottomY) * 0.5
    door.position.set(0, doorY, frontZ - SIDE_WALL_THICKNESS / 2 - 0.16)
    door.castShadow = true
    group.add(door)
    own({ dispose: () => { doorGeometry.dispose(); doorMaterial.dispose() } })

    for (const xOffset of [-1.6, 1.6]) {
      const slot = makeEmissiveBox(0.9, 0.18, 0.1, COIN_SLOT_ORANGE, 2.2)
      slot.mesh.position.set(xOffset, doorY + 1.2, door.position.z - 0.2)
      group.add(slot.mesh)
      own(slot)
    }

    const buttonGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.25, 20)
    const buttonMaterial = new THREE.MeshStandardMaterial({
      color: NEON_CYAN,
      emissive: NEON_CYAN,
      emissiveIntensity: 1.4,
      metalness: 0.3,
      roughness: 0.4,
    })
    const startButton = new THREE.Mesh(buttonGeometry, buttonMaterial)
    startButton.rotation.x = Math.PI / 2
    startButton.position.set(0, doorY - 1.5, door.position.z - 0.25)
    group.add(startButton)
    own({ dispose: () => { buttonGeometry.dispose(); buttonMaterial.dispose() } })
  }

  // Plunger housing on the front, aligned with the shooter lane.
  {
    const housingX = table.plunger.rest.x - table.width / 2
    const housingGeometry = new THREE.CylinderGeometry(0.55, 0.65, 3.2, 16)
    const housing = new THREE.Mesh(housingGeometry, chromeMaterial)
    housing.rotation.x = Math.PI / 2
    housing.position.set(housingX, bottomY + (frontTopY - bottomY) * 0.55, frontZ - 1.2)
    housing.castShadow = true
    group.add(housing)
    own({ dispose: () => housingGeometry.dispose() })

    const knobGeometry = new THREE.SphereGeometry(0.65, 16, 16)
    const knobMaterial = new THREE.MeshStandardMaterial({
      color: NEON_MAGENTA,
      metalness: 0.4,
      roughness: 0.3,
    })
    const knob = new THREE.Mesh(knobGeometry, knobMaterial)
    knob.position.set(housingX, housing.position.y, frontZ + 0.4)
    knob.castShadow = true
    group.add(knob)
    own({ dispose: () => { knobGeometry.dispose(); knobMaterial.dispose() } })
  }

  // --- Backbox, on a short neck at the far end -----------------------------------------------------
  {
    const neckGeometry = new THREE.BoxGeometry(BACKBOX_WIDTH * 0.65, NECK_HEIGHT, NECK_DEPTH)
    const neck = new THREE.Mesh(neckGeometry, bodyMaterial)
    neck.position.set(0, backTopY + NECK_HEIGHT / 2, backZ - NECK_DEPTH / 2)
    neck.castShadow = true
    neck.receiveShadow = true
    group.add(neck)
    own({ dispose: () => neckGeometry.dispose() })
  }

  const backboxCentreZ = backZ - NECK_DEPTH / 2
  const backboxBottomY = backTopY + NECK_HEIGHT
  {
    const boxGeometry = new THREE.BoxGeometry(BACKBOX_WIDTH, BACKBOX_HEIGHT, BACKBOX_DEPTH)
    const box = new THREE.Mesh(boxGeometry, sideMaterial)
    box.position.set(0, backboxBottomY + BACKBOX_HEIGHT / 2, backboxCentreZ)
    box.castShadow = true
    box.receiveShadow = true
    group.add(box)
    own({ dispose: () => boxGeometry.dispose() })
  }

  const backglassTexture = makeBackglassTexture()
  own(backglassTexture)
  const backboxFrontZ = backboxCentreZ + BACKBOX_DEPTH / 2 + 0.05

  const backglassHeight = BACKBOX_HEIGHT * BACKGLASS_HEIGHT_FRACTION
  {
    const geometry = new THREE.PlaneGeometry(BACKBOX_WIDTH * BACKGLASS_MARGIN_X, backglassHeight)
    const material = new THREE.MeshStandardMaterial({
      map: backglassTexture,
      emissiveMap: backglassTexture,
      emissive: 0xffffff,
      emissiveIntensity: 1.3,
      roughness: 0.4,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(0, backboxBottomY + BACKBOX_HEIGHT - backglassHeight / 2 - 0.6, backboxFrontZ)
    group.add(mesh)
    own({ dispose: () => { geometry.dispose(); material.dispose() } })
  }

  const scoreDisplay = makeScoreDisplay()
  own(scoreDisplay.texture)
  {
    const geometry = new THREE.PlaneGeometry(BACKBOX_WIDTH * 0.5, SCORE_PANEL_HEIGHT)
    const material = new THREE.MeshStandardMaterial({
      map: scoreDisplay.texture,
      emissiveMap: scoreDisplay.texture,
      emissive: 0xffffff,
      emissiveIntensity: 1.4,
      roughness: 0.4,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(0, backboxBottomY + SCORE_PANEL_HEIGHT / 2 + 0.4, backboxFrontZ)
    group.add(mesh)
    own({ dispose: () => { geometry.dispose(); material.dispose() } })
  }

  // --- The room: floor, back wall with neon strips, and dim neighbouring cabinets -------------------
  const floorTexture = makeFloorTexture()
  own(floorTexture)
  floorTexture.wrapS = THREE.RepeatWrapping
  floorTexture.wrapT = THREE.RepeatWrapping
  floorTexture.repeat.set(ROOM_FLOOR_REPEAT, ROOM_FLOOR_REPEAT)
  {
    const geometry = new THREE.PlaneGeometry(ROOM_FLOOR_SIZE, ROOM_FLOOR_SIZE)
    const material = new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.95, metalness: 0.02 })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.x = -Math.PI / 2
    mesh.receiveShadow = true
    group.add(mesh)
    own({ dispose: () => { geometry.dispose(); material.dispose() } })
  }

  const backWallZ = backboxCentreZ - BACK_WALL_DISTANCE
  {
    const geometry = new THREE.PlaneGeometry(BACK_WALL_WIDTH, BACK_WALL_HEIGHT)
    const material = new THREE.MeshStandardMaterial({ color: '#08050f', roughness: 0.9 })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(0, BACK_WALL_HEIGHT / 2, backWallZ)
    mesh.receiveShadow = true
    group.add(mesh)
    own({ dispose: () => { geometry.dispose(); material.dispose() } })
  }

  const stripColors = [NEON_MAGENTA, NEON_CYAN, NEON_MAGENTA, NEON_CYAN]
  stripColors.forEach((color, i) => {
    const strip = makeEmissiveBox(30, 3, 0.3, color, 1.8)
    const spread = BACK_WALL_WIDTH * 0.7
    const stripX = -spread / 2 + (spread * i) / (stripColors.length - 1)
    strip.mesh.position.set(stripX, BACK_WALL_HEIGHT * 0.6, backWallZ + 0.3)
    group.add(strip.mesh)
    own(strip)
  })

  const neighbourMaterial = new THREE.MeshStandardMaterial({ color: '#0a0812', roughness: 0.9 })
  own(neighbourMaterial)
  for (const xSign of [-1, 1] as const) {
    const geometry = new THREE.BoxGeometry(
      NEIGHBOUR_CABINET_WIDTH,
      NEIGHBOUR_CABINET_HEIGHT,
      NEIGHBOUR_CABINET_DEPTH,
    )
    const mesh = new THREE.Mesh(geometry, neighbourMaterial)
    mesh.position.set(
      xSign * (halfOuterWidth + NEIGHBOUR_CABINET_DISTANCE),
      NEIGHBOUR_CABINET_HEIGHT / 2,
      backboxCentreZ + NEIGHBOUR_CABINET_DEPTH * 0.1,
    )
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    own({ dispose: () => geometry.dispose() })
  }

  return {
    group,
    playfieldAnchor,
    setDisplay(score: number, ball: number, message: string | null) {
      scoreDisplay.set(score, ball, message)
    },
    dispose() {
      for (const item of disposables) item.dispose()
    },
  }
}
