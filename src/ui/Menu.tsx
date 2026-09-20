import type { HighScore } from '../game/scores.ts'

interface MenuProps {
  highScores: HighScore[]
  muted: boolean
  onPlay: () => void
  onToggleMute: () => void
}

/** One row of the keyboard legend, matching the bindings in `render/input.ts`. */
interface LegendRow {
  label: string
  keys: string
}

const KEYBOARD_LEGEND: LegendRow[] = [
  { label: 'Left flipper', keys: '← / Z / A' },
  { label: 'Right flipper', keys: '→ / M / /' },
  { label: 'Plunger', keys: 'Space / Enter / ↓' },
  { label: 'Nudge', keys: 'Q · E · ↑ / W' },
  { label: 'Camera', keys: 'C' },
  { label: 'Pause', keys: 'P / Esc' },
]

function MuteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      <path d="m16 9 5 6M21 9l-5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function UnmuteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      <path
        d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Formats a score with thousands separators, e.g. `128,400`. */
function formatScore(score: number): string {
  return score.toLocaleString('en-US')
}

/**
 * Title screen: a docked panel on wide screens (so the attract-mode table stays visible) or a
 * bottom sheet on narrow ones, with the neon logo, play button, top-five high scores, a controls
 * legend, mute toggle, and a credit line back to the source repo.
 */
export default function Menu({ highScores, muted, onPlay, onToggleMute }: MenuProps) {
  return (
    <div className="menu-screen">
      <div className="menu-panel neon-panel">
        <div className="menu-top-row">
          <h1 className="menu-title">NEON PINBALL</h1>
          <div className="menu-top-actions">
            <button type="button" className="primary-button play-button" onClick={onPlay}>
              Play
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={muted ? 'Unmute' : 'Mute'}
              onClick={onToggleMute}
            >
              {muted ? <MuteIcon /> : <UnmuteIcon />}
            </button>
          </div>
        </div>
        <p className="menu-tagline">INSERT COIN &middot; PRESS START</p>
        <p className="how-to-line pointer-only">Press Play, or hit Enter / Space.</p>

        <section className="panel-section" aria-label="High scores">
          <h2 className="panel-heading">High Scores</h2>
          <table className="score-table">
            <tbody>
              {highScores.map((entry, index) => (
                <tr key={`${entry.initials}-${entry.date}-${index}`}>
                  <td className="score-rank">{index + 1}</td>
                  <td className="score-initials">{entry.initials}</td>
                  <td className="score-value">{formatScore(entry.score)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel-section" aria-label="Controls">
          <h2 className="panel-heading">Controls</h2>
          <dl className="legend-list pointer-only">
            {KEYBOARD_LEGEND.map((row) => (
              <div className="legend-row" key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.keys}</dd>
              </div>
            ))}
          </dl>
          <ul className="legend-touch-list touch-only">
            <li>Tap the left / right side of the screen to flip</li>
            <li>Hold LAUNCH (or the right side) to pull the plunger</li>
            <li>NUDGE shoves the table. Too much tilts it</li>
          </ul>
        </section>

        <p className="menu-credit">
          Source:{' '}
          <a href="https://github.com/ronpicard/neon-pinball" target="_blank" rel="noreferrer">
            github.com/ronpicard/neon-pinball
          </a>
        </p>
      </div>
    </div>
  )
}
