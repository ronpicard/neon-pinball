import type { Phase, SoundName } from '../game/types.ts'

/** What the HUD shows. A new object is sent only when one of its fields changes. */
export interface HudSnapshot {
  phase: Phase
  score: number
  /** The ball in play, counting from 1. */
  ball: number
  ballsPerGame: number
  bonusMultiplier: number
  extraBalls: number
  /** Whole seconds of ball save left. */
  ballSave: number
  multiball: boolean
  tilted: boolean
  /** True while a ball waits on the plunger for the player to launch it. */
  ballWaiting: boolean
}

/** Callbacks from the 3D engine to the React shell. All are invoked on the main thread. */
export interface EngineEvents {
  onHud(snapshot: HudSnapshot): void
  /** A sound to play. `intensity` runs 0 to 1 and scales the volume of knocks. */
  onSound(name: SoundName | 'wall' | 'rubber' | 'flipper' | 'flipperHit' | 'ballHit' | 'nudge', intensity: number): void
  /** A line for the score display. */
  onMessage(text: string, seconds: number): void
  /** The last ball of a real game drained and its bonus was counted. */
  onGameOver(score: number): void
}

/** 'play' reads the player's controls. 'attract' lets the autoplayer run the table and fires no events. */
export type EngineMode = 'play' | 'attract'

/** 'player' stands at the front of the machine, 'top' looks straight down, 'chase' follows the ball. */
export type CameraView = 'player' | 'top' | 'chase'

/** Screen space covered by UI, in CSS pixels, measured in from each edge of the canvas. */
export interface ViewInsets {
  left: number
  top: number
  right: number
  bottom: number
}

/** On-screen buttons drive the same controls as the keyboard. */
export type ControlName = 'left' | 'right' | 'plunger'

export interface EngineApi {
  /** Clears the table and starts a new game in 'play' mode with a ball on the plunger. */
  startGame(): void
  /** Abandons any game, clears the table, and runs the attract-mode autoplayer. */
  showAttract(): void
  /** Presses or releases a control from an on-screen button. */
  setControl(control: ControlName, pressed: boolean): void
  /** Shoves the table once. */
  nudge(direction: 'left' | 'right' | 'up'): void
  setCameraView(view: CameraView): void
  /** Keeps the machine clear of the part of the canvas the UI covers. */
  setViewInsets(insets: ViewInsets): void
  /** Freezes the physics and the clocks. The scene keeps rendering. */
  setPaused(paused: boolean): void
  /** Re-reads the canvas size. The engine also observes its canvas, so this is rarely needed. */
  resize(): void
  dispose(): void
}
