import { describe, it, expect } from 'vitest'
import { buildCsv, buildJson, buildFilename } from '../export'
import { analyzeImpulseResponse } from '../../dsp/analyze'
import type { Metadata } from '../../measurement/types'
import { bandByCentre } from '../../dsp/bands'

// Build a tiny synthetic measurement so we have something to serialise.
function tinySynthetic() {
  const Fs = 48000
  const N = Fs * 1
  const impulse = new Float32Array(N)
  // Quick exponential decay so the analyser produces non-trivial output.
  for (let i = 0; i < N; i++) {
    const t = i / Fs
    impulse[i] = (Math.sin(2 * Math.PI * 1000 * t) + 0) * Math.exp(-t / 0.15)
  }
  const noise = new Float32Array(Fs * 1)
  for (let i = 0; i < noise.length; i++) noise[i] = 1e-6 * Math.sin(i)
  const result = analyzeImpulseResponse(
    { impulse, noise, sampleRate: Fs, clipped: false },
    { bands: [bandByCentre(1000)!] },
  )
  const metadata: Metadata = {
    site: 'Test Site',
    room: 'Boardroom 2',
    position: 'P1',
    notes: 'first run, with comma, and "quotes"',
    impulseSource: 'clapper',
  }
  return { metadata, result, timestamp: 1717612980000 } // 2024-06-05T20:03:00Z
}

describe('CSV export', () => {
  it('starts with a UTF-8 BOM and includes the metadata header', () => {
    const { metadata, result, timestamp } = tinySynthetic()
    const csv = buildCsv(metadata, result, timestamp)
    expect(csv.charCodeAt(0)).toBe(0xfeff) // BOM
    expect(csv).toContain('# RT60 Measurement Export')
    expect(csv).toContain('Site,Test Site')
    expect(csv).toContain('Room,Boardroom 2')
    expect(csv).toContain('Position,P1')
    expect(csv).toContain('Sample rate (Hz),48000')
  })

  it('quotes fields containing commas or quotes', () => {
    const { metadata, result, timestamp } = tinySynthetic()
    const csv = buildCsv(metadata, result, timestamp)
    // The notes field has commas and double-quotes — should be wrapped in
    // quotes with internal quotes doubled.
    expect(csv).toContain('"first run, with comma, and ""quotes"""')
  })

  it('contains a per-band table with the 1 kHz row', () => {
    const { metadata, result, timestamp } = tinySynthetic()
    const csv = buildCsv(metadata, result, timestamp)
    expect(csv).toContain('Band (Hz),Reported metric,RT (s)')
    // The 1 kHz row should be present and start with the centre frequency.
    const lines = csv.split('\r\n')
    const bandRow = lines.find((l) => l.startsWith('1000,'))
    expect(bandRow).toBeDefined()
  })

  it('appends an Overall (broadband) summary section', () => {
    const { metadata, result, timestamp } = tinySynthetic()
    const csv = buildCsv(metadata, result, timestamp)
    expect(csv).toContain('# Overall (broadband, unfiltered)')
  })
})

describe('JSON export', () => {
  it('produces valid JSON with metadata, sampleRate, overall, and bands', () => {
    const { metadata, result, timestamp } = tinySynthetic()
    const json = buildJson(metadata, result, timestamp)
    const parsed = JSON.parse(json)
    expect(parsed.metadata.site).toBe('Test Site')
    expect(parsed.sampleRate).toBe(48000)
    expect(parsed.overall.reportedMetric).toBeTruthy()
    expect(parsed.bands).toHaveLength(1)
    expect(parsed.bands[0].band.centre).toBe(1000)
    // The EDC array is included so the curve can be re-plotted later.
    expect(Array.isArray(parsed.bands[0].edcDb)).toBe(true)
    expect(parsed.bands[0].edcDb.length).toBeGreaterThan(0)
  })

  it('rounds EDC values to 0.001 dB to keep file size reasonable', () => {
    const { metadata, result, timestamp } = tinySynthetic()
    const json = buildJson(metadata, result, timestamp)
    const parsed = JSON.parse(json)
    for (const v of parsed.bands[0].edcDb as number[]) {
      if (v === null) continue
      // After rounding to 3 decimals, multiplying by 1000 gives an integer.
      const ms = Math.round(v * 1000)
      expect(Math.abs(ms - v * 1000)).toBeLessThan(1e-9)
    }
  })
})

describe('buildFilename', () => {
  it('matches the brief naming convention', () => {
    const meta: Metadata = {
      site: 'NVC office',
      room: 'Boardroom 2',
      position: 'P1',
      notes: '',
      impulseSource: 'clapper',
    }
    // 2024-06-05T18:43:00.000Z (UTC), so the filename uses the UTC time.
    const name = buildFilename(meta, 1717612980000, 'csv')
    expect(name).toMatch(/^RT60_NVC-office_Boardroom-2_P1_2024-06-05T18-43-00Z?\.csv$/)
  })

  it('replaces non-filesystem-safe characters and falls back to "unset"', () => {
    const meta: Metadata = {
      site: '',
      room: '!!',
      position: 'A/B',
      notes: '',
      impulseSource: 'clapper',
    }
    const name = buildFilename(meta, 0, 'json')
    expect(name).toContain('RT60_unset_unset_A-B_')
    expect(name.endsWith('.json')).toBe(true)
  })
})
