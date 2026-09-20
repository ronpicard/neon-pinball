/**
 * The attract-mode player: a pure, deterministic bot that drives the table the same way a human
 * would, through `Input`. It never reads or writes anything outside the `Table`/`TableState` it is
 * given, so the same state always yields the same input.
 */

import type { Ball, Command, Flipper, GameState, Input, PhysicsEvent, Table, TableState, Vec2 } from './types.ts'
import { FIXED_DT, addBall, autoLaunch, ballAtPlunger, createTableState, resetDropBank, stepTable } from './physics.ts'
import { createGame, handleEvent, startGame, tickGame } from './rules.ts'

/** A ball resting on the plunger counts as "waiting" below this speed. */
const PLUNGER_WAIT_SPEED = 1

/** The pull target cycles between these two shares of a full pull, so launches vary in strength. */
const PLUNGER_TARGET_BASE = 0.72
const PLUNGER_TARGET_SPREAD = 0.26

/** How fast the pull target cycles with time and with the waiting ball's id. */
const PLUNGER_TARGET_TIME_RATE = 0.37
const PLUNGER_TARGET_ID_RATE = 0.31

/** A ball is only worth catching if it is not already falling past the flipper. */
const STRIKE_MIN_VY = -8

/** How far past the flipper's own length its strike zone reaches, in inches. */
const STRIKE_REACH_MARGIN = 0.9

/** How far past the rest tip, toward the table centre, the strike zone reaches, in inches. */
const STRIKE_TIP_MARGIN = 0.6

/** The bot lets go on this share of every cycle, so a ball cradled at rest is not held forever. */
const RELEASE_PERIOD = 1.7
const RELEASE_SHARE = 0.12

/** Fractional part of `x`, always in `[0, 1)`. */
function frac(x: number): number {
  return x - Math.floor(x)
}

/** The flipper's tip when resting at `flipper.restAngle`. */
function restTip(flipper: Flipper): Vec2 {
  return {
    x: flipper.pivot.x + flipper.length * Math.cos(flipper.restAngle),
    y: flipper.pivot.y + flipper.length * Math.sin(flipper.restAngle),
  }
}

/**
 * True when `ball` sits in `flipper`'s strike zone: within reach of the pivot, on the playfield
 * side of the pivot-to-rest-tip line (the side the flipper sweeps into when raised), and between
 * the pivot and a little past the rest tip toward the table centre.
 */
function inStrikeZone(table: Table, flipper: Flipper, ball: Ball): boolean {
  if (ball.z !== 0 || ball.saucer) return false
  if (ball.vel.y <= STRIKE_MIN_VY) return false

  const tip = restTip(flipper)
  const dx = tip.x - flipper.pivot.x
  const dy = tip.y - flipper.pivot.y
  const toBallX = ball.pos.x - flipper.pivot.x
  const toBallY = ball.pos.y - flipper.pivot.y

  if (Math.hypot(toBallX, toBallY) > flipper.length + STRIKE_REACH_MARGIN) return false

  const cross = dx * toBallY - dy * toBallX
  const onPlayfieldSide = flipper.side === 'left' ? cross < 0 : cross > 0
  if (!onPlayfieldSide) return false

  const towardCentre = Math.sign(table.width / 2 - tip.x)
  const farEdge = tip.x + towardCentre * STRIKE_TIP_MARGIN
  const lo = Math.min(flipper.pivot.x, farEdge)
  const hi = Math.max(flipper.pivot.x, farEdge)
  return ball.pos.x >= lo && ball.pos.x <= hi
}

/**
 * The attract-mode player: a pure function of the table state. Pulls and releases the plunger to
 * vary launch strength, presses a flipper whenever a ball is in its strike zone, and briefly lets
 * go on a regular cycle so a ball cradled at rest is not pinned under a flipper forever. It never
 * nudges.
 */
export function botInput(table: Table, state: TableState): Input {
  const waiting = ballAtPlunger(table, state)
  let plunger = false
  // Once a pull has started it is carried through: a ball still settling on the plunger must not
  // read as "already launched", or the bot lets go of a barely-pulled plunger and the ball falls back.
  const settled = waiting !== null && Math.hypot(waiting.vel.x, waiting.vel.y) < PLUNGER_WAIT_SPEED
  if (waiting && (settled || state.plungerPull > 0)) {
    const target =
      PLUNGER_TARGET_BASE +
      PLUNGER_TARGET_SPREAD *
        frac(state.time * PLUNGER_TARGET_TIME_RATE + waiting.id * PLUNGER_TARGET_ID_RATE)
    plunger = state.plungerPull < target
  }

  const releasing = frac(state.time / RELEASE_PERIOD) < RELEASE_SHARE
  let left = false
  let right = false
  for (const flipper of table.flippers) {
    const wanted = !releasing && state.balls.some((ball) => inStrikeZone(table, flipper, ball))
    if (flipper.side === 'left') left = wanted
    else right = wanted
  }

  return { left, right, plunger, nudge: null }
}

/** Outcome of one headless attract-mode game played to completion, to a stall, or to the time cap. */
export interface SimulationResult {
  score: number
  seconds: number
  counts: Record<string, number>
  /** Some ball outside the plunger zone stayed slower than `STUCK_SPEED` for `STUCK_SECONDS` straight. */
  stuck: boolean
  /** Some ball's centre left the safety rectangle around the table, or its position went non-finite. */
  escaped: boolean
}

/** Seconds after an `auto` serve is added that the machine launches it itself. */
const AUTO_LAUNCH_DELAY = 0.6

/** Speed below which a ball counts toward the stuck timer. */
const STUCK_SPEED = 1.5

/** Straight seconds under `STUCK_SPEED` that counts as stuck. */
const STUCK_SECONDS = 8

/** How far outside the table rectangle a ball's centre may stray before it counts as escaped. */
const ESCAPE_MARGIN = 1

/** True when `pos` sits inside the plunger's zone. */
function inPlungerZone(table: Table, pos: Vec2): boolean {
  const zone = table.plunger.zone
  return pos.x >= zone.min.x && pos.x <= zone.max.x && pos.y >= zone.min.y && pos.y <= zone.max.y
}

/** True when `ball`'s centre has left the safety rectangle around the table, or gone non-finite. */
function hasEscaped(table: Table, ball: Ball): boolean {
  const { x, y } = ball.pos
  if (!Number.isFinite(x) || !Number.isFinite(y)) return true
  return x < -ESCAPE_MARGIN || x > table.width + ESCAPE_MARGIN || y < -ESCAPE_MARGIN || y > table.drainY + ESCAPE_MARGIN
}

/**
 * Plays one full attract-mode game of `table` headless, from a fresh `createGame`/`createTableState`
 * through `botInput`, `stepTable`, and the rules, executing the commands the rules return the same
 * way the engine does: a `serveBall` adds a ball to the plunger's rest spot when it is empty, else
 * queues it for as soon as it empties; an `auto` serve's ball is launched by `autoLaunch`
 * `AUTO_LAUNCH_DELAY` seconds after it is added; `resetDropBank` and `setFlippersEnabled` are applied
 * to the physics state; `sound`, `message`, and `lightShow` are ignored (there is nothing to show
 * them on). Steps at `FIXED_DT` until the game reaches `'gameOver'` or `maxSeconds` of simulated time
 * pass, stopping early if a ball gets stuck or escapes. `startTimeOffset` is added to `state.time`
 * before the first step, so otherwise-identical games take different plunges.
 */
export function simulateGame(table: Table, maxSeconds: number, startTimeOffset = 0): SimulationResult {
  const state = createTableState(table)
  state.time += startTimeOffset
  const game: GameState = createGame()

  const counts: Record<string, number> = {}
  const serveQueue: boolean[] = []
  const autoLaunchTimers: number[] = []
  const slowTime = new Map<number, number>()
  let escaped = false
  let stuck = false

  const runCommands = (commands: Command[]): void => {
    for (const command of commands) {
      switch (command.type) {
        case 'serveBall':
          if (ballAtPlunger(table, state)) {
            serveQueue.push(command.auto)
          } else {
            addBall(state, table.plunger.rest)
            if (command.auto) autoLaunchTimers.push(AUTO_LAUNCH_DELAY)
          }
          break
        case 'resetDropBank':
          resetDropBank(table, state, command.bank)
          break
        case 'setFlippersEnabled':
          state.flippersEnabled = command.enabled
          break
        case 'sound':
        case 'message':
        case 'lightShow':
          break
      }
    }
  }

  const runEvent = (event: PhysicsEvent): void => {
    counts[event.type] = (counts[event.type] ?? 0) + 1
    runCommands(handleEvent(game, event, table))
  }

  runCommands(startGame(game, table))

  let seconds = 0
  while (game.phase !== 'gameOver' && seconds < maxSeconds) {
    const input = botInput(table, state)
    for (const event of stepTable(table, state, input, FIXED_DT)) runEvent(event)
    runCommands(tickGame(game, FIXED_DT, table))

    for (let i = autoLaunchTimers.length - 1; i >= 0; i--) {
      autoLaunchTimers[i] -= FIXED_DT
      if (autoLaunchTimers[i] > 0) continue
      autoLaunchTimers.splice(i, 1)
      const launchEvents: PhysicsEvent[] = []
      autoLaunch(table, state, launchEvents)
      for (const event of launchEvents) runEvent(event)
    }

    if (serveQueue.length > 0 && !ballAtPlunger(table, state)) {
      const auto = serveQueue.shift() as boolean
      addBall(state, table.plunger.rest)
      if (auto) autoLaunchTimers.push(AUTO_LAUNCH_DELAY)
    }

    const liveIds = new Set<number>()
    for (const ball of state.balls) {
      liveIds.add(ball.id)
      if (hasEscaped(table, ball)) escaped = true

      const onPlayfield = ball.z === 0 && !ball.saucer && !inPlungerZone(table, ball.pos)
      if (!onPlayfield) {
        slowTime.delete(ball.id)
        continue
      }
      if (Math.hypot(ball.vel.x, ball.vel.y) < STUCK_SPEED) {
        const time = (slowTime.get(ball.id) ?? 0) + FIXED_DT
        slowTime.set(ball.id, time)
        if (time >= STUCK_SECONDS) stuck = true
      } else {
        slowTime.delete(ball.id)
      }
    }
    for (const id of [...slowTime.keys()]) if (!liveIds.has(id)) slowTime.delete(id)

    seconds += FIXED_DT
    if (escaped || stuck) break
  }

  return { score: game.score, seconds, counts, stuck, escaped }
}
