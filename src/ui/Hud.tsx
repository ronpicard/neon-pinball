import type { CameraView, HudSnapshot } from '../render/engineApi.ts'

interface HudProps {
  /** Null until the engine's first snapshot arrives after `startGame()`. */
  hud: HudSnapshot | null
  /** The current marquee line, or null once it has cleared. */
  message: string | null
  paused: boolean
  cameraView: CameraView
  muted: boolean
  onTogglePause: () => void
  onCycleCamera: () => void
  onToggleMute: () => void
  onQuit: () => void
}

/** What pressing the camera button switches to next, shown so the label always reads forward. */
const NEXT_CAMERA_LABEL: Record<CameraView, string> = { chase: 'Player', player: 'Top', top: 'Chase' }

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" fill="currentColor" />
    </svg>
  )
}

function ResumeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M7 5v14l12-7Z" fill="currentColor" />
    </svg>
  )
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path
        d="M4 8h3l1.5-2h7L17 8h3v11H4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13.5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

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

function QuitIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path
        d="M10 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4M15 8l4 4-4 4M8 12h11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Formats a score with thousands separators, e.g. `128,400`. */
function formatScore(score: number): string {
  return score.toLocaleString('en-US')
}

/**
 * The in-play chrome: score, ball count, bonus multiplier, status badges, and a marquee message
 * line in a translucent top bar, plus pause/camera/mute/quit buttons and a resumable pause
 * overlay. Stays clear of the board's centre and respects safe-area insets.
 */
export default function Hud({
  hud,
  message,
  paused,
  cameraView,
  muted,
  onTogglePause,
  onCycleCamera,
  onToggleMute,
  onQuit,
}: HudProps) {
  // The waiting hint reads differently on touch: there is no plunger key to pull there. Both
  // variants render at once and CSS (`.touch-only` / `.pointer-only`) shows the one that matches
  // the pointer in use, so this never needs to know the device type itself.
  const waitingHint = hud?.ballWaiting ? (
    <>
      <span className="touch-only">HOLD LAUNCH</span>
      <span className="pointer-only">PULL THE PLUNGER</span>
    </>
  ) : null
  const marquee = message ?? waitingHint

  return (
    <>
      <div className="hud-top-bar neon-panel">
        <div className="hud-score-block">
          <span className="hud-score">{formatScore(hud?.score ?? 0)}</span>
          <span className="hud-ball-line">
            {hud ? `BALL ${hud.ball} / ${hud.ballsPerGame}` : 'BALL — / —'}
            {hud && hud.bonusMultiplier > 1 && (
              <span className="hud-bonus"> &middot; BONUS x{hud.bonusMultiplier}</span>
            )}
          </span>
        </div>

        <div className="hud-badges">
          {hud && hud.ballSave > 0 && <span className="hud-badge badge-ballsave">SAVE {hud.ballSave}</span>}
          {hud?.multiball && <span className="hud-badge badge-multiball">MULTIBALL</span>}
          {hud?.tilted && <span className="hud-badge badge-tilt">TILT</span>}
          {hud && hud.extraBalls > 0 && (
            <span className="hud-badge badge-extra">
              +{hud.extraBalls} BALL{hud.extraBalls === 1 ? '' : 'S'}
            </span>
          )}
        </div>

        <div className="hud-actions">
          <button
            type="button"
            className="icon-button"
            aria-label={paused ? 'Resume' : 'Pause'}
            aria-pressed={paused}
            onClick={onTogglePause}
          >
            {paused ? <ResumeIcon /> : <PauseIcon />}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`Camera view: ${cameraView}. Switch to ${NEXT_CAMERA_LABEL[cameraView]}`}
            onClick={onCycleCamera}
          >
            <CameraIcon />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={muted ? 'Unmute' : 'Mute'}
            onClick={onToggleMute}
          >
            {muted ? <MuteIcon /> : <UnmuteIcon />}
          </button>
          <button type="button" className="icon-button" aria-label="Quit to menu" onClick={onQuit}>
            <QuitIcon />
          </button>
        </div>
      </div>

      <div className="hud-message" role="status" aria-live="polite">
        {marquee}
      </div>

      {paused && (
        <div className="modal-backdrop">
          <div className="pause-card neon-panel" role="dialog" aria-modal="true" aria-label="Paused">
            <h2 className="pause-title">Paused</h2>
            <button type="button" className="primary-button" onClick={onTogglePause}>
              Resume
            </button>
          </div>
        </div>
      )}
    </>
  )
}
