import { useEffect, useRef } from 'react'

// Live waveform display.
//
// The component owns:
//   - a Float32Array ring buffer holding the most recent samples
//   - a requestAnimationFrame loop that draws the buffer to the canvas
//
// The parent passes a registerSink() callback at mount; the parent calls
// the returned function with each new block of samples coming in from
// the audio worklet. Decoupling the audio path from React renders keeps
// the UI thread cheap (no setState per audio block at 375 Hz).

export interface WaveformHandle {
  pushSamples: (samples: Float32Array) => void
  reset: () => void
}

interface Props {
  sampleRate: number
  windowSeconds?: number
  onReady: (handle: WaveformHandle) => void
}

export default function Waveform({ sampleRate, windowSeconds = 1.0, onReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Ring buffer of recent samples. Recreated whenever sampleRate or
  // windowSeconds changes (rare; usually once when the mic starts).
  const bufferRef = useRef<Float32Array | null>(null)
  const writeIndexRef = useRef(0)
  // Peak hold for a small text level meter. Reset by reset().
  const peakRef = useRef(0)

  useEffect(() => {
    const length = Math.max(1024, Math.floor(sampleRate * windowSeconds))
    bufferRef.current = new Float32Array(length)
    writeIndexRef.current = 0
    peakRef.current = 0

    const handle: WaveformHandle = {
      pushSamples: (samples) => {
        const buf = bufferRef.current
        if (!buf) return
        let w = writeIndexRef.current
        for (let i = 0; i < samples.length; i++) {
          const s = samples[i]
          buf[w] = s
          if (Math.abs(s) > peakRef.current) peakRef.current = Math.abs(s)
          w = w + 1
          if (w >= buf.length) w = 0
        }
        writeIndexRef.current = w
      },
      reset: () => {
        const buf = bufferRef.current
        if (buf) buf.fill(0)
        writeIndexRef.current = 0
        peakRef.current = 0
      },
    }
    onReady(handle)
  }, [sampleRate, windowSeconds, onReady])

  useEffect(() => {
    let raf = 0
    const loop = () => {
      drawWaveform(canvasRef.current, bufferRef.current, writeIndexRef.current, peakRef.current)
      // Slow decay on the held peak so the meter does not stick at the
      // top after a transient.
      peakRef.current *= 0.95
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="waveform"
      // The internal pixel size is set in drawWaveform() via devicePixelRatio
      // so the waveform stays crisp on retina displays.
    />
  )
}

// Pure draw routine. Called once per animation frame.
function drawWaveform(
  canvas: HTMLCanvasElement | null,
  buffer: Float32Array | null,
  writeIndex: number,
  peak: number,
) {
  if (!canvas || !buffer) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Match the backing store to the CSS size scaled by devicePixelRatio.
  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth || 320
  const cssH = canvas.clientHeight || 120
  const w = Math.floor(cssW * dpr)
  const h = Math.floor(cssH * dpr)
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h

  // Background.
  ctx.fillStyle = '#0c0e13'
  ctx.fillRect(0, 0, w, h)

  // Centre line.
  ctx.strokeStyle = '#2a2e38'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, h / 2)
  ctx.lineTo(w, h / 2)
  ctx.stroke()

  const len = buffer.length
  const samplesPerPixel = Math.max(1, Math.floor(len / w))

  // We draw the buffer in chronological order: oldest sample on the left,
  // newest on the right. The newest sample lives just before writeIndex
  // (which points at the next slot to be written). So pixel x maps to:
  //   sampleStart = (writeIndex + x * samplesPerPixel) mod len
  ctx.fillStyle = '#5fa8ff'
  for (let x = 0; x < w; x++) {
    let mn = 1
    let mx = -1
    const base = (writeIndex + x * samplesPerPixel) % len
    for (let k = 0; k < samplesPerPixel; k++) {
      const s = buffer[(base + k) % len]
      if (s < mn) mn = s
      if (s > mx) mx = s
    }
    // Map -1..1 to canvas y, with 0 at the centre.
    const yMin = ((1 - mx) * h) / 2
    const yMax = ((1 - mn) * h) / 2
    const barHeight = Math.max(1, yMax - yMin)
    ctx.fillRect(x, yMin, 1, barHeight)
  }

  // Tiny peak number, top-right.
  ctx.fillStyle = '#9aa1ad'
  ctx.font = `${12 * dpr}px -apple-system, sans-serif`
  ctx.textAlign = 'right'
  ctx.fillText(`peak ${peak.toFixed(3)}`, w - 8 * dpr, 16 * dpr)
}
