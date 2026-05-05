import { useCallback, useRef, useState } from 'react'
import {
  AudioCapture,
  REQUESTED_SETTINGS_FOR_DISPLAY,
  type ActualSettings,
} from '../audio/AudioCapture'
import {
  MeasurementController,
  BACKGROUND_DURATION_SEC,
  POST_NOISE_DURATION_SEC,
  COUNTDOWN_DURATION_SEC,
} from '../measurement/MeasurementController'
import {
  IMPULSE_SOURCE_LABELS,
  type CapturedSegments,
  type ImpulseSource,
  type Metadata,
  type RecordingPhase,
} from '../measurement/types'
import { useMeasurementDraft } from '../measurement/DraftContext'
import { useSettings } from '../settings/SettingsContext'
import { analyzeImpulseResponse } from '../dsp/analyze'
import { BANDS } from '../dsp/bands'
import ResultsTable from '../components/ResultsTable'
import { saveMeasurement } from '../storage/measurements'
import { useNavigate } from 'react-router-dom'

// The full measurement view: metadata form -> record sequence -> results.
// Step 5 deliverable; decay-curve plotting (step 6) is omitted for now.

type UIPhase = RecordingPhase

interface PhaseDisplay {
  samplesTotal?: number
  samplesCaptured?: number
  triggerThresholdAmp?: number
  recentPeak?: number
}

export default function Measurement() {
  const { settings } = useSettings()
  // Draft metadata + unsaved analysis live in a context so they survive
  // navigation between Measure / History / Settings.
  const { metadata, setMetadata, unsaved, setUnsaved } = useMeasurementDraft()
  const navigate = useNavigate()

  const [actual, setActual] = useState<ActualSettings | null>(null)
  const [phase, setPhase] = useState<UIPhase>('idle')
  const [phaseInfo, setPhaseInfo] = useState<PhaseDisplay>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // We do NOT keep the AudioCapture or MeasurementController in React
  // state — they are imperative objects. Refs avoid stale-closure bugs
  // in the audio callback.
  const captureRef = useRef<AudioCapture | null>(null)
  const controllerRef = useRef<MeasurementController | null>(null)

  const metadataValid =
    metadata.site.trim() !== '' &&
    metadata.room.trim() !== '' &&
    metadata.position.trim() !== ''

  const updateMeta = useCallback(
    <K extends keyof Metadata>(key: K, value: Metadata[K]) =>
      setMetadata({ ...metadata, [key]: value }),
    [metadata, setMetadata],
  )

  // ---- recording lifecycle -------------------------------------------

  async function startMeasurement() {
    setError(null)
    setUnsaved(null)
    setPhaseInfo({})

    const capture = new AudioCapture()
    captureRef.current = capture

    try {
      const settingsActual = await capture.start(({ samples, clipped }) => {
        controllerRef.current?.onSamples(samples, clipped)
      })
      setActual(settingsActual)

      // Build the controller now that we know the actual sample rate.
      const controller = new MeasurementController({
        sampleRate: settingsActual.sampleRate,
        decayDurationSec: settings.decayDurationSec,
        triggerThresholdDb: settings.triggerThresholdDb,
        onPhaseChange: (p, info) => {
          setPhase(p)
          if (info) setPhaseInfo(info)
        },
        onComplete: (segments) => {
          // Run analysis off the audio callback — but synchronously for now;
          // it's fast enough for our buffer sizes (worst case ~24 bands of
          // 11s of audio at 48 kHz takes ~0.5 s on a phone).
          runAnalysis(segments)
        },
        onError: (msg) => {
          setError(msg)
          setPhase('error')
        },
      })
      controllerRef.current = controller
      controller.start()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setPhase('error')
      captureRef.current = null
    }
  }

  async function runAnalysis(segments: CapturedSegments) {
    try {
      // Filter the BANDS list down to the user-enabled subset.
      const enabled = new Set(settings.enabledBandCentres)
      const enabledBands = BANDS.filter((b) => enabled.has(b.centre))
      const result = analyzeImpulseResponse(
        {
          impulse: segments.impulse,
          noise: segments.noise,
          // Pass the pre-impulse background so the analyzer can use the
          // worse of pre/post for INR and flag bands where the room
          // background changed mid-measurement.
          preNoise: segments.background,
          sampleRate: segments.sampleRate,
          clipped: segments.clipped,
        },
        {
          inrThresholds: settings.inrThresholds,
          bands: enabledBands,
          nonLinearR2Threshold: settings.nonLinearR2Threshold,
        },
      )
      // Stash the unsaved analysis + a snapshot of the metadata into the
      // shared draft context, so navigating to History/Settings and back
      // doesn't lose it. The user must Save or Discard explicitly.
      setUnsaved({ metadata: { ...metadata }, analysis: result })
      setPhase('done')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError('Analysis failed: ' + msg)
      setPhase('error')
    } finally {
      // Stop the mic now that we have the buffers. Don't await — UI is
      // already showing results.
      const cap = captureRef.current
      captureRef.current = null
      if (cap) cap.stop()
    }
  }

  async function discardAndRetry() {
    const cap = captureRef.current
    captureRef.current = null
    controllerRef.current = null
    if (cap) await cap.stop()
    setUnsaved(null)
    setPhase('idle')
    setPhaseInfo({})
    setError(null)
  }

  async function saveToHistory() {
    if (!unsaved) return
    setSaving(true)
    try {
      await saveMeasurement(unsaved.metadata, unsaved.analysis)
      setUnsaved(null)
      setPhase('idle')
      // Navigate to History so the user can see the saved row immediately.
      navigate('/')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError('Save failed: ' + msg)
    } finally {
      setSaving(false)
    }
  }

  // ---- render --------------------------------------------------------

  // Results view takes over while there's an unsaved analysis. Persists
  // through tab navigation thanks to the draft context — user must Save
  // or Discard to leave this screen.
  if (unsaved && (phase === 'done' || phase === 'idle')) {
    const meta = unsaved.metadata
    const analysis = unsaved.analysis
    return (
      <div className="view view-measure">
        <h2>Results</h2>
        <p className="view-stub">
          {meta.site} / {meta.room} / pos {meta.position} —{' '}
          {IMPULSE_SOURCE_LABELS[meta.impulseSource]}
        </p>
        {analysis.clipped && (
          <div className="alert alert-error">
            Recording clipped — impulse may be invalid. Reduce source level or move further away.
          </div>
        )}
        <ResultsTable result={analysis} />
        {error && (
          <div className="alert alert-error">
            <strong>Error:</strong> {error}
          </div>
        )}
        <div className="capture-controls capture-controls-row">
          <button
            className="primary-btn primary-btn-stop"
            onClick={discardAndRetry}
            disabled={saving}
          >
            Discard
          </button>
          <button
            className="primary-btn"
            onClick={saveToHistory}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save to history'}
          </button>
        </div>
        <p className="muted">
          Save stores the measurement on this device only (no cloud).
          CSV/JSON export comes in step 8.
        </p>
      </div>
    )
  }

  return (
    <div className="view view-measure">
      <h2>New measurement</h2>

      {/* --- metadata form --- */}
      <fieldset className="meta-form" disabled={phase !== 'idle' && phase !== 'error'}>
        <label className="settings-label">
          Site
          <input
            type="text"
            value={metadata.site}
            onChange={(e) => updateMeta('site', e.target.value)}
            placeholder="e.g. Project name or building"
            required
          />
        </label>
        <label className="settings-label">
          Room
          <input
            type="text"
            value={metadata.room}
            onChange={(e) => updateMeta('room', e.target.value)}
            placeholder="e.g. Conference Room 2"
            required
          />
        </label>
        <label className="settings-label">
          Position
          <input
            type="text"
            value={metadata.position}
            onChange={(e) => updateMeta('position', e.target.value)}
            placeholder="e.g. P1"
            required
          />
        </label>
        <label className="settings-label">
          Impulse source
          <select
            value={metadata.impulseSource}
            onChange={(e) => updateMeta('impulseSource', e.target.value as ImpulseSource)}
          >
            {Object.entries(IMPULSE_SOURCE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-label">
          Notes (optional)
          <textarea
            rows={2}
            value={metadata.notes}
            onChange={(e) => updateMeta('notes', e.target.value)}
            placeholder="Anything worth remembering about this position"
          />
        </label>
      </fieldset>

      {/* --- start button + warning --- */}
      {(phase === 'idle' || phase === 'error') && (
        <>
          <div className="alert alert-warn">
            Reminder: iOS Safari may not honour every audio constraint
            (auto-gain, noise suppression). Validate against your Type 1 meter.
            Hold the phone still during the impulse and decay.
          </div>
          <div className="capture-controls">
            <button
              className="primary-btn"
              disabled={!metadataValid}
              onClick={startMeasurement}
            >
              Start measurement
            </button>
          </div>
          {!metadataValid && (
            <p className="muted">Fill in site, room, and position to enable Start.</p>
          )}
          {error && (
            <div className="alert alert-error">
              <strong>Error:</strong> {error}
            </div>
          )}
        </>
      )}

      {/* --- recording status display --- */}
      {phase !== 'idle' && phase !== 'done' && phase !== 'error' && (
        <RecordingStatus
          phase={phase}
          phaseInfo={phaseInfo}
          decayDurationSec={settings.decayDurationSec}
          triggerThresholdDb={settings.triggerThresholdDb}
          sampleRate={actual?.sampleRate ?? 48000}
        />
      )}

      {/* --- mic info while running --- */}
      {actual && phase !== 'idle' && phase !== 'error' && (
        <details className="mic-details">
          <summary>Microphone info</summary>
          <div className="settings-grid">
            <div>Sample rate</div>
            <div>{actual.sampleRate.toLocaleString()} Hz</div>
            <div>Auto gain</div>
            <div>{describeBool(actual.autoGainControl)} <span className="muted">(asked off)</span></div>
            <div>Echo cancel</div>
            <div>{describeBool(actual.echoCancellation)}</div>
            <div>Noise supp</div>
            <div>{describeBool(actual.noiseSuppression)}</div>
            <div>Device</div>
            <div className="muted">{actual.deviceLabel}</div>
            <div>Asked rate</div>
            <div className="muted">{REQUESTED_SETTINGS_FOR_DISPLAY.sampleRate} Hz</div>
          </div>
        </details>
      )}

      {/* --- cancel button while running --- */}
      {phase !== 'idle' && phase !== 'done' && phase !== 'error' && (
        <div className="capture-controls">
          <button className="primary-btn primary-btn-stop" onClick={discardAndRetry}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

interface StatusProps {
  phase: UIPhase
  phaseInfo: PhaseDisplay
  decayDurationSec: number
  triggerThresholdDb: number
  sampleRate: number
}

function RecordingStatus({ phase, phaseInfo, decayDurationSec, triggerThresholdDb, sampleRate }: StatusProps) {
  let title = ''
  let subtitle = ''
  let big = ''

  switch (phase) {
    case 'countdown':
      title = 'Get ready'
      subtitle = `Position the source and stand by — ${COUNTDOWN_DURATION_SEC} s`
      big = remainingSeconds(phaseInfo, sampleRate)
      break
    case 'background':
      title = 'Recording background'
      subtitle = `Stay quiet — ${BACKGROUND_DURATION_SEC} s`
      big = remainingSeconds(phaseInfo, sampleRate)
      break
    case 'armed':
      title = 'Trigger impulse now'
      subtitle = `Listening for any sound > ${triggerThresholdDb} dB above background`
      big = '👏'
      break
    case 'recording':
      title = 'Recording decay'
      subtitle = `Capturing ${decayDurationSec} s of decay`
      big = remainingSeconds(phaseInfo, sampleRate)
      break
    case 'postnoise':
      title = 'Recording post-noise'
      subtitle = `Stay quiet — ${POST_NOISE_DURATION_SEC} s`
      big = remainingSeconds(phaseInfo, sampleRate)
      break
    case 'analyzing':
      title = 'Analysing'
      subtitle = 'Filtering each band and fitting decays...'
      big = '...'
      break
    default:
      break
  }

  return (
    <div className={`status-card status-${phase}`}>
      <div className="status-title">{title}</div>
      {big && <div className="status-big">{big}</div>}
      <div className="status-subtitle">{subtitle}</div>
    </div>
  )
}

function remainingSeconds(info: PhaseDisplay, sampleRate: number): string {
  if (info.samplesTotal && info.samplesCaptured !== undefined) {
    const remaining = (info.samplesTotal - info.samplesCaptured) / sampleRate
    return `${Math.max(0, remaining).toFixed(1)} s`
  }
  return ''
}

function describeBool(value: boolean | undefined): string {
  if (value === undefined) return '(not reported)'
  return value ? 'on' : 'off'
}
