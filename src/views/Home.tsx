import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  deleteMeasurement,
  listMeasurements,
  type SavedMeasurement,
} from '../storage/measurements'
import { IMPULSE_SOURCE_LABELS } from '../measurement/types'
import ResultsTable from '../components/ResultsTable'
import DecaySection from '../components/DecaySection'

// History view — the brief calls this "Home" but its job is to show the
// list of past measurements. Users can re-open any saved measurement to
// view its results table, or delete entries they no longer want.
// CSV/JSON export buttons live here too once step 8 lands.
export default function Home() {
  const [items, setItems] = useState<SavedMeasurement[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    // Confirm because deletion is local-only and unrecoverable.
    if (!window.confirm('Delete this measurement permanently?')) return
    try {
      await deleteMeasurement(id)
      if (openId === id) setOpenId(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // ---- expanded view of a single saved measurement -----------------------

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
          <DecaySection result={item.result} />
          <ResultsTable result={item.result} />
          <div className="capture-controls">
            <button className="primary-btn primary-btn-stop" onClick={() => handleDelete(item.id)}>
              Delete this measurement
            </button>
          </div>
        </div>
      )
    }
  }

  // ---- list view ----------------------------------------------------------

  return (
    <div className="view view-home">
      <div className="capture-controls">
        <Link to="/measure" className="primary-btn">+ New measurement</Link>
      </div>

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
              onOpen={() => setOpenId(m.id)}
              onDelete={() => handleDelete(m.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

interface RowProps {
  item: SavedMeasurement
  onOpen: () => void
  onDelete: () => void
}

function HistoryRow({ item, onOpen, onDelete }: RowProps) {
  const meta = item.metadata
  // Quick summary: how many bands of each metric type.
  const bands = item.result.bands
  const counts = {
    T30: bands.filter((b) => b.reportedMetric === 'T30').length,
    T20: bands.filter((b) => b.reportedMetric === 'T20').length,
    EDT: bands.filter((b) => b.reportedMetric === 'EDT-only').length,
    invalid: bands.filter((b) => b.reportedMetric === 'invalid').length,
  }
  return (
    <li className="history-item">
      <button className="history-open" onClick={onOpen}>
        <div className="history-title">
          {meta.site} / {meta.room} / pos {meta.position}
        </div>
        <div className="history-meta">
          {new Date(item.timestamp).toLocaleString()} · {IMPULSE_SOURCE_LABELS[meta.impulseSource]}
        </div>
        <div className="history-summary">
          <span className="legend-swatch metric-T30" /> {counts.T30}
          <span className="legend-swatch metric-T20" /> {counts.T20}
          <span className="legend-swatch metric-EDT-only" /> {counts.EDT}
          <span className="legend-swatch metric-invalid" /> {counts.invalid}
          {item.result.clipped && <span className="flag-chip">clipped</span>}
        </div>
      </button>
      <button className="history-delete" onClick={onDelete} aria-label="Delete">
        ✕
      </button>
    </li>
  )
}
