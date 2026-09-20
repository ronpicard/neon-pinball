/** Synthesised retro-arcade sound effects for Neon Pinball, entirely Web Audio, no asset files. */

import type { EngineEvents } from './render/engineApi.ts'

/** Every sound name the engine can ask for, including the plain-knock names beyond `SoundName`. */
export type SoundId = Parameters<EngineEvents['onSound']>[0]

const MASTER_GAIN = 0.5
const MUTE_RAMP_SECONDS = 0.03
const NOISE_BUFFER_SECONDS = 1
/** No voice re-triggers faster than this, so a burst of identical events doesn't clip together. */
const MIN_VOICE_INTERVAL_S = 0.035

/** Sound effects for the pinball machine. Every method is a no-op until `unlock()` succeeds. */
export interface GameAudio {
  /** Creates/resumes the AudioContext; call from the first user gesture. Safe to call repeatedly. */
  unlock(): void
  setMuted(muted: boolean): void
  /** Plays the voice for `name`. `intensity` runs 0 to 1 and scales the volume of knocks. */
  play(name: SoundId, intensity: number): void
  /** Stops all sound and releases the AudioContext. */
  dispose(): void
}

type AudioContextConstructor = typeof AudioContext
type ToneExtras = { type?: OscillatorType; endFreq?: number; attack?: number }
type Voice = (context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number) => void

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

// A short envelope: near-silent, ramp up to `peak`, ramp back down, both exponential.
function scheduleEnvelope(gain: GainNode, now: number, attack: number, peak: number, duration: number): void {
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(peak, now + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
}

// Plays one enveloped oscillator (optionally sweeping to `endFreq`) and cleans itself up.
function playTone(
  context: AudioContext, out: AudioNode, now: number,
  freq: number, duration: number, peak: number, extras: ToneExtras = {},
): void {
  const osc = context.createOscillator()
  osc.type = extras.type ?? 'sine'
  osc.frequency.setValueAtTime(freq, now)
  if (extras.endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(extras.endFreq, now + duration)
  }
  const gain = context.createGain()
  scheduleEnvelope(gain, now, extras.attack ?? 0.006, peak, duration)
  osc.connect(gain)
  gain.connect(out)
  osc.onended = () => {
    osc.disconnect()
    gain.disconnect()
  }
  osc.start(now)
  osc.stop(now + duration + 0.02)
}

/** Plays one enveloped, band-passed slice of the shared noise buffer and cleans itself up. */
function playNoiseBurst(
  context: AudioContext, out: AudioNode, buffer: AudioBuffer, now: number,
  freq: number, q: number, duration: number, peak: number, attack = 0.003,
): void {
  const source = context.createBufferSource()
  source.buffer = buffer
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = freq
  filter.Q.value = q
  const gain = context.createGain()
  scheduleEnvelope(gain, now, attack, peak, duration)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(out)
  source.onended = () => {
    source.disconnect()
    filter.disconnect()
    gain.disconnect()
  }
  source.start(now)
  source.stop(now + duration + 0.02)
}

/** Plays a short staggered run of tones: the chip-arpeggio used by every award sound. */
function playArpeggio(
  context: AudioContext, out: AudioNode, now: number,
  freqs: readonly number[], noteDuration: number, peak: number, extras: ToneExtras, stagger: number,
): void {
  freqs.forEach((freq, i) => playTone(context, out, now + i * stagger, freq, noteDuration, peak, extras))
}

// ---------------------------------------------------------------------------------------------
// One voice per SoundId. The `Record` below makes the compiler check every id has a voice.
// ---------------------------------------------------------------------------------------------

function voiceBumper(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = clamp01(intensity)
  playNoiseBurst(context, out, buffer, now, 560 + amount * 420, 2.4, 0.045, 0.05 + amount * 0.14)
  playTone(context, out, now, 260 + amount * 140, 0.08, 0.05 + amount * 0.13, { type: 'square', endFreq: 90, attack: 0.003 })
}

function voiceSlingshot(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.7 + 0.3 * clamp01(intensity)
  playNoiseBurst(context, out, buffer, now, 1400, 3.5, 0.035, 0.05 * amount, 0.002)
  playTone(context, out, now + 0.006, 130, 0.07, 0.09 * amount, { type: 'triangle', endFreq: 60, attack: 0.003 })
}

function voiceTarget(context: AudioContext, out: GainNode, _buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.09 * (0.7 + 0.3 * clamp01(intensity))
  playTone(context, out, now, 660, 0.07, peak, { type: 'square', attack: 0.003 })
}

function voiceDropTarget(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.7 + 0.3 * clamp01(intensity)
  playNoiseBurst(context, out, buffer, now, 320, 1.8, 0.06, 0.06 * amount)
  playTone(context, out, now, 180, 0.1, 0.07 * amount, { type: 'triangle', endFreq: 70 })
}

function voiceBankComplete(context: AudioContext, out: GainNode, _buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.11 * (0.85 + 0.15 * clamp01(intensity))
  playArpeggio(context, out, now, [523.25, 659.25, 783.99, 1046.5], 0.12, peak, { type: 'sawtooth', attack: 0.004 }, 0.07)
}

function voiceRollover(context: AudioContext, out: GainNode, _buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.1 * (0.85 + 0.15 * clamp01(intensity))
  playArpeggio(context, out, now, [880, 1174.66], 0.09, peak, { type: 'sine', attack: 0.004 }, 0.06)
}

function voiceLaneComplete(context: AudioContext, out: GainNode, _buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.12 * (0.85 + 0.15 * clamp01(intensity))
  playArpeggio(context, out, now, [659.25, 783.99, 987.77, 1318.51], 0.11, peak, { type: 'square', attack: 0.004 }, 0.06)
}

function voiceSpinner(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.6 + 0.4 * clamp01(intensity)
  playNoiseBurst(context, out, buffer, now, 2600, 6, 0.02, 0.04 * amount, 0.001)
}

function voiceRampEnter(context: AudioContext, out: GainNode, _buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.09 * (0.85 + 0.15 * clamp01(intensity))
  playTone(context, out, now, 300, 0.18, peak, { type: 'sine', endFreq: 900, attack: 0.02 })
}

function voiceRampMade(context: AudioContext, out: GainNode, _buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.11 * (0.85 + 0.15 * clamp01(intensity))
  playArpeggio(context, out, now, [523.25, 659.25, 783.99, 1046.5, 1318.51], 0.09, peak, { type: 'triangle', attack: 0.003 }, 0.05)
}

function voiceSaucer(context: AudioContext, out: GainNode, _buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.12 * (0.85 + 0.15 * clamp01(intensity))
  playTone(context, out, now, 440, 0.22, peak, { type: 'sine', endFreq: 260, attack: 0.02 })
}

function voiceEject(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.7 + 0.3 * clamp01(intensity)
  playNoiseBurst(context, out, buffer, now, 1000, 2, 0.04, 0.06 * amount, 0.002)
  playTone(context, out, now + 0.01, 500, 0.08, 0.07 * amount, { type: 'square', endFreq: 900, attack: 0.004 })
}

function voiceLaunch(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.6 + 0.4 * clamp01(intensity)
  playNoiseBurst(context, out, buffer, now, 700, 1.2, 0.22, 0.05 * amount, 0.02)
  playTone(context, out, now, 160, 0.24, 0.09 * amount, { type: 'sawtooth', endFreq: 760, attack: 0.03 })
}

function voiceDrain(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.7 + 0.3 * clamp01(intensity)
  playNoiseBurst(context, out, buffer, now, 500, 1, 0.3, 0.05 * amount, 0.02)
  playTone(context, out, now, 500, 0.32, 0.09 * amount, { type: 'sawtooth', endFreq: 90, attack: 0.02 })
}

function voiceBallSaved(context: AudioContext, out: GainNode, _buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.11 * (0.85 + 0.15 * clamp01(intensity))
  playArpeggio(context, out, now, [587.33, 880], 0.14, peak, { type: 'triangle', attack: 0.006 }, 0.09)
}

function voiceExtraBall(context: AudioContext, out: GainNode, _buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.12 * (0.85 + 0.15 * clamp01(intensity))
  playArpeggio(context, out, now, [523.25, 659.25, 783.99, 659.25, 1046.5], 0.09, peak, { type: 'square', attack: 0.004 }, 0.06)
}

function voiceMultiball(context: AudioContext, out: GainNode, _buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.12 * (0.85 + 0.15 * clamp01(intensity))
  playArpeggio(
    context, out, now, [392, 523.25, 659.25, 783.99, 1046.5, 1318.51], 0.1, peak,
    { type: 'sawtooth', attack: 0.004 }, 0.055,
  )
  playArpeggio(context, out, now + 0.03, [783.99, 1046.5], 0.14, peak * 0.8, { type: 'square', attack: 0.006 }, 0.09)
}

function voiceJackpot(context: AudioContext, out: GainNode, _buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.13 * (0.85 + 0.15 * clamp01(intensity))
  playArpeggio(
    context, out, now, [659.25, 783.99, 987.77, 1318.51, 1567.98, 2093], 0.1, peak,
    { type: 'square', attack: 0.004 }, 0.055,
  )
}

function voiceBonusTick(context: AudioContext, out: GainNode, _buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.05 * (0.7 + 0.3 * clamp01(intensity))
  playTone(context, out, now, 1200, 0.03, peak, { type: 'square', attack: 0.002 })
}

function voiceTiltWarning(context: AudioContext, out: GainNode, _buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.1 * (0.85 + 0.15 * clamp01(intensity))
  // Two close, slightly detuned square waves beat against each other for a buzzy warning.
  playTone(context, out, now, 220, 0.18, peak, { type: 'square', endFreq: 200, attack: 0.005 })
  playTone(context, out, now, 233, 0.18, peak * 0.8, { type: 'square', endFreq: 210, attack: 0.005 })
}

function voiceTilt(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.85 + 0.15 * clamp01(intensity)
  playTone(context, out, now, 90, 0.7, 0.12 * amount, { type: 'sawtooth', endFreq: 60, attack: 0.02 })
  playNoiseBurst(context, out, buffer, now, 180, 1.5, 0.6, 0.05 * amount, 0.03)
}

function voiceGameStart(context: AudioContext, out: GainNode, _buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.12 * (0.85 + 0.15 * clamp01(intensity))
  playArpeggio(context, out, now, [523.25, 659.25, 783.99, 1046.5], 0.1, peak, { type: 'square', attack: 0.004 }, 0.06)
}

function voiceGameOver(context: AudioContext, out: GainNode, _buffer: AudioBuffer, now: number, intensity: number): void {
  const peak = 0.11 * (0.85 + 0.15 * clamp01(intensity))
  playArpeggio(context, out, now, [659.25, 523.25, 440, 329.63], 0.16, peak, { type: 'triangle', attack: 0.01 }, 0.14)
}

function voiceWall(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = clamp01(intensity)
  playNoiseBurst(context, out, buffer, now, 1000 + amount * 500, 2.6, 0.05, 0.04 + amount * 0.12, 0.003)
}

function voiceRubber(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = clamp01(intensity)
  playNoiseBurst(context, out, buffer, now, 380 + amount * 220, 1.4, 0.07, 0.04 + amount * 0.11, 0.004)
}

function voiceFlipper(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.7 + 0.3 * clamp01(intensity)
  playNoiseBurst(context, out, buffer, now, 1800, 4, 0.03, 0.06 * amount, 0.001)
  playTone(context, out, now, 110, 0.06, 0.08 * amount, { type: 'square', endFreq: 55, attack: 0.002 })
}

function voiceFlipperHit(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = clamp01(intensity)
  playNoiseBurst(context, out, buffer, now, 900 + amount * 600, 2.2, 0.05, 0.04 + amount * 0.13, 0.003)
  playTone(context, out, now, 200 + amount * 120, 0.07, 0.03 + amount * 0.08, { type: 'triangle', endFreq: 80 })
}

function voiceBallHit(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = clamp01(intensity)
  playNoiseBurst(context, out, buffer, now, 2200 + amount * 800, 5, 0.025, 0.03 + amount * 0.08, 0.001)
}

function voiceNudge(context: AudioContext, out: GainNode, buffer: AudioBuffer, now: number, intensity: number): void {
  const amount = 0.6 + 0.4 * clamp01(intensity)
  playNoiseBurst(context, out, buffer, now, 150, 1.2, 0.12, 0.06 * amount, 0.006)
  playTone(context, out, now, 70, 0.14, 0.08 * amount, { type: 'sine', endFreq: 45, attack: 0.008 })
}

// Every `SoundId` maps to a voice; a missing or misspelled key fails to type-check.
const VOICES: Record<SoundId, Voice> = {
  bumper: voiceBumper,
  slingshot: voiceSlingshot,
  target: voiceTarget,
  dropTarget: voiceDropTarget,
  bankComplete: voiceBankComplete,
  rollover: voiceRollover,
  laneComplete: voiceLaneComplete,
  spinner: voiceSpinner,
  rampEnter: voiceRampEnter,
  rampMade: voiceRampMade,
  saucer: voiceSaucer,
  eject: voiceEject,
  launch: voiceLaunch,
  drain: voiceDrain,
  ballSaved: voiceBallSaved,
  extraBall: voiceExtraBall,
  multiball: voiceMultiball,
  jackpot: voiceJackpot,
  bonusTick: voiceBonusTick,
  tiltWarning: voiceTiltWarning,
  tilt: voiceTilt,
  gameStart: voiceGameStart,
  gameOver: voiceGameOver,
  wall: voiceWall,
  rubber: voiceRubber,
  flipper: voiceFlipper,
  flipperHit: voiceFlipperHit,
  ballHit: voiceBallHit,
  nudge: voiceNudge,
}

export function createAudio(): GameAudio {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let noiseBuffer: AudioBuffer | null = null
  let unlocked = false
  let muted = false
  const lastPlayedAt = new Map<SoundId, number>()

  function ensureContext(): boolean {
    if (ctx && master) return true
    try {
      const w = window as unknown as {
        AudioContext?: AudioContextConstructor
        webkitAudioContext?: AudioContextConstructor
      }
      const Ctor = w.AudioContext ?? w.webkitAudioContext
      if (!Ctor) return false
      const context = new Ctor()
      const gain = context.createGain()
      gain.gain.value = muted ? 0 : MASTER_GAIN
      gain.connect(context.destination)
      ctx = context
      master = gain
      return true
    } catch {
      ctx = null
      master = null
      return false
    }
  }

  function unlock(): void {
    try {
      if (!ensureContext() || !ctx) return
      if (ctx.state === 'suspended') void ctx.resume()
      unlocked = true
    } catch { /* no-op: audio is optional */ }
  }

  function setMuted(nextMuted: boolean): void {
    muted = nextMuted
    if (!ctx || !master) return
    try {
      const now = ctx.currentTime
      const target = muted ? 0 : MASTER_GAIN
      master.gain.cancelScheduledValues(now)
      master.gain.setValueAtTime(master.gain.value, now)
      master.gain.linearRampToValueAtTime(target, now + MUTE_RAMP_SECONDS)
    } catch { /* no-op: audio is optional */ }
  }

  function canPlay(): boolean {
    return unlocked && !muted && ctx !== null && master !== null
  }

  /** Runs `action` with the live context/master gain when playable, and never throws. */
  function withAudio(action: (context: AudioContext, out: GainNode) => void): void {
    if (!canPlay() || !ctx || !master) return
    try {
      action(ctx, master)
    } catch { /* no-op: audio is optional */ }
  }

  /** One shared noise buffer, generated once and reused by every noise-based voice. */
  function getNoiseBuffer(context: AudioContext): AudioBuffer {
    if (noiseBuffer) return noiseBuffer
    const length = Math.floor(context.sampleRate * NOISE_BUFFER_SECONDS)
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    noiseBuffer = buffer
    return buffer
  }

  function play(name: SoundId, intensity: number): void {
    withAudio((context, out) => {
      const now = context.currentTime
      const last = lastPlayedAt.get(name) ?? -Infinity
      if (now - last < MIN_VOICE_INTERVAL_S) return
      lastPlayedAt.set(name, now)
      VOICES[name](context, out, getNoiseBuffer(context), now, intensity)
    })
  }

  function dispose(): void {
    try {
      master?.disconnect()
      void ctx?.close()
    } catch { /* no-op: audio is optional */ } finally {
      noiseBuffer = null
      ctx = null
      master = null
      unlocked = false
      lastPlayedAt.clear()
    }
  }

  return { unlock, setMuted, play, dispose }
}
