import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BALL_SAVE_SECONDS, SCORES, createGame, handleEvent, startGame, tickGame } from './rules.ts'
import type { GameState, Table } from './types.ts'

/**
 * A small table fixture with the same element ids as the real table (S1): three toplane
 * rollovers, two inlanes, two outlanes, a `left` drop bank of three, a `play` standup group of
 * four, three bumpers, one ramp, one saucer, one spinner. Geometry is arbitrary since the rules
 * never touch positions.
 */
function testTable(): Table {
  return {
    width: 22,
    height: 42,
    ballRadius: 0.53,
    gravity: 45,
    walls: [],
    posts: [],
    gates: [],
    bumpers: [
      { id: 'bumper.left', pos: { x: 6.8, y: 11.5 }, radius: 1.35, kick: 42 },
      { id: 'bumper.right', pos: { x: 13.2, y: 11.5 }, radius: 1.35, kick: 42 },
      { id: 'bumper.low', pos: { x: 10, y: 15.2 }, radius: 1.35, kick: 42 },
    ],
    slingshots: [],
    standups: [
      { id: 'play.p', a: { x: 19.8, y: 20.0 }, b: { x: 19.8, y: 21.1 }, group: 'play' },
      { id: 'play.l', a: { x: 19.8, y: 21.3 }, b: { x: 19.8, y: 22.4 }, group: 'play' },
      { id: 'play.a', a: { x: 19.8, y: 22.6 }, b: { x: 19.8, y: 23.7 }, group: 'play' },
      { id: 'play.y', a: { x: 19.8, y: 23.9 }, b: { x: 19.8, y: 25.0 }, group: 'play' },
    ],
    dropTargets: [
      { id: 'drop.1', a: { x: 0.45, y: 21.5 }, b: { x: 0.45, y: 22.8 }, bank: 'left' },
      { id: 'drop.2', a: { x: 0.45, y: 22.95 }, b: { x: 0.45, y: 24.25 }, bank: 'left' },
      { id: 'drop.3', a: { x: 0.45, y: 24.4 }, b: { x: 0.45, y: 25.7 }, bank: 'left' },
    ],
    rollovers: [
      { id: 'lane.a', pos: { x: 7.6, y: 5.6 }, radius: 0.6, group: 'toplane' },
      { id: 'lane.b', pos: { x: 10, y: 5.6 }, radius: 0.6, group: 'toplane' },
      { id: 'lane.c', pos: { x: 12.4, y: 5.6 }, radius: 0.6, group: 'toplane' },
      { id: 'inlane.left', pos: { x: 2.95, y: 31 }, radius: 0.6, group: 'inlane' },
      { id: 'inlane.right', pos: { x: 17.05, y: 31 }, radius: 0.6, group: 'inlane' },
      { id: 'outlane.left', pos: { x: 1.0, y: 31.5 }, radius: 0.6, group: 'outlane' },
      { id: 'outlane.right', pos: { x: 19.1, y: 31.5 }, radius: 0.6, group: 'outlane' },
    ],
    spinners: [{ id: 'spinner.left', a: { x: 0.15, y: 14 }, b: { x: 2.45, y: 14 } }],
    saucers: [{ id: 'saucer.right', pos: { x: 19.5, y: 17.0 }, radius: 0.9, hold: 1.2, eject: { x: -32, y: -14 } }],
    ramps: [
      {
        id: 'ramp.main',
        entry: { a: { x: 14.1, y: 22.5 }, b: { x: 15.9, y: 22.5 } },
        path: [
          { x: 15.0, y: 22.5 },
          { x: 15.6, y: 19.0 },
          { x: 2.95, y: 30.0 },
        ],
        heights: [0, 1.4, 0],
      },
    ],
    flippers: [],
    inserts: [],
    plunger: { rest: { x: 21.125, y: 40.45 }, zone: { min: { x: 20.3, y: 38.5 }, max: { x: 21.95, y: 41 } }, minSpeed: 45, maxSpeed: 112 },
    drainY: 42.8,
  }
}

/** A game already `startGame`-ed on `testTable()`, with its startup commands discarded. */
function playingGame(): { game: GameState; table: Table } {
  const table = testTable()
  const game = createGame()
  startGame(game, table)
  return { game, table }
}

// ---------------------------------------------------------------------------------------------
// createGame / startGame
// ---------------------------------------------------------------------------------------------

test('createGame: attract phase, three balls, everything zeroed', () => {
  const game = createGame()
  assert.equal(game.phase, 'attract')
  assert.equal(game.ballsPerGame, 3)
  assert.equal(game.score, 0)
  assert.equal(game.ball, 1)
  assert.equal(game.ballsInPlay, 0)
  assert.equal(game.bonusMultiplier, 1)
  assert.equal(game.tilted, false)
  assert.deepEqual(game.lamps, {})
})

test('startGame: resets state, serves ball 1, and issues the startup commands', () => {
  const table = testTable()
  const game = createGame()
  game.score = 999
  const cmds = startGame(game, table)

  assert.equal(game.phase, 'playing')
  assert.equal(game.score, 0)
  assert.equal(game.ball, 1)
  assert.equal(game.ballSaveArmed, true)
  assert.equal(game.ballsInPlay, 1)

  assert.deepEqual(
    cmds.filter((c) => c.type !== 'sound' && c.type !== 'message'),
    [
      { type: 'setFlippersEnabled', enabled: true },
      { type: 'resetDropBank', bank: 'left' },
      { type: 'serveBall', auto: false },
    ],
  )
  assert.ok(cmds.some((c) => c.type === 'sound' && c.name === 'gameStart'))
  assert.ok(cmds.some((c) => c.type === 'message' && c.text === 'BALL 1'))
})

// ---------------------------------------------------------------------------------------------
// Phase / tilt gating
// ---------------------------------------------------------------------------------------------

test('handleEvent: ignored outside the playing phase', () => {
  const table = testTable()
  const game = createGame()
  const cmds = handleEvent(game, { type: 'bumper', id: 'bumper.left', speed: 10 }, table)
  assert.equal(game.score, 0)
  assert.deepEqual(cmds, [])
})

test('handleEvent: while tilted, only drain is handled', () => {
  const { game, table } = playingGame()
  game.tilted = true
  game.ballsInPlay = 1

  handleEvent(game, { type: 'bumper', id: 'bumper.left', speed: 10 }, table)
  assert.equal(game.score, 0)

  handleEvent(game, { type: 'drain', ballId: 1 }, table)
  assert.equal(game.ballsInPlay, 0)
})

test('handleEvent: the first scoring switch after serve arms the ball save', () => {
  const { game, table } = playingGame()
  assert.equal(game.ballSaveArmed, true)
  handleEvent(game, { type: 'slingshot', id: 'sling.left' }, table)
  assert.equal(game.ballSaveArmed, false)
  assert.equal(game.ballSaveTimer, BALL_SAVE_SECONDS)
})

// ---------------------------------------------------------------------------------------------
// Bumpers / slingshots
// ---------------------------------------------------------------------------------------------

test('bumper: scores normally, and 10x while super is active', () => {
  const { game, table } = playingGame()
  handleEvent(game, { type: 'bumper', id: 'bumper.left', speed: 10 }, table)
  assert.equal(game.score, SCORES.bumper)

  game.superBumperTimer = 5
  handleEvent(game, { type: 'bumper', id: 'bumper.left', speed: 10 }, table)
  assert.equal(game.score, SCORES.bumper + SCORES.bumperSuper)
})

test('slingshot: scores a small fixed amount', () => {
  const { game, table } = playingGame()
  handleEvent(game, { type: 'slingshot', id: 'sling.left' }, table)
  assert.equal(game.score, SCORES.slingshot)
})

// ---------------------------------------------------------------------------------------------
// Standups
// ---------------------------------------------------------------------------------------------

test('standup: first hit lights it and adds to the bonus, repeat hit scores less', () => {
  const { game, table } = playingGame()
  handleEvent(game, { type: 'standup', id: 'play.p' }, table)
  assert.equal(game.score, SCORES.standupFirst)
  assert.equal(game.bonus, SCORES.standupFirst)
  assert.equal(game.lamps['play.p'], 'on')

  handleEvent(game, { type: 'standup', id: 'play.p' }, table)
  assert.equal(game.score, SCORES.standupFirst + SCORES.standupRepeat)
})

test('standup: lighting the whole group awards the bank bonus and lights an extra ball once', () => {
  const { game, table } = playingGame()
  for (const id of ['play.p', 'play.l', 'play.a']) handleEvent(game, { type: 'standup', id }, table)
  const before = game.score
  handleEvent(game, { type: 'standup', id: 'play.y' }, table)

  assert.equal(game.score, before + SCORES.standupFirst + SCORES.standupBankComplete)
  for (const id of ['play.p', 'play.l', 'play.a', 'play.y']) assert.equal(game.lamps[id], 'off')
  assert.equal(game.extraBallLit, true)
  assert.equal(game.extraBallAwarded, true)
})

// ---------------------------------------------------------------------------------------------
// Drop targets
// ---------------------------------------------------------------------------------------------

test('drop: scores and adds to the bonus, lighting its lamp', () => {
  const { game, table } = playingGame()
  handleEvent(game, { type: 'drop', id: 'drop.1' }, table)
  assert.equal(game.score, SCORES.dropTarget)
  assert.equal(game.bonus, SCORES.dropTarget)
  assert.equal(game.lamps['drop.1'], 'on')
})

test('drop: completing the bank scores the bonus, resets it, and lights the spinner', () => {
  const { game, table } = playingGame()
  handleEvent(game, { type: 'drop', id: 'drop.1' }, table)
  handleEvent(game, { type: 'drop', id: 'drop.2' }, table)
  const before = game.score
  const cmds = handleEvent(game, { type: 'drop', id: 'drop.3' }, table)

  assert.equal(game.score, before + SCORES.dropTarget + SCORES.dropBankComplete)
  assert.ok(cmds.some((c) => c.type === 'resetDropBank' && c.bank === 'left'))
  for (const id of ['drop.1', 'drop.2', 'drop.3']) assert.equal(game.lamps[id], 'off')
  assert.equal(game.spinnerLitTimer, 20)
})

// ---------------------------------------------------------------------------------------------
// Rollovers
// ---------------------------------------------------------------------------------------------

test('rollover toplane: lights, scores less on repeat, and completes for a bonus multiplier', () => {
  const { game, table } = playingGame()
  handleEvent(game, { type: 'rollover', id: 'lane.a' }, table)
  assert.equal(game.score, SCORES.toplaneFirst)
  handleEvent(game, { type: 'rollover', id: 'lane.a' }, table)
  assert.equal(game.score, SCORES.toplaneFirst + SCORES.toplaneRepeat)

  handleEvent(game, { type: 'rollover', id: 'lane.b' }, table)
  const before = game.score
  handleEvent(game, { type: 'rollover', id: 'lane.c' }, table)

  assert.equal(game.score, before + SCORES.toplaneFirst + SCORES.toplaneComplete)
  assert.equal(game.bonusMultiplier, 2)
  assert.equal(game.superBumperTimer, 20)
  for (const id of ['lane.a', 'lane.b', 'lane.c']) assert.equal(game.lamps[id], 'off')
})

test('rollover inlane: scores and lights the spinner', () => {
  const { game, table } = playingGame()
  handleEvent(game, { type: 'rollover', id: 'inlane.left' }, table)
  assert.equal(game.score, SCORES.inlane)
  assert.equal(game.spinnerLitTimer, 8)
})

test('rollover outlane: scores a large fixed amount', () => {
  const { game, table } = playingGame()
  handleEvent(game, { type: 'rollover', id: 'outlane.left' }, table)
  assert.equal(game.score, SCORES.outlane)
})

test('flipperUp: rotates the toplane lamp pattern left and right', () => {
  const { game, table } = playingGame()
  const toplanes = (g: GameState) => ['lane.a', 'lane.b', 'lane.c'].map((id) => g.lamps[id] ?? 'off')

  handleEvent(game, { type: 'rollover', id: 'lane.a' }, table)
  assert.deepEqual(toplanes(game), ['on', 'off', 'off'])

  handleEvent(game, { type: 'flipperUp', side: 'left' }, table)
  assert.deepEqual(toplanes(game), ['off', 'off', 'on'])

  handleEvent(game, { type: 'flipperUp', side: 'right' }, table)
  assert.deepEqual(toplanes(game), ['on', 'off', 'off'])
})

// ---------------------------------------------------------------------------------------------
// Spinner, ramp, saucer, launch
// ---------------------------------------------------------------------------------------------

test('spinner: scores more while lit', () => {
  const { game, table } = playingGame()
  handleEvent(game, { type: 'spinner', id: 'spinner.left' }, table)
  assert.equal(game.score, SCORES.spinner)

  game.spinnerLitTimer = 5
  handleEvent(game, { type: 'spinner', id: 'spinner.left' }, table)
  assert.equal(game.score, SCORES.spinner + SCORES.spinnerLit)
})

test('rampEnter: makes a sound and scores nothing', () => {
  const { game, table } = playingGame()
  const cmds = handleEvent(game, { type: 'rampEnter', id: 'ramp.main' }, table)
  assert.equal(game.score, 0)
  assert.ok(cmds.some((c) => c.type === 'sound' && c.name === 'rampEnter'))
})

test('rampMade: combos while the combo timer is running, and resets after it lapses', () => {
  const { game, table } = playingGame()
  handleEvent(game, { type: 'rampMade', id: 'ramp.main' }, table)
  assert.equal(game.score, SCORES.rampMade)
  assert.equal(game.comboCount, 1)

  handleEvent(game, { type: 'rampMade', id: 'ramp.main' }, table)
  assert.equal(game.score, SCORES.rampMade + SCORES.rampMade * 2)
  assert.equal(game.comboCount, 2)

  game.comboTimer = 0
  const before = game.score
  handleEvent(game, { type: 'rampMade', id: 'ramp.main' }, table)
  assert.equal(game.comboCount, 1)
  assert.equal(game.score, before + SCORES.rampMade)
})

test('rampMade: three ramps start multiball and serve two more balls', () => {
  const { game, table } = playingGame()
  handleEvent(game, { type: 'rampMade', id: 'ramp.main' }, table)
  handleEvent(game, { type: 'rampMade', id: 'ramp.main' }, table)
  const ballsBefore = game.ballsInPlay
  const cmds = handleEvent(game, { type: 'rampMade', id: 'ramp.main' }, table)

  assert.equal(game.multiball, true)
  assert.equal(game.rampCount, 0)
  assert.equal(game.ballsInPlay, ballsBefore + 2)
  assert.equal(cmds.filter((c) => c.type === 'serveBall').length, 2)
  assert.ok(cmds.some((c) => c.type === 'message' && c.text === 'MULTIBALL'))
})

test('rampMade: scores a jackpot in multiball instead of the normal ramp value', () => {
  const { game, table } = playingGame()
  game.multiball = true
  handleEvent(game, { type: 'rampMade', id: 'ramp.main' }, table)
  assert.equal(game.score, SCORES.rampJackpot)
})

test('saucerCapture: awards an extra ball when one is lit', () => {
  const { game, table } = playingGame()
  game.extraBallLit = true
  handleEvent(game, { type: 'saucerCapture', id: 'saucer.right' }, table)
  assert.equal(game.score, SCORES.saucerCapture)
  assert.equal(game.extraBalls, 1)
  assert.equal(game.extraBallLit, false)
})

test('saucerCapture: otherwise cycles through the four mystery awards in order', () => {
  const { game, table } = playingGame()
  game.ballSaveArmed = false
  game.ballSaveTimer = 0

  handleEvent(game, { type: 'saucerCapture', id: 'saucer.right' }, table)
  assert.equal(game.score, SCORES.saucerCapture + SCORES.mysteryJackpot)

  handleEvent(game, { type: 'saucerCapture', id: 'saucer.right' }, table)
  assert.equal(game.spinnerLitTimer, 20)

  handleEvent(game, { type: 'saucerCapture', id: 'saucer.right' }, table)
  assert.equal(game.bonusMultiplier, 2)

  handleEvent(game, { type: 'saucerCapture', id: 'saucer.right' }, table)
  assert.equal(game.ballSaveTimer, 10)

  const before = game.score
  handleEvent(game, { type: 'saucerCapture', id: 'saucer.right' }, table)
  assert.equal(game.score, before + SCORES.saucerCapture + SCORES.mysteryJackpot)
})

test('saucerEject and launch: sound only, no score', () => {
  const { game, table } = playingGame()
  handleEvent(game, { type: 'saucerEject', id: 'saucer.right' }, table)
  handleEvent(game, { type: 'launch', speed: 50 }, table)
  assert.equal(game.score, 0)
})

// ---------------------------------------------------------------------------------------------
// Tilt
// ---------------------------------------------------------------------------------------------

test('nudge: below the limit just raises the meter', () => {
  const { game, table } = playingGame()
  handleEvent(game, { type: 'nudge', direction: 'left' }, table)
  assert.equal(game.tiltMeter, 1)
  assert.equal(game.tiltWarnings, 0)
})

test('nudge: crossing the limit resets the meter and warns', () => {
  const { game, table } = playingGame()
  game.tiltMeter = 2.1
  const cmds = handleEvent(game, { type: 'nudge', direction: 'left' }, table)

  assert.equal(game.tiltMeter, 1)
  assert.equal(game.tiltWarnings, 1)
  assert.equal(game.tilted, false)
  assert.ok(cmds.some((c) => c.type === 'message' && c.text === 'DANGER'))
})

test('nudge: the third warning tilts the game and stops scoring', () => {
  const { game, table } = playingGame()
  game.ballsInPlay = 1
  game.tiltWarnings = 2
  game.tiltMeter = 2.1
  game.bonus = 500

  const cmds = handleEvent(game, { type: 'nudge', direction: 'left' }, table)

  assert.equal(game.tilted, true)
  assert.equal(game.tiltWarnings, 3)
  assert.equal(game.bonus, 0)
  assert.ok(cmds.some((c) => c.type === 'setFlippersEnabled' && c.enabled === false))
  assert.ok(cmds.some((c) => c.type === 'message' && c.text === 'TILT'))

  handleEvent(game, { type: 'bumper', id: 'bumper.left', speed: 10 }, table)
  assert.equal(game.score, 0)
})

test('tilt clears on the next ball', () => {
  const { game, table } = playingGame()
  game.ballsInPlay = 1
  game.tilted = true
  game.bonus = 500

  handleEvent(game, { type: 'drain', ballId: 1 }, table)
  assert.equal(game.phase, 'bonus')

  tickGame(game, 10, table)

  assert.equal(game.tilted, false)
  assert.equal(game.phase, 'playing')
})

// ---------------------------------------------------------------------------------------------
// Drain, ball save, and end-of-ball / end-of-game flow
// ---------------------------------------------------------------------------------------------

test('drain: never takes ballsInPlay below zero', () => {
  const { game, table } = playingGame()
  game.ballsInPlay = 0
  game.ballSaveArmed = false
  handleEvent(game, { type: 'drain', ballId: 1 }, table)
  assert.equal(game.ballsInPlay, 0)
})

test('ball save: re-serves the ball and does not advance the ball number', () => {
  const { game, table } = playingGame()
  game.ballsInPlay = 1
  assert.equal(game.ball, 1)

  const cmds = handleEvent(game, { type: 'drain', ballId: 1 }, table)

  assert.equal(game.phase, 'playing')
  assert.equal(game.ball, 1)
  assert.equal(game.ballsInPlay, 1)
  assert.ok(cmds.some((c) => c.type === 'serveBall' && c.auto === true))
  assert.ok(cmds.some((c) => c.type === 'message' && c.text === 'BALL SAVED'))
})

test('drain with no ball save left starts the bonus count for the last ball', () => {
  const { game, table } = playingGame()
  game.ballsInPlay = 1
  game.ballSaveArmed = false
  game.ballSaveTimer = 0
  game.bonus = 1234
  game.bonusMultiplier = 2

  const cmds = handleEvent(game, { type: 'drain', ballId: 1 }, table)

  assert.equal(game.phase, 'bonus')
  assert.equal(game.ballsInPlay, 0)
  assert.ok(cmds.some((c) => c.type === 'message' && c.text === 'BONUS 1234 X2'))
})

test('tickGame: counts down the bonus and adds it to the score before the next ball', () => {
  const { game, table } = playingGame()
  game.phase = 'bonus'
  game.bonusTimer = 2.2
  game.bonus = 1000
  game.bonusMultiplier = 2
  game.ball = 1

  let cmds: ReturnType<typeof tickGame> = []
  for (let i = 0; i < 30; i++) cmds = cmds.concat(tickGame(game, 0.1, table))

  assert.equal(game.score, 2000)
  assert.equal(game.phase, 'playing')
  assert.equal(game.ball, 2)
  assert.ok(cmds.some((c) => c.type === 'serveBall'))
  assert.ok(cmds.some((c) => c.type === 'message' && c.text === 'BALL 2'))
})

test('tickGame: an extra ball replays the same ball number instead of advancing', () => {
  const { game, table } = playingGame()
  game.phase = 'bonus'
  game.bonusTimer = 0.1
  game.ball = 2
  game.extraBalls = 1

  const cmds = tickGame(game, 1, table)

  assert.equal(game.ball, 2)
  assert.equal(game.extraBalls, 0)
  assert.equal(game.phase, 'playing')
  assert.ok(cmds.some((c) => c.type === 'message' && c.text === 'SHOOT AGAIN'))
})

test('a full three-ball game reaches gameOver with the bonus added', () => {
  const { game, table } = playingGame()

  for (let ball = 1; ball <= 3; ball++) {
    assert.equal(game.phase, 'playing')
    game.bonus = 100
    game.ballsInPlay = 1
    game.ballSaveArmed = false
    game.ballSaveTimer = 0
    handleEvent(game, { type: 'drain', ballId: 1 }, table)
    assert.equal(game.phase, 'bonus')
    for (let i = 0; i < 30; i++) tickGame(game, 0.1, table)
  }

  assert.equal(game.phase, 'gameOver')
  assert.ok(game.score >= 300)
})
