import { CRITICAL_FLAGS, type AnalysisResult, type BandResult } from '../dsp/analyze'

// Per-band results table.
// Columns: Band Hz | RT (s) | metric | EDT (s) | INR (dB) | R^2 | Flags.
// Row colour:
//   - any critical flag (sustained-clipped, non-linear, t30-fit-in-clip,
//     or legacy 'clipped' from old saved measurements) -> RED override
//   - else by metric: T30 dark green, T20 light green, EDT-only orange,
//     invalid red
//   - bands with uncertain mic response (50–100 Hz, 6.3–10 kHz) get a
//     hashed background overlay
// EDT cell:
//   - dimmed + italic when 'edt-affected' is set (brief peak clipping
//     inflates EDT but T30 stays trustworthy)

interface Props {
  result: AnalysisResult
}

export default function ResultsTable({ result }: Props) {
  return (
    <div className="results-wrap">
      <table className="results-table">
        <thead>
          <tr>
            <th>Band</th>
            <th>RT (s)</th>
            <th>Metric</th>
            <th>EDT (s)</th>
            <th>INR (dB)</th>
            <th>R²</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {result.bands.map((b) => (
            <ResultRow key={b.band.centre} b={b} />
          ))}
        </tbody>
      </table>
      <div className="results-legend">
        <span className="legend-swatch metric-T30" /> T30
        <span className="legend-swatch metric-T20" /> T20
        <span className="legend-swatch metric-EDT-only" /> EDT-only
        <span className="legend-swatch metric-invalid" /> invalid
        <span className="legend-swatch metric-critical" /> critical issue
        <span className="legend-swatch uncertain" /> uncertain (mic response)
      </div>
    </div>
  )
}

function ResultRow({ b }: { b: BandResult }) {
  const hasCriticalFlag = b.flags.some((f) => CRITICAL_FLAGS.includes(f))
  const baseClass = hasCriticalFlag ? 'metric-critical' : `metric-${b.reportedMetric}`
  const className = `${baseClass}${b.band.uncertain ? ' uncertain' : ''}`
  // EDT is dimmed when peak clipping has inflated it but T30 is still
  // trustworthy. The user still sees the number — just visually demoted
  // so they know not to lean on it.
  const edtAffected = b.flags.includes('edt-affected')
  return (
    <tr className={className}>
      <td>{formatHz(b.band.centre)}</td>
      <td>{formatRt(b.reportedRtSeconds)}</td>
      <td>{b.reportedMetric}</td>
      <td className={edtAffected ? 'edt-cell affected' : 'edt-cell'}>
        {formatRt(b.edtSeconds)}
        {edtAffected ? <span className="edt-affected-mark" title="EDT inflated by peak clipping">*</span> : null}
      </td>
      <td>{Number.isFinite(b.inrDb) ? b.inrDb.toFixed(1) : '—'}</td>
      <td>{Number.isFinite(b.reportedR2) ? b.reportedR2.toFixed(3) : '—'}</td>
      <td className="flags-cell">
        {b.flags.length === 0 ? '—' : b.flags.map((f) => <span key={f} className="flag-chip">{f}</span>)}
      </td>
    </tr>
  )
}

function formatHz(hz: number): string {
  return hz >= 1000 ? `${hz / 1000} k` : `${hz}`
}

function formatRt(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—'
  return seconds.toFixed(2)
}
