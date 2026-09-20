import { useEffect, useRef, useState } from 'react'
import { createAudio } from './audio.ts'
import type { GameAudio } from './audio.ts'
import { insertScore, qualifies } from './game/scores.ts'
import type { HighScore } from './game/scores.ts'
import type { CameraView, EngineApi, EngineEvents, HudSnapshot } from './render/engineApi.ts'
import GameCanvas from './ui/GameCanvas.tsx'
import GameOverCard from './ui/GameOverCard.tsx'
import Hud from './ui/Hud.tsx'
import Menu from './ui/Menu.tsx'
import TouchControls from './ui/TouchControls.tsx'
import { loadHighScores, loadMuted, safeLocalStorage, saveHighScores, saveMuted } from './ui/storage.ts'

/** The three screens the shell can show. The engine itself always keeps rendering behind them. */
type Screen = 'menu' | 'play' | 'gameOver'

/** A menu panel narrower than this share of the window is docked to the side, not a bottom sheet. */
const DOCKED_PANEL_MAX_FRACTION = 0.7

/** Pressing the HUD camera button steps through these views in order, then wraps around. */
const CAMERA_CYCLE: CameraView[] = ['player', 'top', 'chase']

function nextCameraView(current: CameraView): CameraView {
  return CAMERA_CYCLE[(CAMERA_CYCLE.indexOf(current) + 1) % CAMERA_CYCLE.length]
}

/** Today's date in the `yyyy-mm-dd` shape a saved high score expects. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Top-level app shell. Owns the screen state machine (menu / play / gameOver), the engine handle,
 * persisted mute setting and high scores, and wires the 3D engine's events to audio and the
 * HUD/game-over UI. The canvas itself is mounted once, full-screen, behind every screen.
 *
 * The engine's own keyboard input module (flippers, plunger, nudge, camera toggle) listens
 * directly on `window`, so this component never binds those keys. The two exceptions it does own:
 * Enter/Space start a game from the menu, and P/Escape toggle pause during play, because the
 * engine has no pause key of its own and exposes no pause event — `paused` lives here in React.
 */
export default function App() {
  const [storage] = useState(() => safeLocalStorage())
  const [audio] = useState<GameAudio>(() => createAudio())
  const [muted, setMuted] = useState<boolean>(() => loadMuted(storage))
  const [highScores, setHighScores] = useState<HighScore[]>(() => loadHighScores(storage))

  const [screen, setScreen] = useState<Screen>('menu')
  const [engine, setEngine] = useState<EngineApi | null>(null)
  const [hud, setHud] = useState<HudSnapshot | null>(null)
  const [message, setMessage] = useState<{ id: number; text: string } | null>(null)
  const [cameraView, setCameraView] = useState<CameraView>('player')
  const [paused, setPaused] = useState(false)
  const [finalScore, setFinalScore] = useState(0)

  const messageTimerRef = useRef<number | undefined>(undefined)
  const messageIdRef = useRef(0)
  const unlockedAudioRef = useRef(false)

  useEffect(() => () => window.clearTimeout(messageTimerRef.current), [])

  // Put the engine in the right mode whenever the screen changes: attract behind the menu, a
  // fresh game when play starts. A stale pause from a previous game never lingers into the next.
  useEffect(() => {
    if (!engine) return
    if (screen === 'menu') {
      engine.showAttract()
    } else if (screen === 'play') {
      setPaused(false)
      engine.setPaused(false)
      engine.startGame()
      engine.setCameraView(cameraView)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, engine])

  // Keep the machine clear of whichever panel currently covers the canvas: the docked/sheet menu
  // panel, or the HUD's top bar during play. Sizes are read with offsetWidth/offsetHeight, which
  // entry animations (transforms) do not distort.
  useEffect(() => {
    if (!engine) return
    function updateInsets() {
      const insets = { left: 0, top: 0, right: 0, bottom: 0 }
      const panel = document.querySelector<HTMLElement>('.menu-panel')
      const bar = document.querySelector<HTMLElement>('.hud-top-bar')
      if (panel) {
        const docked = panel.offsetWidth < window.innerWidth * DOCKED_PANEL_MAX_FRACTION
        if (docked) insets.left = panel.offsetWidth
        else insets.bottom = panel.offsetHeight
      } else if (bar) {
        insets.top = bar.offsetTop + bar.offsetHeight
      }
      engine?.setViewInsets(insets)
    }
    updateInsets()
    window.addEventListener('resize', updateInsets)
    return () => window.removeEventListener('resize', updateInsets)
  }, [screen, engine])

  // Unlock audio on the very first user gesture, as browsers require.
  useEffect(() => {
    function unlock() {
      if (unlockedAudioRef.current) return
      unlockedAudioRef.current = true
      audio.unlock()
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [audio])

  function handlePlay() {
    setScreen('play')
  }

  function togglePause() {
    setPaused((current) => {
      const next = !current
      engine?.setPaused(next)
      return next
    })
  }

  // Menu: Enter/Space starts a game, only while the menu is showing. Play: P/Escape toggles
  // pause and C cycles the camera. Every other key belongs to the engine's own input module — see the doc comment above.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target
      if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (screen === 'menu' && (e.key === 'Enter' || e.key === ' ') && !e.repeat) {
        e.preventDefault()
        handlePlay()
      } else if (screen === 'play' && (e.key === 'p' || e.key === 'P' || e.key === 'Escape') && !e.repeat) {
        e.preventDefault()
        togglePause()
      } else if (screen === 'play' && e.code === 'KeyC' && !e.repeat) {
        handleCycleCamera()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen])

  function handleCycleCamera() {
    setCameraView((current) => {
      const next = nextCameraView(current)
      engine?.setCameraView(next)
      return next
    })
  }

  function toggleMute() {
    setMuted((current) => {
      const next = !current
      audio.setMuted(next)
      saveMuted(storage, next)
      return next
    })
  }

  function goToMenu() {
    setScreen('menu')
  }

  function handleSubmitInitials(initials: string) {
    const entry: HighScore = { initials, score: finalScore, date: todayIso() }
    setHighScores((current) => {
      const next = insertScore(current, entry)
      saveHighScores(storage, next)
      return next
    })
  }

  const events: EngineEvents = {
    onHud: (snapshot) => setHud(snapshot),
    onSound: (name, intensity) => audio.play(name, intensity),
    onMessage: (text, seconds) => {
      messageIdRef.current += 1
      const id = messageIdRef.current
      setMessage({ id, text })
      window.clearTimeout(messageTimerRef.current)
      messageTimerRef.current = window.setTimeout(() => {
        setMessage((current) => (current && current.id === id ? null : current))
      }, seconds * 1000)
    },
    onGameOver: (score) => {
      setFinalScore(score)
      setScreen('gameOver')
    },
  }

  return (
    <div className="app-root">
      <GameCanvas events={events} onReady={setEngine} />

      <div className="overlay-layer">
        {screen === 'menu' && (
          <Menu highScores={highScores} muted={muted} onPlay={handlePlay} onToggleMute={toggleMute} />
        )}

        {screen === 'play' && (
          <>
            <Hud
              hud={hud}
              message={message?.text ?? null}
              paused={paused}
              cameraView={cameraView}
              muted={muted}
              onTogglePause={togglePause}
              onCycleCamera={handleCycleCamera}
              onToggleMute={toggleMute}
              onQuit={goToMenu}
            />
            <TouchControls engine={engine} />
          </>
        )}

        {screen === 'gameOver' && (
          <GameOverCard
            score={finalScore}
            qualifies={qualifies(highScores, finalScore)}
            onSubmit={handleSubmitInitials}
            onPlayAgain={handlePlay}
            onMenu={goToMenu}
          />
        )}
      </div>
    </div>
  )
}
