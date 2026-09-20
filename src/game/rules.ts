/**
 * Game rules: scoring, lamps, and tilt, driven by physics events. This module owns `GameState`
 * transitions and never touches physics or rendering; it only reads a `Table` for element ids and
 * groupings, and returns `Command`s for the machine (the engine) to carry out.
 */

import type { Command, GameState, Phase, PhysicsEvent, Table } from './types.ts'

/** Every point value the rules award, named so a reader can trace a score back to its rule. */
export const SCORES = {
  bumper: 100,
  bumperSuper: 1000,
  slingshot: 10,
  standupFirst: 500,
  standupRepeat: 100,
  standupBankComplete: 10000,
  dropTarget: 500,
  dropBankComplete: 5000,
  toplaneFirst: 500,
  toplaneRepeat: 100,
  toplaneComplete: 5000,
  inlane: 250,
  outlane: 2000,
  spinner: 100,
  spinnerLit: 1000,
  rampMade: 2500,
  rampJackpot: 25000,
  rampBonus: 1000,
  saucerCapture: 3000,
  mysteryJackpot: 5000,
} as const

/** Seconds of ball save armed by the first scoring switch after a ball is served. */
export const BALL_SAVE_SECONDS = 12

// Named constants for everything else that isn't a point value.
const DEFAULT_MESSAGE_SECONDS = 2
const TILT_MESSAGE_SECONDS = 4
const GAME_OVER_MESSAGE_SECONDS = 5
const BONUS_MESSAGE_SECONDS = 2.2
const BONUS_TICK_INTERVAL = 0.25
const TILT_METER_LIMIT = 2.2
const TILT_METER_DECAY_PER_SECOND = 0.5
const TILT_WARNING_LIMIT = 3
const MAX_BONUS_MULTIPLIER = 5
const MAX_COMBO_COUNT = 5
const COMBO_TIMER_SECONDS = 6
const MULTIBALL_RAMP_TARGET = 3
const MULTIBALL_EXTRA_BALLS = 2
const MULTIBALL_BALL_SAVE_SECONDS = 10
const MYSTERY_BALL_SAVE_SECONDS = 10
const DROP_BANK_SPINNER_SECONDS = 20
const INLANE_SPINNER_SECONDS = 8
const MYSTERY_SPINNER_SECONDS = 20
const SUPER_BUMPER_SECONDS = 20

/** Event types that arm the ball save the first time one lands after a ball is served. */
const SCORING_SWITCH_TYPES = new Set<PhysicsEvent['type']>([
  'bumper',
  'slingshot',
  'standup',
  'drop',
  'rollover',
  'spinner',
  'rampMade',
  'saucerCapture',
])

/** The lit-up-to-here multiplier lamps, from `2X` to `5X`. */
const MULTIPLIER_LAMPS: { id: string; level: number }[] = [
  { id: 'lamp.2x', level: 2 },
  { id: 'lamp.3x', level: 3 },
  { id: 'lamp.4x', level: 4 },
  { id: 'lamp.5x', level: 5 },
]

/** Ramp-progress-toward-multiball lamps, in order. */
const RAMP_PROGRESS_LAMPS = ['lamp.ramp1', 'lamp.ramp2', 'lamp.ramp3']

/** Pushes a `serveBall` command and keeps `game.ballsInPlay` in sync with it. */
function serveBall(cmds: Command[], game: GameState, auto: boolean): void {
  cmds.push({ type: 'serveBall', auto })
  game.ballsInPlay += 1
}

/** A fresh game: attract mode, nothing scored, three balls to play. */
export function createGame(): GameState {
  return {
    phase: 'attract',
    score: 0,
    ball: 1,
    ballsPerGame: 3,
    extraBalls: 0,
    ballsInPlay: 0,
    bonusMultiplier: 1,
    bonus: 0,
    ballSaveTimer: 0,
    ballSaveArmed: false,
    multiball: false,
    rampCount: 0,
    superBumperTimer: 0,
    spinnerLitTimer: 0,
    comboTimer: 0,
    comboCount: 0,
    extraBallLit: false,
    extraBallAwarded: false,
    mysteryIndex: 0,
    tiltMeter: 0,
    tiltWarnings: 0,
    tilted: false,
    bonusTimer: 0,
    lamps: {},
  }
}

/** Resets `game` for a new game and serves the first ball. Mutates `game`; returns the commands. */
export function startGame(game: GameState, table: Table): Command[] {
  const cmds: Command[] = []

  game.phase = 'playing'
  game.score = 0
  game.ball = 1
  game.extraBalls = 0
  game.ballsInPlay = 0
  game.bonusMultiplier = 1
  game.bonus = 0
  game.ballSaveTimer = 0
  game.ballSaveArmed = false
  game.multiball = false
  game.rampCount = 0
  game.superBumperTimer = 0
  game.spinnerLitTimer = 0
  game.comboTimer = 0
  game.comboCount = 0
  game.extraBallLit = false
  game.extraBallAwarded = false
  game.mysteryIndex = 0
  game.tiltMeter = 0
  game.tiltWarnings = 0
  game.tilted = false
  game.bonusTimer = 0
  game.lamps = {}

  cmds.push({ type: 'setFlippersEnabled', enabled: true })
  const banks = new Set(table.dropTargets.map((d) => d.bank))
  for (const bank of banks) cmds.push({ type: 'resetDropBank', bank })
  cmds.push({ type: 'sound', name: 'gameStart' })
  cmds.push({ type: 'message', text: 'BALL 1', seconds: DEFAULT_MESSAGE_SECONDS })
  serveBall(cmds, game, false)
  game.ballSaveArmed = true

  refreshLamps(game, table)
  return cmds
}

/** Applies one physics event to `game`. Mutates `game`; returns the commands it produces. */
export function handleEvent(game: GameState, event: PhysicsEvent, table: Table): Command[] {
  const cmds: Command[] = []

  if (game.phase === 'playing' && (!game.tilted || event.type === 'drain')) {
    if (SCORING_SWITCH_TYPES.has(event.type) && game.ballSaveArmed) {
      game.ballSaveTimer = BALL_SAVE_SECONDS
      game.ballSaveArmed = false
    }

    switch (event.type) {
      case 'bumper': {
        game.score += game.superBumperTimer > 0 ? SCORES.bumperSuper : SCORES.bumper
        cmds.push({ type: 'sound', name: 'bumper' })
        break
      }

      case 'slingshot': {
        game.score += SCORES.slingshot
        cmds.push({ type: 'sound', name: 'slingshot' })
        break
      }

      case 'standup': {
        const target = table.standups.find((s) => s.id === event.id)
        if (target) {
          const wasLit = game.lamps[event.id] === 'on'
          if (wasLit) {
            game.score += SCORES.standupRepeat
          } else {
            game.lamps[event.id] = 'on'
            game.score += SCORES.standupFirst
            game.bonus += SCORES.standupFirst
          }
          cmds.push({ type: 'sound', name: 'target' })

          const group = table.standups.filter((s) => s.group === target.group)
          if (group.every((s) => game.lamps[s.id] === 'on')) {
            game.score += SCORES.standupBankComplete
            cmds.push({ type: 'message', text: 'PLAY COMPLETE', seconds: DEFAULT_MESSAGE_SECONDS })
            cmds.push({ type: 'sound', name: 'bankComplete' })
            cmds.push({ type: 'lightShow' })
            for (const s of group) game.lamps[s.id] = 'off'
            if (!game.extraBallAwarded) {
              game.extraBallLit = true
              game.extraBallAwarded = true
              cmds.push({ type: 'message', text: 'EXTRA BALL IS LIT', seconds: DEFAULT_MESSAGE_SECONDS })
            }
          }
        }
        break
      }

      case 'drop': {
        const target = table.dropTargets.find((d) => d.id === event.id)
        if (target) {
          game.lamps[event.id] = 'on'
          game.score += SCORES.dropTarget
          game.bonus += SCORES.dropTarget
          cmds.push({ type: 'sound', name: 'dropTarget' })

          const bank = table.dropTargets.filter((d) => d.bank === target.bank)
          if (bank.every((d) => game.lamps[d.id] === 'on')) {
            game.score += SCORES.dropBankComplete
            cmds.push({ type: 'message', text: 'BANK DOWN', seconds: DEFAULT_MESSAGE_SECONDS })
            cmds.push({ type: 'sound', name: 'bankComplete' })
            cmds.push({ type: 'resetDropBank', bank: target.bank })
            for (const d of bank) game.lamps[d.id] = 'off'
            game.spinnerLitTimer = Math.max(game.spinnerLitTimer, DROP_BANK_SPINNER_SECONDS)
          }
        }
        break
      }

      case 'rollover': {
        const rollover = table.rollovers.find((r) => r.id === event.id)
        if (rollover) {
          if (rollover.group === 'toplane') {
            const wasLit = game.lamps[event.id] === 'on'
            if (wasLit) {
              game.score += SCORES.toplaneRepeat
            } else {
              game.lamps[event.id] = 'on'
              game.score += SCORES.toplaneFirst
            }
            cmds.push({ type: 'sound', name: 'rollover' })

            const toplanes = table.rollovers.filter((r) => r.group === 'toplane')
            if (toplanes.every((r) => game.lamps[r.id] === 'on')) {
              game.score += SCORES.toplaneComplete
              game.bonusMultiplier = Math.min(MAX_BONUS_MULTIPLIER, game.bonusMultiplier + 1)
              game.superBumperTimer = SUPER_BUMPER_SECONDS
              for (const r of toplanes) game.lamps[r.id] = 'off'
              cmds.push({
                type: 'message',
                text: `BONUS ${game.bonusMultiplier}X`,
                seconds: DEFAULT_MESSAGE_SECONDS,
              })
              cmds.push({ type: 'sound', name: 'laneComplete' })
            }
          } else if (rollover.group === 'inlane') {
            game.score += SCORES.inlane
            game.spinnerLitTimer = Math.max(game.spinnerLitTimer, INLANE_SPINNER_SECONDS)
            cmds.push({ type: 'sound', name: 'rollover' })
          } else {
            game.score += SCORES.outlane
            cmds.push({ type: 'sound', name: 'rollover' })
          }
        }
        break
      }

      case 'flipperUp': {
        const toplanes = table.rollovers.filter((r) => r.group === 'toplane')
        const n = toplanes.length
        if (n > 0) {
          const lit = toplanes.map((r) => game.lamps[r.id] === 'on')
          const rotated = lit.map((_, i) =>
            event.side === 'left' ? lit[(i + 1) % n] : lit[(i - 1 + n) % n],
          )
          toplanes.forEach((r, i) => {
            game.lamps[r.id] = rotated[i] ? 'on' : 'off'
          })
        }
        break
      }

      case 'spinner': {
        game.score += game.spinnerLitTimer > 0 ? SCORES.spinnerLit : SCORES.spinner
        cmds.push({ type: 'sound', name: 'spinner' })
        break
      }

      case 'rampEnter': {
        cmds.push({ type: 'sound', name: 'rampEnter' })
        break
      }

      case 'rampMade': {
        game.comboCount = game.comboTimer > 0 ? Math.min(MAX_COMBO_COUNT, game.comboCount + 1) : 1
        game.comboTimer = COMBO_TIMER_SECONDS

        if (game.multiball) {
          game.score += SCORES.rampJackpot * game.comboCount
          cmds.push({ type: 'message', text: 'JACKPOT', seconds: DEFAULT_MESSAGE_SECONDS })
          cmds.push({ type: 'sound', name: 'jackpot' })
          cmds.push({ type: 'lightShow' })
        } else {
          game.score += SCORES.rampMade * game.comboCount
          if (game.comboCount > 1) {
            cmds.push({
              type: 'message',
              text: `COMBO ${game.comboCount}X`,
              seconds: DEFAULT_MESSAGE_SECONDS,
            })
          }
          game.bonus += SCORES.rampBonus
          cmds.push({ type: 'sound', name: 'rampMade' })
          game.rampCount += 1

          if (game.rampCount === MULTIBALL_RAMP_TARGET) {
            game.multiball = true
            game.rampCount = 0
            for (let i = 0; i < MULTIBALL_EXTRA_BALLS; i++) serveBall(cmds, game, true)
            cmds.push({ type: 'message', text: 'MULTIBALL', seconds: DEFAULT_MESSAGE_SECONDS })
            cmds.push({ type: 'sound', name: 'multiball' })
            cmds.push({ type: 'lightShow' })
            game.ballSaveTimer = Math.max(game.ballSaveTimer, MULTIBALL_BALL_SAVE_SECONDS)
          }
        }
        break
      }

      case 'saucerCapture': {
        game.score += SCORES.saucerCapture
        cmds.push({ type: 'sound', name: 'saucer' })

        if (game.extraBallLit) {
          game.extraBalls += 1
          game.extraBallLit = false
          cmds.push({ type: 'message', text: 'EXTRA BALL', seconds: DEFAULT_MESSAGE_SECONDS })
          cmds.push({ type: 'sound', name: 'extraBall' })
          cmds.push({ type: 'lightShow' })
        } else {
          const award = game.mysteryIndex % 4
          game.mysteryIndex += 1
          switch (award) {
            case 0:
              game.score += SCORES.mysteryJackpot
              cmds.push({ type: 'message', text: 'MYSTERY 5,000', seconds: DEFAULT_MESSAGE_SECONDS })
              break
            case 1:
              game.spinnerLitTimer = Math.max(game.spinnerLitTimer, MYSTERY_SPINNER_SECONDS)
              cmds.push({ type: 'message', text: 'SPINNER LIT', seconds: DEFAULT_MESSAGE_SECONDS })
              break
            case 2:
              game.bonusMultiplier = Math.min(MAX_BONUS_MULTIPLIER, game.bonusMultiplier + 1)
              cmds.push({ type: 'message', text: 'BONUS X UP', seconds: DEFAULT_MESSAGE_SECONDS })
              break
            default:
              game.ballSaveTimer = Math.max(game.ballSaveTimer, MYSTERY_BALL_SAVE_SECONDS)
              cmds.push({ type: 'message', text: 'BALL SAVE', seconds: DEFAULT_MESSAGE_SECONDS })
              break
          }
        }
        break
      }

      case 'saucerEject': {
        cmds.push({ type: 'sound', name: 'eject' })
        break
      }

      case 'launch': {
        cmds.push({ type: 'sound', name: 'launch' })
        break
      }

      case 'nudge': {
        game.tiltMeter += 1
        if (game.tiltMeter > TILT_METER_LIMIT) {
          game.tiltMeter = 1
          game.tiltWarnings += 1
          if (game.tiltWarnings < TILT_WARNING_LIMIT) {
            cmds.push({ type: 'message', text: 'DANGER', seconds: DEFAULT_MESSAGE_SECONDS })
            cmds.push({ type: 'sound', name: 'tiltWarning' })
          } else {
            game.tilted = true
            game.bonus = 0
            game.ballSaveTimer = 0
            game.ballSaveArmed = false
            cmds.push({ type: 'setFlippersEnabled', enabled: false })
            cmds.push({ type: 'message', text: 'TILT', seconds: TILT_MESSAGE_SECONDS })
            cmds.push({ type: 'sound', name: 'tilt' })
          }
        }
        break
      }

      case 'drain': {
        game.ballsInPlay = Math.max(0, game.ballsInPlay - 1)
        if (!game.tilted && (game.ballSaveTimer > 0 || game.ballSaveArmed)) {
          serveBall(cmds, game, true)
          cmds.push({ type: 'message', text: 'BALL SAVED', seconds: DEFAULT_MESSAGE_SECONDS })
          cmds.push({ type: 'sound', name: 'ballSaved' })
        } else if (game.ballsInPlay > 0) {
          if (game.ballsInPlay === 1) game.multiball = false
        } else {
          cmds.push({ type: 'sound', name: 'drain' })
          game.phase = 'bonus'
          game.bonusTimer = BONUS_MESSAGE_SECONDS
          cmds.push({
            type: 'message',
            text: `BONUS ${game.bonus} X${game.bonusMultiplier}`,
            seconds: BONUS_MESSAGE_SECONDS,
          })
          game.multiball = false
        }
        break
      }

      case 'wallHit':
      case 'flipperHit':
      case 'ballHit':
      case 'gate':
      case 'flipperDown':
        break
    }
  }

  refreshLamps(game, table)
  return cmds
}

/**
 * Advances timers by `dt` seconds and, in the `'bonus'` phase, counts down the end-of-ball bonus
 * and starts the next ball (or ends the game) when it reaches zero. Mutates `game`; returns the
 * commands it produces.
 */
export function tickGame(game: GameState, dt: number, table: Table): Command[] {
  const cmds: Command[] = []

  if (game.phase === 'playing' || game.phase === 'bonus') {
    game.ballSaveTimer = Math.max(0, game.ballSaveTimer - dt)
    game.superBumperTimer = Math.max(0, game.superBumperTimer - dt)
    game.spinnerLitTimer = Math.max(0, game.spinnerLitTimer - dt)
    game.comboTimer = Math.max(0, game.comboTimer - dt)
    game.tiltMeter = Math.max(0, game.tiltMeter - TILT_METER_DECAY_PER_SECOND * dt)

    if (game.phase === 'bonus') {
      const before = Math.floor(game.bonusTimer / BONUS_TICK_INTERVAL)
      game.bonusTimer = Math.max(0, game.bonusTimer - dt)
      const after = Math.floor(game.bonusTimer / BONUS_TICK_INTERVAL)
      if (after !== before) cmds.push({ type: 'sound', name: 'bonusTick' })

      if (game.bonusTimer === 0) {
        game.score += game.bonus * game.bonusMultiplier

        const wasTilted = game.tilted
        if (wasTilted) cmds.push({ type: 'setFlippersEnabled', enabled: true })
        game.tilted = false
        game.tiltWarnings = 0
        game.tiltMeter = 0
        game.bonus = 0
        game.bonusMultiplier = 1
        for (const r of table.rollovers) {
          if (r.group === 'toplane') game.lamps[r.id] = 'off'
        }
        game.comboTimer = 0
        game.superBumperTimer = 0
        game.spinnerLitTimer = 0
        game.ballSaveArmed = true

        if (game.extraBalls > 0) {
          game.extraBalls -= 1
          cmds.push({ type: 'message', text: 'SHOOT AGAIN', seconds: DEFAULT_MESSAGE_SECONDS })
        } else {
          game.ball += 1
        }

        if (game.ball > game.ballsPerGame) {
          game.phase = 'gameOver'
          cmds.push({ type: 'sound', name: 'gameOver' })
          cmds.push({ type: 'message', text: 'GAME OVER', seconds: GAME_OVER_MESSAGE_SECONDS })
        } else {
          game.phase = 'playing'
          cmds.push({ type: 'message', text: `BALL ${game.ball}`, seconds: DEFAULT_MESSAGE_SECONDS })
          serveBall(cmds, game, false)
        }
      }
    }
  }

  refreshLamps(game, table)
  return cmds
}

/**
 * Recomputes every derived lamp from the current `game` state. Rollover, standup, and drop lamps
 * are set directly by `handleEvent` as they are won and left alone here; everything else is
 * recomputed fresh each call. Left untouched in `'attract'` and `'gameOver'`, where the view runs
 * its own attract light show.
 */
function refreshLamps(game: GameState, table: Table): void {
  const phasesWithLamps: Phase[] = ['playing', 'bonus']
  if (!phasesWithLamps.includes(game.phase)) return

  for (const lamp of MULTIPLIER_LAMPS) {
    game.lamps[lamp.id] = game.bonusMultiplier >= lamp.level ? 'on' : 'off'
  }

  const ballSaveActive = game.ballSaveArmed || game.ballSaveTimer > 0
  game.lamps['lamp.shootAgain'] = game.extraBalls > 0 ? 'on' : ballSaveActive ? 'blink' : 'off'
  game.lamps['lamp.extraBall'] = game.extraBallLit ? 'blink' : 'off'

  for (let i = 0; i < RAMP_PROGRESS_LAMPS.length; i++) {
    game.lamps[RAMP_PROGRESS_LAMPS[i]] = game.multiball ? 'blink' : i < game.rampCount ? 'on' : 'off'
  }
  game.lamps['lamp.jackpot'] = game.multiball ? 'blink' : 'off'
  game.lamps['lamp.spinner'] = game.spinnerLitTimer > 0 ? 'blink' : 'off'
  game.lamps['lamp.super'] = game.superBumperTimer > 0 ? 'blink' : 'off'

  for (const bumper of table.bumpers) {
    game.lamps[bumper.id] = game.superBumperTimer > 0 ? 'blink' : 'on'
  }

  for (const rollover of table.rollovers) {
    if (rollover.group === 'inlane') {
      game.lamps[rollover.id] = game.spinnerLitTimer > 0 ? 'on' : 'off'
    } else if (rollover.group === 'outlane') {
      game.lamps[rollover.id] = 'off'
    }
  }
}
