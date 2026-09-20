/**
 * The pinball physics simulation: pure, deterministic (no `Math.random`, no `Date`) and mutates
 * `TableState` in place. `stepTable` is the only entry point that advances time; everything else
 * here is a helper it (or the engine, for setup and one-off commands) calls.
 */

import type {
  Ball,
  Bumper,
  Flipper,
  FlipperState,
  Gate,
  Input,
  PhysicsEvent,
  Ramp,
  Saucer,
  Slingshot,
  Table,
  TableState,
  Vec2,
} from './types.ts'

/** The engine always steps the simulation with this timestep, in seconds. */
export const FIXED_DT = 1 / 480

/** No ball is ever allowed to move faster than this, in inches per second. */
export const MAX_BALL_SPEED = 150

/** Speed an auto-launch (ball save, multiball serve) fires the ball at. */
export const AUTO_LAUNCH_SPEED = 100

/** How fast a flipper swings toward its active angle while its button is held, in rad/s. */
const FLIPPER_UP_SPEED = 30

/** How fast a flipper falls back to rest once its button is released, in rad/s. */
const FLIPPER_DOWN_SPEED = 18

/** Seconds of a full plunger pull, from empty to `plungerPull === 1`. */
const PLUNGER_PULL_SECONDS = 0.9

/** Rolling drag applied to a playfield ball each second, as a fraction of its speed. */
const ROLL_DRAG = 0.03

/** Friction: fraction of the tangential relative speed kept after any bounce. */
const SURFACE_FRICTION = 0.985

/** Restitution used for every ball-to-ball collision. */
const BALL_RESTITUTION = 0.9

/** Speed below which a playfield ball counts as "still" for the rescue timer. */
const STILL_SPEED = 1.5

/** Seconds a still ball is left alone before the rescue kicks it free. */
const STILL_RESCUE_SECONDS = 4

/** How far outside the table rectangle a ball must stray to be treated as escaped (safety net). */
const ESCAPE_MARGIN = 5

const ZERO: Vec2 = { x: 0, y: 0 }

// -------------------------------------------------------------------------------------------
// Small vector and geometry helpers.
// -------------------------------------------------------------------------------------------

function vAdd(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

function vSub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

function vScale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s }
}

function vDot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y
}

function vLen(a: Vec2): number {
  return Math.hypot(a.x, a.y)
}

function clampNum(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi)
}

function clampSpeed(ball: Ball, max: number): void {
  const speed = vLen(ball.vel)
  if (speed > max) ball.vel = vScale(ball.vel, max / speed)
}

/** Unit normal 90 degrees left of `a -> b` (the gate's normal convention from `types.ts`). */
function leftNormal(a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return { x: 0, y: -1 }
  return { x: -dy / len, y: dx / len }
}

/** Closest point on segment `a`-`b` to `p`, with its position `t` along the segment (0..1). */
function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): { q: Vec2; t: number } {
  const ab = vSub(b, a)
  const abLenSq = vDot(ab, ab)
  const raw = abLenSq > 1e-12 ? vDot(vSub(p, a), ab) / abLenSq : 0
  const t = clampNum(raw, 0, 1)
  return { q: vAdd(a, vScale(ab, t)), t }
}

/** True proper-intersection test between segments `p1`-`p2` and `q1`-`q2`. */
function segmentsIntersect(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const d1 = cross(q1, q2, p1)
  const d2 = cross(q1, q2, p2)
  const d3 = cross(p1, p2, q1)
  const d4 = cross(p1, p2, q2)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

function inPlungerZone(table: Table, pos: Vec2): boolean {
  const z = table.plunger.zone
  return pos.x >= z.min.x && pos.x <= z.max.x && pos.y >= z.min.y && pos.y <= z.max.y
}

// -------------------------------------------------------------------------------------------
// State setup.
// -------------------------------------------------------------------------------------------

/** A fresh `TableState` for `table`: no balls, every flipper at rest, nothing dropped. */
export function createTableState(table: Table): TableState {
  return {
    balls: [],
    nextBallId: 1,
    flippers: table.flippers.map((f) => ({ angle: f.restAngle, angularVel: 0 })),
    flippersEnabled: true,
    plungerPull: 0,
    droppedTargets: [],
    spinners: table.spinners.map(() => ({ angle: 0, angularVel: 0 })),
    rolloverContacts: [],
    time: 0,
  }
}

/** Adds a new ball to `state` at `pos` (velocity defaults to zero) and returns it. */
export function addBall(state: TableState, pos: Vec2, vel: Vec2 = ZERO): Ball {
  const ball: Ball = {
    id: state.nextBallId++,
    pos: { x: pos.x, y: pos.y },
    vel: { x: vel.x, y: vel.y },
    z: 0,
    ramp: null,
    saucer: null,
    ejectedFrom: null,
    stillTime: 0,
  }
  state.balls.push(ball)
  return ball
}

/** The playfield ball currently sitting inside the plunger's zone, if any. */
export function ballAtPlunger(table: Table, state: TableState): Ball | null {
  for (const ball of state.balls) {
    if (ball.ramp || ball.saucer) continue
    if (inPlungerZone(table, ball.pos)) return ball
  }
  return null
}

/** Fires the ball waiting on the plunger at `AUTO_LAUNCH_SPEED`. False when no ball is waiting. */
export function autoLaunch(table: Table, state: TableState, events: PhysicsEvent[]): boolean {
  const ball = ballAtPlunger(table, state)
  if (!ball) return false
  ball.vel = { x: 0, y: -AUTO_LAUNCH_SPEED }
  events.push({ type: 'launch', speed: AUTO_LAUNCH_SPEED })
  return true
}

/** Raises every drop target of `bank` back up. */
export function resetDropBank(table: Table, state: TableState, bank: string): void {
  const bankIds = new Set(table.dropTargets.filter((d) => d.bank === bank).map((d) => d.id))
  state.droppedTargets = state.droppedTargets.filter((id) => !bankIds.has(id))
}

/** The flipper's tip, at `angle`: `pivot + length * (cos angle, sin angle)`. */
export function flipperTip(flipper: Flipper, angle: number): Vec2 {
  return {
    x: flipper.pivot.x + flipper.length * Math.cos(angle),
    y: flipper.pivot.y + flipper.length * Math.sin(angle),
  }
}

/** Total length of a ramp's centre line. */
export function rampLength(ramp: Ramp): number {
  let total = 0
  for (let i = 1; i < ramp.path.length; i++) total += vLen(vSub(ramp.path[i], ramp.path[i - 1]))
  return total
}

/** Which path segment holds distance `s`, and how far along it (0..1), clamped to the path's ends. */
function rampSegment(ramp: Ramp, s: number): { i0: number; i1: number; segLen: number; localT: number } {
  const clampedLow = Math.max(s, 0)
  let acc = 0
  for (let i = 1; i < ramp.path.length; i++) {
    const segLen = vLen(vSub(ramp.path[i], ramp.path[i - 1]))
    const isLast = i === ramp.path.length - 1
    if (clampedLow <= acc + segLen || isLast) {
      const localT = segLen > 1e-9 ? clampNum((clampedLow - acc) / segLen, 0, 1) : 0
      return { i0: i - 1, i1: i, segLen, localT }
    }
    acc += segLen
  }
  return { i0: 0, i1: Math.max(0, ramp.path.length - 1), segLen: 0, localT: 0 }
}

/** Position, height and unit tangent at distance `s` along a ramp, clamped to its ends. */
export function rampPoint(ramp: Ramp, s: number): { pos: Vec2; z: number; tangent: Vec2 } {
  const { i0, i1, segLen, localT } = rampSegment(ramp, s)
  const p0 = ramp.path[i0]
  const p1 = ramp.path[i1]
  const z0 = ramp.heights[i0]
  const z1 = ramp.heights[i1]
  const pos = vAdd(p0, vScale(vSub(p1, p0), localT))
  const z = z0 + (z1 - z0) * localT
  const tangent = segLen > 1e-9 ? vScale(vSub(p1, p0), 1 / segLen) : { x: 1, y: 0 }
  return { pos, z, tangent }
}

// -------------------------------------------------------------------------------------------
// Collision primitive: a ball against a segment (or, with a=b, a circle) of thickness `R`.
// -------------------------------------------------------------------------------------------

/** Result of a contact: `impact` is the speed into the surface (0 when no bounce happened). */
interface ContactResult {
  impact: number
  t: number
}

/**
 * Resolves `ball` against segment `a`-`b` thickened by `R` (0 for walls/targets, a flipper's
 * radius for flippers). Pushes the ball out to exactly `ballRadius + R`, reflects the closing
 * velocity relative to `surfaceVel` by restitution `e`, and applies friction to the tangential
 * part. Returns `null` when the ball isn't touching the segment at all.
 */
function resolveSegment(
  ball: Ball,
  a: Vec2,
  b: Vec2,
  R: number,
  e: number,
  ballRadius: number,
  surfaceVel: Vec2,
): ContactResult | null {
  const { q, t } = closestPointOnSegment(ball.pos, a, b)
  const diff = vSub(ball.pos, q)
  const d = vLen(diff)
  const minDist = ballRadius + R
  if (d >= minDist) return null

  const n = d < 1e-9 ? leftNormal(a, b) : vScale(diff, 1 / d)
  ball.pos = vAdd(q, vScale(n, minDist))

  const relVel = vSub(ball.vel, surfaceVel)
  const vn = vDot(relVel, n)
  if (vn >= 0) return { impact: 0, t }

  const impact = -vn
  ball.vel = vSub(ball.vel, vScale(n, (1 + e) * vn))
  const relVel2 = vSub(ball.vel, surfaceVel)
  const normalComp = vScale(n, vDot(relVel2, n))
  const tangentComp = vSub(relVel2, normalComp)
  ball.vel = vAdd(surfaceVel, vAdd(normalComp, vScale(tangentComp, SURFACE_FRICTION)))
  return { impact, t }
}

// -------------------------------------------------------------------------------------------
// Per-element handlers used inside the playfield ball step.
// -------------------------------------------------------------------------------------------

function resolveWalls(table: Table, ball: Ball, events: PhysicsEvent[]): void {
  for (const wall of table.walls) {
    const hit = resolveSegment(ball, wall.a, wall.b, 0, wall.restitution, table.ballRadius, ZERO)
    if (hit && hit.impact > 6) events.push({ type: 'wallHit', speed: hit.impact, kind: wall.kind })
  }
}

/** The face's outward normal: whichever of `leftNormal(a,b)`/its negation points away from `opposite`. */
function outwardNormal(a: Vec2, b: Vec2, opposite: Vec2): Vec2 {
  const n = leftNormal(a, b)
  return vDot(n, vSub(opposite, a)) > 0 ? vScale(n, -1) : n
}

function resolveSlingshots(table: Table, ball: Ball, events: PhysicsEvent[]): void {
  for (const sl of table.slingshots) {
    resolveSlingshotFace(ball, sl, sl.a, sl.b, sl.c, true, table.ballRadius, events)
    resolveSlingshotFace(ball, sl, sl.b, sl.c, sl.a, false, table.ballRadius, events)
    resolveSlingshotFace(ball, sl, sl.c, sl.a, sl.b, false, table.ballRadius, events)
  }
}

function resolveSlingshotFace(
  ball: Ball,
  sl: Slingshot,
  p1: Vec2,
  p2: Vec2,
  opposite: Vec2,
  isKickFace: boolean,
  ballRadius: number,
  events: PhysicsEvent[],
): void {
  const hit = resolveSegment(ball, p1, p2, 0, 0.8, ballRadius, ZERO)
  if (!hit) return
  if (isKickFace && hit.impact > 8 && hit.t >= 0.12 && hit.t <= 0.88) {
    const outward = outwardNormal(p1, p2, opposite)
    ball.vel = vAdd(ball.vel, vScale(outward, sl.kick))
    events.push({ type: 'slingshot', id: sl.id })
  } else if (hit.impact > 6) {
    events.push({ type: 'wallHit', speed: hit.impact, kind: 'rubber' })
  }
}

function resolveStandups(table: Table, ball: Ball, events: PhysicsEvent[]): void {
  for (const st of table.standups) {
    const hit = resolveSegment(ball, st.a, st.b, 0, 0.6, table.ballRadius, ZERO)
    if (hit && hit.impact > 5) events.push({ type: 'standup', id: st.id })
  }
}

function resolveDropTargets(table: Table, state: TableState, ball: Ball, events: PhysicsEvent[]): void {
  for (const target of table.dropTargets) {
    if (state.droppedTargets.includes(target.id)) continue
    const hit = resolveSegment(ball, target.a, target.b, 0, 0.5, table.ballRadius, ZERO)
    if (hit && hit.impact > 5) {
      state.droppedTargets.push(target.id)
      events.push({ type: 'drop', id: target.id })
    }
  }
}

/** True when `prev -> pos` crosses the gate's line, from the free side (`sd < 0`) to the solid side. */
function crossesGateLine(prev: Vec2, pos: Vec2, a: Vec2, b: Vec2, n: Vec2): boolean {
  const sdPrev = vDot(vSub(prev, a), n)
  const sdPos = vDot(vSub(pos, a), n)
  if (sdPrev >= 0 || sdPos < 0) return false
  const t = sdPrev / (sdPrev - sdPos)
  const cross = vAdd(prev, vScale(vSub(pos, prev), t))
  const ab = vSub(b, a)
  const abLenSq = vDot(ab, ab)
  const along = abLenSq > 1e-12 ? vDot(vSub(cross, a), ab) / abLenSq : 0
  return along >= 0 && along <= 1
}

function resolveGates(table: Table, ball: Ball, prev: Vec2, events: PhysicsEvent[]): void {
  for (const gate of table.gates) {
    resolveGate(gate, ball, prev, table.ballRadius, events)
  }
}

function resolveGate(gate: Gate, ball: Ball, prev: Vec2, ballRadius: number, events: PhysicsEvent[]): void {
  const n = leftNormal(gate.a, gate.b)
  if (crossesGateLine(prev, ball.pos, gate.a, gate.b, n)) events.push({ type: 'gate', id: gate.id })

  const ab = vSub(gate.b, gate.a)
  const abLenSq = vDot(ab, ab)
  const t = abLenSq > 1e-12 ? vDot(vSub(ball.pos, gate.a), ab) / abLenSq : -1
  if (t <= 0 || t >= 1) return

  const sd = vDot(vSub(ball.pos, gate.a), n)
  if (sd < 0 || sd >= ballRadius) return
  ball.pos = vAdd(ball.pos, vScale(n, ballRadius - sd))
  const vn = vDot(ball.vel, n)
  if (vn < 0) ball.vel = vSub(ball.vel, vScale(n, (1 + 0.3) * vn))
}

function resolvePosts(table: Table, ball: Ball, events: PhysicsEvent[]): void {
  for (const post of table.posts) {
    const R = post.radius
    const hit = resolveSegment(ball, post.pos, post.pos, R, post.restitution, table.ballRadius, ZERO)
    if (hit && hit.impact > 6) events.push({ type: 'wallHit', speed: hit.impact, kind: 'rubber' })
  }
}

function resolveBumpers(table: Table, ball: Ball, events: PhysicsEvent[]): void {
  for (const bumper of table.bumpers) resolveBumper(bumper, ball, table.ballRadius, events)
}

function resolveBumper(bumper: Bumper, ball: Ball, ballRadius: number, events: PhysicsEvent[]): void {
  const diff = vSub(ball.pos, bumper.pos)
  const d = vLen(diff)
  const minDist = ballRadius + bumper.radius
  if (d >= minDist) return
  const n = d < 1e-9 ? { x: 0, y: -1 } : vScale(diff, 1 / d)
  ball.pos = vAdd(bumper.pos, vScale(n, minDist))
  const vn = vDot(ball.vel, n)
  if (vn >= 0) return
  const impact = -vn
  if (impact > 2) {
    ball.vel = vSub(ball.vel, vScale(n, vn))
    ball.vel = vAdd(ball.vel, vScale(n, Math.max(bumper.kick, 0.8 * impact)))
    events.push({ type: 'bumper', id: bumper.id, speed: impact })
  } else {
    ball.vel = vSub(ball.vel, vScale(n, 1.8 * vn))
  }
}

function resolveFlippers(table: Table, state: TableState, ball: Ball, events: PhysicsEvent[]): void {
  table.flippers.forEach((flipper, i) => {
    resolveFlipper(flipper, state.flippers[i], ball, table.ballRadius, events)
  })
}

function resolveFlipper(
  flipper: Flipper,
  fs: FlipperState,
  ball: Ball,
  ballRadius: number,
  events: PhysicsEvent[],
): void {
  const tip = flipperTip(flipper, fs.angle)
  const { q } = closestPointOnSegment(ball.pos, flipper.pivot, tip)
  const surfaceVel: Vec2 = {
    x: -fs.angularVel * (q.y - flipper.pivot.y),
    y: fs.angularVel * (q.x - flipper.pivot.x),
  }
  const risingSign = Math.sign(flipper.activeAngle - flipper.restAngle)
  const isRising = fs.angularVel !== 0 && Math.sign(fs.angularVel) === risingSign
  const e = isRising ? 0.55 : 0.35
  const hit = resolveSegment(ball, flipper.pivot, tip, flipper.radius, e, ballRadius, surfaceVel)
  if (hit && hit.impact > 6) events.push({ type: 'flipperHit', speed: hit.impact })
}

function resolveRampEntry(table: Table, ball: Ball, prev: Vec2, events: PhysicsEvent[]): void {
  for (const ramp of table.ramps) {
    if (ramp.path.length < 2) continue
    if (!segmentsIntersect(prev, ball.pos, ramp.entry.a, ramp.entry.b)) continue
    const tangent0 = rampPoint(ramp, 0).tangent
    const vAlong = vDot(ball.vel, tangent0)
    if (vAlong <= 0) continue
    ball.ramp = { id: ramp.id, s: 0, v: vAlong }
    ball.z = 0
    events.push({ type: 'rampEnter', id: ramp.id })
    return
  }
}

function resolveSpinnerCrossings(table: Table, state: TableState, ball: Ball, prev: Vec2): void {
  table.spinners.forEach((spinner, i) => {
    if (!segmentsIntersect(prev, ball.pos, spinner.a, spinner.b)) return
    const m = leftNormal(spinner.a, spinner.b)
    const ss = state.spinners[i]
    ss.angularVel = clampNum(ss.angularVel + 0.9 * vDot(ball.vel, m), -60, 60)
    ball.vel = vScale(ball.vel, 0.96)
  })
}

function resolveRollovers(table: Table, state: TableState, ball: Ball, events: PhysicsEvent[]): void {
  for (const rollover of table.rollovers) {
    const key = `${ball.id}:${rollover.id}`
    const inside = vLen(vSub(ball.pos, rollover.pos)) < rollover.radius
    const idx = state.rolloverContacts.indexOf(key)
    if (inside && idx === -1) {
      state.rolloverContacts.push(key)
      events.push({ type: 'rollover', id: rollover.id })
    } else if (!inside && idx !== -1) {
      state.rolloverContacts.splice(idx, 1)
    }
  }
}

function resolveSaucers(table: Table, ball: Ball, events: PhysicsEvent[]): void {
  for (const saucer of table.saucers) resolveSaucer(saucer, ball, table.ballRadius, events)
}

function resolveSaucer(saucer: Saucer, ball: Ball, ballRadius: number, events: PhysicsEvent[]): void {
  if (ball.ejectedFrom === saucer.id) {
    if (vLen(vSub(ball.pos, saucer.pos)) > saucer.radius + ballRadius) ball.ejectedFrom = null
    else return
  }
  const d = vLen(vSub(ball.pos, saucer.pos))
  if (d < 0.6 * saucer.radius && vLen(ball.vel) < 60) {
    ball.pos = { x: saucer.pos.x, y: saucer.pos.y }
    ball.vel = { x: 0, y: 0 }
    ball.saucer = { id: saucer.id, timer: saucer.hold }
    events.push({ type: 'saucerCapture', id: saucer.id })
  }
}

// -------------------------------------------------------------------------------------------
// Per-ball step: held in a saucer, riding a ramp, or rolling on the playfield.
// -------------------------------------------------------------------------------------------

function stepHeldBall(table: Table, ball: Ball, dt: number, events: PhysicsEvent[]): void {
  const held = ball.saucer
  if (!held) return
  held.timer -= dt
  if (held.timer > 0) return
  const saucer = table.saucers.find((s) => s.id === held.id)
  ball.vel = saucer ? { x: saucer.eject.x, y: saucer.eject.y } : { x: 0, y: 0 }
  ball.saucer = null
  ball.ejectedFrom = held.id
  events.push({ type: 'saucerEject', id: held.id })
}

function stepRampBall(table: Table, ball: Ball, dt: number, events: PhysicsEvent[]): void {
  const rs = ball.ramp
  if (!rs) return
  const ramp = table.ramps.find((r) => r.id === rs.id)
  if (!ramp) {
    ball.ramp = null
    ball.z = 0
    return
  }

  const { i0, i1, segLen } = rampSegment(ramp, rs.s)
  const slope = segLen > 1e-9 ? (ramp.heights[i1] - ramp.heights[i0]) / segLen : 0
  const p = rampPoint(ramp, rs.s)
  const a = -386 * slope + table.gravity * p.tangent.y - 3 * Math.sign(rs.v)
  rs.v += a * dt
  rs.s += rs.v * dt

  const total = rampLength(ramp)
  if (rs.s <= 0) {
    const tangent0 = rampPoint(ramp, 0).tangent
    ball.ramp = null
    ball.z = 0
    ball.pos = vSub(ramp.path[0], vScale(tangent0, table.ballRadius + 0.05))
    ball.vel = vScale(tangent0, rs.v)
    return
  }
  if (rs.s >= total) {
    const lastTangent = rampPoint(ramp, total).tangent
    const last = ramp.path[ramp.path.length - 1]
    ball.ramp = null
    ball.z = 0
    ball.pos = { x: last.x, y: last.y }
    ball.vel = vScale(lastTangent, Math.max(rs.v, 8))
    events.push({ type: 'rampMade', id: ramp.id })
    return
  }
  const np = rampPoint(ramp, rs.s)
  ball.pos = np.pos
  ball.z = np.z
  ball.vel = vScale(np.tangent, rs.v)
}

function stepPlayfieldBall(
  table: Table,
  state: TableState,
  ball: Ball,
  dt: number,
  events: PhysicsEvent[],
): void {
  ball.vel = { x: ball.vel.x, y: ball.vel.y + table.gravity * dt }
  ball.vel = vScale(ball.vel, 1 - ROLL_DRAG * dt)
  clampSpeed(ball, MAX_BALL_SPEED)
  const prev = { x: ball.pos.x, y: ball.pos.y }
  ball.pos = vAdd(ball.pos, vScale(ball.vel, dt))

  resolveWalls(table, ball, events)
  resolveSlingshots(table, ball, events)
  resolveStandups(table, ball, events)
  resolveDropTargets(table, state, ball, events)
  resolveGates(table, ball, prev, events)
  resolvePosts(table, ball, events)
  resolveBumpers(table, ball, events)
  resolveFlippers(table, state, ball, events)

  resolveRampEntry(table, ball, prev, events)
  resolveSpinnerCrossings(table, state, ball, prev)
  resolveRollovers(table, state, ball, events)
  resolveSaucers(table, ball, events)
}

function resolveBallCollisions(balls: Ball[], ballRadius: number, events: PhysicsEvent[]): void {
  const playfield = balls.filter((b) => !b.ramp && !b.saucer)
  const minDist = ballRadius * 2
  for (let i = 0; i < playfield.length; i++) {
    for (let j = i + 1; j < playfield.length; j++) {
      const a = playfield[i]
      const b = playfield[j]
      const diff = vSub(b.pos, a.pos)
      const dist = vLen(diff)
      if (dist >= minDist) continue
      const n = dist < 1e-9 ? { x: 1, y: 0 } : vScale(diff, 1 / dist)
      const overlap = minDist - dist
      a.pos = vSub(a.pos, vScale(n, overlap / 2))
      b.pos = vAdd(b.pos, vScale(n, overlap / 2))

      const closing = vDot(a.vel, n) - vDot(b.vel, n)
      if (closing <= 0) continue
      const impulse = ((1 + BALL_RESTITUTION) / 2) * closing
      a.vel = vSub(a.vel, vScale(n, impulse))
      b.vel = vAdd(b.vel, vScale(n, impulse))
      if (closing > 5) events.push({ type: 'ballHit', speed: closing })
    }
  }
}

function stepFlippers(
  table: Table,
  state: TableState,
  input: Input,
  dt: number,
  events: PhysicsEvent[],
): void {
  table.flippers.forEach((flipper, i) => {
    const fs = state.flippers[i]
    const buttonRaw = flipper.side === 'left' ? input.left : input.right
    const pressed = state.flippersEnabled && buttonRaw
    const target = pressed ? flipper.activeAngle : flipper.restAngle
    const wasAtRest = fs.angle === flipper.restAngle
    const wasAtActive = fs.angle === flipper.activeAngle
    const diff = target - fs.angle

    if (Math.abs(diff) < 1e-9) {
      fs.angularVel = 0
    } else {
      const rate = pressed ? FLIPPER_UP_SPEED : FLIPPER_DOWN_SPEED
      const maxStep = rate * dt
      const step = Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep
      fs.angle += step
      fs.angularVel = step / dt
    }

    if (pressed && wasAtRest && fs.angularVel !== 0) {
      events.push({ type: 'flipperUp', side: flipper.side })
    }
    if (!pressed && wasAtActive && fs.angularVel !== 0) {
      events.push({ type: 'flipperDown', side: flipper.side })
    }
  })
}

function stepPlunger(
  table: Table,
  state: TableState,
  input: Input,
  dt: number,
  events: PhysicsEvent[],
): void {
  if (input.plunger) {
    state.plungerPull = Math.min(1, state.plungerPull + dt / PLUNGER_PULL_SECONDS)
    return
  }
  if (state.plungerPull <= 0) return
  const ball = ballAtPlunger(table, state)
  if (ball) {
    const { minSpeed, maxSpeed } = table.plunger
    const speed = minSpeed + (maxSpeed - minSpeed) * state.plungerPull
    ball.vel = { x: 0, y: -speed }
    events.push({ type: 'launch', speed })
  }
  state.plungerPull = 0
}

function stepNudge(table: Table, state: TableState, input: Input, events: PhysicsEvent[]): void {
  if (!input.nudge) return
  events.push({ type: 'nudge', direction: input.nudge })
  const delta =
    input.nudge === 'left' ? { x: -9, y: -2 } : input.nudge === 'right' ? { x: 9, y: -2 } : { x: 0, y: -11 }
  for (const ball of state.balls) {
    if (ball.ramp || ball.saucer) continue
    if (inPlungerZone(table, ball.pos)) continue
    ball.vel = vAdd(ball.vel, delta)
  }
}

function stepSpinnerDecay(table: Table, state: TableState, dt: number, events: PhysicsEvent[]): void {
  table.spinners.forEach((spinner, i) => {
    const ss = state.spinners[i]
    const before = Math.floor(ss.angle / Math.PI)
    ss.angle += ss.angularVel * dt
    const after = Math.floor(ss.angle / Math.PI)
    if (after !== before) events.push({ type: 'spinner', id: spinner.id })
    ss.angularVel *= Math.exp(-1.6 * dt)
    if (Math.abs(ss.angularVel) < 0.5) ss.angularVel = 0
  })
}

function stepRescue(state: TableState, table: Table, input: Input, dt: number): void {
  const flipperHeld = input.left || input.right
  for (const ball of state.balls) {
    if (ball.ramp || ball.saucer) continue
    if (inPlungerZone(table, ball.pos)) continue
    const speed = vLen(ball.vel)
    if (speed < STILL_SPEED && !flipperHeld) {
      ball.stillTime += dt
      if (ball.stillTime >= STILL_RESCUE_SECONDS) {
        ball.vel = { x: ball.id % 2 ? 14 : -14, y: -30 }
        ball.stillTime = 0
      }
    } else {
      ball.stillTime = 0
    }
  }
}

function stepDrain(table: Table, state: TableState, events: PhysicsEvent[]): void {
  const kept: Ball[] = []
  const drainedIds: number[] = []
  for (const ball of state.balls) {
    const outOfBounds =
      !Number.isFinite(ball.pos.x) ||
      !Number.isFinite(ball.pos.y) ||
      ball.pos.x < -ESCAPE_MARGIN ||
      ball.pos.x > table.width + ESCAPE_MARGIN ||
      ball.pos.y < -ESCAPE_MARGIN ||
      ball.pos.y > table.height + ESCAPE_MARGIN
    if (ball.pos.y > table.drainY || outOfBounds) {
      events.push({ type: 'drain', ballId: ball.id })
      drainedIds.push(ball.id)
      continue
    }
    kept.push(ball)
  }
  if (drainedIds.length > 0) {
    state.balls = kept
    state.rolloverContacts = state.rolloverContacts.filter(
      (key) => !drainedIds.some((id) => key.startsWith(`${id}:`)),
    )
  }
}

/** Advances the whole table by `dt` (normally `FIXED_DT`), returning this step's events. */
export function stepTable(table: Table, state: TableState, input: Input, dt: number): PhysicsEvent[] {
  const events: PhysicsEvent[] = []
  state.time += dt

  stepFlippers(table, state, input, dt, events)
  stepPlunger(table, state, input, dt, events)
  stepNudge(table, state, input, events)
  stepSpinnerDecay(table, state, dt, events)

  for (const ball of state.balls) {
    if (ball.saucer) stepHeldBall(table, ball, dt, events)
    else if (ball.ramp) stepRampBall(table, ball, dt, events)
    else stepPlayfieldBall(table, state, ball, dt, events)
  }

  resolveBallCollisions(state.balls, table.ballRadius, events)
  stepRescue(state, table, input, dt)
  stepDrain(table, state, events)

  return events
}
