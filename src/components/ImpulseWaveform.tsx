import { useEffect, useRef } from 'react'

// Time-domain plot of the recorded impulse response (with pre-trigger
// margin). Diagnostic for spotting AGC pumping, clipping, or a
// not-quite-clean impulse — the kind of thing the Schroeder integral
// will smooth away even when something is wrong with the recording.
//
// Uses a plain canvas (not uPlot) so the min/max envelope per pixel
// column draws fast even on long buffers (~100 k samples).

interface Props {
  /** Captured impulse buffer (pre-trigger samples + decay window). */
  samples: Float32Array
  sampleRate: number
  /** Sample index where the trigger fired (typically pre-trigger length).
   *  A vertical marker is drawn there so the user can see how the impulse
   *  sits in the buffer. */
  triggerSampleIndex?: number
  /** Display height in CSS pixels. Defaults to 160. */
  height?: number
}

export default function ImpulseWaveform({
  samples,
  sampleRate,
  triggerSampleIndex,
  height = 160,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const draw = () => drawWaveform(canvasRef.current, samples, sampleRate, triggerSampleIndex)
    draw()
    const ro = new ResizeObserver(() => draw())
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [samples, sampleRate, triggerSampleIndex])

  return (
    <div ref={containerRef} className="impulse-waveform-wrap" style={{ height }}>
      <canvas ref={canvasRef} className="impulse-waveform-canvas" />
    </div>
  )
}

function drawWaveform(
  canvas: HTMLCanvasElement | null,
  samples: Float32Array,
  sampleRate: number,
  triggerSampleIndex: number | undefined,
) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth || canvas.parentElement?.clientWidth || 320
  const cssH = canvas.clientHeight || canvas.parentElement?.clientHeight || 160
  const w = Math.floor(cssW * dpr)
  const h = Math.floor(cssH * dpr)
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  canvas.style.width = `${cssW}px`
  canvas.style.height = `${cssH}px`

  // Background.
  ctx.fillStyle = '#0c0e13'
  ctx.fillRect(0, 0, w, h)

  // Find peak amplitude so we auto-fit the y-axis.
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > peak) peak = a
  }
  // Avoid divide-by-zero and give a tiny minimum range so silence draws as a centre line.
  if (peak < 1e-6) peak = 1e-6
  // Pad the range slightly so the trace doesn't touch the edges.
  const yScale = (h * 0.5) / (peak * 1.05)

  // Faint y=0 centre line.
  ctx.strokeStyle = '#2a2e38'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, h / 2)
  ctx.lineTo(w, h / 2)
  ctx.stroke()

  // Min/max envelope per pixel column. For long buffers this is much
  // faster than drawing every sample as a line segment.
  const samplesPerPixel = Math.max(1, Math.floor(samples.length / w))
  ctx.fillStyle = '#5fa8ff'
  for (let x = 0; x < w; x++) {
    let mn = 1
    let mx = -1
    const start = x * samplesPerPixel
    const end = Math.min(samples.length, start + samplesPerPixel)
    for (let i = start; i < end; i++) {
      const s = samples[i]
      if (s < mn) mn = s
      if (s > mx) mx = s
    }
    if (mn > mx) continue // no samples in this column
    const yMin = h / 2 - mx * yScale
    const yMax = h / 2 - mn * yScale
    const barHeight = Math.max(1, yMax - yMin)
    ctx.fillRect(x, yMin, 1, barHeight)
  }

  // Trigger marker — vertical line at the trigger sample.
  if (triggerSampleIndex !== undefined && triggerSampleIndex >= 0) {
    const x = (triggerSampleIndex / samples.length) * w
    ctx.strokeStyle = '#f5d36a'
    ctx.lineWidth = 1.5 * dpr
    ctx.setLineDash([6 * dpr, 4 * dpr])
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
    ctx.setLineDash([])
    // Label
    ctx.fillStyle = '#f5d36a'
    ctx.font = `${11 * dpr}px -apple-system, sans-serif`
    ctx.textBaseline = 'top'
    ctx.fillText('trigger', x + 4 * dpr, 4 * dpr)
  }

  // Time axis label (top right): total duration.
  const totalSec = samples.length / sampleRate
  ctx.fillStyle = '#9aa1ad'
  ctx.font = `${10 * dpr}px -apple-system, sans-serif`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillText(`${totalSec.toFixed(2)} s · peak ${peak.toFixed(3)}`, w - 6 * dpr, 4 * dpr)
}
