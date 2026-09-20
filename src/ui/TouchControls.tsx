import type { PointerEvent as ReactPointerEvent } from 'react'
import type { ControlName, EngineApi } from '../render/engineApi.ts'

interface TouchControlsProps {
  engine: EngineApi | null
}

/**
 * Pointer handlers for one held control: pointer capture keeps the release paired with the same
 * finger even if it slides off the element, so `pointercancel`/`pointerleave` from an
 * uncaptured pointer (e.g. a second finger passing over) doesn't fight the one that is held.
 */
function bindHeldControl(engine: EngineApi | null, control: ControlName) {
  function set(pressed: boolean) {
    engine?.setControl(control, pressed)
  }
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      set(true)
    },
    onPointerUp: () => set(false),
    onPointerCancel: () => set(false),
    onPointerLeave: (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) set(false)
    },
  }
}

/**
 * On-screen controls for coarse (touch) pointers: two large flipper zones over the lower left
 * and right of the screen, a plunger button above the right zone, and a small nudge button.
 * CSS (`@media (pointer: coarse)`) is what actually shows this — it stays in the DOM, and out of
 * the layout and tab order, on mouse/trackpad devices.
 */
export default function TouchControls({ engine }: TouchControlsProps) {
  return (
    <div className="touch-controls">
      <button
        type="button"
        className="touch-zone touch-flipper-left"
        aria-label="Left flipper"
        {...bindHeldControl(engine, 'left')}
      />
      <button
        type="button"
        className="touch-zone touch-flipper-right"
        aria-label="Right flipper"
        {...bindHeldControl(engine, 'right')}
      />
      <button type="button" className="touch-nudge" aria-label="Nudge" onClick={() => engine?.nudge('up')} />
      <button
        type="button"
        className="touch-plunger"
        aria-label="Plunger"
        {...bindHeldControl(engine, 'plunger')}
      />
    </div>
  )
}
