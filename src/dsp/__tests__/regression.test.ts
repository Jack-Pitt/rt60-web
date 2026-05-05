import { describe, it, expect } from 'vitest'
import { fitDecayRT, linearRegression } from '../regression'

describe('linearRegression', () => {
  it('recovers a perfect line exactly', () => {
    const n = 50
    const x = new Float64Array(n)
    const y = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      x[i] = i
      y[i] = -2 * i + 7 // slope -2, intercept 7
    }
    const r = linearRegression(x, y)
    expect(r.slope).toBeCloseTo(-2, 12)
    expect(r.intercept).toBeCloseTo(7, 12)
    expect(r.r2).toBeCloseTo(1, 12)
    expect(r.n).toBe(n)
  })

  it('gives R^2 close to 0 for pure noise', () => {
    const n = 1000
    const x = new Float64Array(n)
    const y = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      x[i] = i
      y[i] = Math.random() - 0.5
    }
    const r = linearRegression(x, y)
    // With this much sample size, |r2| should be tiny (well under 0.05).
    expect(r.r2).toBeLessThan(0.05)
  })

  it('skips non-finite points without crashing', () => {
    const x = [0, 1, 2, 3, 4]
    const y = [0, 1, NaN, 3, 4]
    const r = linearRegression(x, y)
    expect(r.n).toBe(4)
    expect(r.slope).toBeCloseTo(1, 12)
  })
})

describe('fitDecayRT', () => {
  it('extrapolates a perfectly straight EDC to the right RT60', () => {
    // EDC drops 10 dB per second linearly -> RT60 = 6 seconds.
    const Fs = 48000
    const N = Fs * 8
    const edc = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      const t = i / Fs
      edc[i] = -10 * t
    }
    const fit = fitDecayRT(edc, Fs, -5, -35)
    expect(fit.rtSeconds).toBeCloseTo(6, 1)
    expect(fit.regression.r2).toBeCloseTo(1, 6)
  })
})
