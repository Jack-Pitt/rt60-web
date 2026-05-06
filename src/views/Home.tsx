import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  deleteMeasurement,
  listMeasurements,
  type SavedMeasurement,
} from '../storage/measurements'
import { IMPULSE_SOURCE_LABELS } from '../measurement/types'
import ResultsTable from '../components/ResultsTable'
import DecaySection from '../components/DecaySection'
import RTSpectrumPlot, { type SpectrumSeries } from '../components/RTSpectrumPlot'
import ImpulseWaveform from '../components/ImpulseWaveform'
import { singleMeasurementSeries, isBandDubious } from './Measurement'
import { useSettings } from '../settings/SettingsContext'
import {
  buildCsv,
  buildCsvBundle,
  buildJson,
  buildJsonBundle,
  buildFilename,
  buildBundleFilename,
  saveTextAsFile,
} from '../storage/export'

// History view — list of saved measurements, with two interaction modes:
//   - Default: tap a row to open its full results screen.
//   - Select: tap "Select" at the top, rows show checkboxes; pick one or
//     many. The action bar exposes both "Plot" (overlay-compare via
//     RT spectrum plot, ≥2 required) and "Export" (one-or-many CSV
//     download/share).
//
// Per-measurement detail view (when openId is set) shows the RT spectrum
// plot, decay curves, and the full table.

export default function Home() {
  const { settings } = useSettings()
  const [items, setItems] = useState<SavedMeasurement[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Compare-mode state. selectedIds is the set of measurements ticked.
  // showingComparison true means we've moved into the comparison plot view.
  const [compareMode, setCompareMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showingComparison, setShowingComparison] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const list = await listMeasurements()
      setItems(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this measurement permanently?')) return
    try {
      await deleteMeasurement(id)
      if (openId === id) setOpenId(null)
      // Drop from compare selection if it was ticked.
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exitCompareMode() {
    setCompareMode(false)
    setSelectedIds(new Set())
    setShowingComparison(false)
  }

  // ---- comparison view ---------------------------------------------------

  if (showingComparison && items) {
    const compared = items.filter((m) => selectedIds.has(m.id))
    return (
      <ComparisonView
        items={compared}
        onBack={() => setShowingComparison(false)}
        maxRtSec={settings.rtPlotMaxSec}
      />
    )
  }

  // ---- expanded view of a single saved measurement ----------------------

  if (openId && items) {
    const item = items.find((m) => m.id === openId)
    if (item) {
      const meta = item.metadata
      return (
        <div className="view view-home">
          <div className="capture-controls">
            <button className="primary-btn primary-btn-stop" onClick={() => setOpenId(null)}>
              ← Back to history
            </button>
          </div>
          <h2>{meta.site} / {meta.room} / pos {meta.position}</h2>
          <p className="view-stub">
            {new Date(item.timestamp).toLocaleString()} · {IMPULSE_SOURCE_LABELS[meta.impulseSource]}
            {meta.notes ? ` · "${meta.notes}"` : ''}
          </p>
          {item.result.clipped && (
            <div className="alert alert-error">
              Recording clipped — see flagged bands.
            </div>
          )}
          <h3 className="results-section-title">RT spectrum</h3>
          <RTSpectrumPlot
            bandCentres={item.result.bands.map((b) => b.band.centre)}
            series={singleMeasurementSeries(item.result)}
            maxRtSec={settings.rtPlotMaxSec}
          />
          {item.result.rawImpulse && (
            <>
              <h3 className="results-section-title">Recorded waveform</h3>
              <ImpulseWaveform
                samples={item.result.rawImpulse}
                sampleRate={item.result.sampleRate}
                triggerSampleIndex={item.result.triggerSampleIndex}
              />
            </>
          )}
          <DecaySection result={item.result} />
          <ResultsTable result={item.result} />
          <div className="capture-controls">
            <button className="primary-btn primary-btn-stop" onClick={() => handleDelete(item.id)}>
              Delete this measurement
            </button>
          </div>
          <p className="muted">
            To export this measurement (or several at once), use the
            <strong> Select</strong> button on the History list.
          </p>
        </div>
      )
    }
  }

  async function exportSelected(kind: 'csv' | 'json') {
    if (!items || selectedIds.size === 0) return
    const selected = items.filter((m) => selectedIds.has(m.id))
    try {
      let content: string
      let filename: string
      const mime = kind === 'csv' ? 'text/csv' : 'application/json'
      if (selected.length === 1) {
        const it = selected[0]
        content =
          kind === 'csv'
            ? buildCsv(it.metadata, it.result, it.timestamp)
            : buildJson(it.metadata, it.result, it.timestamp)
        filename = buildFilename(it.metadata, it.timestamp, kind)
      } else {
        content =
          kind === 'csv' ? buildCsvBundle(selected) : buildJsonBundle(selected)
        filename = buildBundleFilename(selected.length, Date.now(), kind)
      }
      await saveTextAsFile(content, filename, mime)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError('Export failed: ' + msg)
    }
  }

  // ---- list view --------------------------------------------------------

  return (
    <div className="view view-home">
      <div className="capture-controls capture-controls-row">
        <Link to="/measure" className="primary-btn">+ New measurement</Link>
        {items && items.length >= 1 && !compareMode && (
          <button className="primary-btn secondary-btn" onClick={() => setCompareMode(true)}>
            Select
          </button>
        )}
      </div>

      {compareMode && (
        <div className="compare-bar">
          <span>{selectedIds.size} selected</span>
          <div className="compare-bar-actions">
            <button className="text-btn" onClick={exitCompareMode}>Cancel</button>
            <button
              className="primary-btn secondary-btn"
              disabled={selectedIds.size < 2}
              onClick={() => setShowingComparison(true)}
            >
              Plot
            </button>
            <button
              className="primary-btn"
              disabled={selectedIds.size < 1}
              onClick={() => exportSelected('csv')}
            >
              Export {settings.enableJsonExport ? 'CSV' : ''}
            </button>
            {settings.enableJsonExport && (
              <button
                className="primary-btn secondary-btn"
                disabled={selectedIds.size < 1}
                onClick={() => exportSelected('json')}
              >
                Export JSON
              </button>
            )}
          </div>
        </div>
      )}

      <h2>History</h2>

      {error && (
        <div className="alert alert-error">{error}</div>
      )}

      {items === null && <p className="muted">Loading...</p>}

      {items !== null && items.length === 0 && (
        <p className="view-stub">
          No measurements saved yet. Tap <strong>New measurement</strong> to take one.
        </p>
      )}

      {items !== null && items.length > 0 && (
        <ul className="history-list">
          {items.map((m) => (
            <HistoryRow
              key={m.id}
              item={m}
              compareMode={compareMode}
              selected={selectedIds.has(m.id)}
              onOpen={() => compareMode ? toggleSelected(m.id) : setOpenId(m.id)}
              onDelete={() => handleDelete(m.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

// ---- comparison view component ----------------------------------------

interface ComparisonProps {
  items: SavedMeasurement[]
  onBack: () => void
  maxRtSec: number
}

// Palette deliberately excludes reds and oranges — those would clash
// with the dubious-marker red used to flag uncertain bands on the same
// plot. First four entries are the most distinguishable (typical use:
// 2-4 measurements compared at a time).
const COMPARE_PALETTE = [
  '#5fa8ff', // blue
  '#4ade80', // green
  '#facc15', // yellow
  '#c084fc', // purple
  '#22d3ee', // cyan
  '#f472b6', // pink (magenta-leaning, away from red)
  '#a3e635', // lime
  '#94a3b8', // slate grey
]

function ComparisonView({ items, onBack, maxRtSec }: ComparisonProps) {
  // We assume all selected measurements were taken with the same band set.
  // If they differ, fall back to the first item's bands (rare since the
  // app uses fixed third-octave bands).
  const bandCentres = useMemo(
    () => (items[0]?.result.bands.map((b) => b.band.centre) ?? []),
    [items],
  )

  // Each measurement gets its own dubious mask: a band might be valid
  // in one measurement and non-linear in another, so we don't share the
  // mask across series.
  const series: SpectrumSeries[] = items.map((item, i) => {
    const ref = items[0]
    return {
      label: `${item.metadata.room || item.metadata.site} / ${item.metadata.position}`,
      values: ref
        ? ref.result.bands.map((b, idx) => {
            const matching = item.result.bands[idx]
            return matching && matching.band.centre === b.band.centre
              ? matching.reportedRtSeconds
              : NaN
          })
        : [],
      uncertain: ref
        ? ref.result.bands.map((b, idx) => {
            const matching = item.result.bands[idx]
            return matching && matching.band.centre === b.band.centre
              ? isBandDubious(matching)
              : true
          })
        : [],
      style: 'solid',
      color: COMPARE_PALETTE[i % COMPARE_PALETTE.length],
    }
  })

  return (
    <div className="view view-home">
      <div className="capture-controls">
        <button className="primary-btn primary-btn-stop" onClick={onBack}>
          ← Back to history
        </button>
      </div>
      <h2>Comparison</h2>
      <p className="view-stub">
        {items.length} measurements overlaid. Lines show the reported RT
        (T30/T20) per third-octave band; gaps indicate bands with no
        reportable value (low INR or non-linear decay).
      </p>
      <RTSpectrumPlot
        bandCentres={bandCentres}
        series={series}
        height={320}
        maxRtSec={maxRtSec}
      />
      <ul className="compare-legend">
        {items.map((item, i) => (
          <li key={item.id}>
            <span
              className="compare-swatch"
              style={{ background: COMPARE_PALETTE[i % COMPARE_PALETTE.length] }}
            />
            <div>
              <div className="history-title">
                {item.metadata.site} / {item.metadata.room} / pos {item.metadata.position}
              </div>
              <div className="history-meta">
                {new Date(item.timestamp).toLocaleString()} · {IMPULSE_SOURCE_LABELS[item.metadata.impulseSource]}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---- history row ------------------------------------------------------

interface RowProps {
  item: SavedMeasurement
  compareMode: boolean
  selected: boolean
  onOpen: () => void
  onDelete: () => void
}

function HistoryRow({ item, compareMode, selected, onOpen, onDelete }: RowProps) {
  const meta = item.metadata
  return (
    <li className={`history-item ${selected ? 'selected' : ''}`}>
      <button className="history-open" onClick={onOpen}>
        {compareMode && (
          <span className={`history-checkbox ${selected ? 'on' : ''}`}>
            {selected ? '✓' : ''}
          </span>
        )}
        <div className="history-row-content">
          <div className="history-title">
            {meta.site} / {meta.room} / pos {meta.position}
            {item.result.clipped && (
              <span className="flag-chip flag-chip-inline">clipped</span>
            )}
          </div>
          <div className="history-meta">
            {new Date(item.timestamp).toLocaleString()} · {IMPULSE_SOURCE_LABELS[meta.impulseSource]}
          </div>
        </div>
      </button>
      {!compareMode && (
        <button className="history-delete" onClick={onDelete} aria-label="Delete">
          ✕
        </button>
      )}
    </li>
  )
}
