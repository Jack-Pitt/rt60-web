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

  // Background — matches the canvas-deep token used elsewhere for plots.
  ctx.fillStyle = '#0a0c10'
  ctx.fillRect(0, 0, w, h)

  // Auto-crop to just the section around the impulse so a millisecond
  // event isn't lost in a multi-second buffer.
  const { startSample, endSample } = findUsefulRange(samples, sampleRate, triggerSampleIndex)
  const visibleLength = endSample - startSample

  // Find peak amplitude inside the visible range so we auto-fit the y-axis.
  let peak = 0
  for (let i = startSample; i < endSample; i++) {
    const a = Math.abs(samples[i])
    if (a > peak) peak = a
  }
  if (peak < 1e-6) peak = 1e-6
  const yScale = (h * 0.5) / (peak * 1.05)

  // Faint y=0 centre line.
  ctx.strokeStyle = '#2a2e38'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, h / 2)
  ctx.lineTo(w, h / 2)
  ctx.stroke()

  // Min/max envelope per pixel column over the cropped range.
  const samplesPerPixel = Math.max(1, Math.floor(visibleLength / w))
  ctx.fillStyle = '#00A48B'
  for (let x = 0; x < w; x++) {
    let mn = 1
    let mx = -1
    const segStart = startSample + x * samplesPerPixel
    const segEnd = Math.min(endSample, segStart + samplesPerPixel)
    for (let i = segStart; i < segEnd; i++) {
      const s = samples[i]
      if (s < mn) mn = s
      if (s > mx) mx = s
    }
    if (mn > mx) continue
    const yMin = h / 2 - mx * yScale
    const yMax = h / 2 - mn * yScale
    const barHeight = Math.max(1, yMax - yMin)
    ctx.fillRect(x, yMin, 1, barHeight)
  }

  // Trigger marker (only if it falls inside the visible range).
  if (
    triggerSampleIndex !== undefined &&
    triggerSampleIndex >= startSample &&
    triggerSampleIndex < endSample
  ) {
    const x = ((triggerSampleIndex - startSample) / visibleLength) * w
    ctx.strokeStyle = '#d4881e'
    ctx.lineWidth = 1.5 * dpr
    ctx.setLineDash([6 * dpr, 4 * dpr])
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#f5d36a'
    ctx.font = `${11 * dpr}px -apple-system, sans-serif`
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    ctx.fillText('trigger', x + 4 * dpr, 4 * dpr)
  }

  // Time axis labels — start and end of the cropped window, plus peak.
  const startSec = startSample / sampleRate
  const endSec = endSample / sampleRate
  ctx.fillStyle = '#9aa1ad'
  ctx.font = `${10 * dpr}px -apple-system, sans-serif`
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'left'
  ctx.fillText(`${startSec.toFixed(2)} s`, 6 * dpr, h - 4 * dpr)
  ctx.textAlign = 'right'
  ctx.fillText(`${endSec.toFixed(2)} s`, w - 6 * dpr, h - 4 * dpr)
  // Peak / cropped-window readout in the top-right corner.
  ctx.textBaseline = 'top'
  ctx.textAlign = 'right'
  const cropped = endSample - startSample < samples.length
  const totalSec = samples.length / sampleRate
  const note = cropped
    ? `cropped to ${(endSec - startSec).toFixed(2)} s of ${totalSec.toFixed(2)} s · peak ${peak.toFixed(3)}`
    : `${totalSec.toFixed(2)} s · peak ${peak.toFixed(3)}`
  ctx.fillText(note, w - 6 * dpr, 4 * dpr)
}

/**
 * Auto-detect a sensible viewing window around the impulse.
 *
 * Strategy: start ~100 ms before the trigger; walk forward from the peak
 * in 50 ms windows, find where the local RMS stays below ~40 dB under
 * peak for at least 200 ms, then add 200 ms of margin. Floor the window
 * size at 0.5 s so the user can always see at least the early decay.
 */
function findUsefulRange(
  samples: Float32Array,
  sampleRate: number,
  triggerSampleIndex: number | undefined,
): { startSample: number; endSample: number } {
  const trigger = triggerSampleIndex ?? 0

  // Pre-window: ~100 ms before the trigger so the impact moment isn't
  // hugging the left edge.
  const preWindow = Math.floor(0.1 * sampleRate)
  const startSample = Math.max(0, trigger - preWindow)

  // Find the peak in the post-trigger region; the peak is where we start
  // measuring the decay-to-floor walk.
  let peak = 0
  let peakIdx = trigger
  for (let i = trigger; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > peak) {
      peak = a
      peakIdx = i
    }
  }
  // No useful signal — show the whole buffer.
  if (peak < 1e-6) {
    return { startSample, endSample: samples.length }
  }

  // ~40 dB below peak as the "back to background" amplitude threshold.
  // This is a rough heuristic but tracks well with where a clap's
  // reflections fade into the noise floor for typical rooms.
  const ampThreshold = peak * 0.01

  const winSize = Math.max(1, Math.floor(0.05 * sampleRate)) // 50 ms RMS window
  const requiredBelowWindows = Math.ceil((0.2 * sampleRate) / winSize) // 200 ms below
  const marginSamples = Math.floor(0.2 * sampleRate)

  let belowCount = 0
  let endSample = samples.length
  for (let i = peakIdx; i + winSize < samples.length; i += winSize) {
    let sumSq = 0
    for (let j = 0; j < winSize; j++) {
      const s = samples[i + j]
      sumSq += s * s
    }
    const rms = Math.sqrt(sumSq / winSize)
    if (rms < ampThreshold) {
      belowCount++
      if (belowCount >= requiredBelowWindows) {
        endSample = Math.min(samples.length, i + winSize + marginSamples)
        break
      }
    } else {
      belowCount = 0
    }
  }

  // Floor the visible duration at 0.5 s so very short impulses still get
  // a readable post-trigger window.
  const minEnd = trigger + Math.floor(0.5 * sampleRate)
  if (endSample < minEnd) endSample = Math.min(samples.length, minEnd)

  return { startSample, endSample }
}
