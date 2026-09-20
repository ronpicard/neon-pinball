import type { Input, NudgeDirection } from '../game/types.ts'
import type { ControlName } from './engineApi.ts'

/** Physical key codes that hold the left flipper up while any of them is pressed. */
const LEFT_FLIPPER_CODES = new Set(['ArrowLeft', 'ShiftLeft', 'KeyZ', 'KeyA'])

/** Physical key codes that hold the right flipper up while any of them is pressed. */
const RIGHT_FLIPPER_CODES = new Set(['ArrowRight', 'ShiftRight', 'Slash', 'KeyD', 'KeyM'])

/** Physical key codes that hold the plunger while any of them is pressed. */
const PLUNGER_CODES = new Set(['Space', 'ArrowDown', 'Enter'])

/** Key codes that fire a one-shot nudge, mapped to the direction they nudge. */
const NUDGE_CODES: Record<string, NudgeDirection> = {
  KeyQ: 'left',
  KeyE: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
}

/** Key codes that toggle the camera view. */
const CAMERA_TOGGLE_CODES = new Set(['KeyC'])

/** Key codes that toggle pause. */
const PAUSE_TOGGLE_CODES = new Set(['KeyP', 'Escape'])

/** Every code this controller ever acts on, so it knows which events to `preventDefault`. */
const HANDLED_CODES = new Set([
  ...LEFT_FLIPPER_CODES,
  ...RIGHT_FLIPPER_CODES,
  ...PLUNGER_CODES,
  ...Object.keys(NUDGE_CODES),
  ...CAMERA_TOGGLE_CODES,
  ...PAUSE_TOGGLE_CODES,
])

/** The three controls a keyboard key or an on-screen button can hold down. */
type HeldControl = 'left' | 'right' | 'plunger'

/** True when an event's target is a form control that should keep its own keystrokes. */
function isFormTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
}

/** Reads the next physics step's controls, combining the keyboard with on-screen buttons. */
export interface InputController {
  /** The controls for the next physics step. The one-shot nudge is returned once, then cleared. */
  read(): Input
  setControl(control: ControlName, pressed: boolean): void
  nudge(direction: NudgeDirection): void
  /** Drops every held key, e.g. when the window loses focus. */
  releaseAll(): void
  dispose(): void
}

/**
 * Listens for keyboard input on `window` and merges it with on-screen button presses reported
 * through `setControl` and `nudge`. See `AGENTS.md`/the build spec for the full key map.
 */
export function createInput(callbacks: { onCameraToggle(): void; onPauseToggle(): void }): InputController {
  const keyboardHeld: Record<HeldControl, boolean> = { left: false, right: false, plunger: false }
  const externalHeld: Record<HeldControl, boolean> = { left: false, right: false, plunger: false }
  let pendingNudge: NudgeDirection | null = null

  function handleKeyDown(event: KeyboardEvent): void {
    if (isFormTarget(event.target)) return
    const { code } = event
    if (!HANDLED_CODES.has(code)) return
    event.preventDefault()

    if (LEFT_FLIPPER_CODES.has(code)) keyboardHeld.left = true
    if (RIGHT_FLIPPER_CODES.has(code)) keyboardHeld.right = true
    if (PLUNGER_CODES.has(code)) keyboardHeld.plunger = true

    if (event.repeat) return
    const nudgeDirection = NUDGE_CODES[code]
    if (nudgeDirection) pendingNudge = nudgeDirection
    if (CAMERA_TOGGLE_CODES.has(code)) callbacks.onCameraToggle()
    if (PAUSE_TOGGLE_CODES.has(code)) callbacks.onPauseToggle()
  }

  function handleKeyUp(event: KeyboardEvent): void {
    if (isFormTarget(event.target)) return
    const { code } = event
    if (!HANDLED_CODES.has(code)) return
    event.preventDefault()

    if (LEFT_FLIPPER_CODES.has(code)) keyboardHeld.left = false
    if (RIGHT_FLIPPER_CODES.has(code)) keyboardHeld.right = false
    if (PLUNGER_CODES.has(code)) keyboardHeld.plunger = false
  }

  function handleBlur(): void {
    controller.releaseAll()
  }

  function handleVisibilityChange(): void {
    if (document.visibilityState === 'hidden') controller.releaseAll()
  }

  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  window.addEventListener('blur', handleBlur)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  const controller: InputController = {
    read(): Input {
      const input: Input = {
        left: keyboardHeld.left || externalHeld.left,
        right: keyboardHeld.right || externalHeld.right,
        plunger: keyboardHeld.plunger || externalHeld.plunger,
        nudge: pendingNudge,
      }
      pendingNudge = null
      return input
    },

    setControl(control: ControlName, pressed: boolean): void {
      externalHeld[control] = pressed
    },

    nudge(direction: NudgeDirection): void {
      pendingNudge = direction
    },

    releaseAll(): void {
      keyboardHeld.left = false
      keyboardHeld.right = false
      keyboardHeld.plunger = false
      externalHeld.left = false
      externalHeld.right = false
      externalHeld.plunger = false
    },

    dispose(): void {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    },
  }

  return controller
}
