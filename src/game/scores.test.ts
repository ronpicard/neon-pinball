import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_HIGH_SCORES,
  MAX_HIGH_SCORES,
  insertScore,
  parseHighScores,
  qualifies,
  sanitizeInitials,
  serializeHighScores,
} from './scores.ts'
import type { HighScore } from './scores.ts'

test('sanitizeInitials: upper-cases and keeps only A-Z0-9', () => {
  assert.equal(sanitizeInitials('abc'), 'ABC')
  assert.equal(sanitizeInitials('a-b!2'), 'AB2')
})

test('sanitizeInitials: truncates to 3 characters', () => {
  assert.equal(sanitizeInitials('WIZARD'), 'WIZ')
})

test('sanitizeInitials: pads short input with A', () => {
  assert.equal(sanitizeInitials('X'), 'XAA')
  assert.equal(sanitizeInitials('XY'), 'XYA')
})

test('sanitizeInitials: empty or all-punctuation input becomes AAA', () => {
  assert.equal(sanitizeInitials(''), 'AAA')
  assert.equal(sanitizeInitials('!!!'), 'AAA')
})

test('qualifies: a non-positive score never qualifies', () => {
  assert.equal(qualifies([], 0), false)
  assert.equal(qualifies([], -5), false)
  assert.equal(qualifies([], Number.NaN), false)
})

test('qualifies: any positive score qualifies while the list is not full', () => {
  const scores: HighScore[] = [{ initials: 'AAA', score: 100, date: '2026-01-01' }]
  assert.equal(scores.length < MAX_HIGH_SCORES, true)
  assert.equal(qualifies(scores, 1), true)
})

test('qualifies: once full, only a score beating the lowest entry qualifies', () => {
  const scores: HighScore[] = Array.from({ length: MAX_HIGH_SCORES }, (_, i) => ({
    initials: 'AAA',
    score: (MAX_HIGH_SCORES - i) * 100,
    date: '2026-01-01',
  }))
  const lowest = Math.min(...scores.map((s) => s.score))
  assert.equal(qualifies(scores, lowest), false)
  assert.equal(qualifies(scores, lowest + 1), true)
})

test('insertScore: sorts descending by score', () => {
  const scores: HighScore[] = [
    { initials: 'AAA', score: 100, date: '2026-01-01' },
    { initials: 'BBB', score: 300, date: '2026-01-01' },
  ]
  const next = insertScore(scores, { initials: 'CCC', score: 200, date: '2026-01-02' })
  assert.deepEqual(
    next.map((s) => s.score),
    [300, 200, 100],
  )
})

test('insertScore: caps the result at MAX_HIGH_SCORES and returns a new array', () => {
  const scores: HighScore[] = Array.from({ length: MAX_HIGH_SCORES }, (_, i) => ({
    initials: 'AAA',
    score: (i + 1) * 1000,
    date: '2026-01-01',
  }))
  const next = insertScore(scores, { initials: 'ZZZ', score: 999999, date: '2026-01-02' })
  assert.equal(next.length, MAX_HIGH_SCORES)
  assert.notEqual(next, scores)
  assert.equal(next[0].initials, 'ZZZ')
})

test('parseHighScores: null falls back to defaults', () => {
  assert.deepEqual(parseHighScores(null), DEFAULT_HIGH_SCORES)
})

test('parseHighScores: not JSON falls back to defaults', () => {
  assert.deepEqual(parseHighScores('not json {'), DEFAULT_HIGH_SCORES)
})

test('parseHighScores: valid JSON that is not an array falls back to defaults', () => {
  assert.deepEqual(parseHighScores('{"initials":"AAA"}'), DEFAULT_HIGH_SCORES)
})

test('parseHighScores: wrong field types fall back to defaults', () => {
  assert.deepEqual(
    parseHighScores(JSON.stringify([{ initials: 'AAA', score: '100', date: '2026-01-01' }])),
    DEFAULT_HIGH_SCORES,
  )
  assert.deepEqual(
    parseHighScores(JSON.stringify([{ initials: 123, score: 100, date: '2026-01-01' }])),
    DEFAULT_HIGH_SCORES,
  )
})

test('parseHighScores: negative, NaN, or huge scores fall back to defaults', () => {
  assert.deepEqual(
    parseHighScores(JSON.stringify([{ initials: 'AAA', score: -1, date: '2026-01-01' }])),
    DEFAULT_HIGH_SCORES,
  )
  assert.deepEqual(
    parseHighScores(JSON.stringify([{ initials: 'AAA', score: Number.NaN, date: '2026-01-01' }])),
    DEFAULT_HIGH_SCORES,
  )
  assert.deepEqual(
    parseHighScores(JSON.stringify([{ initials: 'AAA', score: 1e13, date: '2026-01-01' }])),
    DEFAULT_HIGH_SCORES,
  )
  assert.deepEqual(
    parseHighScores(JSON.stringify([{ initials: 'AAA', score: 1.5, date: '2026-01-01' }])),
    DEFAULT_HIGH_SCORES,
  )
})

test('parseHighScores: over-long or invalid initials fall back to defaults', () => {
  assert.deepEqual(
    parseHighScores(JSON.stringify([{ initials: 'ABCD', score: 100, date: '2026-01-01' }])),
    DEFAULT_HIGH_SCORES,
  )
  assert.deepEqual(
    parseHighScores(JSON.stringify([{ initials: 'ab', score: 100, date: '2026-01-01' }])),
    DEFAULT_HIGH_SCORES,
  )
})

test('parseHighScores: an invalid date falls back to defaults', () => {
  assert.deepEqual(
    parseHighScores(JSON.stringify([{ initials: 'AAA', score: 100, date: '01-01-2026' }])),
    DEFAULT_HIGH_SCORES,
  )
})

test('parseHighScores: a fully valid but over-long list is capped, not defaulted', () => {
  const entries = Array.from({ length: MAX_HIGH_SCORES + 3 }, (_, i) => ({
    initials: 'AAA',
    score: (i + 1) * 1000,
    date: '2026-01-01',
  }))
  const result = parseHighScores(JSON.stringify(entries))
  assert.equal(result.length, MAX_HIGH_SCORES)
  assert.deepEqual(result, entries.slice(0, MAX_HIGH_SCORES))
})

test('parseHighScores: accepts a well-formed list unchanged', () => {
  const entries: HighScore[] = [{ initials: 'ACE', score: 12345, date: '2026-09-20' }]
  assert.deepEqual(parseHighScores(JSON.stringify(entries)), entries)
})

test('serializeHighScores round-trips through parseHighScores', () => {
  const entries: HighScore[] = [
    { initials: 'ACE', score: 500000, date: '2026-09-20' },
    { initials: 'MAX', score: 100, date: '2026-01-01' },
  ]
  assert.deepEqual(parseHighScores(serializeHighScores(entries)), entries)
})
