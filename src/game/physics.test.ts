import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Gate, Input, PhysicsEvent, Table, TableState } from './types.ts'
import {
  AUTO_LAUNCH_SPEED,
  FIXED_DT,
  MAX_BALL_SPEED,
  addBall,
  autoLaunch,
  ballAtPlunger,
  createTableState,
  flipperTip,
  rampLength,
  rampPoint,
  resetDropBank,
  stepTable,
} from './physics.ts'

/**
 * Builds a `Table` by hand, filling every field with an empty array or a sane default, then
 * applying `overrides`. `table.ts` (which builds the real table) is being written concurrently, so
 * tests here never import it.
 */
function makeTable(overrides: Partial<Table> = {}): Table {
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
    flippers: [],
    inserts: [],
    plunger: {
      rest: { x: 21, y: 40 },
      zone: { min: { x: 20, y: 38 }, max: { x: 22, y: 41 } },
      minSpeed: 45,
      maxSpeed: 112,
    },
    drainY: 42.8,
    ...overrides,
  }
}

const NO_INPUT: Input = { left: false, right: false, plunger: false, nudge: null }

function withInput(partial: Partial<Input>): Input {
  return { ...NO_INPUT, ...partial }
}

/** Runs `stepTable` `n` times with `input`, returning every event seen along the way. */
function runSteps(table: Table, state: TableState, input: Input, n: number): PhysicsEvent[] {
  const events: PhysicsEvent[] = []
  for (let i = 0; i < n; i++) events.push(...stepTable(table, state, input, FIXED_DT))
  return events
}

describe('createTableState / addBall', () => {
  it('starts with no balls, flippers at rest, and nothing dropped', () => {
    const table = makeTable({
      flippers: [
        {
          id: 'f',
          side: 'left',
          pivot: { x: 0, y: 0 },
          length: 3,
          radius: 0.4,
          restAngle: 0.5,
          activeAngle: -0.5,
        },
      ],
      dropTargets: [{ id: 'd', a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, bank: 'left' }],
    })
    const state = createTableState(table)
    assert.deepEqual(state.balls, [])
    assert.equal(state.flippers.length, 1)
    assert.equal(state.flippers[0].angle, 0.5)
    assert.equal(state.flippers[0].angularVel, 0)
    assert.deepEqual(state.droppedTargets, [])
  })

  it('assigns increasing ids', () => {
    const table = makeTable()
    const state = createTableState(table)
    const a = addBall(state, { x: 1, y: 1 })
    const b = addBall(state, { x: 2, y: 2 })
    assert.notEqual(a.id, b.id)
    assert.equal(state.balls.length, 2)
  })
})

describe('flipperTip / rampLength / rampPoint', () => {
  it('flipperTip sits length away from the pivot at the given angle', () => {
    const flipper = {
      id: 'f',
      side: 'left' as const,
      pivot: { x: 5, y: 5 },
      length: 3,
      radius: 0.4,
      restAngle: 0,
      activeAngle: -1,
    }
    const tip = flipperTip(flipper, 0)
    assert.ok(Math.abs(tip.x - 8) < 1e-9)
    assert.ok(Math.abs(tip.y - 5) < 1e-9)
  })

  it('rampLength sums the path segments, and rampPoint interpolates position and height', () => {
    const ramp = {
      id: 'r',
      entry: { a: { x: 0, y: 0 }, b: { x: 2, y: 0 } },
      path: [{ x: 1, y: 0 }, { x: 1, y: -10 }],
      heights: [0, 4],
    }
    assert.ok(Math.abs(rampLength(ramp) - 10) < 1e-9)
    const mid = rampPoint(ramp, 5)
    assert.ok(Math.abs(mid.pos.y - -5) < 1e-9)
    assert.ok(Math.abs(mid.z - 2) < 1e-9)
    assert.ok(Math.abs(mid.tangent.y - -1) < 1e-9)
    const clampedEnd = rampPoint(ramp, 999)
    assert.ok(Math.abs(clampedEnd.pos.y - -10) < 1e-9)
  })
})

describe('gravity and walls', () => {
  it('a ball falls under gravity', () => {
    const table = makeTable()
    const state = createTableState(table)
    const ball = addBall(state, { x: 10, y: 10 })
    stepTable(table, state, NO_INPUT, FIXED_DT)
    assert.ok(Math.abs(ball.vel.y - table.gravity * FIXED_DT) < 1e-4)
    assert.ok(ball.pos.y > 10)
  })

  it('bounces off a floor wall keeping ~restitution of its speed', () => {
    const restitution = 0.5
    const table = makeTable({
      gravity: 0,
      walls: [{ id: 'floor', a: { x: 0, y: 20 }, b: { x: 20, y: 20 }, restitution, kind: 'rail' }],
    })
    const state = createTableState(table)
    const ball = addBall(state, { x: 10, y: 19.9 }, { x: 0, y: 40 })
    const incoming = ball.vel.y
    const events = stepTable(table, state, NO_INPUT, FIXED_DT)
    assert.ok(events.some((e) => e.type === 'wallHit' && e.kind === 'rail'))
    assert.ok(Math.abs(ball.vel.y - -restitution * incoming) < 0.1)
  })

  it('never tunnels through a wall at MAX_BALL_SPEED', () => {
    const table = makeTable({
      gravity: 0,
      walls: [{ id: 'floor', a: { x: 0, y: 20 }, b: { x: 20, y: 20 }, restitution: 0.3, kind: 'rail' }],
    })
    const state = createTableState(table)
    const ball = addBall(state, { x: 10, y: 10 }, { x: 0, y: 1e6 })
    for (let i = 0; i < 300; i++) {
      stepTable(table, state, NO_INPUT, FIXED_DT)
      assert.ok(Math.hypot(ball.vel.x, ball.vel.y) <= MAX_BALL_SPEED + 1e-6, 'speed clamped')
      assert.ok(ball.pos.y < 20 + table.ballRadius + 0.1, `ball tunnelled: pos.y=${ball.pos.y}`)
    }
  })
})

describe('bumpers and slingshots', () => {
  it('a bumper kicks the ball away at at least its kick speed', () => {
    const bumper = { id: 'b', pos: { x: 10, y: 10 }, radius: 1, kick: 20 }
    const table = makeTable({ gravity: 0, bumpers: [bumper] })
    const state = createTableState(table)
    const ball = addBall(state, { x: 10, y: 8.4 }, { x: 0, y: 50 })
    const events = runSteps(table, state, NO_INPUT, 5)
    const hit = events.find((e) => e.type === 'bumper')
    assert.ok(hit)
    assert.ok(Math.hypot(ball.vel.x, ball.vel.y) >= 20 - 1e-6)
  })

  it('a slingshot face adds its kick', () => {
    const slingshot = { id: 's', a: { x: 0, y: 10 }, b: { x: 10, y: 10 }, c: { x: 5, y: 12 }, kick: 25 }
    const table = makeTable({ gravity: 0, slingshots: [slingshot] })
    const state = createTableState(table)
    const ball = addBall(state, { x: 5, y: 9.8 }, { x: 0, y: 20 })
    const events = runSteps(table, state, NO_INPUT, 3)
    assert.ok(events.some((e) => e.type === 'slingshot' && e.id === 's'))
    // The a-b face's outward normal (away from c, which is above) points further up, i.e. -y.
    assert.ok(ball.vel.y < -25 + 1)
  })
})

describe('targets', () => {
  it('a drop target drops once then lets the ball through, and resetDropBank raises it', () => {
    const target = { id: 'd1', a: { x: 10, y: 0 }, b: { x: 10, y: 5 }, bank: 'left' }
    const table = makeTable({ gravity: 0, dropTargets: [target] })
    const state = createTableState(table)
    const ball = addBall(state, { x: 9.6, y: 2.5 }, { x: 20, y: 0 })

    const events = runSteps(table, state, NO_INPUT, 3)
    assert.ok(events.some((e) => e.type === 'drop' && e.id === 'd1'))
    assert.ok(state.droppedTargets.includes('d1'))

    // Send the ball at the target again: with it down, the ball passes straight through.
    ball.pos = { x: 9.3, y: 2.5 }
    ball.vel = { x: 20, y: 0 }
    const secondPass = runSteps(table, state, NO_INPUT, 40)
    assert.ok(!secondPass.some((e) => e.type === 'drop'))
    assert.ok(ball.pos.x > 10.5)

    resetDropBank(table, state, 'left')
    assert.ok(!state.droppedTargets.includes('d1'))
  })

  it('a standup emits on a hard hit only', () => {
    const standup = { id: 'st', a: { x: 10, y: 0 }, b: { x: 10, y: 5 }, group: 'play' }
    const soft = makeTable({ gravity: 0, standups: [standup] })
    const softState = createTableState(soft)
    addBall(softState, { x: 9.3, y: 2.5 }, { x: 3, y: 0 })
    const softEvents = runSteps(soft, softState, NO_INPUT, 5)
    assert.ok(!softEvents.some((e) => e.type === 'standup'))

    const hard = makeTable({ gravity: 0, standups: [standup] })
    const hardState = createTableState(hard)
    addBall(hardState, { x: 9.3, y: 2.5 }, { x: 20, y: 0 })
    const hardEvents = runSteps(hard, hardState, NO_INPUT, 5)
    assert.ok(hardEvents.some((e) => e.type === 'standup' && e.id === 'st'))
  })

  it('a rollover fires once per pass', () => {
    const rollover = { id: 'r', pos: { x: 10, y: 10 }, radius: 0.6, group: 'inlane' as const }
    const table = makeTable({ gravity: 0, rollovers: [rollover] })
    const state = createTableState(table)
    addBall(state, { x: 7, y: 10 }, { x: 60, y: 0 })
    const events = runSteps(table, state, NO_INPUT, 60)
    assert.equal(events.filter((e) => e.type === 'rollover').length, 1)
  })
})

describe('spinner', () => {
  it('spins and emits at least one spinner event', () => {
    const table = makeTable({ gravity: 0, spinners: [{ id: 'sp', a: { x: 10, y: 8 }, b: { x: 10, y: 12 } }] })
    const state = createTableState(table)
    addBall(state, { x: 8, y: 10 }, { x: 30, y: 0 })
    const events = runSteps(table, state, NO_INPUT, 200)
    assert.ok(events.some((e) => e.type === 'spinner'))
    assert.ok(state.spinners[0].angle !== 0)
  })
})

describe('gate', () => {
  it('passes one way and blocks the other', () => {
    const gate: Gate = { id: 'g', a: { x: 10, y: 0 }, b: { x: 10, y: 10 } }
    // leftNormal(a, b) here is (-1, 0): the solid side is x <= 10, the free side is x > 10.
    const table = makeTable({ gravity: 0, ballRadius: 1, gates: [gate] })

    const passState = createTableState(table)
    const passingBall = addBall(passState, { x: 10.3, y: 5 }, { x: -60, y: 0 })
    const passEvents = runSteps(table, passState, NO_INPUT, 10)
    assert.equal(passEvents.filter((e) => e.type === 'gate').length, 1)
    assert.ok(passingBall.pos.x < 10, 'a ball crossing from the free side should pass through')

    const blockState = createTableState(table)
    const blockedBall = addBall(blockState, { x: 9.7, y: 5 }, { x: 20, y: 0 })
    const blockEvents = runSteps(table, blockState, NO_INPUT, 5)
    assert.ok(!blockEvents.some((e) => e.type === 'gate'))
    assert.ok(blockedBall.pos.x < 10, 'a ball on the solid side should not cross back to the free side')
  })
})

describe('saucer', () => {
  it('captures, holds for `hold`, then ejects with `eject`, and does not immediately recapture', () => {
    const saucer = { id: 'sa', pos: { x: 10, y: 10 }, radius: 1, hold: 0.5, eject: { x: 0, y: -30 } }
    const table = makeTable({ gravity: 0, saucers: [saucer] })
    const state = createTableState(table)
    const ball = addBall(state, { x: 10, y: 9.7 }, { x: 0, y: 5 })

    const captureEvents = runSteps(table, state, NO_INPUT, 3)
    assert.ok(captureEvents.some((e) => e.type === 'saucerCapture'))
    assert.ok(ball.saucer)
    assert.deepEqual(ball.vel, { x: 0, y: 0 })

    const holdSteps = Math.ceil(0.5 / FIXED_DT) + 2
    const ejectEvents = runSteps(table, state, NO_INPUT, holdSteps)
    const eject = ejectEvents.find((e) => e.type === 'saucerEject')
    assert.ok(eject)
    assert.ok(!state.balls.every((b) => b.saucer))
    assert.equal(ball.saucer, null)
    assert.equal(ball.ejectedFrom, 'sa')

    // Immediately after ejecting, the ball must not be recaptured even though it starts inside the
    // saucer's radius (it only clears the guard once it has rolled `radius + ballRadius` away).
    const afterEject = runSteps(table, state, NO_INPUT, 2)
    assert.ok(!afterEject.some((e) => e.type === 'saucerCapture'))
  })
})

describe('ramp', () => {
  const ramp = {
    id: 'r1',
    entry: { a: { x: 4, y: 0 }, b: { x: 8, y: 0 } },
    path: [{ x: 6, y: 0 }, { x: 6, y: -5 }],
    heights: [0, 3],
  }

  it('a fast ball climbs the ramp and emits rampEnter then rampMade', () => {
    const table = makeTable({ ramps: [ramp] })
    const state = createTableState(table)
    addBall(state, { x: 6, y: 1 }, { x: 0, y: -80 })
    const events = runSteps(table, state, NO_INPUT, 1000)
    const enterIndex = events.findIndex((e) => e.type === 'rampEnter')
    const madeIndex = events.findIndex((e) => e.type === 'rampMade')
    assert.ok(enterIndex >= 0, 'expected a rampEnter event')
    assert.ok(madeIndex >= 0, 'expected a rampMade event')
    assert.ok(enterIndex < madeIndex)
  })

  it('a slow ball rolls back out of the entry', () => {
    const table = makeTable({ ramps: [ramp] })
    const state = createTableState(table)
    const ball = addBall(state, { x: 6, y: 1 }, { x: 0, y: -10 })
    const events = runSteps(table, state, NO_INPUT, 1000)
    assert.ok(events.some((e) => e.type === 'rampEnter'))
    assert.ok(!events.some((e) => e.type === 'rampMade'))
    assert.equal(ball.ramp, null)
  })
})

describe('plunger', () => {
  // A floor under the rest position, like the real table's `wall.plungerStop`, so the ball sits
  // still while the plunger is held instead of free-falling out of the zone.
  const plungerStop = {
    id: 'stop',
    a: { x: 20, y: 41 },
    b: { x: 22, y: 41 },
    restitution: 0.2,
    kind: 'rail' as const,
  }

  function launchWithPull(holdSteps: number): number {
    const table = makeTable({ walls: [plungerStop] })
    const state = createTableState(table)
    addBall(state, table.plunger.rest)
    runSteps(table, state, withInput({ plunger: true }), holdSteps)
    const events = stepTable(table, state, withInput({ plunger: false }), FIXED_DT)
    const launch = events.find((e) => e.type === 'launch')
    assert.ok(launch)
    return launch.type === 'launch' ? launch.speed : 0
  }

  it('launches harder with a longer pull and emits launch', () => {
    const shortPull = launchWithPull(48)
    const longPull = launchWithPull(384)
    assert.ok(longPull > shortPull)
    assert.ok(shortPull >= 45 - 1e-6 && shortPull <= 112 + 1e-6)
    assert.ok(longPull >= 45 - 1e-6 && longPull <= 112 + 1e-6)
  })

  it('autoLaunch fires a waiting ball and reports when none is waiting', () => {
    const table = makeTable()
    const state = createTableState(table)
    const events: PhysicsEvent[] = []
    assert.equal(autoLaunch(table, state, events), false)

    const ball = addBall(state, table.plunger.rest)
    assert.equal(ballAtPlunger(table, state), ball)
    assert.equal(autoLaunch(table, state, events), true)
    assert.deepEqual(ball.vel, { x: 0, y: -AUTO_LAUNCH_SPEED })
    assert.ok(events.some((e) => e.type === 'launch'))
  })
})

describe('flippers', () => {
  const flipper = {
    id: 'left',
    side: 'left' as const,
    pivot: { x: 0, y: 10 },
    length: 3,
    radius: 0.4,
    restAngle: 0,
    activeAngle: -0.6,
  }

  it('a rising flipper throws a resting ball upward and emits flipperUp/flipperHit', () => {
    const table = makeTable({ flippers: [flipper] })
    const state = createTableState(table)
    const ball = addBall(state, { x: 1.5, y: 9.1 }, { x: 0, y: 0 })
    const events = runSteps(table, state, withInput({ left: true }), 15)
    assert.ok(events.some((e) => e.type === 'flipperUp' && e.side === 'left'))
    assert.ok(events.some((e) => e.type === 'flipperHit'))
    assert.ok(ball.vel.y < -20, `expected a strong upward throw, got vel.y=${ball.vel.y}`)
  })

  it('disabled flippers do not move', () => {
    const table = makeTable({ flippers: [flipper] })
    const state = createTableState(table)
    state.flippersEnabled = false
    const events = runSteps(table, state, withInput({ left: true }), 10)
    assert.equal(state.flippers[0].angle, flipper.restAngle)
    assert.equal(state.flippers[0].angularVel, 0)
    assert.ok(!events.some((e) => e.type === 'flipperUp'))
  })
})

describe('nudge', () => {
  it('shifts ball velocity and emits nudge', () => {
    const table = makeTable({ gravity: 0 })
    const state = createTableState(table)
    const ball = addBall(state, { x: 10, y: 10 }, { x: 0, y: 0 })
    const events = stepTable(table, state, withInput({ nudge: 'left' }), FIXED_DT)
    assert.ok(events.some((e) => e.type === 'nudge' && e.direction === 'left'))
    assert.ok(Math.abs(ball.vel.x - -9) < 0.01)
    assert.ok(Math.abs(ball.vel.y - -2) < 0.01)
  })
})

describe('ball vs ball', () => {
  it('two balls collide and conserve momentum', () => {
    const table = makeTable({ gravity: 0 })
    const state = createTableState(table)
    const a = addBall(state, { x: 5, y: 10 }, { x: 10, y: 0 })
    const b = addBall(state, { x: 6.05, y: 10 }, { x: -10, y: 0 })
    const momentumBefore = a.vel.x + b.vel.x
    const events = stepTable(table, state, NO_INPUT, FIXED_DT)
    assert.ok(events.some((e) => e.type === 'ballHit'))
    const momentumAfter = a.vel.x + b.vel.x
    assert.ok(Math.abs(momentumAfter - momentumBefore) < 0.05)
  })
})

describe('drain', () => {
  it('removes a ball below drainY and emits drain', () => {
    const table = makeTable()
    const state = createTableState(table)
    const ball = addBall(state, { x: 10, y: table.drainY + 1 }, { x: 0, y: 0 })
    const events = stepTable(table, state, NO_INPUT, FIXED_DT)
    assert.ok(events.some((e) => e.type === 'drain' && e.ballId === ball.id))
    assert.equal(state.balls.length, 0)
  })
})

describe('still-ball rescue', () => {
  it('kicks a parked ball free after it sits still', () => {
    const table = makeTable({ gravity: 0 })
    const state = createTableState(table)
    const ball = addBall(state, { x: 10, y: 10 }, { x: 0, y: 0 })
    let kicked = false
    for (let i = 0; i < 2200 && !kicked; i++) {
      stepTable(table, state, NO_INPUT, FIXED_DT)
      if (Math.hypot(ball.vel.x, ball.vel.y) > 1.5) kicked = true
    }
    assert.ok(kicked, 'expected the rescue to fire within a few seconds')
    assert.ok(Math.abs(ball.vel.x - (ball.id % 2 ? 14 : -14)) < 1e-9)
    assert.ok(Math.abs(ball.vel.y - -30) < 1e-9)
  })
})

describe('determinism', () => {
  it('two identical runs give identical state', () => {
    function run() {
      const table = makeTable({
        bumpers: [{ id: 'b', pos: { x: 10, y: 10 }, radius: 1, kick: 20 }],
        flippers: [
          {
            id: 'left',
            side: 'left' as const,
            pivot: { x: 5, y: 30 },
            length: 3,
            radius: 0.4,
            restAngle: 0.5,
            activeAngle: -0.5,
          },
        ],
      })
      const state = createTableState(table)
      addBall(state, { x: 10, y: 8.4 }, { x: 1, y: 6 })
      addBall(state, { x: 5, y: 5 }, { x: -2, y: 3 })
      for (let i = 0; i < 400; i++) {
        const input = withInput({ left: i % 50 < 25, nudge: i === 100 ? 'left' : i === 250 ? 'up' : null })
        stepTable(table, state, input, FIXED_DT)
      }
      return state
    }

    const s1 = run()
    const s2 = run()
    assert.deepEqual(s1, s2)
  })
})
