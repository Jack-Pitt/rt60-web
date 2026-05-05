// CSV and JSON export of an RT60 measurement.
//
// CSV is laid out for Excel: a metadata header (label,value rows), a
// blank line, then a single per-band table, then the broadband summary.
// A UTF-8 BOM is prepended so Excel recognises the encoding (important
// for the R² character).
//
// JSON dumps everything the app knows about the measurement, including
// the per-band Schroeder EDC arrays, so the measurement can be re-plotted
// in another tool without re-recording. Float arrays are serialised at
// 0.001 dB precision to keep file size manageable.
//
// File downloads route through the Web Share API on iOS so the user sees
// the standard share sheet (Files / AirDrop / Mail / etc). Desktop browsers
// fall back to a synthesised <a download> click on a Blob URL.

import type { AnalysisResult, BandResult, DecayPipelineResult } from '../dsp/analyze'
import { type Metadata, IMPULSE_SOURCE_LABELS } from '../measurement/types'

// ---- CSV ----------------------------------------------------------------

export function buildCsv(
  metadata: Metadata,
  result: AnalysisResult,
  timestamp: number,
): string {
  const lines: string[] = []
  lines.push('# RT60 Measurement Export')
  lines.push(csvRow(['Site', metadata.site]))
  lines.push(csvRow(['Room', metadata.room]))
  lines.push(csvRow(['Position', metadata.position]))
  lines.push(csvRow(['Notes', metadata.notes]))
  lines.push(csvRow(['Impulse source', IMPULSE_SOURCE_LABELS[metadata.impulseSource]]))
  lines.push(csvRow(['Timestamp', new Date(timestamp).toISOString()]))
  lines.push(csvRow(['Sample rate (Hz)', result.sampleRate.toString()]))
  lines.push(csvRow(['Recording clipped', result.clipped ? 'true' : 'false']))
  lines.push('')
  lines.push(
    csvRow([
      'Band (Hz)',
      'Reported metric',
      'RT (s)',
      'EDT (s)',
      'INR (dB)',
      'R²',
      'Noise plateau (dB rel peak)',
      'Flags',
    ]),
  )
  for (const b of result.bands) {
    lines.push(csvRow(rowForBand(b)))
  }
  lines.push('')
  lines.push('# Overall (broadband, unfiltered)')
  lines.push(
    csvRow(['RT (s)', 'EDT (s)', 'INR (dB)', 'R²', 'Reported metric', 'Noise plateau (dB rel peak)']),
  )
  lines.push(
    csvRow([
      formatNum(result.overall.reportedRtSeconds, 3),
      formatNum(result.overall.edtSeconds, 3),
      formatNum(result.overall.inrDb, 1),
      formatNum(result.overall.reportedR2, 3),
      result.overall.reportedMetric,
      formatNum(result.overall.noisePlateauDb, 1),
    ]),
  )
  // Excel-friendly line endings + UTF-8 BOM.
  return '﻿' + lines.join('\r\n') + '\r\n'
}

function rowForBand(b: BandResult): string[] {
  return [
    b.band.centre.toString(),
    b.reportedMetric,
    formatNum(b.reportedRtSeconds, 3),
    formatNum(b.edtSeconds, 3),
    formatNum(b.inrDb, 1),
    formatNum(b.reportedR2, 3),
    formatNum(b.noisePlateauDb, 1),
    b.flags.join(';'),
  ]
}

function csvRow(fields: string[]): string {
  return fields.map(csvEscape).join(',')
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}

function formatNum(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return ''
  return value.toFixed(decimals)
}

// ---- JSON ---------------------------------------------------------------

export function buildJson(
  metadata: Metadata,
  result: AnalysisResult,
  timestamp: number,
): string {
  const exportObj = {
    appVersion: 'rt60-web/0.1',
    exportedAt: new Date().toISOString(),
    measurementTimestamp: new Date(timestamp).toISOString(),
    metadata,
    sampleRate: result.sampleRate,
    clipped: result.clipped,
    overall: serializePipeline(result.overall),
    bands: result.bands.map((b) => ({
      band: b.band,
      ...serializePipeline(b),
    })),
  }
  return JSON.stringify(exportObj, null, 2)
}

function serializePipeline(p: DecayPipelineResult) {
  return {
    sampleRate: p.sampleRate,
    inrDb: p.inrDb,
    reportedMetric: p.reportedMetric,
    reportedRtSeconds: p.reportedRtSeconds,
    reportedR2: p.reportedR2,
    reportedRange: p.reportedRange,
    reportedDbRange: p.reportedDbRange,
    reportedRegression: p.reportedRegression,
    edtSeconds: p.edtSeconds,
    edtR2: p.edtR2,
    edtRegression: p.edtRegression,
    edtRange: p.edtRange,
    // Round to 0.001 dB to cut JSON size by ~3x while preserving more
    // precision than any plotter will display anyway.
    edcDb: Array.from(p.edcDb).map((v) =>
      Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null,
    ),
    noiseFloorDb: Number.isFinite(p.noiseFloorDb) ? p.noiseFloorDb : null,
    noisePlateauDb: Number.isFinite(p.noisePlateauDb) ? p.noisePlateauDb : null,
    flags: p.flags,
  }
}

// ---- filename + download ------------------------------------------------

/** Build the filename per the brief: RT60_<site>_<room>_<pos>_<timestamp>.<ext> */
export function buildFilename(
  metadata: Metadata,
  timestamp: number,
  ext: 'csv' | 'json',
): string {
  const ts = new Date(timestamp)
    .toISOString()
    .replace(/:/g, '-')   // colons aren't filesystem-safe everywhere
    .replace(/\.\d+/, '') // drop the milliseconds for readability
  return `RT60_${sanitize(metadata.site)}_${sanitize(metadata.room)}_${sanitize(metadata.position)}_${ts}.${ext}`
}

function sanitize(value: string): string {
  // Keep alphanumerics, dashes, underscores; collapse anything else to '-'.
  const cleaned = value.replace(/[^a-z0-9_-]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return cleaned.length > 0 ? cleaned : 'unset'
}

/**
 * Save a file using whichever mechanism the platform supports best.
 *
 * On iOS Safari the Web Share API with files routes through the native
 * iOS share sheet — the user can save to Files, AirDrop, email, etc.
 * On desktop browsers and older mobile browsers we fall back to a Blob
 * URL + synthesised `<a download>` click which kicks off a normal save.
 */
export async function saveTextAsFile(
  content: string,
  filename: string,
  mimeType: string,
): Promise<void> {
  // Try Web Share API first if the browser supports sharing files.
  // canShare requires a File argument to verify the platform actually
  // supports file sharing (some browsers expose share() for text but
  // not files).
  if (typeof navigator !== 'undefined' && 'share' in navigator) {
    try {
      const file = new File([content], filename, { type: mimeType })
      // canShare may not exist; if it does, check it before calling share.
      const nav = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean
      }
      if (!nav.canShare || nav.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename })
        return
      }
    } catch (err) {
      // User-cancelled share is normal — fall through silently. Any other
      // error also drops to the download fallback below.
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.toLowerCase().includes('abort')) return
    }
  }

  // Fallback: build a Blob and trigger a download via an anchor tag.
  const blob = new Blob([content], { type: mimeType + ';charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  } finally {
    // Give the browser a moment to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
