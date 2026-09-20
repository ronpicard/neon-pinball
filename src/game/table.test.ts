import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Table } from './types.ts'
import { TABLE, validateTable } from './table.ts'

test('TABLE validates clean', () => {
  assert.deepEqual(validateTable(TABLE), [])
})

test('a duplicated id is reported', () => {
  const brokenId = TABLE.posts[0].id
  const broken: Table = { ...TABLE, posts: [...TABLE.posts, { ...TABLE.posts[0] }] }

  const problems = validateTable(broken)
  assert.ok(
    problems.some((p) => p.includes(brokenId) && p.includes('duplicate')),
    `expected a duplicate-id problem for '${brokenId}', got: ${problems.join('; ')}`,
  )
})

test('a wall outside the table is reported', () => {
  const outsideWall = { id: 'test.outside', a: { x: -5, y: 0 }, b: { x: -2, y: 0 }, kind: 'rail' as const, restitution: 0.4 }
  const broken: Table = { ...TABLE, walls: [...TABLE.walls, outsideWall] }

  const problems = validateTable(broken)
  assert.ok(
    problems.some((p) => p.includes('test.outside') && p.includes('outside the table')),
    `expected an out-of-bounds problem, got: ${problems.join('; ')}`,
  )
})

test('a ramp with mismatched path/heights lengths is reported', () => {
  const badRamp = { ...TABLE.ramps[0], heights: TABLE.ramps[0].heights.slice(0, -1) }
  const broken: Table = { ...TABLE, ramps: [badRamp] }

  const problems = validateTable(broken)
  assert.ok(
    problems.some((p) => p.includes(badRamp.id) && p.includes('heights')),
    `expected a heights-mismatch problem, got: ${problems.join('; ')}`,
  )
})

test('a missing insert is reported', () => {
  const broken: Table = { ...TABLE, inserts: TABLE.inserts.filter((i) => i.id !== 'lane.a') }

  const problems = validateTable(broken)
  assert.ok(
    problems.some((p) => p.includes('lane.a') && p.includes('insert')),
    `expected a missing-insert problem for 'lane.a', got: ${problems.join('; ')}`,
  )
})

test('the flipper tips at rest leave a gap wider than the ball', () => {
  const left = TABLE.flippers.find((f) => f.side === 'left')
  const right = TABLE.flippers.find((f) => f.side === 'right')
  assert.ok(left && right, 'expected one left and one right flipper')

  const tip = (f: NonNullable<typeof left>) => ({
    x: f.pivot.x + f.length * Math.cos(f.restAngle),
    y: f.pivot.y + f.length * Math.sin(f.restAngle),
  })
  const leftTip = tip(left!)
  const rightTip = tip(right!)

  const gap = Math.hypot(rightTip.x - leftTip.x, rightTip.y - leftTip.y) - left!.radius - right!.radius
  assert.ok(gap > TABLE.ballRadius * 2, `gap between resting flipper tips (${gap}) should exceed the ball's diameter`)
})

test('every lane between neighbouring top lane guides is wider than the ball', () => {
  const laneGuides = TABLE.walls.filter((w) => w.id.startsWith('guide.lane.')).sort((a, b) => a.a.x - b.a.x)
  assert.ok(laneGuides.length >= 2, 'expected at least two top lane guides')

  for (let i = 0; i < laneGuides.length - 1; i++) {
    const gap = laneGuides[i + 1].a.x - laneGuides[i].a.x
    assert.ok(gap > TABLE.ballRadius * 2, `lane gap ${gap} between top lane guides should exceed the ball's diameter`)
  }
})

test('both inlanes and outlanes are wider than the ball', () => {
  const wallLeft = TABLE.walls.find((w) => w.id === 'wall.left')
  const wallRight = TABLE.walls.find((w) => w.id === 'wall.right')
  const inlaneGuideL = TABLE.walls.find((w) => w.id === 'guide.inlaneL.0')
  const inlaneGuideR = TABLE.walls.find((w) => w.id === 'guide.inlaneR.0')
  const slingLeft = TABLE.slingshots.find((s) => s.id === 'sling.left')
  const slingRight = TABLE.slingshots.find((s) => s.id === 'sling.right')
  assert.ok(wallLeft && wallRight && inlaneGuideL && inlaneGuideR && slingLeft && slingRight)

  const ballDiameter = TABLE.ballRadius * 2
  const outlaneLeftWidth = inlaneGuideL!.a.x - wallLeft!.a.x
  const inlaneLeftWidth = slingLeft!.c.x - inlaneGuideL!.a.x
  const outlaneRightWidth = wallRight!.a.x - inlaneGuideR!.a.x
  const inlaneRightWidth = inlaneGuideR!.a.x - slingRight!.a.x

  assert.ok(outlaneLeftWidth > ballDiameter, `left outlane width ${outlaneLeftWidth} should exceed the ball`)
  assert.ok(inlaneLeftWidth > ballDiameter, `left inlane width ${inlaneLeftWidth} should exceed the ball`)
  assert.ok(outlaneRightWidth > ballDiameter, `right outlane width ${outlaneRightWidth} should exceed the ball`)
  assert.ok(inlaneRightWidth > ballDiameter, `right inlane width ${inlaneRightWidth} should exceed the ball`)
})
