/**
 * Shared types for the table, the physics, and the rules.
 *
 * Table units are inches and seconds. `x` runs left to right across the playfield and `y` runs
 * from the top arch (0) down to the drain (`Table.height`), so gravity pulls toward +y. An angle
 * `t` means the direction `(cos t, sin t)` in these coordinates, so a positive turn is clockwise
 * when the table is seen from above.
 */

export interface Vec2 {
  x: number
  y: number
}

export type Side = 'left' | 'right'

// ---------------------------------------------------------------------------------------------
// Table definition: static data, never mutated while playing.
// ---------------------------------------------------------------------------------------------

/** What a wall is made of. It only changes how the wall is drawn and how it sounds. */
export type WallKind = 'rail' | 'guide' | 'rubber'

/** A solid two-sided line segment. */
export interface Wall {
  id: string
  a: Vec2
  b: Vec2
  /** Share of the normal speed kept after a bounce, 0 to 1. */
  restitution: number
  kind: WallKind
}

/** A fixed round post. */
export interface Post {
  id: string
  pos: Vec2
  radius: number
  restitution: number
}

/**
 * A one-way gate. With `n` the unit normal `(-(b.y - a.y), b.x - a.x) / |b - a|`, the gate is solid
 * to a ball whose centre is on the side `n` points to, and a ball on the other side passes freely.
 */
export interface Gate {
  id: string
  a: Vec2
  b: Vec2
}

/** A pop bumper: a round body that kicks the ball away on contact. */
export interface Bumper {
  id: string
  pos: Vec2
  radius: number
  /** The least speed, along the contact normal, that the ball leaves with. */
  kick: number
}

/**
 * A slingshot: a triangle of rubber whose long face `a`-`b` kicks. The other two faces, `b`-`c`
 * and `c`-`a`, are plain rubber walls. The physics builds all three faces from this definition,
 * so `Table.walls` must not repeat them.
 */
export interface Slingshot {
  id: string
  a: Vec2
  b: Vec2
  c: Vec2
  /** Speed added along the kicking face's outward normal (pointing away from `c`). */
  kick: number
}

/** A standup target: a short solid face that scores when hit. It never moves. */
export interface Standup {
  id: string
  a: Vec2
  b: Vec2
  /** The group it lights with, e.g. 'play'. */
  group: string
}

/** A drop target: solid while up, and it drops out of the way when hit. */
export interface DropTarget {
  id: string
  a: Vec2
  b: Vec2
  bank: string
}

export type RolloverGroup = 'toplane' | 'inlane' | 'outlane'

/** A rollover switch: a sensor that fires once each time a ball rolls onto it. */
export interface Rollover {
  id: string
  pos: Vec2
  radius: number
  group: RolloverGroup
}

/** A spinner: a sensor line the ball passes through, spinning the plate as it goes. */
export interface Spinner {
  id: string
  a: Vec2
  b: Vec2
}

/** A saucer (kick-out hole): it catches a slow enough ball, holds it, then kicks it out. */
export interface Saucer {
  id: string
  pos: Vec2
  radius: number
  /** Seconds the ball is held. */
  hold: number
  /** Velocity the ball leaves with. */
  eject: Vec2
}

/**
 * A ramp: a raised path. A ball crossing `entry` in the direction of the path's first segment
 * leaves the playfield and rides the path, touching nothing else. It slows as it climbs. If it
 * stalls it rolls back out of the entry, and otherwise it drops off the far end.
 */
export interface Ramp {
  id: string
  entry: { a: Vec2; b: Vec2 }
  /** Centre line, from the entry to the exit. `path[0]` is the midpoint of `entry`. */
  path: Vec2[]
  /** Height above the playfield at each `path` point. The first is 0. */
  heights: number[]
}

export interface Flipper {
  id: string
  side: Side
  pivot: Vec2
  length: number
  /** Half the flipper's thickness: it collides as a capsule of this radius. */
  radius: number
  /** Angle when the button is up. */
  restAngle: number
  /** Angle when the button is held. */
  activeAngle: number
}

export interface Plunger {
  /** Where a served ball rests, on top of the plunger. */
  rest: Vec2
  /** A ball is launched only while its centre is inside this box. */
  zone: { min: Vec2; max: Vec2 }
  /** Launch speed for the shortest pull. */
  minSpeed: number
  /** Launch speed for a full pull. */
  maxSpeed: number
}

/**
 * A lamp under the playfield, seen through a coloured window. The rules switch it by `id` through
 * `GameState.lamps`. A rollover, standup or drop target gets a lamp by giving an insert its id.
 */
export interface Insert {
  id: string
  pos: Vec2
  radius: number
  /** CSS hex colour, e.g. '#ff2bd6'. */
  color: string
  shape: 'circle' | 'arrow'
  /** The way an arrow points. Ignored for a circle. */
  angle: number
  /** A short caption printed on the playfield beside the insert, e.g. '2X'. */
  label: string
}

export interface Table {
  width: number
  height: number
  ballRadius: number
  /** Acceleration toward +y from the playfield's slope. */
  gravity: number
  walls: Wall[]
  posts: Post[]
  gates: Gate[]
  bumpers: Bumper[]
  slingshots: Slingshot[]
  standups: Standup[]
  dropTargets: DropTarget[]
  rollovers: Rollover[]
  spinners: Spinner[]
  saucers: Saucer[]
  ramps: Ramp[]
  flippers: Flipper[]
  inserts: Insert[]
  plunger: Plunger
  /** A ball whose centre passes below this `y` has drained. */
  drainY: number
}

// ---------------------------------------------------------------------------------------------
// Physics state: mutated in place by the physics step.
// ---------------------------------------------------------------------------------------------

export interface Ball {
  id: number
  pos: Vec2
  vel: Vec2
  /** Height of the ball's underside above the playfield. 0 except on a ramp. */
  z: number
  /** Set while the ball rides a ramp: `s` is the distance along the path and `v` the speed along it. */
  ramp: { id: string; s: number; v: number } | null
  /** Set while a saucer holds the ball. */
  saucer: { id: string; timer: number } | null
  /** The saucer that last kicked the ball out. It is ignored until the ball has rolled clear of it. */
  ejectedFrom: string | null
  /** Seconds the ball has sat still on the playfield with no flipper held. A long sit gets it kicked free. */
  stillTime: number
}

export interface FlipperState {
  angle: number
  /** Radians per second. 0 while resting against either stop. */
  angularVel: number
}

export interface SpinnerState {
  angle: number
  angularVel: number
}

export interface TableState {
  balls: Ball[]
  nextBallId: number
  /** One per `Table.flippers`, in the same order. */
  flippers: FlipperState[]
  /** When false the flippers ignore the buttons and fall to rest (the machine has tilted). */
  flippersEnabled: boolean
  /** How far the plunger is pulled back, 0 to 1. */
  plungerPull: number
  /** Drop target ids that are down. */
  droppedTargets: string[]
  /** One per `Table.spinners`, in the same order. */
  spinners: SpinnerState[]
  /** `ballId:rolloverId` pairs for balls resting on a rollover, so each pass fires once. */
  rolloverContacts: string[]
  /** Seconds simulated so far. */
  time: number
}

export type NudgeDirection = 'left' | 'right' | 'up'

/** The player's controls for one physics step. */
export interface Input {
  left: boolean
  right: boolean
  /** True while the plunger is being pulled back. Letting go launches the ball. */
  plunger: boolean
  /** Set for exactly one step to shove the table. */
  nudge: NudgeDirection | null
}

export type PhysicsEvent =
  | { type: 'bumper'; id: string; speed: number }
  | { type: 'slingshot'; id: string }
  | { type: 'standup'; id: string }
  | { type: 'drop'; id: string }
  | { type: 'rollover'; id: string }
  /** One per half turn of the plate. */
  | { type: 'spinner'; id: string }
  | { type: 'rampEnter'; id: string }
  /** The ball reached the far end of the ramp. */
  | { type: 'rampMade'; id: string }
  | { type: 'saucerCapture'; id: string }
  | { type: 'saucerEject'; id: string }
  /** The plunger (or an auto-launch) fired a ball up the lane. */
  | { type: 'launch'; speed: number }
  /** A ball passed a one-way gate. */
  | { type: 'gate'; id: string }
  | { type: 'drain'; ballId: number }
  | { type: 'nudge'; direction: NudgeDirection }
  | { type: 'flipperUp'; side: Side }
  | { type: 'flipperDown'; side: Side }
  /** Plain knocks, for sound only. `speed` is the speed into the surface. */
  | { type: 'wallHit'; speed: number; kind: WallKind }
  | { type: 'flipperHit'; speed: number }
  | { type: 'ballHit'; speed: number }

// ---------------------------------------------------------------------------------------------
// Rules state: scoring, lamps, and what the game asks the machine to do.
// ---------------------------------------------------------------------------------------------

export type Phase = 'attract' | 'playing' | 'bonus' | 'gameOver'

export type LampState = 'off' | 'on' | 'blink'

export type SoundName =
  | 'bumper'
  | 'slingshot'
  | 'target'
  | 'dropTarget'
  | 'bankComplete'
  | 'rollover'
  | 'laneComplete'
  | 'spinner'
  | 'rampEnter'
  | 'rampMade'
  | 'saucer'
  | 'eject'
  | 'launch'
  | 'drain'
  | 'ballSaved'
  | 'extraBall'
  | 'multiball'
  | 'jackpot'
  | 'bonusTick'
  | 'tiltWarning'
  | 'tilt'
  | 'gameStart'
  | 'gameOver'

/** Something the rules ask the machine (the engine) to do. */
export type Command =
  /** Put a new ball on the plunger. With `auto` the machine launches it itself. */
  | { type: 'serveBall'; auto: boolean }
  | { type: 'resetDropBank'; bank: string }
  | { type: 'setFlippersEnabled'; enabled: boolean }
  | { type: 'sound'; name: SoundName }
  /** A line for the score display, shown for `seconds`. */
  | { type: 'message'; text: string; seconds: number }
  /** Flash every lamp for a moment. */
  | { type: 'lightShow' }

export interface GameState {
  phase: Phase
  score: number
  /** The ball in play, counting from 1. */
  ball: number
  ballsPerGame: number
  /** Extra balls earned and not yet played. */
  extraBalls: number
  /** Balls on the table, counting one waiting on the plunger. */
  ballsInPlay: number
  /** End-of-ball bonus multiplier, 1 to 5. */
  bonusMultiplier: number
  /** Bonus points banked so far this ball, before the multiplier. */
  bonus: number
  /** Seconds of ball save left. A ball that drains while this is above 0 is served again. */
  ballSaveTimer: number
  /** True from a ball being served until it first hits a scoring switch. */
  ballSaveArmed: boolean
  multiball: boolean
  /** Ramps made toward the next multiball. */
  rampCount: number
  /** Seconds left of the super bumpers, which score ten times as much. */
  superBumperTimer: number
  /** Seconds left of the lit spinner. */
  spinnerLitTimer: number
  /** Seconds left to score a ramp combo. */
  comboTimer: number
  comboCount: number
  extraBallLit: boolean
  /** True once this game's extra ball has been lit, so it is lit only once a game. */
  extraBallAwarded: boolean
  /** Which saucer award comes next. The awards go round in a fixed order. */
  mysteryIndex: number
  /** Rises by 1 with each nudge and drains over time. Crossing the limit costs a tilt warning. */
  tiltMeter: number
  tiltWarnings: number
  tilted: boolean
  /** Seconds left of the end-of-ball bonus count. */
  bonusTimer: number
  /** Lamp state by element id. An id that is missing is off. */
  lamps: Record<string, LampState>
}
