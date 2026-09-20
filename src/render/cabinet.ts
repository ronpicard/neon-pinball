/**
 * The physical machine: legs, cabinet body, backbox, and glass. Everything here is code-built
 * from three.js primitives (boxes, cylinders, and a couple of hand built tapered slabs) - no
 * models, no image files. The arcade room around the machine lives in `arcadeRoom.ts`.
 *
 * World frame: the floor is Y = 0, +Z is toward the player, -Z runs away toward the backbox.
 */

import * as THREE from 'three'
import type { Table } from '../game/types.ts'
import {
  makeBackglassTexture,
  makeCabinetSideTexture,
  makeScoreDisplay,
} from './textures.ts'
import {
  makeBrushedMetalBump,
  makeBrushedMetalRoughness,
  makePebbleBump,
  makePowderCoatBump,
  makeWoodBump,
} from './materialTextures.ts'

/** The playfield tilts back by this many radians: the far (-Z) end sits higher than the near end. */
export const PLAYFIELD_SLOPE = (6.5 * Math.PI) / 180

const SIDE_WALL_THICKNESS = 1 // inches, each side; playfield width + 2 of these = the outer cabinet width
const LEG_HEIGHT = 28 // floor to the underside of the cabinet body
const LEG_RADIUS_TOP = 1.1
const LEG_RADIUS_BOTTOM = 1.5
const PLAYFIELD_ANCHOR_HEIGHT = 36 // the playfield anchor's pivot height above the floor
const SIDE_RAIL_RISE = 2.5 // how far the side rail (and the glass resting on it) stands above the playfield
const FRONT_MARGIN = 2 // body footprint extends this far past the playfield's near edge, for the apron
const NECK_HEIGHT = 1.5 // the short riser between the cabinet body and the backbox: kept low so the
// backbox sits right behind the far end of the playfield, in view of the low default camera
const NECK_DEPTH = 6
const BACKBOX_WIDTH = 28
const BACKBOX_HEIGHT = 27
const BACKBOX_DEPTH = 9
// The backbox face, bottom to top: a speaker-panel band (the score display plus two grilles),
// then the translite, each framed by a thin trim border.
const SPEAKER_BAND_HEIGHT = 8.5
const SCORE_PANEL_WIDTH = 22
const SCORE_PANEL_HEIGHT = 5.5
const SPEAKER_GRILLE_RADIUS = 1.15
const SPEAKER_GRILLE_INSET = 1.4 // grille centre, inward from the backbox's outer edge
const TRANSLITE_WIDTH = 26
const TRANSLITE_HEIGHT = 17
const TRIM_THICKNESS = 0.4 // the frame border drawn just behind the translite and the score panel
const MARQUEE_HEIGHT = 1.1 // the lit topper strip above the backbox
const GLASS_MARGIN = 1.4 // the glass pane overhangs the playfield footprint by this much on every side
const COIN_DOOR_WIDTH = 9
const COIN_DOOR_HEIGHT = 6
const LOCKDOWN_BAR_RADIUS = 0.55
const LOCKDOWN_BAR_COLOR = '#7b7f88'
const CHROME_TRIM_HEIGHT = 0.35
const MOULDING_RADIUS = 0.12
const SIDE_RAIL_SCREW_COUNT = 5
const LEG_BOLT_RADIUS = 0.35
const FOOT_RADIUS = 1.7
const FOOT_HEIGHT = 0.35

/** Colour palette for the cabinet's own emissive/plastic bits (kept in step with the game's neon look). */
const NEON_MAGENTA = '#ff2bd6'
const NEON_CYAN = '#22e4ff'
const COIN_SLOT_ORANGE = '#ff8a1f'
const CABINET_BLACK = '#0c0912'
const CHROME_COLOR = '#d8dde3'
const WOOD_BUMP_SCALE = 0.04
const GRILLE_BUMP_SCALE = 0.03
const POWDER_COAT_BUMP_SCALE = 0.03
const STAINLESS_ENV_INTENSITY = 0.6

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
 * A full machine: legs, a tapered cabinet body with a coin door and lockdown bar, a backbox that
 * doubles as the scoreboard (a lit dot-matrix score panel and speaker grilles below a lit
 * translite), and a near-invisible glass pane over the playfield. No room: `arcadeRoom.ts` builds
 * that separately.
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
      specularIntensity: 0.1,
      transparent: true,
      opacity: 0.04,
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
  const woodBump = makeWoodBump()
  own(woodBump)
  const sideMaterial = new THREE.MeshStandardMaterial({
    color: CABINET_BLACK,
    map: sideTexture,
    emissiveMap: sideTexture,
    emissive: 0xffffff,
    emissiveIntensity: 0.4,
    roughness: 0.65,
    metalness: 0.1,
    bumpMap: woodBump,
    bumpScale: WOOD_BUMP_SCALE,
    side: THREE.DoubleSide,
  })
  own(sideMaterial)

  // Brushed, not mirror: a mirror-smooth trim throws the key light back as one long white streak.
  const stainlessRoughness = makeBrushedMetalRoughness()
  own(stainlessRoughness)
  const stainlessBump = makeBrushedMetalBump()
  own(stainlessBump)
  const stainlessMaterial = new THREE.MeshStandardMaterial({
    color: CHROME_COLOR,
    metalness: 1,
    roughness: 0.5,
    roughnessMap: stainlessRoughness,
    bumpMap: stainlessBump,
    envMapIntensity: STAINLESS_ENV_INTENSITY,
  })
  own(stainlessMaterial)

  // A small mirror-chrome accent, kept only for tiny jewelled bits (the button bezels, the
  // plunger housing) where a hot highlight reads as detail rather than glare off a big surface.
  const chromeMaterial = new THREE.MeshStandardMaterial({ color: CHROME_COLOR, metalness: 1, roughness: 0.4 })
  own(chromeMaterial)

  const mouldingMaterial = new THREE.MeshStandardMaterial({ color: '#050308', roughness: 0.85, metalness: 0 })
  own(mouldingMaterial)

  /** A thin black T-moulding rod, `yBottom` to `yTop`, at `(x, z)`. Used along body/backbox corners. */
  const addMoulding = (x: number, z: number, yTop: number, yBottom: number): void => {
    const height = yTop - yBottom
    if (height <= 0) return
    const geometry = new THREE.CylinderGeometry(MOULDING_RADIUS, MOULDING_RADIUS, height, 8)
    const mesh = new THREE.Mesh(geometry, mouldingMaterial)
    mesh.position.set(x, (yTop + yBottom) / 2, z)
    group.add(mesh)
    own({ dispose: () => geometry.dispose() })
  }

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
    const trim = new THREE.Mesh(trimGeometry, stainlessMaterial)
    trim.castShadow = true
    trim.receiveShadow = true
    group.add(trim)
    own({ dispose: () => trimGeometry.dispose() })

    addMoulding(outerX, frontZ - SIDE_WALL_THICKNESS / 2, frontTopY, bottomY)
    addMoulding(outerX, backZ + SIDE_WALL_THICKNESS / 2, backTopY, bottomY)

    // Side-rail screws: a few small chrome dots along the trim's outer face.
    for (let i = 0; i < SIDE_RAIL_SCREW_COUNT; i++) {
      const t = (i + 0.5) / SIDE_RAIL_SCREW_COUNT
      const z = backZ + (frontZ - backZ) * t
      const screwGeometry = new THREE.SphereGeometry(0.12, 8, 8)
      const screw = new THREE.Mesh(screwGeometry, stainlessMaterial)
      screw.position.set(outerX, railTopY(z) + CHROME_TRIM_HEIGHT * 0.5, z)
      group.add(screw)
      own({ dispose: () => screwGeometry.dispose() })
    }

    // A flipper button on each side, near the front: glossy plastic in a chrome bezel.
    const buttonGeometry = new THREE.CylinderGeometry(0.7, 0.7, 0.6, 16)
    const buttonMaterial = new THREE.MeshStandardMaterial({
      color: sign < 0 ? NEON_MAGENTA : NEON_CYAN,
      emissive: sign < 0 ? NEON_MAGENTA : NEON_CYAN,
      emissiveIntensity: 0.6,
      metalness: 0.05,
      roughness: 0.25,
    })
    const button = new THREE.Mesh(buttonGeometry, buttonMaterial)
    button.rotation.z = Math.PI / 2
    const buttonY = bottomY + (frontTopY - bottomY) * 0.4
    button.position.set(outerX - sign * 0.3, buttonY, frontZ - table.height * 0.12)
    button.castShadow = true
    group.add(button)
    own({ dispose: () => { buttonGeometry.dispose(); buttonMaterial.dispose() } })

    const bezelGeometry = new THREE.TorusGeometry(0.78, 0.09, 8, 20)
    const bezel = new THREE.Mesh(bezelGeometry, chromeMaterial)
    bezel.rotation.y = Math.PI / 2
    bezel.position.copy(button.position)
    group.add(bezel)
    own({ dispose: () => bezelGeometry.dispose() })
  }

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: CABINET_BLACK,
    roughness: 0.65,
    metalness: 0.08,
    bumpMap: woodBump,
    bumpScale: WOOD_BUMP_SCALE,
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
    const geometry = new THREE.CylinderGeometry(LOCKDOWN_BAR_RADIUS, LOCKDOWN_BAR_RADIUS, outerWidth, 40)
    // Satin, darker than the rest of the trim: the bar lies right under the key light and right in
    // front of the low camera, so anything shinier fills the bottom of the screen with glare.
    const material = new THREE.MeshStandardMaterial({
      color: LOCKDOWN_BAR_COLOR,
      metalness: 1,
      roughness: 0.78,
      roughnessMap: stainlessRoughness,
      envMapIntensity: 0.35,
    })
    own(material)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.rotation.z = Math.PI / 2
    mesh.position.set(0, frontTopY + LOCKDOWN_BAR_RADIUS, frontZ - 0.4)
    mesh.castShadow = true
    group.add(mesh)
    own({ dispose: () => geometry.dispose() })
  }

  // Legs, feet, and bolts.
  for (const xSign of [-1, 1] as const) {
    for (const zPos of [frontZ - 2, backZ + 2]) {
      const legX = xSign * (halfOuterWidth - 1.5)

      const geometry = new THREE.CylinderGeometry(LEG_RADIUS_TOP, LEG_RADIUS_BOTTOM, bottomY, 12)
      const mesh = new THREE.Mesh(geometry, stainlessMaterial)
      mesh.position.set(legX, bottomY / 2, zPos)
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)
      own({ dispose: () => geometry.dispose() })

      // A bolt where the leg meets the cabinet body.
      const boltGeometry = new THREE.CylinderGeometry(LEG_BOLT_RADIUS, LEG_BOLT_RADIUS, 0.18, 8)
      const bolt = new THREE.Mesh(boltGeometry, stainlessMaterial)
      bolt.position.set(legX, bottomY - 0.1, zPos)
      group.add(bolt)
      own({ dispose: () => boltGeometry.dispose() })

      // A levelling foot at the floor.
      const footGeometry = new THREE.CylinderGeometry(FOOT_RADIUS, FOOT_RADIUS, FOOT_HEIGHT, 12)
      const foot = new THREE.Mesh(footGeometry, stainlessMaterial)
      foot.position.set(legX, FOOT_HEIGHT / 2, zPos)
      foot.receiveShadow = true
      group.add(foot)
      own({ dispose: () => footGeometry.dispose() })
    }
  }

  // Coin door: a recessed powder-coated panel with two lit coin slots, a lock, a lit
  // coin-return button, and a start button.
  {
    const powderBump = makePowderCoatBump()
    own(powderBump)
    const doorGeometry = new THREE.BoxGeometry(COIN_DOOR_WIDTH, COIN_DOOR_HEIGHT, 0.3)
    const doorMaterial = new THREE.MeshStandardMaterial({
      color: '#1a1520',
      metalness: 0.3,
      roughness: 0.6,
      bumpMap: powderBump,
      bumpScale: POWDER_COAT_BUMP_SCALE,
    })
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

    // A small lock cylinder below the coin slots.
    const lockGeometry = new THREE.CylinderGeometry(0.25, 0.25, 0.2, 12)
    const lock = new THREE.Mesh(lockGeometry, stainlessMaterial)
    lock.rotation.x = Math.PI / 2
    lock.position.set(0, doorY + 0.6, door.position.z - 0.2)
    group.add(lock)
    own({ dispose: () => lockGeometry.dispose() })

    // A lit coin-return button.
    const returnGeometry = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 20)
    const returnMaterial = new THREE.MeshStandardMaterial({
      color: COIN_SLOT_ORANGE,
      emissive: COIN_SLOT_ORANGE,
      emissiveIntensity: 1.2,
      metalness: 0.3,
      roughness: 0.4,
    })
    const returnButton = new THREE.Mesh(returnGeometry, returnMaterial)
    returnButton.rotation.x = Math.PI / 2
    returnButton.position.set(-2.6, doorY - 1.5, door.position.z - 0.25)
    group.add(returnButton)
    own({ dispose: () => { returnGeometry.dispose(); returnMaterial.dispose() } })

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

  // --- Backbox, on a short neck at the far end: a scoreboard the player can see from the low
  // default camera. Bottom to top: a speaker-panel band (the dot-matrix score display flanked by
  // two grilles), then the translite, each framed by a thin trim border; a small lit marquee
  // strip tops it off. The face stays vertical, facing +Z.
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

  for (const xSign of [-1, 1] as const) {
    addMoulding(
      xSign * (BACKBOX_WIDTH / 2),
      backboxCentreZ - BACKBOX_DEPTH / 2,
      backboxBottomY + BACKBOX_HEIGHT,
      backboxBottomY,
    )
    addMoulding(
      xSign * (BACKBOX_WIDTH / 2),
      backboxCentreZ + BACKBOX_DEPTH / 2,
      backboxBottomY + BACKBOX_HEIGHT,
      backboxBottomY,
    )
  }

  const backboxFrontZ = backboxCentreZ + BACKBOX_DEPTH / 2 + 0.05
  const speakerBandCentreY = backboxBottomY + SPEAKER_BAND_HEIGHT / 2
  const transliteBottomY = backboxBottomY + SPEAKER_BAND_HEIGHT + TRIM_THICKNESS
  const transliteCentreY = transliteBottomY + TRANSLITE_HEIGHT / 2

  // A slightly darker sub-panel behind the speaker band, so it reads as its own face.
  {
    const geometry = new THREE.PlaneGeometry(BACKBOX_WIDTH - 1, SPEAKER_BAND_HEIGHT - 0.6)
    const material = new THREE.MeshStandardMaterial({ color: '#08050c', roughness: 0.7, metalness: 0.15 })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(0, speakerBandCentreY, backboxFrontZ - 0.02)
    group.add(mesh)
    own({ dispose: () => { geometry.dispose(); material.dispose() } })
  }

  // Thin trim frames sitting just behind the translite and the score panel.
  {
    const geometry = new THREE.PlaneGeometry(
      TRANSLITE_WIDTH + TRIM_THICKNESS * 2,
      TRANSLITE_HEIGHT + TRIM_THICKNESS * 2,
    )
    const mesh = new THREE.Mesh(geometry, mouldingMaterial)
    mesh.position.set(0, transliteCentreY, backboxFrontZ - 0.01)
    group.add(mesh)
    own({ dispose: () => geometry.dispose() })
  }
  {
    const geometry = new THREE.PlaneGeometry(
      SCORE_PANEL_WIDTH + TRIM_THICKNESS * 2,
      SCORE_PANEL_HEIGHT + TRIM_THICKNESS * 2,
    )
    const mesh = new THREE.Mesh(geometry, mouldingMaterial)
    mesh.position.set(0, speakerBandCentreY, backboxFrontZ - 0.01)
    group.add(mesh)
    own({ dispose: () => geometry.dispose() })
  }

  const backglassTexture = makeBackglassTexture()
  own(backglassTexture)
  {
    const geometry = new THREE.PlaneGeometry(TRANSLITE_WIDTH, TRANSLITE_HEIGHT)
    const material = new THREE.MeshStandardMaterial({
      map: backglassTexture,
      emissiveMap: backglassTexture,
      emissive: 0xffffff,
      emissiveIntensity: 0.9,
      roughness: 0.4,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(0, transliteCentreY, backboxFrontZ + 0.02)
    group.add(mesh)
    own({ dispose: () => { geometry.dispose(); material.dispose() } })
  }

  const scoreDisplay = makeScoreDisplay()
  own(scoreDisplay.texture)
  {
    const geometry = new THREE.PlaneGeometry(SCORE_PANEL_WIDTH, SCORE_PANEL_HEIGHT)
    const material = new THREE.MeshStandardMaterial({
      map: scoreDisplay.texture,
      emissiveMap: scoreDisplay.texture,
      emissive: 0xffffff,
      emissiveIntensity: 1.1,
      roughness: 0.4,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(0, speakerBandCentreY, backboxFrontZ + 0.01)
    group.add(mesh)
    own({ dispose: () => { geometry.dispose(); material.dispose() } })
  }

  // Speaker grilles either side of the score panel: dark perforated discs with a chrome ring.
  const grilleBump = makePebbleBump()
  own(grilleBump)
  const grilleMaterial = new THREE.MeshStandardMaterial({
    color: '#0d0a12',
    roughness: 0.8,
    metalness: 0.2,
    bumpMap: grilleBump,
    bumpScale: GRILLE_BUMP_SCALE,
  })
  own(grilleMaterial)
  for (const sign of [-1, 1] as const) {
    const grilleX = sign * (BACKBOX_WIDTH / 2 - SPEAKER_GRILLE_INSET)

    const discGeometry = new THREE.CircleGeometry(SPEAKER_GRILLE_RADIUS, 24)
    const disc = new THREE.Mesh(discGeometry, grilleMaterial)
    disc.position.set(grilleX, speakerBandCentreY, backboxFrontZ)
    group.add(disc)
    own({ dispose: () => discGeometry.dispose() })

    const ringGeometry = new THREE.RingGeometry(SPEAKER_GRILLE_RADIUS, SPEAKER_GRILLE_RADIUS + 0.12, 24)
    const ring = new THREE.Mesh(ringGeometry, stainlessMaterial)
    ring.position.set(grilleX, speakerBandCentreY, backboxFrontZ + 0.01)
    group.add(ring)
    own({ dispose: () => ringGeometry.dispose() })
  }

  // A small lit marquee-style topper strip above the backbox.
  {
    const marquee = makeEmissiveBox(BACKBOX_WIDTH * 0.9, MARQUEE_HEIGHT, BACKBOX_DEPTH * 0.7, NEON_CYAN, 1.3)
    marquee.mesh.position.set(0, backboxBottomY + BACKBOX_HEIGHT + MARQUEE_HEIGHT / 2, backboxCentreZ)
    group.add(marquee.mesh)
    own(marquee)
  }

  // A hinge line where the backbox would fold down over the cabinet body.
  {
    const hingeGeometry = new THREE.BoxGeometry(BACKBOX_WIDTH * 0.7, 0.25, 0.6)
    const hinge = new THREE.Mesh(hingeGeometry, mouldingMaterial)
    hinge.position.set(0, backboxBottomY + BACKBOX_HEIGHT - 0.3, backboxCentreZ - BACKBOX_DEPTH / 2)
    group.add(hinge)
    own({ dispose: () => hingeGeometry.dispose() })
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
