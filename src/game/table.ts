/**
 * The one shipped table: a dense retro-arcade layout, built once from plain data so the physics,
 * the rules and the renderer can all walk the same shapes. See `types.ts` for the coordinate and
 * angle conventions.
 */

import type {
  Bumper,
  DropTarget,
  Flipper,
  Gate,
  Insert,
  Plunger,
  Post,
  Ramp,
  Rollover,
  Saucer,
  Slingshot,
  Spinner,
  Standup,
  Table,
  Vec2,
  Wall,
  WallKind,
} from './types.ts'

// -------------------------------------------------------------------------------------------
// Retro arcade neon palette (see SPEC.md), used to colour the inserts.
// -------------------------------------------------------------------------------------------

const MAGENTA = '#ff2bd6'
const CYAN = '#22e4ff'
const YELLOW = '#ffe14a'
const PURPLE = '#9b5cff'
const ORANGE = '#ff8a1f'
const GREEN = '#3dff8b'

// -------------------------------------------------------------------------------------------
// Table dimensions and defaults.
// -------------------------------------------------------------------------------------------

const WIDTH = 22
const HEIGHT = 42
const BALL_RADIUS = 0.53
const GRAVITY = 45
const DRAIN_Y = 42.8

const RESTITUTION_RAIL = 0.4
const RESTITUTION_GUIDE = 0.45
const RESTITUTION_RUBBER = 0.8

/** X positions of the four top lane guides / rollovers, left to right. */
const TOP_LANE_X = [6.4, 8.8, 11.2, 13.6]

/** Builds consecutive wall segments through `points`, ids `${idPrefix}.0`, `${idPrefix}.1`, ... */
function polyline(idPrefix: string, points: Vec2[], kind: WallKind, restitution: number): Wall[] {
  const segments: Wall[] = []
  for (let i = 0; i < points.length - 1; i++) {
    segments.push({ id: `${idPrefix}.${i}`, a: points[i], b: points[i + 1], kind, restitution })
  }
  return segments
}

/** The direction from `from` to `to`, in the table's angle convention. */
function angleTo(from: Vec2, to: Vec2): number {
  return Math.atan2(to.y - from.y, to.x - from.x)
}

/** The midpoint of a two-point segment, e.g. a standup or drop target face. */
function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** `-PI/2` points up the table, per the angle convention in `types.ts`. */
const UP_THE_TABLE = -Math.PI / 2

// -------------------------------------------------------------------------------------------
// Walls: the arch, rails, guides, and orbit/lane furniture.
// -------------------------------------------------------------------------------------------

const ARCH_CENTRE: Vec2 = { x: 11, y: 11 }
const ARCH_RADIUS = 11
const ARCH_SEGMENTS = 28

/** The top arch, from (0,11) over the top of the table to (22,11), as a chain of rail segments. */
function buildArch(): Wall[] {
  const points: Vec2[] = []
  for (let i = 0; i <= ARCH_SEGMENTS; i++) {
    const t = Math.PI + (i * Math.PI) / ARCH_SEGMENTS
    points.push({ x: ARCH_CENTRE.x + ARCH_RADIUS * Math.cos(t), y: ARCH_CENTRE.y + ARCH_RADIUS * Math.sin(t) })
  }
  return polyline('arch', points, 'rail', RESTITUTION_RAIL)
}

const walls: Wall[] = [
  ...buildArch(),
  { id: 'wall.left', a: { x: 0, y: 11 }, b: { x: 0, y: 42 }, kind: 'rail', restitution: RESTITUTION_RAIL },
  { id: 'wall.right', a: { x: 22, y: 11 }, b: { x: 22, y: 42 }, kind: 'rail', restitution: RESTITUTION_RAIL },
  {
    id: 'wall.divider',
    a: { x: 20.25, y: 11 },
    b: { x: 20.25, y: 42 },
    kind: 'rail',
    restitution: RESTITUTION_RAIL,
  },
  // The served ball rests on this: a soft bounce keeps it from rattling on the stop.
  { id: 'wall.plungerStop', a: { x: 20.25, y: 41 }, b: { x: 22, y: 41 }, kind: 'rail', restitution: 0.2 },
  {
    id: 'guide.orbitLeft',
    a: { x: 2.6, y: 8.5 },
    b: { x: 2.6, y: 17 },
    kind: 'guide',
    restitution: RESTITUTION_GUIDE,
  },
  // Throws a ball coming down the left orbit back into play.
  {
    id: 'wall.kickerLeft',
    a: { x: 0, y: 18.5 },
    b: { x: 1.5, y: 20.2 },
    kind: 'rubber',
    restitution: RESTITUTION_RUBBER,
  },
  {
    id: 'guide.pocketRight',
    a: { x: 17.6, y: 8.5 },
    b: { x: 17.6, y: 13.5 },
    kind: 'guide',
    restitution: RESTITUTION_GUIDE,
  },
  // Balls roll right along it into the saucer.
  {
    id: 'wall.pocketFloor',
    a: { x: 17.0, y: 17.0 },
    b: { x: 20.25, y: 17.8 },
    kind: 'guide',
    restitution: RESTITUTION_GUIDE,
  },
  ...TOP_LANE_X.map(
    (x, i): Wall => ({
      id: `guide.lane.${i}`,
      a: { x, y: 4.2 },
      b: { x, y: 7.0 },
      kind: 'guide',
      restitution: RESTITUTION_GUIDE,
    }),
  ),
  { id: 'cap.dropTop', a: { x: 0, y: 20.6 }, b: { x: 0.45, y: 21.5 }, kind: 'guide', restitution: RESTITUTION_GUIDE },
  {
    id: 'cap.playTop',
    a: { x: 20.25, y: 19.2 },
    b: { x: 19.8, y: 20.0 },
    kind: 'guide',
    restitution: RESTITUTION_GUIDE,
  },
  {
    id: 'ramp.flankL',
    a: { x: 14.1, y: 22.5 },
    b: { x: 14.5, y: 19.5 },
    kind: 'guide',
    restitution: RESTITUTION_GUIDE,
  },
  {
    id: 'ramp.flankR',
    a: { x: 15.9, y: 22.5 },
    b: { x: 16.3, y: 19.5 },
    kind: 'guide',
    restitution: RESTITUTION_GUIDE,
  },
  ...polyline(
    'ramp.roof',
    [
      { x: 14.5, y: 19.5 },
      { x: 15.4, y: 18.9 },
      { x: 16.3, y: 19.5 },
    ],
    'guide',
    RESTITUTION_GUIDE,
  ),
  ...polyline(
    'guide.inlaneL',
    [
      { x: 2.0, y: 28.8 },
      { x: 2.0, y: 33.6 },
      { x: 5.6, y: 36.7 },
    ],
    'guide',
    RESTITUTION_GUIDE,
  ),
  ...polyline(
    'guide.inlaneR',
    [
      { x: 18.0, y: 28.8 },
      { x: 18.0, y: 33.6 },
      { x: 14.4, y: 36.7 },
    ],
    'guide',
    RESTITUTION_GUIDE,
  ),
]

// -------------------------------------------------------------------------------------------
// Posts: rubber, restitution 0.8 throughout.
// -------------------------------------------------------------------------------------------

const posts: Post[] = [
  ...TOP_LANE_X.flatMap(
    (x, i): Post[] => [
      { id: `post.lane.${i}.top`, pos: { x, y: 4.2 }, radius: 0.25, restitution: RESTITUTION_RUBBER },
      { id: `post.lane.${i}.bottom`, pos: { x, y: 7.0 }, radius: 0.25, restitution: RESTITUTION_RUBBER },
    ],
  ),
  { id: 'post.orbitLeft.top', pos: { x: 2.6, y: 8.5 }, radius: 0.3, restitution: RESTITUTION_RUBBER },
  { id: 'post.orbitLeft.bottom', pos: { x: 2.6, y: 17 }, radius: 0.3, restitution: RESTITUTION_RUBBER },
  { id: 'post.pocketRight.top', pos: { x: 17.6, y: 8.5 }, radius: 0.3, restitution: RESTITUTION_RUBBER },
  { id: 'post.pocketRight.bottom', pos: { x: 17.6, y: 13.5 }, radius: 0.3, restitution: RESTITUTION_RUBBER },
  { id: 'post.pocketFloor', pos: { x: 17.0, y: 17.0 }, radius: 0.3, restitution: RESTITUTION_RUBBER },
  { id: 'post.inlaneL', pos: { x: 2.0, y: 28.8 }, radius: 0.3, restitution: RESTITUTION_RUBBER },
  { id: 'post.inlaneR', pos: { x: 18.0, y: 28.8 }, radius: 0.3, restitution: RESTITUTION_RUBBER },
  { id: 'post.kickerLeft', pos: { x: 1.5, y: 20.2 }, radius: 0.3, restitution: RESTITUTION_RUBBER },
  { id: 'post.mid.left', pos: { x: 7.2, y: 19.6 }, radius: 0.45, restitution: RESTITUTION_RUBBER },
  { id: 'post.mid.right', pos: { x: 12.4, y: 19.8 }, radius: 0.45, restitution: RESTITUTION_RUBBER },
  { id: 'post.sling.left.a', pos: { x: 3.9, y: 28.6 }, radius: 0.35, restitution: RESTITUTION_RUBBER },
  { id: 'post.sling.left.b', pos: { x: 5.6, y: 34.2 }, radius: 0.35, restitution: RESTITUTION_RUBBER },
  { id: 'post.sling.left.c', pos: { x: 3.9, y: 33.2 }, radius: 0.35, restitution: RESTITUTION_RUBBER },
  { id: 'post.sling.right.a', pos: { x: 16.1, y: 28.6 }, radius: 0.35, restitution: RESTITUTION_RUBBER },
  { id: 'post.sling.right.b', pos: { x: 14.4, y: 34.2 }, radius: 0.35, restitution: RESTITUTION_RUBBER },
  { id: 'post.sling.right.c', pos: { x: 16.1, y: 33.2 }, radius: 0.35, restitution: RESTITUTION_RUBBER },
]

// -------------------------------------------------------------------------------------------
// Gate: solid to a ball leaving the playfield toward the shooter lane, open the other way.
// -------------------------------------------------------------------------------------------

const gates: Gate[] = [{ id: 'gate.lane', a: { x: 20.25, y: 5.05 }, b: { x: 20.25, y: 11 } }]

// -------------------------------------------------------------------------------------------
// Bumpers and slingshots.
// -------------------------------------------------------------------------------------------

const BUMPER_RADIUS = 1.35
const BUMPER_KICK = 42

const bumpers: Bumper[] = [
  { id: 'bumper.left', pos: { x: 6.8, y: 11.5 }, radius: BUMPER_RADIUS, kick: BUMPER_KICK },
  { id: 'bumper.right', pos: { x: 13.2, y: 11.5 }, radius: BUMPER_RADIUS, kick: BUMPER_KICK },
  { id: 'bumper.low', pos: { x: 10, y: 15.2 }, radius: BUMPER_RADIUS, kick: BUMPER_KICK },
]

const SLINGSHOT_KICK = 30

const slingshots: Slingshot[] = [
  {
    id: 'sling.left',
    a: { x: 3.9, y: 28.6 },
    b: { x: 5.6, y: 34.2 },
    c: { x: 3.9, y: 33.2 },
    kick: SLINGSHOT_KICK,
  },
  {
    id: 'sling.right',
    a: { x: 16.1, y: 28.6 },
    b: { x: 14.4, y: 34.2 },
    c: { x: 16.1, y: 33.2 },
    kick: SLINGSHOT_KICK,
  },
]

// -------------------------------------------------------------------------------------------
// Targets: the left drop bank and the right PLAY standup bank.
// -------------------------------------------------------------------------------------------

const DROP_BANK_LEFT = 'left'
const STANDUP_GROUP_PLAY = 'play'

const dropTargets: DropTarget[] = [
  { id: 'drop.1', a: { x: 0.45, y: 21.5 }, b: { x: 0.45, y: 22.8 }, bank: DROP_BANK_LEFT },
  { id: 'drop.2', a: { x: 0.45, y: 22.95 }, b: { x: 0.45, y: 24.25 }, bank: DROP_BANK_LEFT },
  { id: 'drop.3', a: { x: 0.45, y: 24.4 }, b: { x: 0.45, y: 25.7 }, bank: DROP_BANK_LEFT },
]

const standups: Standup[] = [
  { id: 'play.p', a: { x: 19.8, y: 20.0 }, b: { x: 19.8, y: 21.1 }, group: STANDUP_GROUP_PLAY },
  { id: 'play.l', a: { x: 19.8, y: 21.3 }, b: { x: 19.8, y: 22.4 }, group: STANDUP_GROUP_PLAY },
  { id: 'play.a', a: { x: 19.8, y: 22.6 }, b: { x: 19.8, y: 23.7 }, group: STANDUP_GROUP_PLAY },
  { id: 'play.y', a: { x: 19.8, y: 23.9 }, b: { x: 19.8, y: 25.0 }, group: STANDUP_GROUP_PLAY },
]

// -------------------------------------------------------------------------------------------
// Rollovers.
// -------------------------------------------------------------------------------------------

const ROLLOVER_RADIUS = 0.6

const rollovers: Rollover[] = [
  { id: 'lane.a', pos: { x: 7.6, y: 5.6 }, radius: ROLLOVER_RADIUS, group: 'toplane' },
  { id: 'lane.b', pos: { x: 10, y: 5.6 }, radius: ROLLOVER_RADIUS, group: 'toplane' },
  { id: 'lane.c', pos: { x: 12.4, y: 5.6 }, radius: ROLLOVER_RADIUS, group: 'toplane' },
  { id: 'inlane.left', pos: { x: 2.95, y: 31 }, radius: ROLLOVER_RADIUS, group: 'inlane' },
  { id: 'inlane.right', pos: { x: 17.05, y: 31 }, radius: ROLLOVER_RADIUS, group: 'inlane' },
  { id: 'outlane.left', pos: { x: 1.0, y: 31.5 }, radius: ROLLOVER_RADIUS, group: 'outlane' },
  { id: 'outlane.right', pos: { x: 19.1, y: 31.5 }, radius: ROLLOVER_RADIUS, group: 'outlane' },
]

// -------------------------------------------------------------------------------------------
// Spinner, saucer, ramp.
// -------------------------------------------------------------------------------------------

const spinners: Spinner[] = [{ id: 'spinner.left', a: { x: 0.15, y: 14 }, b: { x: 2.45, y: 14 } }]

const saucers: Saucer[] = [
  { id: 'saucer.right', pos: { x: 19.5, y: 17.0 }, radius: 0.9, hold: 1.2, eject: { x: -32, y: -14 } },
]

const RAMP_ENTRY = { a: { x: 14.1, y: 22.5 }, b: { x: 15.9, y: 22.5 } }

/** Centre line of the main ramp, from its entry midpoint to where it drops over the left inlane. */
const RAMP_PATH: Vec2[] = [
  { x: 15.0, y: 22.5 },
  { x: 15.6, y: 19.0 },
  { x: 16.2, y: 15.5 },
  { x: 16.0, y: 11.0 },
  { x: 14.5, y: 8.6 },
  { x: 10.0, y: 8.0 },
  { x: 5.5, y: 8.6 },
  { x: 3.9, y: 11.0 },
  { x: 3.6, y: 16.0 },
  { x: 3.0, y: 24.0 },
  { x: 2.95, y: 28.5 },
  { x: 2.95, y: 30.0 },
]

const RAMP_HEIGHTS = [0, 1.4, 3.0, 2.9, 2.8, 2.65, 2.5, 2.3, 2.0, 1.5, 0.8, 0]

const ramps: Ramp[] = [{ id: 'ramp.main', entry: RAMP_ENTRY, path: RAMP_PATH, heights: RAMP_HEIGHTS }]

// -------------------------------------------------------------------------------------------
// Flippers and plunger.
// -------------------------------------------------------------------------------------------

const FLIPPER_LENGTH = 3.1
const FLIPPER_RADIUS = 0.4
const FLIPPER_SWING = 0.52

const flippers: Flipper[] = [
  {
    id: 'flipper.left',
    side: 'left',
    pivot: { x: 6.0, y: 37.2 },
    length: FLIPPER_LENGTH,
    radius: FLIPPER_RADIUS,
    restAngle: FLIPPER_SWING,
    activeAngle: -FLIPPER_SWING,
  },
  {
    id: 'flipper.right',
    side: 'right',
    pivot: { x: 14.0, y: 37.2 },
    length: FLIPPER_LENGTH,
    radius: FLIPPER_RADIUS,
    restAngle: Math.PI - FLIPPER_SWING,
    activeAngle: Math.PI + FLIPPER_SWING,
  },
]

const plunger: Plunger = {
  // Resting on `wall.plungerStop` (y = 41): a ball served any higher drops and bounces first.
  rest: { x: 21.125, y: 41 - BALL_RADIUS },
  zone: { min: { x: 20.3, y: 38.5 }, max: { x: 21.95, y: 41 } },
  minSpeed: 45,
  maxSpeed: 112,
}

// -------------------------------------------------------------------------------------------
// Inserts: one per switch that lights (matching its id), plus the standalone award lamps.
// -------------------------------------------------------------------------------------------

const inserts: Insert[] = [
  // Top lane rollovers spell A-R-C when all three are lit.
  { id: 'lane.a', pos: { x: 7.6, y: 5.6 }, radius: 0.5, color: YELLOW, shape: 'circle', angle: 0, label: 'A' },
  { id: 'lane.b', pos: { x: 10, y: 5.6 }, radius: 0.5, color: YELLOW, shape: 'circle', angle: 0, label: 'R' },
  { id: 'lane.c', pos: { x: 12.4, y: 5.6 }, radius: 0.5, color: YELLOW, shape: 'circle', angle: 0, label: 'C' },
  { id: 'inlane.left', pos: { x: 2.95, y: 31 }, radius: 0.5, color: CYAN, shape: 'circle', angle: 0, label: '' },
  { id: 'inlane.right', pos: { x: 17.05, y: 31 }, radius: 0.5, color: CYAN, shape: 'circle', angle: 0, label: '' },
  { id: 'outlane.left', pos: { x: 1.0, y: 31.5 }, radius: 0.5, color: ORANGE, shape: 'circle', angle: 0, label: '' },
  {
    id: 'outlane.right',
    pos: { x: 19.1, y: 31.5 },
    radius: 0.5,
    color: ORANGE,
    shape: 'circle',
    angle: 0,
    label: '',
  },
  // Drop bank, one insert beside each target at its mid height.
  {
    id: 'drop.1',
    pos: { x: 1.7, y: midpoint(dropTargets[0].a, dropTargets[0].b).y },
    radius: 0.45,
    color: MAGENTA,
    shape: 'circle',
    angle: 0,
    label: '1',
  },
  {
    id: 'drop.2',
    pos: { x: 1.7, y: midpoint(dropTargets[1].a, dropTargets[1].b).y },
    radius: 0.45,
    color: MAGENTA,
    shape: 'circle',
    angle: 0,
    label: '2',
  },
  {
    id: 'drop.3',
    pos: { x: 1.7, y: midpoint(dropTargets[2].a, dropTargets[2].b).y },
    radius: 0.45,
    color: MAGENTA,
    shape: 'circle',
    angle: 0,
    label: '3',
  },
  // PLAY standup bank, one insert beside each target at its mid height.
  {
    id: 'play.p',
    pos: { x: 18.6, y: midpoint(standups[0].a, standups[0].b).y },
    radius: 0.45,
    color: CYAN,
    shape: 'circle',
    angle: 0,
    label: 'P',
  },
  {
    id: 'play.l',
    pos: { x: 18.6, y: midpoint(standups[1].a, standups[1].b).y },
    radius: 0.45,
    color: CYAN,
    shape: 'circle',
    angle: 0,
    label: 'L',
  },
  {
    id: 'play.a',
    pos: { x: 18.6, y: midpoint(standups[2].a, standups[2].b).y },
    radius: 0.45,
    color: CYAN,
    shape: 'circle',
    angle: 0,
    label: 'A',
  },
  {
    id: 'play.y',
    pos: { x: 18.6, y: midpoint(standups[3].a, standups[3].b).y },
    radius: 0.45,
    color: CYAN,
    shape: 'circle',
    angle: 0,
    label: 'Y',
  },
  // Bonus multiplier lamps.
  { id: 'lamp.2x', pos: { x: 7.6, y: 33 }, radius: 0.5, color: GREEN, shape: 'circle', angle: 0, label: '2X' },
  { id: 'lamp.3x', pos: { x: 9.2, y: 33 }, radius: 0.5, color: GREEN, shape: 'circle', angle: 0, label: '3X' },
  { id: 'lamp.4x', pos: { x: 10.8, y: 33 }, radius: 0.5, color: GREEN, shape: 'circle', angle: 0, label: '4X' },
  { id: 'lamp.5x', pos: { x: 12.4, y: 33 }, radius: 0.5, color: GREEN, shape: 'circle', angle: 0, label: '5X' },
  {
    id: 'lamp.shootAgain',
    pos: { x: 10, y: 40.0 },
    radius: 0.6,
    color: ORANGE,
    shape: 'circle',
    angle: 0,
    label: 'SHOOT AGAIN',
  },
  {
    id: 'lamp.extraBall',
    pos: { x: 18.2, y: 15.4 },
    radius: 0.55,
    color: ORANGE,
    shape: 'arrow',
    angle: angleTo({ x: 18.2, y: 15.4 }, saucers[0].pos),
    label: 'EXTRA BALL',
  },
  {
    id: 'lamp.ramp1',
    pos: { x: 13.7, y: 27.6 },
    radius: 0.5,
    color: PURPLE,
    shape: 'arrow',
    angle: angleTo({ x: 13.7, y: 27.6 }, RAMP_PATH[0]),
    label: '1',
  },
  {
    id: 'lamp.ramp2',
    pos: { x: 14.05, y: 26.2 },
    radius: 0.5,
    color: PURPLE,
    shape: 'arrow',
    angle: angleTo({ x: 14.05, y: 26.2 }, RAMP_PATH[0]),
    label: '2',
  },
  {
    id: 'lamp.ramp3',
    pos: { x: 14.4, y: 24.8 },
    radius: 0.5,
    color: PURPLE,
    shape: 'arrow',
    angle: angleTo({ x: 14.4, y: 24.8 }, RAMP_PATH[0]),
    label: '3',
  },
  {
    id: 'lamp.jackpot',
    pos: { x: 14.7, y: 23.6 },
    radius: 0.55,
    color: MAGENTA,
    shape: 'arrow',
    angle: angleTo({ x: 14.7, y: 23.6 }, RAMP_PATH[0]),
    label: 'JACKPOT',
  },
  {
    id: 'lamp.spinner',
    pos: { x: 2.2, y: 21.6 },
    radius: 0.5,
    color: YELLOW,
    shape: 'arrow',
    angle: UP_THE_TABLE,
    label: 'SPIN',
  },
  // Between the bumpers.
  { id: 'lamp.super', pos: { x: 10, y: 12.2 }, radius: 0.55, color: MAGENTA, shape: 'circle', angle: 0, label: 'SUPER' },
]

/** The one shipped table: a dense retro-arcade layout, in inches. */
export const TABLE: Table = {
  width: WIDTH,
  height: HEIGHT,
  ballRadius: BALL_RADIUS,
  gravity: GRAVITY,
  walls,
  posts,
  gates,
  bumpers,
  slingshots,
  standups,
  dropTargets,
  rollovers,
  spinners,
  saucers,
  ramps,
  flippers,
  inserts,
  plunger,
  drainY: DRAIN_Y,
}

// -------------------------------------------------------------------------------------------
// Validation.
// -------------------------------------------------------------------------------------------

/** Every problem found in a table, as readable sentences. Empty when the table is sound. */
export function validateTable(table: Table): string[] {
  const problems: string[] = []

  const claimedIds = new Set<string>()
  function claimId(id: string): void {
    if (claimedIds.has(id)) problems.push(`duplicate id '${id}'`)
    claimedIds.add(id)
  }

  function checkPoint(id: string, label: string, p: Vec2, requireInBounds: boolean): void {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      problems.push(`${id}: ${label} (${p.x}, ${p.y}) is not finite`)
      return
    }
    if (requireInBounds && (p.x < 0 || p.x > table.width || p.y < 0 || p.y > table.height)) {
      problems.push(
        `${id}: ${label} (${p.x}, ${p.y}) is outside the table bounds [0, ${table.width}] x [0, ${table.height}]`,
      )
    }
  }

  function checkPositive(id: string, label: string, value: number): void {
    if (!(value > 0)) problems.push(`${id}: ${label} must be positive, got ${value}`)
  }

  function checkRestitution(id: string, restitution: number): void {
    if (!(restitution >= 0 && restitution <= 1)) {
      problems.push(`${id}: restitution ${restitution} is outside [0, 1]`)
    }
  }

  function checkSegment(id: string, label: string, a: Vec2, b: Vec2): void {
    if (Math.hypot(b.x - a.x, b.y - a.y) <= 1e-9) {
      problems.push(`${id}: ${label} has zero length`)
    }
  }

  for (const w of table.walls) {
    claimId(w.id)
    checkPoint(w.id, 'a', w.a, true)
    checkPoint(w.id, 'b', w.b, true)
    checkSegment(w.id, 'wall', w.a, w.b)
    checkRestitution(w.id, w.restitution)
  }

  for (const p of table.posts) {
    claimId(p.id)
    checkPoint(p.id, 'pos', p.pos, true)
    checkPositive(p.id, 'radius', p.radius)
    checkRestitution(p.id, p.restitution)
  }

  for (const g of table.gates) {
    claimId(g.id)
    checkPoint(g.id, 'a', g.a, true)
    checkPoint(g.id, 'b', g.b, true)
    checkSegment(g.id, 'gate', g.a, g.b)
  }

  for (const b of table.bumpers) {
    claimId(b.id)
    checkPoint(b.id, 'pos', b.pos, true)
    checkPositive(b.id, 'radius', b.radius)
    checkPositive(b.id, 'kick', b.kick)
  }

  for (const s of table.slingshots) {
    claimId(s.id)
    checkPoint(s.id, 'a', s.a, true)
    checkPoint(s.id, 'b', s.b, true)
    checkPoint(s.id, 'c', s.c, true)
    checkSegment(s.id, 'a-b face', s.a, s.b)
    checkSegment(s.id, 'b-c face', s.b, s.c)
    checkSegment(s.id, 'c-a face', s.c, s.a)
    checkPositive(s.id, 'kick', s.kick)
  }

  for (const s of table.standups) {
    claimId(s.id)
    checkPoint(s.id, 'a', s.a, true)
    checkPoint(s.id, 'b', s.b, true)
    checkSegment(s.id, 'standup', s.a, s.b)
  }

  for (const d of table.dropTargets) {
    claimId(d.id)
    checkPoint(d.id, 'a', d.a, true)
    checkPoint(d.id, 'b', d.b, true)
    checkSegment(d.id, 'drop target', d.a, d.b)
  }

  for (const r of table.rollovers) {
    claimId(r.id)
    checkPoint(r.id, 'pos', r.pos, true)
    checkPositive(r.id, 'radius', r.radius)
  }

  for (const s of table.spinners) {
    claimId(s.id)
    checkPoint(s.id, 'a', s.a, true)
    checkPoint(s.id, 'b', s.b, true)
    checkSegment(s.id, 'spinner', s.a, s.b)
  }

  for (const s of table.saucers) {
    claimId(s.id)
    checkPoint(s.id, 'pos', s.pos, true)
    checkPositive(s.id, 'radius', s.radius)
    checkPositive(s.id, 'hold', s.hold)
    // The eject vector is a velocity, not a position: only finiteness makes sense here.
    checkPoint(s.id, 'eject', s.eject, false)
  }

  for (const r of table.ramps) {
    claimId(r.id)
    checkPoint(r.id, 'entry.a', r.entry.a, true)
    checkPoint(r.id, 'entry.b', r.entry.b, true)
    r.path.forEach((p, i) => checkPoint(r.id, `path[${i}]`, p, true))

    if (r.path.length !== r.heights.length || r.path.length < 2) {
      problems.push(
        `${r.id}: path has ${r.path.length} point(s) but heights has ${r.heights.length}; ` +
          'both must be equal and at least 2',
      )
    } else {
      if (r.heights[0] !== 0) problems.push(`${r.id}: first height must be 0, got ${r.heights[0]}`)
      const lastHeight = r.heights[r.heights.length - 1]
      if (lastHeight !== 0) problems.push(`${r.id}: last height must be 0, got ${lastHeight}`)

      const entryMid = midpoint(r.entry.a, r.entry.b)
      const first = r.path[0]
      if (Math.hypot(first.x - entryMid.x, first.y - entryMid.y) > 1e-6) {
        problems.push(
          `${r.id}: path[0] (${first.x}, ${first.y}) must be the entry midpoint (${entryMid.x}, ${entryMid.y})`,
        )
      }
    }
  }

  let leftFlippers = 0
  let rightFlippers = 0
  for (const f of table.flippers) {
    claimId(f.id)
    checkPoint(f.id, 'pivot', f.pivot, true)
    checkPositive(f.id, 'length', f.length)
    checkPositive(f.id, 'radius', f.radius)
    if (f.side === 'left') leftFlippers++
    else rightFlippers++
  }
  if (leftFlippers !== 1) problems.push(`expected exactly one left flipper, found ${leftFlippers}`)
  if (rightFlippers !== 1) problems.push(`expected exactly one right flipper, found ${rightFlippers}`)

  checkPoint('plunger', 'rest', table.plunger.rest, true)
  checkPoint('plunger', 'zone.min', table.plunger.zone.min, true)
  checkPoint('plunger', 'zone.max', table.plunger.zone.max, true)
  checkPositive('plunger', 'minSpeed', table.plunger.minSpeed)
  checkPositive('plunger', 'maxSpeed', table.plunger.maxSpeed)
  {
    const { rest, zone } = table.plunger
    if (rest.x < zone.min.x || rest.x > zone.max.x || rest.y < zone.min.y || rest.y > zone.max.y) {
      problems.push(`plunger: rest (${rest.x}, ${rest.y}) must be inside its zone`)
    }
  }

  const insertIds = new Set<string>()
  for (const i of table.inserts) {
    if (insertIds.has(i.id)) problems.push(`duplicate insert id '${i.id}'`)
    insertIds.add(i.id)
    checkPoint(i.id, 'pos', i.pos, true)
    checkPositive(i.id, 'radius', i.radius)
  }

  for (const r of table.rollovers) {
    if (!insertIds.has(r.id)) problems.push(`rollover '${r.id}' has no matching insert`)
  }
  for (const s of table.standups) {
    if (!insertIds.has(s.id)) problems.push(`standup '${s.id}' has no matching insert`)
  }
  for (const d of table.dropTargets) {
    if (!insertIds.has(d.id)) problems.push(`drop target '${d.id}' has no matching insert`)
  }

  return problems
}
