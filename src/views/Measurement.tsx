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
import { analyzeImpulseResponse, CRITICAL_FLAGS } from '../dsp/analyze'
import { BANDS } from '../dsp/bands'
import ResultsTable from '../components/ResultsTable'
import DecaySection from '../components/DecaySection'
import RTSpectrumPlot, { type SpectrumSeries } from '../components/RTSpectrumPlot'
import ImpulseWaveform from '../components/ImpulseWaveform'
import { saveMeasurement } from '../storage/measurements'
import { useNavigate } from 'react-router-dom'
import type { AnalysisResult, BandResult } from '../dsp/analyze'

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
          triggerSampleIndex: segments.triggerSampleIndex,
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

  /** Save the current measurement and immediately re-arm for another at
   *  the same position. The metadata (site/room/position/notes/source)
   *  stays in the form ready for the next take. */
  async function saveAndRepeat() {
    if (!unsaved) return
    setSaving(true)
    try {
      await saveMeasurement(unsaved.metadata, unsaved.analysis)
      setUnsaved(null)
      setPhase('idle')
      // Stay on this view — metadata is already preserved by the draft
      // context, so the user just taps Start measurement again.
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError('Save failed: ' + msg)
    } finally {
      setSaving(false)
    }
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
        {/* Three-way clipping message, severity-aware. Brief peak
            clipping is empirically T30-safe (May 2026 NVC validation),
            so it gets an advisory amber tone rather than the previous
            measurement-killing red. Sustained clipping keeps the red. */}
        {analysis.clipping?.severity === 'peak' && (
          <div className="alert alert-warn">
            Peak SPL exceeded the device microphone's linear range for
            ~{Math.round(analysis.clipping.postTriggerMaxRunMs)} ms at the impulse.
            T30 / T20 values are reliable; EDT may be slightly elevated.
            Reduce source level or move further away if you need EDT precision.
          </div>
        )}
        {analysis.clipping?.severity === 'sustained' && (
          <div className="alert alert-error">
            Sustained clipping ({Math.round(analysis.clipping.postTriggerMaxRunMs)} ms post-impulse)
            extends into the T30 fit window — RT values are likely unreliable.
            Reduce source level or move further away and retake.
          </div>
        )}
        {/* Backwards-compat: old saved measurements set the legacy
            `clipped` boolean without the new clipping summary. */}
        {analysis.clipped && !analysis.clipping && (
          <div className="alert alert-error">
            Recording clipped — impulse may be invalid. Reduce source level or move further away.
          </div>
        )}
        <h3 className="results-section-title">RT spectrum</h3>
        <RTSpectrumPlot
          bandCentres={analysis.bands.map((b) => b.band.centre)}
          series={singleMeasurementSeries(analysis)}
          maxRtSec={settings.rtPlotMaxSec}
        />
        {analysis.rawImpulse && (
          <>
            <h3 className="results-section-title">Recorded waveform</h3>
            <p className="muted">
              Raw recording, with the trigger point marked. Look for AGC
              "pumping" (level dropping then recovering during the decay)
              or any flat-top "clipping" near the impulse.
            </p>
            <ImpulseWaveform
              samples={analysis.rawImpulse}
              sampleRate={analysis.sampleRate}
              triggerSampleIndex={analysis.triggerSampleIndex}
            />
          </>
        )}
        <DecaySection result={analysis} />
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
            className="primary-btn secondary-btn"
            onClick={saveAndRepeat}
            disabled={saving}
          >
            Save + repeat
          </button>
          <button
            className="primary-btn"
            onClick={saveToHistory}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
        <p className="muted">
          Save stores the measurement on this device. Save + repeat keeps
          the same metadata so you can quickly take multiple impulses at
          one position. Export from the History tab.
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
            Reminder: the device's audio pipeline may not fully honour
            the requested capture settings (auto-gain, noise suppression).
            Validate against your Type 1 meter, and hold the device still
            during the impulse and decay.
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

/**
 * Build the spectrum-plot series for a single measurement. We split the
 * reported RT into separate T30 and T20 series so each can take its own
 * colour matching the button/pill scheme (T30 dark green, T20 light
 * green). EDT goes on its own dashed line in orange. Bands not falling
 * into the relevant metric are NaN so the line breaks cleanly.
 *
 * "Dubious" bands are flagged on the plot via the uncertain mask —
 * the line breaks at them and red ring markers are drawn over their
 * values. A band counts as dubious if either:
 *   - phone mic response is unreliable in its frequency range
 *     (50-100 Hz or 6.3-10 kHz), OR
 *   - it has a critical analysis flag (clipped, non-linear). These
 *     bands have a fitted T30 number but the regression failed the
 *     R² threshold, so the value is technically reportable but visually
 *     untrustworthy on a spectrum plot.
 */
export function singleMeasurementSeries(result: AnalysisResult): SpectrumSeries[] {
  const t30Values = result.bands.map((b) =>
    b.reportedMetric === 'T30' ? b.reportedRtSeconds : NaN,
  )
  const t20Values = result.bands.map((b) =>
    b.reportedMetric === 'T20' ? b.reportedRtSeconds : NaN,
  )
  const edtValues = result.bands.map((b) => b.edtSeconds)
  const uncertain = result.bands.map(isBandDubious)
  return [
    // Colours match the metric pills/buttons. Greens are slightly
    // desaturated so they harmonise with NVC teal elsewhere on the plot;
    // EDT shifts to amber (away from any red so it doesn't fight the
    // dubious-marker rings).
    { label: 'T30', values: t30Values, uncertain, style: 'solid', color: '#22a160' },
    { label: 'T20', values: t20Values, uncertain, style: 'solid', color: '#6dcb7e' },
    { label: 'EDT', values: edtValues, uncertain, style: 'dashed', color: '#d4881e' },
  ]
}

/** True if a band's value should be flagged as dubious on the spectrum plot. */
export function isBandDubious(b: BandResult): boolean {
  if (b.band.uncertain) return true
  for (const f of b.flags) if (CRITICAL_FLAGS.includes(f)) return true
  return false
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
      // Sentinel value picked up by the render to swap in a vector mark
      // instead of a glyph (kept emoji-free per HIG/NVC guidance).
      big = '__trigger_mark__'
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
      {big === '__trigger_mark__' ? (
        <div className="status-trigger-mark" aria-hidden="true" />
      ) : big ? (
        <div className="status-big">{big}</div>
      ) : null}
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
