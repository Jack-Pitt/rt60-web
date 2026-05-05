import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

// RT-versus-frequency line plot — the standard "reverberation spectrum"
// view used in acoustic reports. X axis is log-scale frequency in Hz
// with the third-octave preferred centres as ticks; y axis is RT in
// seconds (linear). Bands with no reportable value are NaN, which
// breaks the line cleanly at that point.
//
// Used in two modes:
//   - Single measurement: two series per measurement — reported RT
//     (T30/T20) solid, EDT dashed. Lets the user see the early-vs-late
//     decay relationship at a glance.
//   - Comparison: one series per measurement, each a different colour,
//     so the user can compare e.g. P1 vs P2 vs P3 in one room.

export interface SpectrumSeries {
  label: string
  /** RT values aligned to bandCentres. NaN where missing. */
  values: number[]
  /** Solid by default. Use 'dashed' for secondary lines (e.g. EDT). */
  style?: 'solid' | 'dashed'
  /** Optional explicit colour. Otherwise auto-assigned from palette. */
  color?: string
}

interface Props {
  bandCentres: number[]
  series: SpectrumSeries[]
  /** Display height. Defaults to 280 px. */
  height?: number
}

// Distinct colours that read clearly on the dark theme. Used when a
// series doesn't override its colour.
const PALETTE = [
  '#5fa8ff', // blue
  '#ff7e6b', // coral red
  '#5fd97c', // green
  '#f5d36a', // yellow
  '#c879f5', // purple
  '#79e0e0', // cyan
  '#ffa05c', // orange
  '#a896e0', // lavender
]

export default function RTSpectrumPlot({ bandCentres, series, height = 280 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // uPlot wants AlignedData = [xs, y1, y2, ...]
    const xs = new Float64Array(bandCentres)
    const ys = series.map((s) => Float64Array.from(s.values))
    const data = [xs, ...ys] as unknown as uPlot.AlignedData

    // Compute a sensible y-axis upper bound from the data so the lines
    // fill the plot without too much empty space at the top.
    let maxRt = 0
    for (const s of series) {
      for (const v of s.values) {
        if (Number.isFinite(v) && v > maxRt) maxRt = v
      }
    }
    const yMax = maxRt > 0 ? Math.ceil(maxRt * 1.15 * 10) / 10 : 1.0

    const opts: uPlot.Options = {
      width: containerRef.current.clientWidth || 320,
      height,
      cursor: { drag: { x: false, y: false } },
      legend: { show: true },
      scales: {
        // Logarithmic x so equal-octave spacing is visually equal.
        x: { distr: 3, log: 10, range: [40, 12000] },
        y: { auto: false, range: [0, yMax] },
      },
      axes: [
        {
          stroke: '#9aa1ad',
          grid: { stroke: '#2a2e38', width: 1 },
          ticks: { stroke: '#2a2e38' },
          label: 'Frequency (Hz)',
          labelSize: 26,
          size: 36,
          font: '11px -apple-system, sans-serif',
          // Force ticks at the preferred third-octave centres only.
          splits: () => bandCentres,
          values: (_u, splits) => splits.map(formatHz),
        },
        {
          stroke: '#9aa1ad',
          grid: { stroke: '#2a2e38', width: 1 },
          ticks: { stroke: '#2a2e38' },
          label: 'RT (s)',
          labelSize: 22,
          size: 50,
          font: '11px -apple-system, sans-serif',
        },
      ],
      series: [
        {},
        ...series.map((s, i) => ({
          label: s.label,
          stroke: s.color ?? PALETTE[i % PALETTE.length],
          width: 2,
          dash: s.style === 'dashed' ? [6, 4] : undefined,
          points: { show: true, size: 6 },
        })),
      ],
    }

    const plot = new uPlot(opts, data, containerRef.current)

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        plot.setSize({ width: containerRef.current.clientWidth, height })
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      plot.destroy()
    }
  }, [bandCentres, series, height])

  return <div ref={containerRef} className="rt-spectrum-plot" />
}

function formatHz(hz: number): string {
  if (hz >= 1000) {
    const k = hz / 1000
    return Number.isInteger(k) ? `${k}k` : `${k}k`
  }
  return `${hz}`
}
