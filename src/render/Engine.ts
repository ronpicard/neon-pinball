/**
 * Builds the three.js scene, camera, renderer and simulation loop for one canvas: the whole
 * playable machine. Everything created here (geometries, materials, textures, render targets, the
 * renderer, the composer, the input controller) is disposed by `dispose()`, and nothing is created
 * outside this function, so the returned `EngineApi` is safe to construct and tear down repeatedly
 * (React StrictMode double-invokes it). See `SPEC.md` section S11 for the contract this follows.
 */

import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

import type {
  CameraView,
  ControlName,
  EngineApi,
  EngineEvents,
  EngineMode,
  HudSnapshot,
  ViewInsets,
} from './engineApi.ts'
import { createInput } from './input.ts'
import type { InputController } from './input.ts'
import { createCabinet } from './cabinet.ts'
import type { Cabinet } from './cabinet.ts'
import { createTableView } from './tableView.ts'
import type { TableView } from './tableView.ts'

import { TABLE } from '../game/table.ts'
import {
  addBall,
  autoLaunch,
  ballAtPlunger,
  createTableState,
  FIXED_DT,
  resetDropBank,
  stepTable,
} from '../game/physics.ts'
import { createGame, handleEvent, startGame, tickGame } from '../game/rules.ts'
import { botInput } from '../game/autoplay.ts'
import type { Command, GameState, Input, PhysicsEvent, TableState } from '../game/types.ts'

// -------------------------------------------------------------------------------------------
// Loop timing
// -------------------------------------------------------------------------------------------

/** A frame slower than this is treated as a stall, not a moment to simulate for real. */
const MAX_FRAME_SECONDS = 1 / 20
/** However long a stalled frame took, never step physics more than this many times to catch up. */
const MAX_FIXED_STEPS_PER_FRAME = 40
/** Seconds after an auto `serveBall` before the machine fires the plunger itself. */
const AUTO_LAUNCH_DELAY_SECONDS = 0.6
/** How long an attract-mode game's `gameOver` screen sits before a fresh one starts. */
const ATTRACT_RESTART_DELAY_SECONDS = 3
/** Duration of the flash `lightShow` commands ask the table view for. */
const LIGHT_SHOW_SECONDS = 1.2
/** A knock's reported speed that maps to full sound intensity (1). */
const KNOCK_FULL_INTENSITY_SPEED = 80

const ALL_FALSE_INPUT: Input = { left: false, right: false, plunger: false, nudge: null }

// -------------------------------------------------------------------------------------------
// Renderer / post-processing look
// -------------------------------------------------------------------------------------------

const BACKGROUND_COLOR = 0x05030b
const FOG_DENSITY = 0.006
const TONE_MAPPING_EXPOSURE = 1.25
const ENVIRONMENT_INTENSITY = 0.35
const BLOOM_STRENGTH = 0.45
const BLOOM_RADIUS = 0.6
const BLOOM_THRESHOLD = 1.0
const SHADOW_MAP_SIZE = 2048

// -------------------------------------------------------------------------------------------
// Lights
// -------------------------------------------------------------------------------------------

const KEY_LIGHT_COLOR = 0xffd9a0
const KEY_LIGHT_INTENSITY = 2.1
const FILL_LIGHT_COLOR = 0x9fd4ff
const FILL_LIGHT_INTENSITY = 0.6
const HEMI_SKY_COLOR = 0x33264d
const HEMI_GROUND_COLOR = 0x0a0410
const HEMI_INTENSITY = 0.9
const NEON_LEFT_COLOR = 0xff2bd6
const NEON_RIGHT_COLOR = 0x22e4ff
const NEON_POINT_INTENSITY = 0.8
const NEON_POINT_DISTANCE = 70
/** How far above the playfield the key spotlight and the two neon point lights sit. */
const OVERHEAD_LIGHT_HEIGHT = 40
/** How far the key light hangs toward the player's end of the table from its centre. */
const KEY_LIGHT_TOWARD_PLAYER = 46
/** Padding added to the spot's cone so the whole table clears its edge, in the angle's tangent. */
const SPOT_CONE_PADDING = 1.15

// -------------------------------------------------------------------------------------------
// Camera
// -------------------------------------------------------------------------------------------

const CAMERA_NEAR = 0.4
const CAMERA_FAR = 400
/** Fixed field of view. Fitting is done by pulling the eye back, not by changing this. */
const CAMERA_FOV_DEGREES = 36
/** Canvas aspect (width / height) below which the default view is 'top' instead of 'player'. */
const PORTRAIT_ASPECT_THRESHOLD = 0.8
/** Time constant of the critically-damped ease between camera views. */
const VIEW_SMOOTH_TIME = 0.4
/** The fit never treats less than this fraction of the viewport as free, however large the insets. */
const MIN_FREE_FRACTION = 0.3
/** Shrinks the fitted frustum a touch so corners never sit flush against the canvas edge. */
/** Inches of cabinet kept in frame beyond the playfield's sides and far end, and beyond its near end. */
const FRAME_MARGIN_SIDE = 2
const FRAME_MARGIN_FRONT = 5
const CAMERA_FIT_MARGIN = 0.04
const FIT_ITERATIONS = 24
const FIT_MIN_EXTRA = 0
const FIT_MAX_EXTRA = 400

/** How steeply the player's view looks down on the playfield, above the horizontal. */
const PLAYER_ELEVATION = (52 * Math.PI) / 180
/** The player's eye starts this far from its look target, before the fit pulls it back. */
const PLAYER_BASE_DISTANCE = 30
const TOP_VIEW_BASE_HEIGHT = 34
const CHASE_EYE_HEIGHT = 22
/** How much of the ball's sideways position the chase camera follows. */
const CHASE_FOLLOW_SHARE = 0.35
/** How far behind the flipper line the chase eye sits, and how far up-table it looks. */
const CHASE_EYE_BACK_OFFSET = 16
const CHASE_LOOK_AHEAD = 16
const CHASE_LOOK_HEIGHT = 0
/** How quickly the chase camera's x eases toward the tracked ball's x. */
const CHASE_TRACK_RATE = 3.5

const NUDGE_SHAKE_SECONDS = 0.22
const NUDGE_SHAKE_MAGNITUDE = 0.35

const VIEW_CYCLE: CameraView[] = ['player', 'top', 'chase']

// -------------------------------------------------------------------------------------------
// Small maths helpers
// -------------------------------------------------------------------------------------------

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * One axis of a critically-damped spring toward `target`, in the spirit of Unity's
 * `Mathf.SmoothDamp`: reaches the target smoothly in about `smoothTime` seconds with no overshoot
 * ringing, which is what "critically damped" means for a camera easing between two views.
 */
function smoothDamp(
  current: number,
  target: number,
  velocity: { v: number },
  smoothTime: number,
  dt: number,
): number {
  const omega = 2 / Math.max(1e-4, smoothTime)
  const x = omega * dt
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const change = current - target
  const temp = (velocity.v + omega * change) * dt
  velocity.v = (velocity.v - omega * temp) * exp
  let output = target + (change + temp) * exp
  if (target - current > 0 === output > target) {
    output = target
    velocity.v = (output - target) / Math.max(1e-4, dt)
  }
  return output
}

/** Applies `smoothDamp` to each axis of a `THREE.Vector3`, with a separate velocity per axis. */
function dampVector3(
  current: THREE.Vector3,
  target: THREE.Vector3,
  velocity: { x: { v: number }; y: { v: number }; z: { v: number } },
  smoothTime: number,
  dt: number,
): void {
  current.x = smoothDamp(current.x, target.x, velocity.x, smoothTime, dt)
  current.y = smoothDamp(current.y, target.y, velocity.y, smoothTime, dt)
  current.z = smoothDamp(current.z, target.z, velocity.z, smoothTime, dt)
}

// -------------------------------------------------------------------------------------------
// Engine
// -------------------------------------------------------------------------------------------

/**
 * Builds and runs the whole machine on `canvas`, reporting sound/HUD/message/game-over back
 * through `events`. See module doc comment above.
 */
export function createEngine(canvas: HTMLCanvasElement, events: EngineEvents): EngineApi {
  // --- Renderer / scene / environment ------------------------------------------------------------

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(BACKGROUND_COLOR)
  scene.fog = new THREE.FogExp2(BACKGROUND_COLOR, FOG_DENSITY)

  const pmremGenerator = new THREE.PMREMGenerator(renderer)
  const roomEnvironment = new RoomEnvironment()
  const environmentTarget = pmremGenerator.fromScene(roomEnvironment)
  const envMap = environmentTarget.texture
  scene.environment = envMap
  scene.environmentIntensity = ENVIRONMENT_INTENSITY
  roomEnvironment.dispose()
  pmremGenerator.dispose()

  // --- Post-processing ---------------------------------------------------------------------------

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEGREES, 1, CAMERA_NEAR, CAMERA_FAR)

  const composer = new EffectComposer(renderer)
  const renderPass = new RenderPass(scene, camera)
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(1, 1),
    BLOOM_STRENGTH,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD,
  )
  const outputPass = new OutputPass()
  composer.addPass(renderPass)
  composer.addPass(bloomPass)
  composer.addPass(outputPass)

  // --- Scene content: cabinet + table ------------------------------------------------------------

  const cabinet: Cabinet = createCabinet(TABLE)
  const view: TableView = createTableView(TABLE, envMap)
  cabinet.playfieldAnchor.add(view.group)
  scene.add(cabinet.group)
  // From the root: updating only the view's group would leave its parents' (the sloped anchor's)
  // world matrices stale, and every corner below would come out in local space.
  cabinet.group.updateMatrixWorld(true)

  // --- Lights ------------------------------------------------------------------------------------

  // The playfield's four world-space corners, in table-convention order: [back-left, back-right,
  // front-left, front-right], where "front" (local z = +height/2) is the flipper end, closest to
  // the player who "stands at +Z looking toward -Z" (see the cabinet's world-frame doc comment).
  const halfWidth = TABLE.width / 2
  const halfHeight = TABLE.height / 2
  const localCorners: [number, number][] = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [-halfWidth, halfHeight],
    [halfWidth, halfHeight],
  ]
  const corners = localCorners.map(([x, z]) =>
    new THREE.Vector3(x, 0, z).applyMatrix4(view.group.matrixWorld),
  )
  const [backLeft, backRight, frontLeft, frontRight] = corners
  /** What the camera fit keeps on screen: the playfield plus the rails and lockdown bar around it. */
  const frameCorners = localCorners.map(([x, z]) =>
    new THREE.Vector3(
      x + Math.sign(x) * FRAME_MARGIN_SIDE,
      0,
      z > 0 ? z + FRAME_MARGIN_FRONT : z - FRAME_MARGIN_SIDE,
    ).applyMatrix4(view.group.matrixWorld),
  )
  const playfieldCentre = new THREE.Vector3()
    .add(backLeft)
    .add(backRight)
    .add(frontLeft)
    .add(frontRight)
    .multiplyScalar(0.25)
  const frontMid = new THREE.Vector3().addVectors(frontLeft, frontRight).multiplyScalar(0.5)
  const backMid = new THREE.Vector3().addVectors(backLeft, backRight).multiplyScalar(0.5)
  const playfieldNormal = new THREE.Vector3()
    .subVectors(frontRight, frontLeft)
    .cross(new THREE.Vector3().subVectors(backLeft, frontLeft))
    .normalize()
  if (playfieldNormal.y < 0) playfieldNormal.negate()
  /** "Up the table" in world space: flipper end toward the arch, used as the top view's up vector. */
  const upTheTable = new THREE.Vector3().subVectors(backMid, frontMid).normalize()

  const tableRadius = Math.max(playfieldCentre.distanceTo(backLeft), playfieldCentre.distanceTo(frontRight))

  const keyLight = new THREE.SpotLight(KEY_LIGHT_COLOR, KEY_LIGHT_INTENSITY)
  // Hung toward the player's end: straight overhead, its mirror image in the lacquer glares into
  // the player's camera.
  keyLight.position
    .copy(playfieldCentre)
    .addScaledVector(playfieldNormal, OVERHEAD_LIGHT_HEIGHT)
    .addScaledVector(upTheTable, -KEY_LIGHT_TOWARD_PLAYER)
  keyLight.target.position.copy(playfieldCentre)
  const keyLightDistance = keyLight.position.distanceTo(playfieldCentre)
  keyLight.angle = Math.atan2(tableRadius * SPOT_CONE_PADDING, keyLightDistance)
  keyLight.penumbra = 0.4
  // The scene is measured in inches, so physical inverse-square falloff would leave it black.
  keyLight.decay = 0
  keyLight.distance = OVERHEAD_LIGHT_HEIGHT * 3
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
  keyLight.shadow.camera.near = Math.max(1, keyLightDistance - tableRadius * 1.3)
  keyLight.shadow.camera.far = keyLightDistance + tableRadius * 1.3
  keyLight.shadow.bias = -0.0006
  keyLight.shadow.normalBias = 0.02
  scene.add(keyLight, keyLight.target)

  const fillLight = new THREE.DirectionalLight(FILL_LIGHT_COLOR, FILL_LIGHT_INTENSITY)
  fillLight.position
    .copy(playfieldCentre)
    .add(new THREE.Vector3(-tableRadius, tableRadius, tableRadius * 0.4))
  scene.add(fillLight)

  const hemiLight = new THREE.HemisphereLight(HEMI_SKY_COLOR, HEMI_GROUND_COLOR, HEMI_INTENSITY)
  scene.add(hemiLight)

  const neonLeft = new THREE.PointLight(NEON_LEFT_COLOR, NEON_POINT_INTENSITY, NEON_POINT_DISTANCE, 0)
  neonLeft.position.copy(frontLeft).addScaledVector(playfieldNormal, OVERHEAD_LIGHT_HEIGHT * 0.5)
  scene.add(neonLeft)

  const neonRight = new THREE.PointLight(NEON_RIGHT_COLOR, NEON_POINT_INTENSITY, NEON_POINT_DISTANCE, 0)
  neonRight.position.copy(frontRight).addScaledVector(playfieldNormal, OVERHEAD_LIGHT_HEIGHT * 0.5)
  scene.add(neonRight)

  // --- Input / game state ------------------------------------------------------------------------

  const initialAspect = canvas.clientWidth / Math.max(1, canvas.clientHeight)
  let currentView: CameraView = initialAspect < PORTRAIT_ASPECT_THRESHOLD ? 'top' : 'player'
  let userPickedView = false

  const input: InputController = createInput({
    // React owns the camera choice and pausing (its HUD shows both, and it calls `setCameraView` and
    // `setPaused`), so it listens for these keys itself and the shortcuts are no-ops here.
    onCameraToggle(): void {},
    onPauseToggle(): void {},
  })

  let mode: EngineMode = 'attract'
  let state: TableState = createTableState(TABLE)
  let game: GameState = createGame()
  let paused = false
  let wasHidden = document.visibilityState === 'hidden'

  /** Serve requests waiting for the plunger zone to clear, in the order the rules asked for them. */
  const pendingServes: { auto: boolean }[] = []
  /** Countdown, in seconds, until each queued auto-serve's ball is launched by the machine itself. */
  const autoLaunchTimers: number[] = []

  let attractRestartTimer = 0
  let gameOverReported = false

  let currentMessage: { text: string; expiresAt: number } | null = null
  let lastDisplay: { score: number; ball: number; message: string | null } | null = null
  let lastHud: HudSnapshot | null = null

  /** This frame's physics events, for `view.update`'s flashes. Cleared and refilled, never reallocated. */
  const frameEvents: PhysicsEvent[] = []

  // --- Camera rig --------------------------------------------------------------------------------

  /** Reusable scratch objects for the fit search and the per-frame rig build (never per fixed step). */
  const probeCamera = new THREE.PerspectiveCamera(CAMERA_FOV_DEGREES, 1, CAMERA_NEAR, CAMERA_FAR)
  const projectedScratch = new THREE.Vector3()
  const rigEyeScratch = new THREE.Vector3()
  const rigLookScratch = new THREE.Vector3()
  const rigUpScratch = new THREE.Vector3(0, 1, 0)

  /** How far each view's eye has been pulled back from its base position to fit the current canvas. */
  const fitExtra: Record<CameraView, number> = { player: 0, top: 0, chase: 0 }

  let insets: ViewInsets = { left: 0, top: 0, right: 0, bottom: 0 }
  let aspect = 1

  const cameraPosition = new THREE.Vector3()
  const cameraLookAt = new THREE.Vector3()
  const cameraPositionVelocity = { x: { v: 0 }, y: { v: 0 }, z: { v: 0 } }
  const cameraLookAtVelocity = { x: { v: 0 }, y: { v: 0 }, z: { v: 0 } }
  let cameraInitialized = false

  /** Ball x eased toward by the chase camera (world units), independent of any one ball's id. */
  let chaseTrackedX = playfieldCentre.x
  let shakeTimer = 0

  /**
   * Fills `rigEyeScratch`/`rigLookScratch`/`rigUpScratch` with the un-pulled-back rig for `viewName`.
   * `chaseX` is the world-space x the chase view's eye and gaze are currently centred on.
   */
  function buildRig(viewName: CameraView, chaseX: number): void {
    if (viewName === 'top') {
      rigEyeScratch.copy(playfieldCentre).addScaledVector(playfieldNormal, TOP_VIEW_BASE_HEIGHT)
      rigLookScratch.copy(playfieldCentre)
      rigUpScratch.copy(upTheTable)
      return
    }
    if (viewName === 'player') {
      // A fixed line of sight down the table, so pulling back along it always shrinks the machine
      // on screen and the fit search below is monotonic.
      rigLookScratch.copy(playfieldCentre)
      rigEyeScratch.set(
        rigLookScratch.x,
        rigLookScratch.y + Math.sin(PLAYER_ELEVATION) * PLAYER_BASE_DISTANCE,
        rigLookScratch.z + Math.cos(PLAYER_ELEVATION) * PLAYER_BASE_DISTANCE,
      )
      rigUpScratch.set(0, 1, 0)
      return
    }
    // 'chase': low, just behind the flipper line, tracking the ball's x, looking up the table.
    rigEyeScratch
      .copy(frontMid)
      .addScaledVector(upTheTable, -CHASE_EYE_BACK_OFFSET)
      .addScaledVector(playfieldNormal, CHASE_EYE_HEIGHT)
    rigLookScratch
      .copy(frontMid)
      .addScaledVector(upTheTable, CHASE_LOOK_AHEAD)
      .addScaledVector(playfieldNormal, CHASE_LOOK_HEIGHT)
    rigEyeScratch.x = chaseX * CHASE_FOLLOW_SHARE
    rigLookScratch.x = chaseX * CHASE_FOLLOW_SHARE
    rigUpScratch.set(0, 1, 0)
  }

  /** Moves `rigEyeScratch` further from `rigLookScratch` by `extra`, along their existing line. */
  function pullBackScratch(extra: number): void {
    if (extra <= 0) return
    const dx = rigEyeScratch.x - rigLookScratch.x
    const dy = rigEyeScratch.y - rigLookScratch.y
    const dz = rigEyeScratch.z - rigLookScratch.z
    const length = Math.hypot(dx, dy, dz)
    if (length < 1e-6) return
    const scale = (length + extra) / length
    rigEyeScratch.set(
      rigLookScratch.x + dx * scale,
      rigLookScratch.y + dy * scale,
      rigLookScratch.z + dz * scale,
    )
  }

  /** True when every corner in `points` projects inside the canvas minus `ViewInsets`, for `probeCamera`. */
  function cornersFit(points: THREE.Vector3[], limitX: number, limitY: number): boolean {
    probeCamera.updateMatrixWorld(true)
    probeCamera.updateProjectionMatrix()
    return points.every((corner) => {
      projectedScratch.copy(corner).project(probeCamera)
      return Math.abs(projectedScratch.x) <= limitX && Math.abs(projectedScratch.y) <= limitY
    })
  }

  /**
   * Binary-searches the pull-back distance for `viewName` so the playfield corners project inside
   * the canvas minus `ViewInsets`. Only called on resize, an insets change, or the first frame: the
   * result is cached in `fitExtra`.
   */
  function fitView(viewName: CameraView): number {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return fitExtra[viewName]

    const freeX = Math.max(MIN_FREE_FRACTION, (width - insets.left - insets.right) / width)
    const freeY = Math.max(MIN_FREE_FRACTION, (height - insets.top - insets.bottom) / height)
    const limitX = freeX * (1 - CAMERA_FIT_MARGIN)
    const limitY = freeY * (1 - CAMERA_FIT_MARGIN)

    // The chase view sits inside the machine on purpose: there is nothing to fit.
    if (viewName === 'chase') return 0

    probeCamera.fov = CAMERA_FOV_DEGREES
    probeCamera.aspect = aspect
    probeCamera.near = CAMERA_NEAR
    probeCamera.far = CAMERA_FAR


    function fits(extra: number): boolean {
      buildRig(viewName, playfieldCentre.x)
      pullBackScratch(extra)
      probeCamera.position.copy(rigEyeScratch)
      probeCamera.up.copy(rigUpScratch)
      probeCamera.lookAt(rigLookScratch)
      return cornersFit(frameCorners, limitX, limitY)
    }

    let lo = FIT_MIN_EXTRA
    let hi = FIT_MAX_EXTRA
    if (!fits(hi)) {
      // Best effort: even pulled all the way back it does not fit (an extreme aspect ratio).
      return hi
    }
    for (let i = 0; i < FIT_ITERATIONS; i++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) hi = mid
      else lo = mid
    }
    return hi
  }

  function refitAllViews(): void {
    for (const viewName of VIEW_CYCLE) fitExtra[viewName] = fitView(viewName)
  }

  /** Applies the shifted-frustum trick (see `handleResize`) so the fitted view centres in the free area. */
  function applyViewOffset(): void {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return
    camera.setViewOffset(
      width,
      height,
      -(insets.left - insets.right) / 2,
      -(insets.top - insets.bottom) / 2,
      width,
      height,
    )
  }

  /** Sets `currentView` and remembers that it was chosen, so aspect changes no longer override it. */
  function applyCameraView(next: CameraView): void {
    currentView = next
    userPickedView = true
  }

  /** Switches `currentView` to the aspect-based default, until the user (or the API) picks one. */
  function applyDefaultViewForAspect(): void {
    if (userPickedView) return
    currentView = aspect < PORTRAIT_ASPECT_THRESHOLD ? 'top' : 'player'
  }

  // --- Command execution -------------------------------------------------------------------------

  /** Adds a ball to the plunger if it is free, else queues the serve; schedules an auto-launch. */
  function serveOrQueue(auto: boolean): void {
    if (ballAtPlunger(TABLE, state) === null) {
      addBall(state, TABLE.plunger.rest)
      if (auto) autoLaunchTimers.push(AUTO_LAUNCH_DELAY_SECONDS)
    } else {
      pendingServes.push({ auto })
    }
  }

  /** Serves any queued balls whose zone has since cleared. */
  function drainPendingServes(): void {
    while (pendingServes.length > 0 && ballAtPlunger(TABLE, state) === null) {
      const next = pendingServes.shift()
      if (next) serveOrQueue(next.auto)
    }
  }

  /** Carries out one rules `Command`. `silent` is true in attract mode: no events to React, no sound. */
  function executeCommand(command: Command, silent: boolean): void {
    switch (command.type) {
      case 'serveBall':
        serveOrQueue(command.auto)
        break
      case 'resetDropBank':
        resetDropBank(TABLE, state, command.bank)
        break
      case 'setFlippersEnabled':
        state.flippersEnabled = command.enabled
        break
      case 'sound':
        if (!silent) events.onSound(command.name, 1)
        break
      case 'message':
        currentMessage = { text: command.text, expiresAt: state.time + command.seconds }
        if (!silent) events.onMessage(command.text, command.seconds)
        break
      case 'lightShow':
        view.lightShow(LIGHT_SHOW_SECONDS)
        break
    }
  }

  function executeCommands(commands: Command[], silent: boolean): void {
    for (const command of commands) executeCommand(command, silent)
  }

  /** Sound and camera-shake reactions to a raw physics event, independent of what the rules score. */
  function reactToPhysicsEvent(event: PhysicsEvent): void {
    if (mode !== 'play') return
    switch (event.type) {
      case 'wallHit': {
        const sound = event.kind === 'rubber' ? 'rubber' : 'wall'
        events.onSound(sound, clamp01(event.speed / KNOCK_FULL_INTENSITY_SPEED))
        break
      }
      case 'flipperHit':
        events.onSound('flipperHit', clamp01(event.speed / KNOCK_FULL_INTENSITY_SPEED))
        break
      case 'ballHit':
        events.onSound('ballHit', clamp01(event.speed / KNOCK_FULL_INTENSITY_SPEED))
        break
      case 'flipperUp':
      case 'flipperDown':
        events.onSound('flipper', 1)
        break
      case 'nudge':
        events.onSound('nudge', 1)
        shakeTimer = NUDGE_SHAKE_SECONDS
        break
      default:
        break
    }
  }

  // --- Game lifecycle ----------------------------------------------------------------------------

  function resetRun(): void {
    state = createTableState(TABLE)
    game = createGame()
    pendingServes.length = 0
    autoLaunchTimers.length = 0
    currentMessage = null
    gameOverReported = false
    attractRestartTimer = 0
  }

  function beginPlay(): void {
    mode = 'play'
    resetRun()
    view.setAttract(false)
    input.releaseAll()
    executeCommands(startGame(game, TABLE), false)
  }

  function beginAttract(): void {
    mode = 'attract'
    resetRun()
    view.setAttract(true)
    executeCommands(startGame(game, TABLE), true)
  }

  beginAttract()

  // --- Fixed-step physics ------------------------------------------------------------------------

  function fixedStep(dt: number): void {
    const silent = mode !== 'play'
    const rulesInput: Input = mode === 'play'
      ? (game.phase === 'playing' ? input.read() : ALL_FALSE_INPUT)
      : botInput(TABLE, state)

    const physicsEvents = stepTable(TABLE, state, rulesInput, dt)

    for (let i = autoLaunchTimers.length - 1; i >= 0; i--) {
      autoLaunchTimers[i] -= dt
      if (autoLaunchTimers[i] <= 0) {
        autoLaunchTimers.splice(i, 1)
        autoLaunch(TABLE, state, physicsEvents)
      }
    }

    for (const event of physicsEvents) {
      frameEvents.push(event)
      reactToPhysicsEvent(event)
      executeCommands(handleEvent(game, event, TABLE), silent)
    }

    executeCommands(tickGame(game, dt, TABLE), silent)
    drainPendingServes()

    if (currentMessage && state.time >= currentMessage.expiresAt) currentMessage = null

    if (mode === 'play' && !gameOverReported && game.phase === 'gameOver') {
      gameOverReported = true
      events.onGameOver(game.score)
    }
    if (mode === 'attract' && game.phase === 'gameOver') {
      attractRestartTimer += dt
      if (attractRestartTimer >= ATTRACT_RESTART_DELAY_SECONDS) beginAttract()
    }
  }

  // --- Per-frame visuals -------------------------------------------------------------------------

  function updateCamera(dt: number): void {
    applyDefaultViewForAspect()

    let trackX = playfieldCentre.x
    const plungerBall = ballAtPlunger(TABLE, state)
    if (currentView === 'chase') {
      const balls = state.balls
      let closest: number | null = null
      let closestY = -Infinity
      for (const ball of balls) {
        if (ball.saucer || (plungerBall && ball.id === plungerBall.id)) continue
        if (ball.pos.y > closestY) {
          closestY = ball.pos.y
          closest = ball.pos.x
        }
      }
      const targetLocalX = closest ?? TABLE.width / 2
      // The tracked ball's local x maps onto the world x axis the same way a playfield corner
      // does: local (x - width/2, 0, *) through the view group's transform.
      const worldTarget = new THREE.Vector3(targetLocalX - halfWidth, 0, 0)
      worldTarget.applyMatrix4(view.group.matrixWorld)
      chaseTrackedX += (worldTarget.x - chaseTrackedX) * (1 - Math.exp(-CHASE_TRACK_RATE * dt))
      trackX = chaseTrackedX
    }

    buildRig(currentView, trackX)
    pullBackScratch(fitExtra[currentView])

    if (shakeTimer > 0) {
      shakeTimer = Math.max(0, shakeTimer - dt)
      const magnitude = NUDGE_SHAKE_MAGNITUDE * (shakeTimer / NUDGE_SHAKE_SECONDS)
      rigEyeScratch.x += (Math.random() - 0.5) * magnitude
      rigEyeScratch.y += (Math.random() - 0.5) * magnitude
    }

    if (!cameraInitialized) {
      cameraPosition.copy(rigEyeScratch)
      cameraLookAt.copy(rigLookScratch)
      cameraInitialized = true
    } else {
      dampVector3(cameraPosition, rigEyeScratch, cameraPositionVelocity, VIEW_SMOOTH_TIME, dt)
      dampVector3(cameraLookAt, rigLookScratch, cameraLookAtVelocity, VIEW_SMOOTH_TIME, dt)
    }

    camera.position.copy(cameraPosition)
    camera.up.copy(rigUpScratch)
    camera.lookAt(cameraLookAt)
  }

  function updateDisplay(): void {
    const messageText = currentMessage ? currentMessage.text : null
    const next = { score: game.score, ball: game.ball, message: messageText }
    if (
      !lastDisplay ||
      lastDisplay.score !== next.score ||
      lastDisplay.ball !== next.ball ||
      lastDisplay.message !== next.message
    ) {
      cabinet.setDisplay(next.score, next.ball, next.message)
      lastDisplay = next
    }
  }

  function updateHud(): void {
    if (mode !== 'play') return
    const next: HudSnapshot = {
      phase: game.phase,
      score: game.score,
      ball: game.ball,
      ballsPerGame: game.ballsPerGame,
      bonusMultiplier: game.bonusMultiplier,
      extraBalls: game.extraBalls,
      ballSave: Math.ceil(game.ballSaveTimer),
      multiball: game.multiball,
      tilted: game.tilted,
      ballWaiting: ballAtPlunger(TABLE, state) !== null,
    }
    const prev = lastHud
    if (
      !prev ||
      prev.phase !== next.phase ||
      prev.score !== next.score ||
      prev.ball !== next.ball ||
      prev.ballsPerGame !== next.ballsPerGame ||
      prev.bonusMultiplier !== next.bonusMultiplier ||
      prev.extraBalls !== next.extraBalls ||
      prev.ballSave !== next.ballSave ||
      prev.multiball !== next.multiball ||
      prev.tilted !== next.tilted ||
      prev.ballWaiting !== next.ballWaiting
    ) {
      lastHud = next
      events.onHud(next)
    }
  }

  // --- Resize ------------------------------------------------------------------------------------

  function handleResize(): void {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return
    renderer.setSize(width, height, false)
    composer.setSize(width, height)
    aspect = width / height
    camera.aspect = aspect
    camera.clearViewOffset()
    camera.updateProjectionMatrix()
    refitAllViews()
    applyViewOffset()
  }

  const resizeObserver = new ResizeObserver(() => handleResize())
  resizeObserver.observe(canvas)
  handleResize()

  // --- Visibility: drop accumulated time instead of a catch-up burst -----------------------------

  function handleVisibilityChange(): void {
    const hidden = document.visibilityState === 'hidden'
    if (hidden && !wasHidden) accumulator = 0
    wasHidden = hidden
  }
  document.addEventListener('visibilitychange', handleVisibilityChange)

  // --- Main loop ---------------------------------------------------------------------------------

  let rafId = 0
  let lastFrameTime = 0
  let hasLastFrameTime = false
  let accumulator = 0

  function animate(now: number): void {
    rafId = requestAnimationFrame(animate)
    if (!hasLastFrameTime) {
      hasLastFrameTime = true
      lastFrameTime = now
      return
    }
    const dt = Math.min(MAX_FRAME_SECONDS, (now - lastFrameTime) / 1000)
    lastFrameTime = now

    frameEvents.length = 0
    const hidden = document.visibilityState === 'hidden'
    if (!paused && !hidden) {
      accumulator += dt
      let steps = 0
      while (accumulator >= FIXED_DT && steps < MAX_FIXED_STEPS_PER_FRAME) {
        fixedStep(FIXED_DT)
        accumulator -= FIXED_DT
        steps++
      }
      if (steps === MAX_FIXED_STEPS_PER_FRAME) accumulator = 0
    } else if (hidden) {
      accumulator = 0
    }

    view.update(state, game, frameEvents, paused ? 0 : dt)
    updateCamera(dt)
    updateDisplay()
    updateHud()

    composer.render()
  }
  rafId = requestAnimationFrame(animate)

  // --- Public API --------------------------------------------------------------------------------

  return {
    startGame(): void {
      beginPlay()
    },

    showAttract(): void {
      beginAttract()
    },

    setControl(control: ControlName, pressed: boolean): void {
      input.setControl(control, pressed)
    },

    nudge(direction: 'left' | 'right' | 'up'): void {
      input.nudge(direction)
    },

    setCameraView(nextView: CameraView): void {
      applyCameraView(nextView)
    },

    setViewInsets(next: ViewInsets): void {
      const clean = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0)
      insets = {
        left: clean(next.left),
        top: clean(next.top),
        right: clean(next.right),
        bottom: clean(next.bottom),
      }
      refitAllViews()
      applyViewOffset()
    },

    setPaused(next: boolean): void {
      paused = next
    },

    resize(): void {
      handleResize()
    },

    dispose(): void {
      cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      input.dispose()
      view.dispose()
      cabinet.dispose()
      renderPass.dispose()
      bloomPass.dispose()
      outputPass.dispose()
      composer.dispose()
      environmentTarget.dispose()
      renderer.dispose()
    },
  }
}
