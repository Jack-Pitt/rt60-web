import { useMemo, useState } from 'react'
import type { AnalysisResult, BandResult } from '../dsp/analyze'
import DecayPlot from './DecayPlot'

// Combined decay-curve section, used on both the live results screen and
// the saved-measurement view. Renders:
//   1. A row of band-centre chips for selecting which band to view full size.
//   2. A full-size DecayPlot for the selected band, with a header showing
//      band centre, reported metric, RT, INR, R^2 — all the band's headline
//      facts at a glance alongside the curve.
//   3. A grid of small-multiples thumbnails for ALL bands, tappable to
//      promote a band into the full-size view above.
//
// Layout intent: the brief flags "Always show decay curves for every
// measurement, prominently, not buried below the table." So this section
// is rendered ABOVE the per-band table on the results screen.

interface Props {
  result: AnalysisResult
}

const DEFAULT_BAND_CENTRES = [500, 1000, 2000]

export default function DecaySection({ result }: Props) {
  // Pick a sensible default band: 1 kHz if present, otherwise 500 Hz, then
  // 2 kHz, otherwise the first band in the result.
  const defaultBand = useMemo(() => {
    for (const c of DEFAULT_BAND_CENTRES) {
      const hit = result.bands.find((b) => b.band.centre === c)
      if (hit) return hit
    }
    return result.bands[0]
  }, [result])

  const [selectedCentre, setSelectedCentre] = useState<number>(defaultBand?.band.centre ?? 1000)

  const selectedBand =
    result.bands.find((b) => b.band.centre === selectedCentre) ?? defaultBand

  if (!selectedBand) return null

  return (
    <div className="decay-section">
      <h3 className="decay-section-title">Decay curves</h3>

      {/* Band selector chips */}
      <div className="band-selector">
        {result.bands.map((b) => (
          <button
            key={b.band.centre}
            className={`band-selector-chip ${
              b.band.centre === selectedBand.band.centre ? 'on' : ''
            } ${b.band.uncertain ? 'uncertain' : ''}`}
            onClick={() => setSelectedCentre(b.band.centre)}
          >
            {formatHz(b.band.centre)}
          </button>
        ))}
      </div>

      {/* Full-size plot for the selected band */}
      <DecayHeader band={selectedBand} />
      <DecayPlot band={selectedBand} variant="full" />

      {/* Small multiples — all bands at thumbnail size */}
      <h4 className="decay-section-subtitle">All bands</h4>
      <div className="decay-grid">
        {result.bands.map((b) => (
          <div
            key={b.band.centre}
            className={`decay-grid-item${b.band.uncertain ? ' uncertain' : ''}${
              b.band.centre === selectedBand.band.centre ? ' selected' : ''
            }`}
          >
            <div className="decay-grid-label">
              {formatHz(b.band.centre)}
              <span className={`decay-grid-metric metric-${b.reportedMetric}`}>
                {b.reportedMetric}
              </span>
            </div>
            <DecayPlot
              band={b}
              variant="thumb"
              onClick={() => setSelectedCentre(b.band.centre)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

// --- helper bits ---------------------------------------------------------

function DecayHeader({ band }: { band: BandResult }) {
  return (
    <div className="decay-header">
      <div className="decay-header-band">{formatHz(band.band.centre)} Hz</div>
      <div className="decay-header-stats">
        <span className={`metric-pill metric-${band.reportedMetric}`}>
          {band.reportedMetric}
        </span>
        {Number.isFinite(band.reportedRtSeconds) && (
          <span>RT {band.reportedRtSeconds.toFixed(2)} s</span>
        )}
        <span>EDT {Number.isFinite(band.edtSeconds) ? band.edtSeconds.toFixed(2) + ' s' : '—'}</span>
        <span>INR {Number.isFinite(band.inrDb) ? band.inrDb.toFixed(1) + ' dB' : '—'}</span>
        {Number.isFinite(band.reportedR2) && (
          <span>R² {band.reportedR2.toFixed(3)}</span>
        )}
      </div>
    </div>
  )
}

function formatHz(hz: number): string {
  return hz >= 1000 ? `${hz / 1000} k` : `${hz}`
}
