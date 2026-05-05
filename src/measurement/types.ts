// Shared types for the measurement flow.

export type ImpulseSource = 'balloon' | 'clapper' | 'pistol' | 'other'

export const IMPULSE_SOURCE_LABELS: Record<ImpulseSource, string> = {
  balloon: 'Balloon pop',
  clapper: 'Clapper board',
  pistol: 'Starter pistol',
  other: 'Other',
}

export interface Metadata {
  site: string
  room: string
  position: string
  notes: string
  impulseSource: ImpulseSource
}

/** Phases of the recording state machine. */
export type RecordingPhase =
  | 'idle'
  | 'countdown'    // 2 s "get ready" countdown before background capture
  | 'background'   // capturing 3 s of background noise
  | 'armed'        // background captured, waiting for impulse
  | 'recording'    // impulse triggered, capturing decay
  | 'postnoise'    // capturing 3 s of post-decay noise
  | 'analyzing'    // running the DSP
  | 'done'         // results available
  | 'error'        // a fatal problem stopped the run

/** Captured buffers ready for analysis. */
export interface CapturedSegments {
  /** Pre-trigger margin + decay window. */
  impulse: Float32Array
  /** Post-decay 2 s of noise. */
  noise: Float32Array
  /** Background segment used to set the trigger threshold. */
  background: Float32Array
  /** Sample rate at which all the above were captured. */
  sampleRate: number
  /** Whether ANY recorded sample hit ±1.0. */
  clipped: boolean
  /** Trigger threshold actually used (amplitude, linear). */
  triggerThresholdAmp: number
}
