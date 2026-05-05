import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

// RT-versus-frequency line plot — the standard "reverberation spectrum"
// view used in acoustic reports.
//
// Implementation note: uPlot's log-distributed x-scale was generating
// auto-tick splits at decade marks (1, 10, 100, 1000…) that fought our
// preferred third-octave centre splits, producing garbled "null"-style
// labels. We instead use a LINEAR x scale with band INDEX (0..23) as
// the x value. Third-octave bands are equally spaced in log-frequency,
// so equal-spaced indices look identical to a clean log-scale plot —
// without uPlot's tick collision. We label only the octave centres
// (63, 125, 250, 500, 1k, 2k, 4k, 8k) so labels never overlap.
//
// Used in two modes:
//   - Single measurement: two series — RT (T30/T20, solid blue) and EDT
//     (always computed, dashed yellow). For each, an extra "uncertain"
//     overlay series places red markers over the dubious-accuracy bands
//     (50–100 Hz, 6.3–10 kHz) to flag phone-mic-response uncertainty.
//   - Comparison: one series per measurement in distinct colours.
//
// The y-axis auto-scales for low-RT measurements but never exceeds
// `maxRtSec` (a Settings value, default 3 s) so a single wild low-band
// value can't squash the rest of the spectrum into the bottom.

export interface SpectrumSeries {
  label: string
  /** RT values aligned to the band order. NaN where missing. */
  values: number[]
  /** Optional mask of "uncertain" bands (mic response unreliable). When
   *  provided, the corresponding values are highlighted with red dot
   *  overlays so they're visible but flagged. */
  uncertain?: boolean[]
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
  /** Y-axis ceiling in seconds; the auto-scaled max is capped at this. */
  maxRtSec?: number
}

const PALETTE = [
  '#5fa8ff',
  '#ff7e6b',
  '#5fd97c',
  '#f5d36a',
  '#c879f5',
  '#79e0e0',
  '#ffa05c',
  '#a896e0',
]

const UNCERTAIN_COLOR = '#ff5555'

export default function RTSpectrumPlot({
  bandCentres,
  series,
  height = 280,
  maxRtSec = 3,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // X is band index, not frequency, so labels never collide with
    // uPlot's log-axis auto-ticks.
    const xs = new Float64Array(bandCentres.map((_, i) => i))

    // Pick the indices of the octave centres for axis labels. The 24
    // preferred third-octave centres run 50…10 k; octaves anchor at
    // band indices 1, 4, 7, 10, 13, 16, 19, 22 (which are 63, 125, 250,
    // 500, 1k, 2k, 4k, 8k). Filter to indices that actually exist in
    // the band list passed in (in case a subset was selected).
    const OCTAVE_INDICES = [1, 4, 7, 10, 13, 16, 19, 22].filter(
      (i) => i < bandCentres.length,
    )

    // Build uPlot data and series. For each input series we emit one
    // line series (NaN at uncertain bands so the line breaks cleanly)
    // plus an optional uncertain-overlay series (NaN elsewhere, only
    // values at uncertain bands, drawn as red dots with no line).
    const ySeriesArrays: Float64Array[] = []
    const uplotSeries: uPlot.Series[] = [{}]

    series.forEach((s, i) => {
      const colour = s.color ?? PALETTE[i % PALETTE.length]

      // Main line: NaN at uncertain bands.
      const mainArr = new Float64Array(bandCentres.length)
      for (let k = 0; k < bandCentres.length; k++) {
        const v = s.values[k]
        if (s.uncertain && s.uncertain[k]) {
          mainArr[k] = NaN
        } else {
          mainArr[k] = Number.isFinite(v) ? v : NaN
        }
      }
      ySeriesArrays.push(mainArr)
      uplotSeries.push({
        label: s.label,
        stroke: colour,
        width: 2,
        dash: s.style === 'dashed' ? [6, 4] : undefined,
        points: { show: true, size: 6, fill: colour, stroke: colour },
      })

      // Uncertain overlay: only where uncertain.
      if (s.uncertain && s.uncertain.some((u) => u)) {
        const uncArr = new Float64Array(bandCentres.length)
        for (let k = 0; k < bandCentres.length; k++) {
          const v = s.values[k]
          uncArr[k] = s.uncertain[k] && Number.isFinite(v) ? v : NaN
        }
        ySeriesArrays.push(uncArr)
        uplotSeries.push({
          label: `${s.label} (uncertain)`,
          stroke: 'transparent',
          width: 0,
          // Bigger, hollow markers in red over the uncertain bands.
          points: {
            show: true,
            size: 9,
            stroke: UNCERTAIN_COLOR,
            fill: 'transparent',
            width: 2,
          },
        })
      }
    })

    const data = [xs, ...ySeriesArrays] as unknown as uPlot.AlignedData

    // Y-axis range: auto-fit data, but never exceed maxRtSec ceiling.
    let dataMax = 0
    for (const arr of ySeriesArrays) {
      for (const v of arr) {
        if (Number.isFinite(v) && v > dataMax) dataMax = v
      }
    }
    const autoMax = dataMax > 0 ? Math.ceil(dataMax * 1.15 * 10) / 10 : 1
    const yMax = Math.min(autoMax, maxRtSec)

    const opts: uPlot.Options = {
      width: containerRef.current.clientWidth || 320,
      height,
      cursor: { drag: { x: false, y: false } },
      legend: { show: true },
      scales: {
        x: { time: false, range: [-0.5, bandCentres.length - 0.5] },
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
          // Fixed tick positions at the octave centre indices.
          splits: () => OCTAVE_INDICES,
          values: (_u, splits) =>
            splits.map((idx) => {
              const i = Math.round(idx)
              if (i < 0 || i >= bandCentres.length) return ''
              return formatHz(bandCentres[i])
            }),
        },
        {
          stroke: '#9aa1ad',
          grid: { stroke: '#2a2e38', width: 1 },
          ticks: { stroke: '#2a2e38' },
          label: 'RT (s)',
          labelSize: 22,
          size: 50,
          font: '11px -apple-system, sans-serif',
          // Allow uPlot to pick a sensible tick increment within range.
          space: 30,
        },
      ],
      series: uplotSeries,
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
  }, [bandCentres, series, height, maxRtSec])

  return <div ref={containerRef} className="rt-spectrum-plot" />
}

function formatHz(hz: number): string {
  if (hz >= 1000) return `${hz / 1000}k`
  return `${hz}`
}
