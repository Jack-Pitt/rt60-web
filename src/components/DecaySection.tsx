import { useState } from 'react'
import { CRITICAL_FLAGS, type AnalysisResult, type BandResult, type DecayPipelineResult, type ReportedMetric } from '../dsp/analyze'
import DecayPlot from './DecayPlot'

// Decay-curve section embedded above the results table.
//
// Default view: the mid-band-filtered ("MFRT") Schroeder decay curve,
// which is the conventional single-number summary of a room's RT
// (ISO 3382 T_mid convention). Below the
// plot, a row of buttons lets the user switch to any individual band's
// curve. Each band button is coloured according to its reported metric
// (T30/T20/EDT-only/invalid) — at a glance the user sees which bands
// the algorithm thinks are good, which need checking, and which have
// critical flags (clipped or non-linear) that override to bright red.

interface Props {
  result: AnalysisResult
}

// Discriminator for the currently-selected curve.
type Selection = { kind: 'overall' } | { kind: 'band'; centre: number }

export default function DecaySection({ result }: Props) {
  const [selection, setSelection] = useState<Selection>({ kind: 'overall' })

  // Resolve the selected curve back into the data we feed to DecayPlot.
  const view = resolveSelection(selection, result)

  return (
    <div className="decay-section">
      <h3 className="decay-section-title">Decay curves</h3>

      <DecayHeader view={view} />
      <DecayPlot
        edcDb={view.edcDb}
        sampleRate={view.sampleRate}
        regression={view.regression}
        dbRange={view.dbRange}
        noisePlateauDb={view.noisePlateauDb}
      />

      {/* Selector buttons: MFRT first, then every band. Coloured by
          reported metric so the user can scan at a glance for which bands
          are reliable (green) vs which need checking (orange / red). */}
      <div className="decay-buttons">
        <button
          className={`decay-button decay-button-overall ${
            selection.kind === 'overall' ? 'on' : ''
          }`}
          onClick={() => setSelection({ kind: 'overall' })}
        >
          MFRT
        </button>
        {result.bands.map((b) => (
          <DecayButton
            key={b.band.centre}
            band={b}
            selected={selection.kind === 'band' && selection.centre === b.band.centre}
            onSelect={() => setSelection({ kind: 'band', centre: b.band.centre })}
          />
        ))}
      </div>

      <DecayLegend />
    </div>
  )
}

// ---- selection plumbing ------------------------------------------------

interface ResolvedView {
  title: string
  subtitle: string
  metric: ReportedMetric | null
  pipeline: DecayPipelineResult
  edcDb: Float32Array
  sampleRate: number
  regression: { slope: number; intercept: number; sampleStart: number; sampleEnd: number } | null
  dbRange: [number, number] | null
  noisePlateauDb: number
}

function resolveSelection(sel: Selection, result: AnalysisResult): ResolvedView {
  if (sel.kind === 'band') {
    const b = result.bands.find((x) => x.band.centre === sel.centre)
    if (b) return viewFromBand(b)
  }
  return viewFromOverall(result.overall)
}

function viewFromOverall(o: AnalysisResult['overall']): ResolvedView {
  return {
    title: 'MFRT (mid-frequency, 354–1414 Hz)',
    subtitle:
      'Bandpass-filtered to the 500 Hz + 1 kHz octave union — ISO 3382 T_mid range. Single-number RT for the room.',
    metric: o.reportedMetric,
    pipeline: o,
    edcDb: o.edcDb,
    sampleRate: o.sampleRate,
    regression: o.reportedRegression
      ? {
          slope: o.reportedRegression.slope,
          intercept: o.reportedRegression.intercept,
          sampleStart: o.reportedRange[0],
          sampleEnd: o.reportedRange[1],
        }
      : null,
    dbRange: o.reportedMetric === 'invalid' ? null : o.reportedDbRange,
    noisePlateauDb: o.noisePlateauDb,
  }
}

function viewFromBand(b: BandResult): ResolvedView {
  return {
    title: `${formatHz(b.band.centre)} Hz`,
    subtitle: b.band.uncertain
      ? 'Uncertain — phone microphone response is unreliable in this range.'
      : '',
    metric: b.reportedMetric,
    pipeline: b,
    edcDb: b.edcDb,
    sampleRate: b.sampleRate,
    regression: b.reportedRegression
      ? {
          slope: b.reportedRegression.slope,
          intercept: b.reportedRegression.intercept,
          sampleStart: b.reportedRange[0],
          sampleEnd: b.reportedRange[1],
        }
      : null,
    dbRange: b.reportedMetric === 'invalid' ? null : b.reportedDbRange,
    noisePlateauDb: b.noisePlateauDb,
  }
}

// ---- subcomponents ------------------------------------------------------

function DecayHeader({ view }: { view: ResolvedView }) {
  const p = view.pipeline
  return (
    <div className="decay-header">
      <div className="decay-header-band">{view.title}</div>
      {view.subtitle && <div className="decay-header-sub">{view.subtitle}</div>}
      <div className="decay-header-stats">
        {view.metric && (
          <span className={`metric-pill metric-${view.metric}`}>{view.metric}</span>
        )}
        {Number.isFinite(p.reportedRtSeconds) && (
          <span>RT {p.reportedRtSeconds.toFixed(2)} s</span>
        )}
        <span>EDT {Number.isFinite(p.edtSeconds) ? p.edtSeconds.toFixed(2) + ' s' : '—'}</span>
        <span>INR {Number.isFinite(p.inrDb) ? p.inrDb.toFixed(1) + ' dB' : '—'}</span>
        {Number.isFinite(p.reportedR2) && <span>R² {p.reportedR2.toFixed(3)}</span>}
      </div>
    </div>
  )
}

function DecayButton({
  band,
  selected,
  onSelect,
}: {
  band: BandResult
  selected: boolean
  onSelect: () => void
}) {
  const hasCritical = band.flags.some((f) => CRITICAL_FLAGS.includes(f))
  const colourClass = hasCritical ? 'metric-critical' : `metric-${band.reportedMetric}`
  return (
    <button
      type="button"
      className={`decay-button ${colourClass} ${selected ? 'on' : ''} ${
        band.band.uncertain ? 'uncertain' : ''
      }`}
      onClick={onSelect}
    >
      {formatHz(band.band.centre)}
    </button>
  )
}

function DecayLegend() {
  return (
    <div className="decay-legend">
      <span className="legend-swatch decay-button-overall" /> MFRT
      <span className="legend-swatch metric-T30" /> T30
      <span className="legend-swatch metric-T20" /> T20
      <span className="legend-swatch metric-EDT-only" /> EDT-only
      <span className="legend-swatch metric-invalid" /> invalid
      <span className="legend-swatch metric-critical" /> critical (check)
      <span className="legend-swatch uncertain" /> uncertain (mic)
    </div>
  )
}

function formatHz(hz: number): string {
  return hz >= 1000 ? `${hz / 1000} k` : `${hz}`
}
