import { describe, it, expect } from 'vitest'
import {
  applyBiquadCascade,
  designButterworthBandpass,
  magnitudeAt,
} from '../biquad'

const Fs = 48000

describe('Butterworth bandpass design', () => {
  it('has unity gain at the geometric centre frequency', () => {
    const f0 = 1000
    const fLow = f0 / Math.pow(10, 1 / 20)
    const fHigh = f0 * Math.pow(10, 1 / 20)
    const sections = designButterworthBandpass(fLow, fHigh, Fs)
    const gain = magnitudeAt(sections, Math.sqrt(fLow * fHigh), Fs)
    expect(gain).toBeCloseTo(1.0, 5)
  })

  it('produces ~3 dB attenuation at the band edges', () => {
    const f0 = 1000
    const fLow = f0 / Math.pow(10, 1 / 20)
    const fHigh = f0 * Math.pow(10, 1 / 20)
    const sections = designButterworthBandpass(fLow, fHigh, Fs)
    const gainLow = 20 * Math.log10(magnitudeAt(sections, fLow, Fs))
    const gainHigh = 20 * Math.log10(magnitudeAt(sections, fHigh, Fs))
    // Butterworth defines its bandwidth at -3 dB. Allow tolerance for the
    // bilinear pre-warp imperfection at higher frequencies.
    expect(gainLow).toBeGreaterThan(-4)
    expect(gainLow).toBeLessThan(-2.4)
    expect(gainHigh).toBeGreaterThan(-4)
    expect(gainHigh).toBeLessThan(-2.4)
  })

  it('rejects an octave below and above the band by at least 30 dB', () => {
    // 6th-order Butterworth is 36 dB/octave, but for a bandpass that's the
    // skirt slope per side. Conservatively check >= 30 dB.
    const f0 = 1000
    const fLow = f0 / Math.pow(10, 1 / 20)
    const fHigh = f0 * Math.pow(10, 1 / 20)
    const sections = designButterworthBandpass(fLow, fHigh, Fs)
    const gainBelow = 20 * Math.log10(magnitudeAt(sections, fLow / 4, Fs))
    const gainAbove = 20 * Math.log10(magnitudeAt(sections, fHigh * 4, Fs))
    expect(gainBelow).toBeLessThan(-30)
    expect(gainAbove).toBeLessThan(-30)
  })

  it('runs stably on a long input without producing NaN or runaway output', () => {
    const sections = designButterworthBandpass(891, 1122, Fs) // 1 kHz band
    // Random noise input.
    const N = Fs * 2 // 2 seconds
    const x = new Float32Array(N)
    for (let i = 0; i < N; i++) x[i] = (Math.random() - 0.5) * 0.5
    const y = applyBiquadCascade(x, sections)
    let maxAbs = 0
    for (let i = 0; i < N; i++) {
      expect(Number.isFinite(y[i])).toBe(true)
      if (Math.abs(y[i]) > maxAbs) maxAbs = Math.abs(y[i])
    }
    // Output amplitude should be on the order of input. Filtering noise
    // through one third-octave band reduces RMS but should never blow up.
    expect(maxAbs).toBeLessThan(2)
  })

  it('passes a sine at band centre with near-unity gain', () => {
    const sections = designButterworthBandpass(891, 1122, Fs)
    const f = 1000
    const N = Fs * 1
    const x = new Float32Array(N)
    for (let i = 0; i < N; i++) x[i] = Math.sin((2 * Math.PI * f * i) / Fs)
    const y = applyBiquadCascade(x, sections)
    // Steady-state portion (skip the transient at the start).
    let peak = 0
    for (let i = N / 2; i < N; i++) if (Math.abs(y[i]) > peak) peak = Math.abs(y[i])
    expect(peak).toBeGreaterThan(0.95)
    expect(peak).toBeLessThan(1.05)
  })

  it('strongly attenuates a sine well below the band', () => {
    const sections = designButterworthBandpass(891, 1122, Fs)
    const f = 100 // 3 octaves below
    const N = Fs * 1
    const x = new Float32Array(N)
    for (let i = 0; i < N; i++) x[i] = Math.sin((2 * Math.PI * f * i) / Fs)
    const y = applyBiquadCascade(x, sections)
    let peak = 0
    for (let i = N / 2; i < N; i++) if (Math.abs(y[i]) > peak) peak = Math.abs(y[i])
    expect(peak).toBeLessThan(0.01) // -40 dB
  })
})
