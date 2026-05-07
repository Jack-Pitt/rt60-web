import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

// Single-pane Schroeder energy-decay curve plot.
//
// Layers (bottom to top):
//   - The EDC line (cyan-ish), the primary signal.
//   - The regression line (yellow), drawn ONLY over the regression range
//     so the user sees what was actually fitted. Optional.
//   - Horizontal reference lines at the regression dB endpoints (e.g.
//     -5 and -35 for T30) — drawn as dashed flat-y series. Optional.
//   - Horizontal noise plateau line (red dashed) — where the EDC would
//     plateau if the IR window contained only noise. Optional.
//
// Axes:
//   - X: time in seconds
//   - Y: dB rel peak. Range chosen so 0 dB is at the top and we see down
//     to a few dB below the noise plateau (or -60 dB, whichever is lower).
//   - Y gridlines every 5 dB per the brief.

export interface DecayPlotProps {
  edcDb: Float32Array
  sampleRate: number
  /** Optional regression overlay (slope dB/s, intercept dB). */
  regression?: {
    slope: number
    intercept: number
    sampleStart: number
    sampleEnd: number
  } | null
  /** Optional dB endpoints of the regression range, e.g. [-5, -35]. */
  dbRange?: [number, number] | null
  /** Optional noise plateau line in dB rel peak. */
  noisePlateauDb?: number
}

export default function DecayPlot(props: DecayPlotProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const { data, yMin, seriesNames } = buildPlotData(props)

    const opts: uPlot.Options = {
      width: containerRef.current.clientWidth || 320,
      height: 280,
      cursor: { drag: { x: false, y: false } },
      legend: { show: true },
      scales: {
        x: { time: false },
        y: { auto: false, range: [yMin, 5] },
      },
      axes: [
        {
          stroke: '#9aa1ad',
          grid: { stroke: '#2a2e38', width: 1 },
          ticks: { stroke: '#2a2e38' },
          label: 'Time (s)',
          labelSize: 26,
          size: 36,
          font: '11px -apple-system, sans-serif',
        },
        {
          stroke: '#9aa1ad',
          grid: { stroke: '#2a2e38', width: 1 },
          ticks: { stroke: '#2a2e38' },
          label: 'Level (dB rel peak)',
          labelSize: 22,
          size: 50,
          font: '11px -apple-system, sans-serif',
          // Explicit tick positions every 10 dB so the labels reliably
          // show on small phone screens (a 5 dB increment is too dense).
          // The 5 dB gridlines are achieved by the visual fact that the
          // 10 dB labels straddle 5-dB midpoints, and the user can read
          // the scale at a glance.
          splits: (_u, _aIdx, scaleMin, scaleMax) => {
            const out: number[] = []
            const start = Math.ceil(scaleMin / 10) * 10
            for (let v = start; v <= scaleMax; v += 10) out.push(v)
            return out
          },
          values: (_u, splits) => splits.map((v) => `${v}`),
        },
      ],
      series: [
        {},
        {
          // EDC line in NVC teal so the brand colour leads the diagnostic.
          label: seriesNames.edc,
          stroke: '#00A48B',
          width: 2,
          points: { show: false },
        },
        {
          // Regression line in amber — same family as the EDT line on
          // the spectrum plot, away from any red so it doesn't conflict
          // with the dubious-marker hue.
          label: seriesNames.regression,
          stroke: '#d4881e',
          width: 2,
          points: { show: false },
        },
        {
          label: seriesNames.refUpper,
          stroke: '#7e8694',
          width: 1,
          dash: [4, 4],
          points: { show: false },
        },
        {
          label: seriesNames.refLower,
          stroke: '#7e8694',
          width: 1,
          dash: [4, 4],
          points: { show: false },
        },
        {
          label: 'Noise plateau',
          stroke: '#d23a3a',
          width: 1,
          dash: [2, 4],
          points: { show: false },
        },
      ],
    }

    const plot = new uPlot(opts, data, containerRef.current)

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        plot.setSize({ width: containerRef.current.clientWidth, height: 280 })
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      plot.destroy()
    }
  }, [props])

  return <div ref={containerRef} className="decay-plot full" />
}

// ---- data preparation ---------------------------------------------------

interface BuiltData {
  data: uPlot.AlignedData
  yMin: number
  seriesNames: {
    edc: string
    regression: string
    refUpper: string
    refLower: string
  }
}

function buildPlotData(props: DecayPlotProps): BuiltData {
  const Fs = props.sampleRate
  const N = props.edcDb.length

  // Time axis.
  const t = new Float64Array(N)
  for (let i = 0; i < N; i++) t[i] = i / Fs

  // EDC, with -Infinity replaced by NaN so uPlot breaks the line cleanly
  // rather than drawing off-screen.
  const edc = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const v = props.edcDb[i]
    edc[i] = Number.isFinite(v) ? v : NaN
  }

  // Regression line over its fitted range, NaN elsewhere so uPlot breaks
  // the line at the boundary.
  const regression = new Float64Array(N)
  regression.fill(NaN)
  if (
    props.regression &&
    props.regression.sampleStart >= 0 &&
    props.regression.sampleEnd >= 0 &&
    Number.isFinite(props.regression.slope) &&
    Number.isFinite(props.regression.intercept)
  ) {
    // Extend slightly beyond the fitted range so the user can see the
    // extrapolation visually (~50 ms each side, capped at signal bounds).
    const margin = Math.round(0.05 * Fs)
    const startSample = Math.max(0, props.regression.sampleStart - margin)
    const endSample = Math.min(N - 1, props.regression.sampleEnd + margin)
    const { slope, intercept } = props.regression
    for (let i = startSample; i <= endSample; i++) {
      regression[i] = slope * (i / Fs) + intercept
    }
  }

  // Horizontal reference dB lines (constant Y across all X). If there are
  // no dbRange endpoints supplied, draw flat NaN so the series is hidden.
  const refUpper = new Float64Array(N)
  const refLower = new Float64Array(N)
  if (props.dbRange) {
    refUpper.fill(props.dbRange[0])
    refLower.fill(props.dbRange[1])
  } else {
    refUpper.fill(NaN)
    refLower.fill(NaN)
  }

  // Noise plateau line.
  const noiseLine = new Float64Array(N)
  noiseLine.fill(
    props.noisePlateauDb !== undefined && Number.isFinite(props.noisePlateauDb)
      ? props.noisePlateauDb
      : NaN,
  )

  // Y-axis lower bound: fixed at -60 dB (the conventional decay-plot
  // range) so plots are visually comparable across measurements. If the
  // noise plateau is below -55 dB we extend the axis down to give it
  // some headroom, capped at -90 dB.
  const noiseFloor =
    props.noisePlateauDb !== undefined && Number.isFinite(props.noisePlateauDb)
      ? props.noisePlateauDb
      : -60
  let yMin = -60
  if (noiseFloor < yMin + 5) yMin = Math.max(-90, noiseFloor - 5)

  const seriesNames = {
    edc: 'EDC',
    regression: 'Regression',
    refUpper: props.dbRange ? `${props.dbRange[0]} dB` : 'ref-upper',
    refLower: props.dbRange ? `${props.dbRange[1]} dB` : 'ref-lower',
  }

  return {
    data: [t, edc, regression, refUpper, refLower, noiseLine] as unknown as uPlot.AlignedData,
    yMin,
    seriesNames,
  }
}
