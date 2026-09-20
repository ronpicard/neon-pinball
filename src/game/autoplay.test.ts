import test from 'node:test'
import assert from 'node:assert/strict'
import type { Ball, Table, TableState } from './types.ts'
import { botInput, simulateGame } from './autoplay.ts'
import { TABLE } from './table.ts'

/** A ball with sensible defaults for whatever a test doesn't care about. */
function makeBall(overrides: Partial<Ball> & Pick<Ball, 'pos' | 'vel'>): Ball {
  return {
    id: 1,
    z: 0,
    ramp: null,
    saucer: null,
    ejectedFrom: null,
    stillTime: 0,
    ...overrides,
  }
}

/**
 * A table with just the two flippers and the plunger zone the botInput tests need, at the same
 * geometry as the real `TABLE` (S1) so the strike-zone and plunger-zone math matches production.
 */
function minimalTable(): Table {
  return {
    width: 22,
    height: 42,
    ballRadius: 0.53,
    gravity: 45,
    walls: [],
    posts: [],
    gates: [],
    bumpers: [],
    slingshots: [],
    standups: [],
    dropTargets: [],
    rollovers: [],
    spinners: [],
    saucers: [],
    ramps: [],
    flippers: [
      {
        id: 'flipper.left',
        side: 'left',
        pivot: { x: 6.0, y: 37.2 },
        length: 3.1,
        radius: 0.4,
        restAngle: 0.52,
        activeAngle: -0.52,
      },
      {
        id: 'flipper.right',
        side: 'right',
        pivot: { x: 14.0, y: 37.2 },
        length: 3.1,
        radius: 0.4,
        restAngle: Math.PI - 0.52,
        activeAngle: Math.PI + 0.52,
      },
    ],
    inserts: [],
    plunger: {
      rest: { x: 21.125, y: 40.45 },
      zone: { min: { x: 20.3, y: 38.5 }, max: { x: 21.95, y: 41 } },
      minSpeed: 45,
      maxSpeed: 112,
    },
    drainY: 42.8,
  }
}

/** A fresh state holding `balls` at `time`, with the plunger pulled back `plungerPull`. */
function minimalState(table: Table, balls: Ball[], time: number, plungerPull = 0): TableState {
  return {
    balls,
    nextBallId: balls.length + 1,
    flippers: table.flippers.map(() => ({ angle: 0, angularVel: 0 })),
    flippersEnabled: true,
    plungerPull,
    droppedTargets: [],
    spinners: [],
    rolloverContacts: [],
    time,
  }
}

test('botInput never nudges', () => {
  const table = minimalTable()
  assert.equal(botInput(table, minimalState(table, [], 3.4)).nudge, null)
})

test('the bot holds the plunger only while a ball waits there, slow, below its pull target', () => {
  const table = minimalTable()

  assert.equal(botInput(table, minimalState(table, [], 0)).plunger, false, 'no ball is waiting')

  // frac(time * 0.37 + id * 0.31) at time 0, id 1 is frac(0.31) = 0.31, so target = 0.72 + 0.26 * 0.31 = 0.8006.
  const waiting = makeBall({ pos: { x: 21, y: 40 }, vel: { x: 0, y: 0 } })
  assert.equal(
    botInput(table, minimalState(table, [waiting], 0, 0.5)).plunger,
    true,
    'the pull is short of the target',
  )
  assert.equal(
    botInput(table, minimalState(table, [waiting], 0, 0.9)).plunger,
    false,
    'the pull has passed the target',
  )

  const alreadyMoving = makeBall({ pos: { x: 21, y: 40 }, vel: { x: 0, y: 5 } })
  assert.equal(
    botInput(table, minimalState(table, [alreadyMoving], 0, 0)).plunger,
    false,
    'a pull is not started for a ball that is still moving',
  )
  assert.equal(
    botInput(table, minimalState(table, [alreadyMoving], 0, 0.1)).plunger,
    true,
    'a pull already under way is carried through while the ball settles',
  )

  const notInZone = makeBall({ pos: { x: 5, y: 5 }, vel: { x: 0, y: 0 } })
  assert.equal(
    botInput(table, minimalState(table, [notInZone], 0, 0.1)).plunger,
    false,
    'no ball is actually in the plunger zone',
  )
})

test('a flipper presses only for a ball inside its own strike zone', () => {
  const table = minimalTable()
  const time = 1 // frac(1 / 1.7) = 0.588..., outside the release window

  const aboveLeft = makeBall({ pos: { x: 8.0, y: 36.5 }, vel: { x: 0, y: 0 } })
  const left = botInput(table, minimalState(table, [aboveLeft], time))
  assert.equal(left.left, true, 'a ball above the left flipper is caught')
  assert.equal(left.right, false)

  const aboveRight = makeBall({ pos: { x: 12.0, y: 36.5 }, vel: { x: 0, y: 0 } })
  const right = botInput(table, minimalState(table, [aboveRight], time))
  assert.equal(right.right, true, 'a ball above the right flipper is caught')
  assert.equal(right.left, false)

  const outOfReach = makeBall({ pos: { x: 2, y: 2 }, vel: { x: 0, y: 0 } })
  assert.equal(botInput(table, minimalState(table, [outOfReach], time)).left, false, 'out of reach')

  const fallingPast = makeBall({ pos: { x: 8.0, y: 36.5 }, vel: { x: 0, y: -20 } })
  assert.equal(
    botInput(table, minimalState(table, [fallingPast], time)).left,
    false,
    'falling too fast to catch',
  )

  const wrongSide = makeBall({ pos: { x: 8.0, y: 39.5 }, vel: { x: 0, y: 0 } })
  assert.equal(
    botInput(table, minimalState(table, [wrongSide], time)).left,
    false,
    'on the wrong side of the flipper',
  )
})

test('the bot releases a held flipper on a regular cycle, so a cradled ball is never pinned forever', () => {
  const table = minimalTable()
  const aboveLeft = makeBall({ pos: { x: 8.0, y: 36.5 }, vel: { x: 0, y: 0 } })
  // frac(0 / 1.7) = 0, inside the release window regardless of the strike zone.
  assert.equal(botInput(table, minimalState(table, [aboveLeft], 0)).left, false)
})

test('simulateGame plays real games to completion, with no ball ever stuck or escaped', () => {
  const maxSeconds = 10 * 60
  const offsets = [0, 5.3, 12.7]
  const results = offsets.map((offset) => simulateGame(TABLE, maxSeconds, offset))

  const totals: Record<string, number> = {}
  let totalScore = 0
  for (const result of results) {
    assert.equal(result.escaped, false, 'a ball escaped the table')
    assert.equal(result.stuck, false, 'a ball got stuck')
    assert.ok(result.seconds < maxSeconds, `game ran to the ${maxSeconds}s cap instead of finishing`)
    totalScore += result.score
    for (const [type, count] of Object.entries(result.counts)) {
      totals[type] = (totals[type] ?? 0) + count
    }
  }

  assert.ok(totalScore > 10000, `expected total score > 10000, got ${totalScore}`)
  for (const type of ['launch', 'gate', 'bumper', 'slingshot', 'rollover', 'flipperHit', 'drain']) {
    assert.ok((totals[type] ?? 0) > 0, `expected at least one '${type}' event across the games, got 0`)
  }
})
