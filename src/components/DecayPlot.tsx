import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { BandResult } from '../dsp/analyze'

// Single-band Schroeder energy-decay curve plot.
//
// Layers (bottom to top):
//   - The EDC line (cyan-ish), the primary signal.
//   - The regression line for the reported metric (yellow), drawn ONLY
//     over the regression range so the user sees what was actually fitted.
//   - Horizontal reference lines at the regression dB endpoints (e.g.
//     -5 and -35 for T30) — drawn as additional flat-y series.
//   - Horizontal noise plateau line (red dashed) — where the EDC would
//     plateau if the IR window contained only noise.
//
// Axes:
//   - X: time in seconds
//   - Y: dB rel peak. Range chosen so 0 dB is at the top and we see down
//     to 5 dB below the noise plateau (or -60 dB, whichever is lower).
//   - Y gridlines every 5 dB per the brief.

interface Props {
  band: BandResult
  /** Visual size. Defaults to "full" for the main plot; "thumb" for small
   *  multiples disables most chrome and uses a denser layout. */
  variant?: 'full' | 'thumb'
  /** Optional click handler — used by the small-multiples grid. */
  onClick?: () => void
}

export default function DecayPlot({ band, variant = 'full', onClick }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const plotRef = useRef<uPlot | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const { data, yMin } = buildPlotData(band)

    const isThumb = variant === 'thumb'
    const opts: uPlot.Options = {
      width: containerRef.current.clientWidth || 320,
      height: isThumb ? 90 : 280,
      // Disable interactivity on thumbnails (small for taps anyway).
      cursor: isThumb ? { show: false } : { drag: { x: false, y: false } },
      legend: { show: !isThumb },
      scales: {
        x: { time: false },
        y: { auto: false, range: [yMin, 5] },
      },
      axes: [
        {
          stroke: '#9aa1ad',
          grid: { stroke: '#2a2e38', width: 1 },
          ticks: { stroke: '#2a2e38' },
          label: isThumb ? undefined : 'Time (s)',
          labelSize: isThumb ? 0 : 26,
          size: isThumb ? 18 : 36,
          font: '11px -apple-system, sans-serif',
          show: true,
        },
        {
          stroke: '#9aa1ad',
          grid: { stroke: '#2a2e38', width: 1 },
          ticks: { stroke: '#2a2e38' },
          label: isThumb ? undefined : 'Level (dB rel peak)',
          labelSize: isThumb ? 0 : 26,
          size: isThumb ? 28 : 50,
          font: '11px -apple-system, sans-serif',
          // Force ticks at every 5 dB.
          incrs: [5],
          show: true,
        },
      ],
      series: [
        {}, // x
        {
          label: 'EDC',
          stroke: '#5fa8ff',
          width: isThumb ? 1 : 2,
          points: { show: false },
        },
        {
          label: 'Regression',
          stroke: '#f5d36a',
          width: isThumb ? 1 : 2,
          points: { show: false },
        },
        {
          label: `${band.reportedDbRange[0]} dB`,
          stroke: '#7e8694',
          width: 1,
          dash: [4, 4],
          points: { show: false },
        },
        {
          label: `${band.reportedDbRange[1]} dB`,
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
    plotRef.current = plot

    // Re-fit on container resize (orientation change, page reflow).
    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        plot.setSize({
          width: containerRef.current.clientWidth,
          height: isThumb ? 90 : 280,
        })
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      plot.destroy()
      plotRef.current = null
    }
  }, [band, variant])

  return (
    <div
      ref={containerRef}
      className={`decay-plot ${variant}`}
      onClick={onClick}
      // Keyboard accessibility for the thumbnail click handler.
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick()
        }
      }}
    />
  )
}

// ---- data preparation ---------------------------------------------------

/**
 * Build the array shape uPlot wants: [xValues, ...ySeries]. We also
 * compute a sensible y-axis lower bound so the EDC fills the plot well
 * regardless of how far the decay went.
 */
function buildPlotData(band: BandResult): {
  data: uPlot.AlignedData
  yMin: number
} {
  const Fs = band.sampleRate
  const N = band.edcDb.length

  // Time axis. Using a Float64Array for uPlot.
  const t = new Float64Array(N)
  for (let i = 0; i < N; i++) t[i] = i / Fs

  // EDC, copied from Float32 to a plain number array for uPlot. Replace
  // -Infinity samples (clamped at the floor in schroederEdcDb) with NaN
  // so uPlot breaks the line rather than drawing a spike.
  const edc = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const v = band.edcDb[i]
    edc[i] = Number.isFinite(v) ? v : NaN
  }

  // Regression line: y = slope*x + intercept, drawn only between
  // sampleStart and sampleEnd. Outside the range use NaN so the line
  // breaks (uPlot won't draw between NaN gaps).
  const regression = new Float64Array(N)
  regression.fill(NaN)
  if (band.reportedRegression && band.reportedRange[0] >= 0 && band.reportedRange[1] >= 0) {
    const { slope, intercept } = band.reportedRegression
    if (Number.isFinite(slope) && Number.isFinite(intercept)) {
      // Extend the regression line a bit beyond the fitted range so the
      // user can see the extrapolation clearly. Use the dB endpoints and
      // solve for time.
      const startSample = Math.max(0, band.reportedRange[0] - Math.round(0.05 * Fs))
      const endSample = Math.min(N - 1, band.reportedRange[1] + Math.round(0.05 * Fs))
      for (let i = startSample; i <= endSample; i++) {
        regression[i] = slope * (i / Fs) + intercept
      }
    }
  }

  // Horizontal reference dB lines (constant Y across all X).
  const refUpper = new Float64Array(N).fill(band.reportedDbRange[0])
  const refLower = new Float64Array(N).fill(band.reportedDbRange[1])

  // Noise plateau line.
  const noiseLine = new Float64Array(N)
  noiseLine.fill(Number.isFinite(band.noisePlateauDb) ? band.noisePlateauDb : NaN)

  // Y-axis lower bound: a few dB below the noise plateau, but no lower
  // than -90 (deeper has no value), and never higher than -30 (so we
  // always see at least to -30 dB to make the EDC shape readable).
  const noiseFloor = Number.isFinite(band.noisePlateauDb) ? band.noisePlateauDb : -60
  let yMin = Math.min(-30, noiseFloor - 5)
  if (yMin < -90) yMin = -90

  return {
    data: [t, edc, regression, refUpper, refLower, noiseLine] as unknown as uPlot.AlignedData,
    yMin,
  }
}
