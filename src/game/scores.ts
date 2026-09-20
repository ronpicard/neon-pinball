/** A single saved high score entry. */
export interface HighScore {
  initials: string
  score: number
  /** ISO date, `yyyy-mm-dd`. */
  date: string
}

/** How many high scores are kept on the list. */
export const MAX_HIGH_SCORES = 5

/** Retro placeholder scores shown before a player has set any real ones. */
export const DEFAULT_HIGH_SCORES: HighScore[] = [
  { initials: 'ACE', score: 500000, date: '1988-01-01' },
  { initials: 'MAX', score: 400000, date: '1988-01-01' },
  { initials: 'ZAP', score: 300000, date: '1988-01-01' },
  { initials: 'FOX', score: 200000, date: '1988-01-01' },
  { initials: 'RAY', score: 100000, date: '1988-01-01' },
]

/** Only these characters are allowed in stored initials. */
const INITIALS_PATTERN = /^[A-Z0-9]{3}$/

/** Stored dates must look like this, e.g. `2026-09-20`. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Upper bound on a plausible score, generous enough to never clip a real game. */
const MAX_SCORE = 1e12

/**
 * Normalises free-typed initials for the high score table: upper-cases, strips anything outside
 * `A-Z0-9`, truncates to 3 characters, then pads the right with `'A'` up to 3. An empty or
 * all-punctuation input becomes `'AAA'` rather than an invalid short string.
 */
export function sanitizeInitials(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3)
  return cleaned.padEnd(3, 'A')
}

/** True when `score` is positive and would earn a place on the (possibly not-yet-full) list. */
export function qualifies(scores: HighScore[], score: number): boolean {
  if (!Number.isFinite(score) || score <= 0) return false
  if (scores.length < MAX_HIGH_SCORES) return true
  const lowest = Math.min(...scores.map((entry) => entry.score))
  return score > lowest
}

/** Folds `entry` into `scores`, returning a new array sorted by score descending and capped. */
export function insertScore(scores: HighScore[], entry: HighScore): HighScore[] {
  return [...scores, entry].sort((a, b) => b.score - a.score).slice(0, MAX_HIGH_SCORES)
}

/**
 * Parses high scores persisted in storage. `raw` crosses a trust boundary (missing, hand-edited,
 * or written by a future/older version of this app), so this never throws: invalid JSON, a
 * non-array, or any entry with the wrong shape, an out-of-range/non-integer score, initials not
 * matching `/^[A-Z0-9]{3}$/`, or a date not matching `/^\d{4}-\d{2}-\d{2}$/` all fall back to
 * `DEFAULT_HIGH_SCORES`. A fully valid list longer than `MAX_HIGH_SCORES` is simply capped rather
 * than rejected.
 */
export function parseHighScores(raw: string | null): HighScore[] {
  if (raw === null) return DEFAULT_HIGH_SCORES

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_HIGH_SCORES
  }

  if (!Array.isArray(parsed)) return DEFAULT_HIGH_SCORES

  const result: HighScore[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) return DEFAULT_HIGH_SCORES

    const { initials, score, date } = item as Record<string, unknown>
    if (typeof initials !== 'string' || !INITIALS_PATTERN.test(initials)) return DEFAULT_HIGH_SCORES
    if (typeof score !== 'number' || !Number.isFinite(score) || !Number.isInteger(score)) {
      return DEFAULT_HIGH_SCORES
    }
    if (score < 0 || score > MAX_SCORE) return DEFAULT_HIGH_SCORES
    if (typeof date !== 'string' || !DATE_PATTERN.test(date)) return DEFAULT_HIGH_SCORES

    result.push({ initials, score, date })
  }

  return result.slice(0, MAX_HIGH_SCORES)
}

/** Serialises high scores for storage. Paired with `parseHighScores` for the round trip back. */
export function serializeHighScores(scores: HighScore[]): string {
  return JSON.stringify(scores)
}
