import { useCallback, useRef, useState } from 'react'
import {
  AudioCapture,
  REQUESTED_SETTINGS_FOR_DISPLAY,
  type ActualSettings,
} from '../audio/AudioCapture'
import Waveform, { type WaveformHandle } from '../components/Waveform'

// Step 3 scope: prove we can open the microphone with our requested
// constraints, show what the browser actually gave us, and render a live
// waveform. No DSP, no recording-to-buffer, no impulse detection yet —
// those come in steps 4-5.
export default function Measurement() {
  const captureRef = useRef<AudioCapture | null>(null)
  const waveformRef = useRef<WaveformHandle | null>(null)

  const [running, setRunning] = useState(false)
  const [actual, setActual] = useState<ActualSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [clipped, setClipped] = useState(false)

  // The Waveform component hands back its push/reset interface once it
  // has set up its internal ring buffer. Stash it in a ref so the audio
  // callback can reach it without forcing React re-renders per block.
  const handleWaveformReady = useCallback((handle: WaveformHandle) => {
    waveformRef.current = handle
  }, [])

  async function start() {
    setError(null)
    setClipped(false)
    const capture = new AudioCapture()
    captureRef.current = capture
    try {
      const settings = await capture.start(({ samples, clipped: blockClipped }) => {
        waveformRef.current?.pushSamples(samples)
        if (blockClipped) setClipped(true)
      })
      setActual(settings)
      setRunning(true)
    } catch (err) {
      // Permission denied, no mic, secure-context required, etc.
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      captureRef.current = null
    }
  }

  async function stop() {
    const capture = captureRef.current
    captureRef.current = null
    setRunning(false)
    waveformRef.current?.reset()
    if (capture) await capture.stop()
  }

  return (
    <div className="view view-measure">
      <h2>New measurement</h2>
      <p className="view-stub">
        Step 3: microphone test. Tap <strong>Enable mic</strong>, allow Safari
        to access the microphone, and you should see a live waveform.
      </p>

      <div className="capture-controls">
        {!running ? (
          <button className="primary-btn" onClick={start}>Enable mic</button>
        ) : (
          <button className="primary-btn primary-btn-stop" onClick={stop}>Stop</button>
        )}
      </div>

      {error && (
        <div className="alert alert-error">
          <strong>Microphone error:</strong> {error}
        </div>
      )}

      {running && actual && (
        <>
          <div className="alert alert-warn">
            iOS Safari may not honour every audio constraint — check the
            actual values below against what was requested.
          </div>

          <div className="settings-grid">
            <div>Sample rate</div>
            <div>{actual.sampleRate.toLocaleString()} Hz <span className="muted">(asked {REQUESTED_SETTINGS_FOR_DISPLAY.sampleRate?.toLocaleString()} Hz)</span></div>

            <div>Channel count</div>
            <div>{describe(actual.channelCount)} <span className="muted">(asked {REQUESTED_SETTINGS_FOR_DISPLAY.channelCount})</span></div>

            <div>Auto gain control</div>
            <div>{describeBool(actual.autoGainControl)} <span className="muted">(asked off)</span></div>

            <div>Echo cancellation</div>
            <div>{describeBool(actual.echoCancellation)} <span className="muted">(asked off)</span></div>

            <div>Noise suppression</div>
            <div>{describeBool(actual.noiseSuppression)} <span className="muted">(asked off)</span></div>

            <div>Device</div>
            <div className="muted">{actual.deviceLabel}</div>
          </div>

          {clipped && (
            <div className="alert alert-error">
              Clipping detected (sample reached ±1.0). For RT60, this would
              invalidate the impulse — reduce source level or move further away.
            </div>
          )}
        </>
      )}

      {/* Mount the waveform whenever the mic is running so it sees the
          real sample rate. Re-mounting is what triggers it to allocate
          its ring buffer at the correct length. */}
      {running && actual && (
        <div className="waveform-wrap">
          <Waveform sampleRate={actual.sampleRate} onReady={handleWaveformReady} />
        </div>
      )}
    </div>
  )
}

function describe(value: number | undefined): string {
  return value === undefined ? '(not reported)' : String(value)
}

function describeBool(value: boolean | undefined): string {
  if (value === undefined) return '(not reported)'
  return value ? 'on' : 'off'
}
