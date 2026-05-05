// MeasurementController — the recording state machine.
//
// Owns the captured audio buffers and walks through the phases of a
// single RT60 measurement, driven by sample blocks coming in from the
// AudioCapture worklet. The React layer just calls onSamples() with each
// block and listens for state notifications.
//
// Phases:
//   1) background  — capture 3 s of background noise. At the end we
//                    compute its RMS and set the trigger threshold.
//   2) armed       — listen for any sample whose magnitude exceeds the
//                    threshold. The most recent ~200 ms is kept in a
//                    ring buffer so the impulse onset is not lost.
//   3) recording   — once triggered, capture decayDurationSec of the
//                    decay (with the pre-trigger ring buffer prepended).
//   4) postnoise   — capture 2 s of background after the decay so the
//                    noise floor can be measured separately.
//   5) done        — hand all three buffers (impulse, noise, background)
//                    to the caller via onComplete.
//
// Clipping flag is OR'd across every block.

import type { CapturedSegments, RecordingPhase } from './types'

export const BACKGROUND_DURATION_SEC = 3
export const POST_NOISE_DURATION_SEC = 2
export const PRE_TRIGGER_DURATION_SEC = 0.2

export interface ControllerOptions {
  sampleRate: number
  decayDurationSec: number
  /** Trigger threshold in dB above the measured background RMS. */
  triggerThresholdDb: number
  onPhaseChange: (phase: RecordingPhase, info?: PhaseInfo) => void
  onComplete: (segments: CapturedSegments) => void
  onError: (message: string) => void
}

export interface PhaseInfo {
  /** Total samples needed in the current phase. */
  samplesTotal?: number
  /** Samples captured so far in the current phase. */
  samplesCaptured?: number
  /** For 'armed': the trigger threshold (linear amplitude). */
  triggerThresholdAmp?: number
  /** For 'armed': the most recent peak amplitude observed. */
  recentPeak?: number
}

export class MeasurementController {
  private opts: ControllerOptions
  private phase: RecordingPhase = 'idle'
  private clipped = false

  // Background phase storage.
  private backgroundBuf: Float32Array
  private backgroundIdx = 0

  // Pre-trigger ring buffer (always-on once armed).
  private ringBuf: Float32Array
  private ringWrite = 0
  private ringFull = false

  // Decay storage. Allocated once we know the trigger threshold.
  private impulseBuf: Float32Array
  private impulseIdx = 0

  // Post-noise storage.
  private postNoiseBuf: Float32Array
  private postNoiseIdx = 0

  // Trigger threshold (linear amplitude), set at the end of background phase.
  private triggerThresholdAmp = 0

  // For PhaseInfo throttling.
  private lastPhaseInfoTime = 0

  constructor(options: ControllerOptions) {
    this.opts = options
    const Fs = options.sampleRate
    this.backgroundBuf = new Float32Array(Math.round(Fs * BACKGROUND_DURATION_SEC))
    this.ringBuf = new Float32Array(Math.round(Fs * PRE_TRIGGER_DURATION_SEC))
    this.impulseBuf = new Float32Array(
      Math.round(Fs * (PRE_TRIGGER_DURATION_SEC + options.decayDurationSec)),
    )
    this.postNoiseBuf = new Float32Array(Math.round(Fs * POST_NOISE_DURATION_SEC))
  }

  /** Begin a measurement. Caller should already have an AudioCapture
   *  feeding samples into onSamples() at this point. */
  start() {
    if (this.phase !== 'idle') {
      this.opts.onError('Controller already started')
      return
    }
    this.transition('background', { samplesTotal: this.backgroundBuf.length })
  }

  /** Cancel the current measurement and return to idle. */
  cancel() {
    if (this.phase === 'idle' || this.phase === 'done' || this.phase === 'error') return
    this.phase = 'idle'
    this.opts.onPhaseChange('idle')
  }

  getPhase(): RecordingPhase {
    return this.phase
  }

  /** Feed one block of audio in. Called once per worklet message. */
  onSamples(block: Float32Array, blockClipped: boolean) {
    if (blockClipped) this.clipped = true

    switch (this.phase) {
      case 'background':
        this.handleBackground(block)
        break
      case 'armed':
        this.handleArmed(block)
        break
      case 'recording':
        this.handleRecording(block)
        break
      case 'postnoise':
        this.handlePostNoise(block)
        break
      // 'idle' / 'analyzing' / 'done' / 'error' — drop samples.
      default:
        break
    }
  }

  // ---- phase handlers ----------------------------------------------------

  private handleBackground(block: Float32Array) {
    const remaining = this.backgroundBuf.length - this.backgroundIdx
    const take = Math.min(remaining, block.length)
    this.backgroundBuf.set(block.subarray(0, take), this.backgroundIdx)
    this.backgroundIdx += take

    // Also push samples into the pre-trigger ring buffer so the moment
    // we transition to 'armed' it already has 200 ms of history.
    this.pushRing(block.subarray(0, take))

    this.maybeReportProgress({
      samplesTotal: this.backgroundBuf.length,
      samplesCaptured: this.backgroundIdx,
    })

    if (this.backgroundIdx >= this.backgroundBuf.length) {
      // Background captured. Compute RMS and arm the trigger.
      const bgRms = computeRms(this.backgroundBuf)
      // Threshold in linear amplitude relative to RMS.
      this.triggerThresholdAmp = bgRms * Math.pow(10, this.opts.triggerThresholdDb / 20)
      // Guard against effectively-zero background (e.g. dead-silent room).
      // Treat that as a small floor so a soft impulse still triggers.
      if (!Number.isFinite(this.triggerThresholdAmp) || this.triggerThresholdAmp < 1e-6) {
        this.triggerThresholdAmp = 1e-3
      }
      this.transition('armed', {
        triggerThresholdAmp: this.triggerThresholdAmp,
      })

      // Carry over any leftover samples in this block into the next phase.
      if (take < block.length) {
        const tail = block.subarray(take)
        this.handleArmed(tail)
      }
    }
  }

  private handleArmed(block: Float32Array) {
    // Walk through the block sample-by-sample. As soon as a sample exceeds
    // the threshold, start the recording phase (the triggering sample is
    // the first sample of the impulse window after the pre-trigger margin).
    let triggerIdx = -1
    let recentPeak = 0
    for (let i = 0; i < block.length; i++) {
      const s = block[i]
      const a = Math.abs(s)
      if (a > recentPeak) recentPeak = a
      if (a >= this.triggerThresholdAmp) {
        triggerIdx = i
        break
      }
    }
    if (triggerIdx < 0) {
      // No trigger this block. Push everything into the ring and report.
      this.pushRing(block)
      this.maybeReportProgress({
        triggerThresholdAmp: this.triggerThresholdAmp,
        recentPeak,
      })
      return
    }

    // Trigger! Push pre-trigger samples (block[0..triggerIdx]) into ring
    // first so the ring buffer represents the most recent 200 ms ending
    // at the triggering sample.
    this.pushRing(block.subarray(0, triggerIdx))

    // Snapshot ring buffer in chronological order into the impulse buffer.
    const ringSnapshot = this.snapshotRing()
    const preCount = Math.min(ringSnapshot.length, this.impulseBuf.length)
    this.impulseBuf.set(ringSnapshot.subarray(ringSnapshot.length - preCount, ringSnapshot.length), 0)
    this.impulseIdx = preCount

    this.transition('recording', {
      samplesTotal: this.impulseBuf.length,
      samplesCaptured: this.impulseIdx,
    })

    // Now feed the triggering sample and the rest of this block into
    // the recording phase.
    const tail = block.subarray(triggerIdx)
    this.handleRecording(tail)
  }

  private handleRecording(block: Float32Array) {
    const remaining = this.impulseBuf.length - this.impulseIdx
    const take = Math.min(remaining, block.length)
    this.impulseBuf.set(block.subarray(0, take), this.impulseIdx)
    this.impulseIdx += take

    this.maybeReportProgress({
      samplesTotal: this.impulseBuf.length,
      samplesCaptured: this.impulseIdx,
    })

    if (this.impulseIdx >= this.impulseBuf.length) {
      this.transition('postnoise', {
        samplesTotal: this.postNoiseBuf.length,
      })
      if (take < block.length) {
        this.handlePostNoise(block.subarray(take))
      }
    }
  }

  private handlePostNoise(block: Float32Array) {
    const remaining = this.postNoiseBuf.length - this.postNoiseIdx
    const take = Math.min(remaining, block.length)
    this.postNoiseBuf.set(block.subarray(0, take), this.postNoiseIdx)
    this.postNoiseIdx += take

    this.maybeReportProgress({
      samplesTotal: this.postNoiseBuf.length,
      samplesCaptured: this.postNoiseIdx,
    })

    if (this.postNoiseIdx >= this.postNoiseBuf.length) {
      this.complete()
    }
  }

  private complete() {
    this.transition('analyzing')
    // Hand the buffers off to the caller; React will run the DSP pipeline.
    const segments: CapturedSegments = {
      impulse: this.impulseBuf,
      noise: this.postNoiseBuf,
      background: this.backgroundBuf,
      sampleRate: this.opts.sampleRate,
      clipped: this.clipped,
      triggerThresholdAmp: this.triggerThresholdAmp,
    }
    this.opts.onComplete(segments)
  }

  // ---- ring buffer -------------------------------------------------------

  private pushRing(block: ArrayLike<number>) {
    const len = this.ringBuf.length
    let w = this.ringWrite
    for (let i = 0; i < block.length; i++) {
      this.ringBuf[w] = block[i]
      w++
      if (w >= len) {
        w = 0
        this.ringFull = true
      }
    }
    this.ringWrite = w
  }

  /** Return the ring buffer contents in chronological order. */
  private snapshotRing(): Float32Array {
    const len = this.ringBuf.length
    if (!this.ringFull) {
      // Only the first ringWrite samples are valid.
      return this.ringBuf.slice(0, this.ringWrite)
    }
    const out = new Float32Array(len)
    // Oldest sample lives at ringWrite (the next slot to be overwritten).
    out.set(this.ringBuf.subarray(this.ringWrite), 0)
    out.set(this.ringBuf.subarray(0, this.ringWrite), len - this.ringWrite)
    return out
  }

  // ---- helpers -----------------------------------------------------------

  private transition(phase: RecordingPhase, info?: PhaseInfo) {
    this.phase = phase
    this.opts.onPhaseChange(phase, info)
  }

  private maybeReportProgress(info: PhaseInfo) {
    // Throttle to ~30 Hz so React doesn't re-render on every audio block
    // (which arrives at ~375 Hz at 48 kHz with 128-sample blocks).
    const now = performance.now()
    if (now - this.lastPhaseInfoTime < 33) return
    this.lastPhaseInfoTime = now
    this.opts.onPhaseChange(this.phase, info)
  }
}

function computeRms(buf: Float32Array): number {
  let sumSq = 0
  for (let i = 0; i < buf.length; i++) {
    const s = buf[i]
    sumSq += s * s
  }
  return Math.sqrt(sumSq / buf.length)
}
