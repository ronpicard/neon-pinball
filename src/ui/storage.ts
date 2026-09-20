import { parseHighScores, serializeHighScores } from '../game/scores.ts'
import type { HighScore } from '../game/scores.ts'

const MUTE_KEY = 'neon-pinball.muted'
const SCORES_KEY = 'neon-pinball.scores'

/**
 * localStorage throws in some iframes and private-mode browsers. This probes it once and hands
 * back either the real Storage or null, so the rest of the app never has to guard every call.
 */
export function safeLocalStorage(): Storage | null {
  try {
    const probeKey = '__neon_pinball_probe__'
    window.localStorage.setItem(probeKey, '1')
    window.localStorage.removeItem(probeKey)
    return window.localStorage
  } catch {
    return null
  }
}

export function loadMuted(storage: Storage | null): boolean {
  if (!storage) return false
  try {
    return storage.getItem(MUTE_KEY) === '1'
  } catch {
    // Quota errors and private-mode restrictions on getItem: fall back to unmuted.
    return false
  }
}

export function saveMuted(storage: Storage | null, muted: boolean): void {
  if (!storage) return
  try {
    storage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    // Quota exceeded or storage disabled mid-session: the mute preference just won't persist.
  }
}

/** Loads saved high scores, falling back to the retro defaults when nothing valid is stored. */
export function loadHighScores(storage: Storage | null): HighScore[] {
  if (!storage) return parseHighScores(null)
  try {
    return parseHighScores(storage.getItem(SCORES_KEY))
  } catch {
    // Quota errors and private-mode restrictions on getItem: fall back to the defaults.
    return parseHighScores(null)
  }
}

export function saveHighScores(storage: Storage | null, scores: HighScore[]): void {
  if (!storage) return
  try {
    storage.setItem(SCORES_KEY, serializeHighScores(scores))
  } catch {
    // Quota exceeded or storage disabled mid-session: the high scores just won't persist.
  }
}
