// Analysis of the May 22 2026 NVC test set: iPhone 16 Pro Max vs Type 1
// SLM, simultaneous clapper impulses in a meeting room. iPhone reported
// clipping for all 5 takes; this script runs the SLM WAVs through the
// same DSP pipeline as the app and compares per-band T30 + EDT to the
// iPhone JSON, plus inspects the iPhone EDC shape near the peak to
// characterise the clipping behaviour.
//
// Run with:  npx tsx scripts/analyse-test-data.ts

import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeImpulseResponse } from '../src/dsp/analyze'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(__dirname, '../TEST DATA')

// ---- WAV parsing -------------------------------------------------------

interface WavData {
  sampleRate: number
  bitsPerSample: number
  numChannels: number
  samples: Float32Array
}

function parseWav(buf: Buffer): WavData {
  // Standard RIFF/WAVE header — assumes a single fmt chunk followed by
  // a single data chunk (the SLM exports this form).
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not RIFF')
  if (buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not WAVE')
  if (buf.toString('ascii', 12, 16) !== 'fmt ') throw new Error('expected fmt chunk')
  const fmtSize = buf.readUInt32LE(16)
  const format = buf.readUInt16LE(20)
  const numChannels = buf.readUInt16LE(22)
  const sampleRate = buf.readUInt32LE(24)
  const bitsPerSample = buf.readUInt16LE(34)
  if (format !== 1) throw new Error(`unsupported format ${format}`)

  // Find the data chunk (may not be at byte 36 if there are extra chunks).
  let pos = 20 + fmtSize
  while (pos < buf.length - 8) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'data') {
      const dataStart = pos + 8
      const dataEnd = dataStart + size
      const bytesPerSample = bitsPerSample / 8
      const frameSize = bytesPerSample * numChannels
      const numFrames = Math.floor(size / frameSize)
      const samples = new Float32Array(numFrames)
      // Read mono (or sum-mono if multi-channel) into Float32 [-1, +1].
      for (let f = 0; f < numFrames; f++) {
        let sum = 0
        for (let c = 0; c < numChannels; c++) {
          const off = dataStart + f * frameSize + c * bytesPerSample
          let v: number
          if (bitsPerSample === 16) {
            v = buf.readInt16LE(off) / 32768
          } else if (bitsPerSample === 24) {
            // 24-bit signed LE: assemble 3 bytes into a signed 24-bit.
            const b0 = buf.readUInt8(off)
            const b1 = buf.readUInt8(off + 1)
            const b2 = buf.readUInt8(off + 2)
            let int24 = (b2 << 16) | (b1 << 8) | b0
            if (int24 & 0x800000) int24 |= ~0xffffff // sign extend
            v = int24 / 8388608
          } else if (bitsPerSample === 32) {
            v = buf.readInt32LE(off) / 2147483648
          } else {
            throw new Error(`unsupported bitsPerSample ${bitsPerSample}`)
          }
          sum += v
        }
        samples[f] = sum / numChannels
      }
      return { sampleRate, bitsPerSample, numChannels, samples }
    }
    pos += 8 + size
  }
  throw new Error('no data chunk')
}

// ---- Impulse onset detection -------------------------------------------

/**
 * Find the impulse onset in a long recording: locate the global peak
 * abs(sample), then walk backward to where the signal first exceeds
 * 1% of that peak. That sample is treated as the trigger.
 */
function findImpulseOnset(samples: Float32Array): number {
  let peak = 0
  let peakIdx = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > peak) {
      peak = a
      peakIdx = i
    }
  }
  const threshold = peak * 0.01
  for (let i = peakIdx; i >= 0; i--) {
    if (Math.abs(samples[i]) < threshold) {
      return Math.min(samples.length - 1, i + 1)
    }
  }
  return 0
}

// ---- Per-WAV analysis --------------------------------------------------

interface WavAnalysis {
  filename: string
  sampleRate: number
  durationSec: number
  peakAmp: number
  triggerIdx: number
  impulse: Float32Array
  noise: Float32Array
  preNoise: Float32Array
  result: ReturnType<typeof analyzeImpulseResponse>
}

function analyseWav(filepath: string, filename: string): WavAnalysis {
  const buf = readFileSync(filepath)
  const wav = parseWav(buf)
  const sr = wav.sampleRate

  // Find onset, then carve segments.
  const trigger = findImpulseOnset(wav.samples)
  // Pre-trigger margin: 200 ms (matches the app).
  const preTrigger = Math.floor(0.2 * sr)
  // Decay window: 3 s (gives plenty of room for T30 at ~1 s RT60).
  const decay = Math.floor(3 * sr)
  // Background segments: 1 s before, 1 s at the end.
  const bg = Math.floor(1 * sr)

  const impulseStart = Math.max(0, trigger - preTrigger)
  const impulseEnd = Math.min(wav.samples.length, trigger + decay)
  const impulse = wav.samples.slice(impulseStart, impulseEnd)

  const noiseStart = Math.max(impulseEnd, wav.samples.length - bg)
  const noise = wav.samples.slice(noiseStart)
  const preNoise = wav.samples.slice(Math.max(0, impulseStart - bg), impulseStart)

  // Peak amplitude on the full recording (SLM should be well below 1.0).
  let peak = 0
  for (let i = 0; i < wav.samples.length; i++) {
    const a = Math.abs(wav.samples[i])
    if (a > peak) peak = a
  }

  const result = analyzeImpulseResponse({
    impulse,
    noise,
    preNoise,
    sampleRate: sr,
    clipped: peak >= 0.999, // virtually never for SLM
  })

  return {
    filename,
    sampleRate: sr,
    durationSec: wav.samples.length / sr,
    peakAmp: peak,
    triggerIdx: trigger,
    impulse,
    noise,
    preNoise,
    result,
  }
}

// ---- iPhone EDC clipping inspection ------------------------------------

interface ClipStats {
  centre: number
  firstSampleAtPeak: number      // sample index of EDC where it's 0 dB (peak)
  /** dB at sample 0 of the EDC — should be 0 by definition. */
  dbAtSample0: number
  /** How long the EDC stays within 0.5 dB of the peak — a sustained
   *  flat top here suggests the clipping is visible in the integrated
   *  decay, not just the raw waveform. */
  samplesFlatNearPeak: number
  msFlatNearPeak: number
  /** At what sample does the EDC drop below -5 dB? T30 fit starts here. */
  samplesTo_minus5dB: number
  msTo_minus5dB: number
}

function inspectIphoneEdc(edcDb: number[], sampleRate: number, centre: number): ClipStats {
  // EDC starts at 0 dB at index 0 (Schroeder normalisation).
  let i = 0
  while (i < edcDb.length && edcDb[i] > -0.5) i++
  const flatSamples = i
  let j = 0
  while (j < edcDb.length && edcDb[j] > -5) j++
  return {
    centre,
    firstSampleAtPeak: 0,
    dbAtSample0: edcDb[0],
    samplesFlatNearPeak: flatSamples,
    msFlatNearPeak: (flatSamples / sampleRate) * 1000,
    samplesTo_minus5dB: j,
    msTo_minus5dB: (j / sampleRate) * 1000,
  }
}

// ---- Main --------------------------------------------------------------

console.log('=== RT60 test-data comparison: iPhone 16 Pro Max vs Type 1 SLM ===\n')

const wavFiles = readdirSync(DATA_DIR)
  .filter((f) => /\.WAV$/i.test(f))
  .sort()
console.log(`Found ${wavFiles.length} SLM WAVs:`, wavFiles.join(', '))

const jsonPath = readdirSync(DATA_DIR).find((f) => /\.json$/i.test(f))!
const jsonData = JSON.parse(readFileSync(join(DATA_DIR, jsonPath), 'utf8'))
const phoneMeasurements = jsonData.measurements
console.log(`iPhone bundle: ${phoneMeasurements.length} measurements\n`)

// Order iPhone measurements by timestamp ascending so we can pair them
// with the WAVs in chronological order. The SLM WAV filenames R1815..1819
// are also in time order.
const phoneByTime = [...phoneMeasurements].sort((a, b) =>
  a.measurementTimestamp.localeCompare(b.measurementTimestamp),
)

// Bands we care about for the comparison — drop the uncertain ones at
// the extremes so we focus on where the phone mic is reliable.
const REPORT_BANDS = [125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000]

// ---- Per-WAV analysis + side-by-side table -----------------------------

const wavAnalyses: WavAnalysis[] = []
for (const f of wavFiles) {
  console.log(`\n--- SLM ${f} ---`)
  const a = analyseWav(join(DATA_DIR, f), f)
  wavAnalyses.push(a)
  console.log(`  duration=${a.durationSec.toFixed(2)}s  peak=${a.peakAmp.toFixed(3)}  trigger@sample=${a.triggerIdx} (${(a.triggerIdx / a.sampleRate).toFixed(3)}s)`)
  console.log(`  MFRT: ${a.result.overall.reportedMetric}, RT=${a.result.overall.reportedRtSeconds?.toFixed(3)}s, EDT=${a.result.overall.edtSeconds?.toFixed(3)}s`)
}

// ---- Side-by-side T30 comparison ---------------------------------------

console.log('\n\n=== T30 comparison: iPhone (clipped) vs SLM (clean) ===')
console.log('Bands shown: 125 Hz – 5 kHz (mid range where iPhone mic is reliable)\n')

console.log(
  'Band'.padEnd(7) +
  '|  iPhone average    SLM average     Δ (s)    Δ (%)'
)
console.log('-'.repeat(80))

const bandStats: Record<number, { phone: number[]; slm: number[] }> = {}
for (const c of REPORT_BANDS) bandStats[c] = { phone: [], slm: [] }

for (let i = 0; i < wavAnalyses.length; i++) {
  const wav = wavAnalyses[i]
  const phone = phoneByTime[i]
  if (!phone) continue
  for (const c of REPORT_BANDS) {
    const wavBand = wav.result.bands.find((b: any) => b.band.centre === c)
    const phoneBand = phone.bands.find((b: any) => b.band.centre === c)
    if (wavBand && Number.isFinite(wavBand.reportedRtSeconds)) {
      bandStats[c].slm.push(wavBand.reportedRtSeconds)
    }
    if (phoneBand && Number.isFinite(phoneBand.reportedRtSeconds)) {
      bandStats[c].phone.push(phoneBand.reportedRtSeconds)
    }
  }
}

function mean(arr: number[]): number {
  if (arr.length === 0) return NaN
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

for (const c of REPORT_BANDS) {
  const pm = mean(bandStats[c].phone)
  const sm = mean(bandStats[c].slm)
  const dd = pm - sm
  const dp = (dd / sm) * 100
  const fmt = (n: number, w = 6, dec = 3) =>
    Number.isFinite(n) ? n.toFixed(dec).padStart(w) : '   - '
  console.log(
    `${c.toString().padStart(5)} Hz| ${fmt(pm, 7).padEnd(18)}${fmt(sm, 7).padEnd(16)}${fmt(dd, 7).padEnd(10)}${fmt(dp, 6, 1).padEnd(6)}%`
  )
}

// Mid-band MFRT-style average (500 + 1000 Hz octaves).
const midOct500Centres = [400, 500, 630]
const midOct1000Centres = [800, 1000, 1250]
const midPhone: number[] = []
const midSlm: number[] = []
for (const c of [...midOct500Centres, ...midOct1000Centres]) {
  midPhone.push(...bandStats[c].phone)
  midSlm.push(...bandStats[c].slm)
}
console.log('-'.repeat(80))
console.log(`MFRT  | ${mean(midPhone).toFixed(3).padStart(7).padEnd(18)}${mean(midSlm).toFixed(3).padStart(7).padEnd(16)}${(mean(midPhone) - mean(midSlm)).toFixed(3).padStart(7).padEnd(10)}${((mean(midPhone) - mean(midSlm)) / mean(midSlm) * 100).toFixed(1).padStart(6)}%`)

// ---- EDT comparison ----------------------------------------------------

console.log('\n\n=== EDT comparison (where iPhone clipping IS expected to corrupt) ===')
console.log('Bands shown: 500 Hz, 1 kHz, 2 kHz (mid range)\n')

console.log(
  'Band'.padEnd(7) +
  '|  iPhone EDT       SLM EDT          Δ (s)    Δ (%)'
)
console.log('-'.repeat(80))

for (const c of [500, 1000, 2000]) {
  const phoneVals: number[] = []
  const slmVals: number[] = []
  for (let i = 0; i < wavAnalyses.length; i++) {
    const wav = wavAnalyses[i]
    const phone = phoneByTime[i]
    const wavBand = wav.result.bands.find((b: any) => b.band.centre === c)
    const phoneBand = phone?.bands.find((b: any) => b.band.centre === c)
    if (wavBand && Number.isFinite(wavBand.edtSeconds)) slmVals.push(wavBand.edtSeconds)
    if (phoneBand && Number.isFinite(phoneBand.edtSeconds)) phoneVals.push(phoneBand.edtSeconds)
  }
  const pm = mean(phoneVals)
  const sm = mean(slmVals)
  const dd = pm - sm
  const dp = (dd / sm) * 100
  const fmt = (n: number, w = 6, dec = 3) =>
    Number.isFinite(n) ? n.toFixed(dec).padStart(w) : '   - '
  console.log(
    `${c.toString().padStart(5)} Hz| ${fmt(pm, 7).padEnd(18)}${fmt(sm, 7).padEnd(16)}${fmt(dd, 7).padEnd(10)}${fmt(dp, 6, 1).padEnd(6)}%`
  )
}

// ---- iPhone EDC clipping characterisation ------------------------------

console.log('\n\n=== iPhone clipping characterisation (per-band, first measurement) ===')
console.log('How long the EDC stays within 0.5 dB of peak, and how long until it drops below -5 dB (T30 start point).\n')

const firstPhone = phoneByTime[0]
console.log(
  'Band'.padEnd(8) +
  '| samples flat | ms flat | samples to -5 dB | ms to -5 dB'
)
console.log('-'.repeat(75))
for (const c of [125, 250, 500, 1000, 2000, 4000]) {
  const band = firstPhone.bands.find((b: any) => b.band.centre === c)
  if (!band) continue
  const stats = inspectIphoneEdc(band.edcDb, firstPhone.sampleRate, c)
  console.log(
    `${c.toString().padStart(5)} Hz | ${stats.samplesFlatNearPeak.toString().padStart(12)} | ${stats.msFlatNearPeak.toFixed(2).padStart(7)} | ${stats.samplesTo_minus5dB.toString().padStart(16)} | ${stats.msTo_minus5dB.toFixed(2).padStart(11)}`
  )
}
