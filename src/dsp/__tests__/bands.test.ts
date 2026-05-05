import { describe, it, expect } from 'vitest'
import { BANDS, bandByCentre } from '../bands'

describe('third-octave band table', () => {
  it('has the 24 bands the brief asks for, in order', () => {
    expect(BANDS).toHaveLength(24)
    expect(BANDS[0].centre).toBe(50)
    expect(BANDS[BANDS.length - 1].centre).toBe(10000)
    // First few preferred centres.
    expect(BANDS.slice(0, 5).map((b) => b.centre)).toEqual([50, 63, 80, 100, 125])
  })

  it('upper edge is the sixth-octave ratio above the centre', () => {
    const sixthOctave = Math.pow(10, 1 / 20)
    for (const b of BANDS) {
      expect(b.upper / b.centre).toBeCloseTo(sixthOctave, 6)
      expect(b.centre / b.lower).toBeCloseTo(sixthOctave, 6)
    }
  })

  it('flags low (<=100 Hz) and high (>=6.3 kHz) bands as uncertain', () => {
    expect(bandByCentre(50)?.uncertain).toBe(true)
    expect(bandByCentre(100)?.uncertain).toBe(true)
    expect(bandByCentre(125)?.uncertain).toBe(false)
    expect(bandByCentre(5000)?.uncertain).toBe(false)
    expect(bandByCentre(6300)?.uncertain).toBe(true)
    expect(bandByCentre(10000)?.uncertain).toBe(true)
  })
})
