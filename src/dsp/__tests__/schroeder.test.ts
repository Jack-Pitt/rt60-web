import { describe, it, expect } from 'vitest'
import { schroederEdcDb } from '../schroeder'

describe('Schroeder backward integration', () => {
  it('starts at 0 dB (peak) and is monotonically non-increasing', () => {
    const sig = new Float32Array(1000)
    for (let i = 0; i < sig.length; i++) sig[i] = Math.random() - 0.5
    const edc = schroederEdcDb(sig)
    expect(edc[0]).toBeCloseTo(0, 6)
    for (let i = 1; i < edc.length; i++) {
      expect(edc[i]).toBeLessThanOrEqual(edc[i - 1] + 1e-6)
    }
  })

  it('recovers a known exponential decay slope (in energy) within 5%', () => {
    // A pure exponential decay e^{-t/tau} has energy decay 2/tau (per unit
    // time, in nepers-of-energy/sec). In dB/sec that's 10*log10(e) * 2/tau
    // = 8.686 / tau. So decay rate in dB/sec = -8.686 / tau.
    const Fs = 48000
    const tau = 0.5 // exponential time constant in seconds
    const N = Fs * 4
    const sig = new Float32Array(N)
    // Use white noise modulated by exp(-t/tau) so the EDC is statistically
    // a clean exponential decay (Schroeder's averaging in action).
    for (let i = 0; i < N; i++) {
      const t = i / Fs
      const env = Math.exp(-t / tau)
      sig[i] = (Math.random() - 0.5) * env
    }
    const edc = schroederEdcDb(sig)

    // Pick two times in the bulk of the decay (avoid the very start, which
    // has integration-window edge effects, and the noise-floor end).
    const t1 = 0.2
    const t2 = 1.5
    const i1 = Math.round(t1 * Fs)
    const i2 = Math.round(t2 * Fs)
    const slopeMeasured = (edc[i2] - edc[i1]) / (t2 - t1)
    const slopeExpected = -8.686 / tau // dB/sec
    expect(Math.abs((slopeMeasured - slopeExpected) / slopeExpected)).toBeLessThan(0.05)
  })

  it('returns -Infinity for an all-zero signal', () => {
    const edc = schroederEdcDb(new Float32Array(1000))
    expect(edc[0]).toBe(-Infinity)
  })
})
