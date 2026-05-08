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
  /** Display height. If unset, picks a viewport-aware default
   *  (280 px on phone, 380 px on tablet+). Pass an explicit number
   *  only when you specifically want to override the responsive default. */
  height?: number
  /** Y-axis ceiling in seconds; the auto-scaled max is capped at this. */
  maxRtSec?: number
  /** When true, dubious points are flagged with red overlay markers.
   *  Set false in comparison mode to keep the plot uncluttered when
   *  multiple measurements are stacked. Default true. */
  showDubiousOverlay?: boolean
  /** Override the line stroke width. Useful for comparison mode where
   *  thicker lines help distinguish overlapping curves. Default 2. */
  strokeWidth?: number
  /** Optional shaded band representing an "ideal" RT range — e.g. the
   *  AS/NZS 2107 design target for a chosen room use + volume. Drawn
   *  beneath the lines as a pale teal-green tint. */
  idealRange?: { lower: number; upper: number }
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

/** Default plot height — responsive to window width so the plot is
 *  taller on iPad / desktop and stays compact on iPhone. */
function defaultHeight(): number {
  if (typeof window === 'undefined') return 280
  return window.innerWidth >= 768 ? 380 : 280
}

export default function RTSpectrumPlot({
  bandCentres,
  series,
  height,
  maxRtSec = 3,
  showDubiousOverlay = true,
  strokeWidth = 2,
  idealRange,
}: Props) {
  const effectiveHeight = height ?? defaultHeight()
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

    // Pre-compute label uniqueness so duplicate labels (multiple takes
    // at the same site/room/pos) don't collapse into one legend row.
    // uPlot tolerates duplicate labels but it makes the legend
    // ambiguous; we suffix duplicates with their position in the array.
    const labelCounts = new Map<string, number>()
    series.forEach((s) => labelCounts.set(s.label, (labelCounts.get(s.label) ?? 0) + 1))
    const labelSeen = new Map<string, number>()
    const uniqueLabels = series.map((s) => {
      if ((labelCounts.get(s.label) ?? 0) <= 1) return s.label
      const seen = (labelSeen.get(s.label) ?? 0) + 1
      labelSeen.set(s.label, seen)
      return `${s.label} #${seen}`
    })

    series.forEach((s, i) => {
      const colour = s.color ?? PALETTE[i % PALETTE.length]
      const label = uniqueLabels[i]

      // Main line: ALWAYS NaN at uncertain bands so dubious values are
      // omitted from the plot regardless of mode. The line breaks
      // cleanly at those gaps. The optional overlay below only adds the
      // hollow red marker rings on top — it doesn't change which values
      // appear on the main line.
      const mainArr = new Float64Array(bandCentres.length)
      for (let k = 0; k < bandCentres.length; k++) {
        const v = s.values[k]
        const isUncertain = !!(s.uncertain && s.uncertain[k])
        mainArr[k] = isUncertain || !Number.isFinite(v) ? NaN : v
      }
      ySeriesArrays.push(mainArr)
      uplotSeries.push({
        label,
        stroke: colour,
        width: strokeWidth,
        dash: s.style === 'dashed' ? [6, 4] : undefined,
        points: { show: true, size: 6, fill: colour, stroke: colour },
      })

      // Uncertain overlay (single-measurement views only by default).
      // Skipped in comparison mode to keep the plot uncluttered when
      // multiple measurements are stacked.
      if (showDubiousOverlay && s.uncertain && s.uncertain.some((u) => u)) {
        const uncArr = new Float64Array(bandCentres.length)
        for (let k = 0; k < bandCentres.length; k++) {
          const v = s.values[k]
          uncArr[k] = s.uncertain[k] && Number.isFinite(v) ? v : NaN
        }
        ySeriesArrays.push(uncArr)
        uplotSeries.push({
          label: `${label} (dubious)`,
          // Series stroke determines the legend swatch colour, even when
          // width=0 means no actual line is drawn on the plot. Red so the
          // legend matches the hollow red ring markers below.
          stroke: UNCERTAIN_COLOR,
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

    // ---- Ideal-range band overlay (e.g. AS/NZS 2107 design target) ----
    //
    // Drawn beneath the lines as a pale teal-green tint between two
    // invisible series for the upper and lower bound. uPlot's bands
    // feature fills between the two referenced series; we reference
    // them by their final indices in the uplotSeries array.
    let idealBandConfig: uPlot.Band[] | undefined
    if (idealRange && idealRange.lower < idealRange.upper) {
      const upperArr = new Float64Array(bandCentres.length).fill(idealRange.upper)
      const lowerArr = new Float64Array(bandCentres.length).fill(idealRange.lower)
      // Indices: existing series count + this push order.
      // ySeriesArrays grows by 2; uplotSeries also grows by 2.
      const upperIdx = uplotSeries.length // before push
      const lowerIdx = upperIdx + 1
      ySeriesArrays.push(upperArr)
      uplotSeries.push({
        // Invisible line — only used as the band's upper edge.
        label: 'Target upper',
        stroke: 'transparent',
        width: 0,
        points: { show: false },
        // Hide from legend, this is overlay infrastructure, not data.
        show: true,
      })
      ySeriesArrays.push(lowerArr)
      uplotSeries.push({
        label: 'Target lower',
        stroke: 'transparent',
        width: 0,
        points: { show: false },
        show: true,
      })
      idealBandConfig = [
        {
          series: [upperIdx, lowerIdx],
          // Pale teal-green — sits behind the data lines without
          // dominating. Same hue as the T30 metric tint, lower alpha.
          fill: 'rgba(34, 161, 96, 0.18)',
        },
      ]
    }

    const data = [xs, ...ySeriesArrays] as unknown as uPlot.AlignedData

    // Y-axis range: auto-fit data, but never exceed maxRtSec ceiling.
    // If an ideal-range band is shown, make sure its upper edge is
    // visible too — extend dataMax to include it.
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
      height: effectiveHeight,
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
      bands: idealBandConfig,
    }

    const plot = new uPlot(opts, data, containerRef.current)

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        // Recompute the responsive default each tick so resizing the
        // window across the 768 px breakpoint reflows the plot height.
        const liveHeight = height ?? defaultHeight()
        plot.setSize({ width: containerRef.current.clientWidth, height: liveHeight })
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      plot.destroy()
    }
  }, [bandCentres, series, height, effectiveHeight, maxRtSec, showDubiousOverlay, strokeWidth, idealRange])

  return <div ref={containerRef} className="rt-spectrum-plot" />
}

function formatHz(hz: number): string {
  if (hz >= 1000) return `${hz / 1000}k`
  return `${hz}`
}
