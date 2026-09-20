import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { ControlName, EngineApi } from '../render/engineApi.ts'

interface TouchControlsProps {
  engine: EngineApi | null
  /** True while a ball waits on the plunger for the player to launch it. */
  ballWaiting: boolean
}

type Zone = 'left' | 'right'

/** Stops the long-press context menu / text-selection callout on a held control. */
function preventContextMenu(e: ReactMouseEvent) {
  e.preventDefault()
}

/**
 * On-screen controls for coarse (touch) pointers: two invisible flipper zones covering the lower
 * left and right halves of the screen (holding the right zone also pulls the plunger), a launch
 * pill shown only while a ball waits, and a nudge button under the HUD bar. CSS
 * (`@media (pointer: coarse), (hover: none)`) is what actually shows this — it stays in the DOM,
 * and out of the layout and tab order, on mouse/trackpad devices.
 */
export default function TouchControls({ engine, ballWaiting }: TouchControlsProps) {
  const [pressed, setPressed] = useState<Record<Zone, boolean>>({ left: false, right: false })
  const engineRef = useRef(engine)
  engineRef.current = engine
  // Which controls each live pointer is holding, so a release always matches what was pressed —
  // even if `ballWaiting` flips while the finger is still down.
  const heldRef = useRef(new Map<number, ControlName[]>())

  // Release every control still held if the component unmounts mid-press.
  useEffect(() => {
    const held = heldRef.current
    return () => {
      for (const controls of held.values()) {
        for (const control of controls) engineRef.current?.setControl(control, false)
      }
      held.clear()
    }
  }, [])

  function press(pointerId: number, controls: ControlName[]) {
    heldRef.current.set(pointerId, controls)
    for (const control of controls) engineRef.current?.setControl(control, true)
  }

  function release(pointerId: number) {
    const controls = heldRef.current.get(pointerId)
    if (!controls) return
    heldRef.current.delete(pointerId)
    for (const control of controls) engineRef.current?.setControl(control, false)
  }

  function bindZone(zone: Zone) {
    const controls: ControlName[] = zone === 'left' ? ['left'] : ['right', 'plunger']
    return {
      onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setPressed((current) => ({ ...current, [zone]: true }))
        press(e.pointerId, controls)
      },
      onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => {
        setPressed((current) => ({ ...current, [zone]: false }))
        release(e.pointerId)
      },
      onPointerCancel: (e: ReactPointerEvent<HTMLButtonElement>) => {
        setPressed((current) => ({ ...current, [zone]: false }))
        release(e.pointerId)
      },
      onPointerLeave: (e: ReactPointerEvent<HTMLButtonElement>) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) return
        setPressed((current) => ({ ...current, [zone]: false }))
        release(e.pointerId)
      },
      onContextMenu: preventContextMenu,
    }
  }

  const launchHandlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      press(e.pointerId, ['plunger'])
    },
    onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => release(e.pointerId),
    onPointerCancel: (e: ReactPointerEvent<HTMLButtonElement>) => release(e.pointerId),
    onPointerLeave: (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) release(e.pointerId)
    },
    onContextMenu: preventContextMenu,
  }

  return (
    <div className="touch-controls">
      <button
        type="button"
        className="touch-zone touch-zone-left"
        aria-label="Left flipper"
        data-pressed={pressed.left}
        {...bindZone('left')}
      />
      <button
        type="button"
        className="touch-zone touch-zone-right"
        aria-label="Right flipper"
        data-pressed={pressed.right}
        {...bindZone('right')}
      />

      <span className="touch-chip touch-chip-left" data-pressed={pressed.left} aria-hidden="true">
        &#9664; FLIP
      </span>
      <span className="touch-chip touch-chip-right" data-pressed={pressed.right} aria-hidden="true">
        FLIP &#9654;
      </span>

      {ballWaiting && (
        <button
          type="button"
          className="touch-launch"
          aria-label="Hold to launch the ball"
          {...launchHandlers}
        >
          HOLD TO LAUNCH
        </button>
      )}

      <button
        type="button"
        className="touch-nudge"
        aria-label="Nudge the table"
        onPointerDown={() => engineRef.current?.nudge('up')}
        onContextMenu={preventContextMenu}
      >
        NUDGE
      </button>
    </div>
  )
}
