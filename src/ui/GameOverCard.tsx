import { useState } from 'react'
import type { FormEvent } from 'react'
import { sanitizeInitials } from '../game/scores.ts'

interface GameOverCardProps {
  score: number
  /** Whether `score` earns a spot on the high score list. */
  qualifies: boolean
  /** Called once with sanitised initials when the player saves their score. */
  onSubmit: (initials: string) => void
  onPlayAgain: () => void
  onMenu: () => void
}

/** Formats a score with thousands separators, e.g. `128,400`. */
function formatScore(score: number): string {
  return score.toLocaleString('en-US')
}

/**
 * End-of-game screen: the final score, an arcade-style three-letter initials entry when it
 * qualifies for the high score list, and buttons to play again or return to the menu.
 */
export default function GameOverCard({ score, qualifies, onSubmit, onPlayAgain, onMenu }: GameOverCardProps) {
  const [initials, setInitials] = useState('')
  const [saved, setSaved] = useState(false)

  function handleSave(e: FormEvent) {
    e.preventDefault()
    if (saved) return
    onSubmit(sanitizeInitials(initials))
    setSaved(true)
  }

  return (
    <div className="modal-backdrop">
      <div className="game-over-card neon-panel" role="dialog" aria-modal="true" aria-label="Game over">
        <h2 className="game-over-title">Game Over</h2>
        <p className="game-over-score">{formatScore(score)}</p>

        {qualifies && !saved && (
          <form className="initials-form" onSubmit={handleSave}>
            <label className="initials-label" htmlFor="initials-input">
              New high score! Enter your initials
            </label>
            <div className="initials-row">
              <input
                id="initials-input"
                className="initials-input"
                type="text"
                inputMode="text"
                maxLength={3}
                autoFocus
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={initials}
                onChange={(e) => setInitials(e.target.value)}
              />
              <button type="submit" className="primary-button">
                Save
              </button>
            </div>
          </form>
        )}
        {qualifies && saved && (
          <p className="initials-saved" role="status">
            Saved!
          </p>
        )}

        <div className="game-over-actions">
          <button type="button" className="primary-button" onClick={onPlayAgain}>
            Play again
          </button>
          <button type="button" className="secondary-button" onClick={onMenu}>
            Menu
          </button>
        </div>
      </div>
    </div>
  )
}
