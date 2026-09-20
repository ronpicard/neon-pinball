/**
 * Runs a batch of headless attract-mode games with the real table and bot, and prints a line per
 * game (score, duration, and how many of each `PhysicsEvent` type it saw) plus a totals line.
 * Usage: `node --experimental-strip-types scripts/simulate.ts [gameCount]` (default 5 games).
 * Exits 1 if any game got stuck or its ball escaped, so this doubles as a smoke test for the table.
 */

import { TABLE } from '../src/game/table.ts'
import { simulateGame } from '../src/game/autoplay.ts'

/** Each game is capped at ten sim-minutes, matching the spec's headless ceiling. */
const MAX_SECONDS = 10 * 60

/** Default game count when none is given on the command line. */
const DEFAULT_GAME_COUNT = 5

/** Seconds apart each game's starting time is offset, so otherwise-identical games plunge differently. */
const OFFSET_STEP = 11.3

/** Renders a game's event counts as `type=count` pairs, alphabetically, for a readable log line. */
function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `${type}=${count}`)
    .join(' ')
}

const gameCount = Number(process.argv[2] ?? DEFAULT_GAME_COUNT)

const totals: Record<string, number> = {}
let totalScore = 0
let anyTrouble = false

for (let i = 0; i < gameCount; i++) {
  const result = simulateGame(TABLE, MAX_SECONDS, i * OFFSET_STEP)
  totalScore += result.score
  for (const [type, count] of Object.entries(result.counts)) {
    totals[type] = (totals[type] ?? 0) + count
  }
  if (result.stuck || result.escaped) anyTrouble = true

  console.log(
    `game ${i + 1}: score=${result.score} seconds=${result.seconds.toFixed(2)} ` +
      `stuck=${result.stuck} escaped=${result.escaped} ${formatCounts(result.counts)}`,
  )
}

console.log(`totals: score=${totalScore} ${formatCounts(totals)}`)

if (anyTrouble) {
  console.error('\nsimulate: at least one game got stuck or its ball escaped')
  process.exit(1)
}
