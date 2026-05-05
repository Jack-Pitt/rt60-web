// AudioCapture: high-level wrapper around the browser audio APIs.
//
// Job:
//   1) Ask the user for microphone permission via getUserMedia, requesting
//      the cleanest possible signal (no auto-gain, no echo cancellation,
//      no noise suppression, mono, 48 kHz). iOS Safari may not honour all
//      these, which is why we report the actual values back via
//      getActualConstraints().
//   2) Build an AudioContext and an AudioWorkletNode that runs the
//      capture-processor.js worklet on the audio thread.
//   3) Forward each block of incoming samples to a caller-supplied
//      onSamples() callback so the UI can draw a waveform and (later)
//      record into a buffer for analysis.
//
// All of this must be triggered by a user gesture (button tap) on iOS,
// otherwise the AudioContext stays suspended and getUserMedia is denied.

// Worklet processor file. The ?url suffix tells Vite to emit it as a
// separate static asset and give us its final URL — that URL is what
// audioWorklet.addModule() needs.
import workletUrl from './capture-processor.js?url'

// What we tell getUserMedia we want. Documented in the brief.
const REQUESTED_CONSTRAINTS: MediaTrackConstraints = {
  autoGainControl: false,
  echoCancellation: false,
  noiseSuppression: false,
  channelCount: 1,
  sampleRate: 48000,
}

// What we got back. iOS Safari is the main reason these can differ from
// what we asked for — it tends to lock the sample rate to the hardware
// native rate and silently ignores some constraints.
export interface ActualSettings {
  sampleRate: number
  channelCount: number | undefined
  autoGainControl: boolean | undefined
  echoCancellation: boolean | undefined
  noiseSuppression: boolean | undefined
  deviceLabel: string
}

// Block of samples handed off from the worklet on the audio thread.
export interface CaptureBlock {
  samples: Float32Array
  clipped: boolean
}

export class AudioCapture {
  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | null = null
  private actual: ActualSettings | null = null
  private onBlock: ((block: CaptureBlock) => void) | null = null

  /** True when the mic is open and the worklet is running. */
  get isRunning(): boolean {
    return this.node !== null
  }

  /**
   * Request microphone access and start streaming samples to onBlock.
   * Must be called from a user-gesture event handler (button click) on iOS.
   */
  async start(onBlock: (block: CaptureBlock) => void): Promise<ActualSettings> {
    if (this.isRunning) throw new Error('Already running')
    this.onBlock = onBlock

    // Step 1: ask for the mic. The browser may prompt the user.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: REQUESTED_CONSTRAINTS,
      video: false,
    })

    const track = this.stream.getAudioTracks()[0]
    const settings = track.getSettings()
    // Step 2: build the audio graph. AudioContext picks its own sample
    // rate based on the device — we read it back rather than asking for
    // a specific rate (the sampleRate constructor option is widely
    // unreliable on iOS Safari).
    this.context = new AudioContext()
    this.actual = {
      sampleRate: this.context.sampleRate,
      channelCount: settings.channelCount,
      autoGainControl: coerceBool(settings.autoGainControl),
      echoCancellation: coerceBool(settings.echoCancellation),
      noiseSuppression: coerceBool(settings.noiseSuppression),
      deviceLabel: track.label || '(default microphone)',
    }

    // Some iOS situations create the AudioContext in a suspended state
    // even when called from a gesture. Resuming is harmless if it is
    // already running.
    if (this.context.state === 'suspended') await this.context.resume()

    // Step 3: load the worklet module that defines our processor class,
    // then create a node that runs an instance of it.
    await this.context.audioWorklet.addModule(workletUrl)
    this.node = new AudioWorkletNode(this.context, 'capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    })

    this.node.port.onmessage = (e) => {
      const msg = e.data as { type: string; samples?: Float32Array; clipped?: boolean }
      if (msg.type === 'samples' && msg.samples && this.onBlock) {
        this.onBlock({ samples: msg.samples, clipped: !!msg.clipped })
      }
    }

    // Step 4: connect mic -> worklet. The worklet has no output so the
    // signal does not get fed back to the speaker (which would feedback
    // through the same mic).
    this.source = this.context.createMediaStreamSource(this.stream)
    this.source.connect(this.node)

    return this.actual!
  }

  /** Stop the worklet and release the microphone. */
  async stop(): Promise<void> {
    if (this.node) {
      this.node.port.postMessage({ type: 'stop' })
      this.node.disconnect()
      this.node = null
    }
    if (this.source) {
      this.source.disconnect()
      this.source = null
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop()
      this.stream = null
    }
    if (this.context) {
      await this.context.close()
      this.context = null
    }
    this.onBlock = null
  }

  getActualSettings(): ActualSettings | null {
    return this.actual
  }
}

/** What we asked the browser for, exposed for the UI to display alongside actuals.
 *  Plain values (not the wider Constraint range types) so the UI can render directly. */
export const REQUESTED_SETTINGS_FOR_DISPLAY = {
  sampleRate: 48000,
  channelCount: 1,
  autoGainControl: false,
  echoCancellation: false,
  noiseSuppression: false,
} as const

// Browsers vary on how they encode boolean settings: some return real
// booleans, some return the strings "true"/"false". Normalise to bool.
function coerceBool(v: boolean | string | undefined): boolean | undefined {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return v === 'true'
  return undefined
}
