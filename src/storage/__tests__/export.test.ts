import { describe, it, expect } from 'vitest'
import {
  buildCsv,
  buildCsvBundle,
  buildJson,
  buildFilename,
  buildBundleFilename,
} from '../export'
import { analyzeImpulseResponse } from '../../dsp/analyze'
import type { Metadata } from '../../measurement/types'
import { bandByCentre } from '../../dsp/bands'
import type { SavedMeasurement } from '../measurements'

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

describe('CSV bundle export', () => {
  function makeSaved(site: string, room: string, pos: string, ts: number): SavedMeasurement {
    const { metadata, result } = tinySynthetic()
    return {
      id: `${ts}-x`,
      timestamp: ts,
      metadata: { ...metadata, site, room, position: pos },
      result,
    }
  }

  it('produces a single-measurement file when only one item is bundled', () => {
    const items = [makeSaved('S', 'R', 'P', 1717612980000)]
    const out = buildCsvBundle(items)
    // Should be the single-measurement format (with the file-level header).
    expect(out).toContain('# RT60 Measurement Export')
    expect(out).not.toContain('# Comparison summary')
    expect(out).not.toContain('# Index')
  })

  it('contains an index, three comparison-summary tables, and per-measurement detail blocks', () => {
    const items = [
      makeSaved('Site A', 'Room 1', 'P1', 1717612980000),
      makeSaved('Site A', 'Room 1', 'P2', 1717613000000),
      makeSaved('Site A', 'Room 1', 'P3', 1717613100000),
    ]
    const out = buildCsvBundle(items)
    expect(out).toContain('# RT60 Measurements Bundle')
    expect(out).toContain('Number of measurements,3')
    expect(out).toContain('# Index')
    expect(out).toContain('# Comparison summary — RT (s) per band')
    expect(out).toContain('# Comparison summary — EDT (s) per band')
    expect(out).toContain('# Comparison summary — INR (dB) per band')
    expect(out).toContain('# Measurement 1: Site A / Room 1 / pos P1')
    expect(out).toContain('# Measurement 2: Site A / Room 1 / pos P2')
    expect(out).toContain('# Measurement 3: Site A / Room 1 / pos P3')
  })

  it('column count in comparison summaries matches the number of measurements', () => {
    const items = [
      makeSaved('Site A', 'Room 1', 'P1', 1717612980000),
      makeSaved('Site A', 'Room 1', 'P2', 1717613000000),
    ]
    const out = buildCsvBundle(items)
    // Find the RT comparison summary header line.
    const lines = out.split('\r\n')
    const hdrIdx = lines.findIndex((l) =>
      l.startsWith('Band (Hz),') && l.split(',').length === 3,
    )
    expect(hdrIdx).toBeGreaterThan(0)
    // Expect band column + one per measurement.
    expect(lines[hdrIdx].split(',')).toHaveLength(3)
  })
})

describe('buildBundleFilename', () => {
  it('uses the RT60_Bundle prefix and includes the measurement count', () => {
    const name = buildBundleFilename(3, 1717612980000, 'csv')
    expect(name).toMatch(/^RT60_Bundle_3_2024-06-05T18-43-00Z?\.csv$/)
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
