// Top-level RT60 analysis pipeline.
//
// Inputs (from the recording flow):
//   - impulse: the captured impulse response (after the auto-detected
//              trigger, including a small pre-trigger margin) for the
//              full decay duration.
//   - noise:   the post-decay background segment, used to estimate the
//              noise floor for each band.
//   - sampleRate: actual hardware sample rate.
//
// For every third-octave band (50 Hz – 10 kHz) we:
//   1) Bandpass-filter the impulse and the noise with a 6th-order
//      Butterworth (3 cascaded biquads) designed for the actual sample
//      rate.
//   2) Compute the Schroeder energy-decay curve (EDC) of the impulse, in
//      dB relative to peak.
//   3) Compute INR — peak filtered-impulse amplitude vs RMS of the
//      filtered noise — and pick which RT metric is reportable per the
//      brief's decision logic.
//   4) Fit a regression line to the appropriate dB range and read off
//      RT (extrapolated to a 60 dB drop). Always also fit EDT (0 to -10).
//   5) Flag the result with the appropriate caveats.

import { type Band, BANDS } from './bands'
import {
  applyBiquadCascade,
  designButterworthBandpass,
} from './biquad'
import { schroederEdcDb } from './schroeder'
import { fitDecayRT, type RegressionResult } from './regression'
import { inrDb, peakAbs, rms } from './noise'

export type ReportedMetric = 'T30' | 'T20' | 'EDT-only' | 'invalid'

export type ResultFlag =
  | 'clipped'
  | 'non-linear'
  | 'uncertain-freq'
  | 'low-INR'

export interface BandResult {
  band: Band
  /** Sample rate the analysis was performed at, repeated per band for export convenience. */
  sampleRate: number

  /** dB INR (impulse peak vs noise RMS in this band). */
  inrDb: number

  /** Which metric we report for this band per the decision logic. */
  reportedMetric: ReportedMetric
  /** RT seconds for the reported metric (T30 / T20 / NaN if EDT-only / invalid). */
  reportedRtSeconds: number
  /** R-squared of the regression that produced reportedRtSeconds (NaN for invalid). */
  reportedR2: number
  /** Inclusive sample range used for the reported regression, [start, end]. */
  reportedRange: [number, number]
  /** dB endpoints of the reported regression range, e.g. [-5, -25]. */
  reportedDbRange: [number, number]

  /** EDT seconds (always computed). NaN if the EDC didn't reach -10 dB. */
  edtSeconds: number
  edtR2: number
  edtRegression: RegressionResult
  /** Inclusive sample range used for the EDT regression. */
  edtRange: [number, number]

  /** Energy-decay curve in dB relative to peak. */
  edcDb: Float32Array

  /** Noise floor in dB relative to the impulse peak amplitude (negative). */
  noiseFloorDb: number

  /** All flags applicable to this band. */
  flags: ResultFlag[]
}

export interface AnalysisInput {
  impulse: Float32Array
  noise: Float32Array
  sampleRate: number
  /** Whether the raw impulse recording hit ±1.0 anywhere; carried in to flag bands. */
  clipped: boolean
}

export interface AnalysisResult {
  sampleRate: number
  bands: BandResult[]
  /** Whether the original raw recording clipped (any band). */
  clipped: boolean
}

/** Decision thresholds per the brief, exported so the UI/Settings can reference them. */
export const DEFAULT_INR_THRESHOLDS = {
  t30: 35,
  t20: 25,
  edtOnly: 15,
} as const

export interface AnalyzeOptions {
  /** Override the default INR thresholds. Useful for the Settings view. */
  inrThresholds?: typeof DEFAULT_INR_THRESHOLDS
  /** Subset of bands to analyse. Defaults to every band in BANDS. */
  bands?: ReadonlyArray<Band>
  /** R^2 below which we set the non-linear flag. */
  nonLinearR2Threshold?: number
}

export function analyzeImpulseResponse(
  input: AnalysisInput,
  options: AnalyzeOptions = {},
): AnalysisResult {
  const thresholds = options.inrThresholds ?? DEFAULT_INR_THRESHOLDS
  const bands = options.bands ?? BANDS
  const r2Floor = options.nonLinearR2Threshold ?? 0.95

  const results: BandResult[] = []
  for (const band of bands) {
    results.push(analyseBand(input, band, thresholds, r2Floor))
  }
  return {
    sampleRate: input.sampleRate,
    bands: results,
    clipped: input.clipped,
  }
}

function analyseBand(
  input: AnalysisInput,
  band: Band,
  thresholds: typeof DEFAULT_INR_THRESHOLDS,
  r2Floor: number,
): BandResult {
  // 1) Design and apply the bandpass filter.
  const sections = designButterworthBandpass(band.lower, band.upper, input.sampleRate)
  const filteredImpulse = applyBiquadCascade(input.impulse, sections)
  const filteredNoise = applyBiquadCascade(input.noise, sections)

  // 2) Energy-decay curve.
  const edcDb = schroederEdcDb(filteredImpulse)

  // 3) Noise floor and INR.
  const peak = peakAbs(filteredImpulse)
  const noiseRms = rms(filteredNoise)
  const inr = inrDb(peak, noiseRms)
  const noiseFloorDb = peak > 0 && noiseRms > 0 ? 20 * Math.log10(noiseRms / peak) : -Infinity

  // Always compute EDT (0 to -10 dB).
  const edt = fitDecayRT(edcDb, input.sampleRate, 0, -10)

  // 4) Pick the reportable metric per the brief.
  let reportedMetric: ReportedMetric = 'invalid'
  let reportedRt = NaN
  let reportedR2 = NaN
  let reportedRange: [number, number] = [-1, -1]
  let reportedDbRange: [number, number] = [0, 0]

  if (inr >= thresholds.t30) {
    const fit = fitDecayRT(edcDb, input.sampleRate, -5, -35)
    reportedMetric = 'T30'
    reportedRt = fit.rtSeconds
    reportedR2 = fit.regression.r2
    reportedRange = [fit.sampleStart, fit.sampleEnd]
    reportedDbRange = [-5, -35]
  } else if (inr >= thresholds.t20) {
    const fit = fitDecayRT(edcDb, input.sampleRate, -5, -25)
    reportedMetric = 'T20'
    reportedRt = fit.rtSeconds
    reportedR2 = fit.regression.r2
    reportedRange = [fit.sampleStart, fit.sampleEnd]
    reportedDbRange = [-5, -25]
  } else if (inr >= thresholds.edtOnly) {
    reportedMetric = 'EDT-only'
    reportedRt = NaN
    reportedR2 = NaN
    reportedRange = [edt.sampleStart, edt.sampleEnd]
    reportedDbRange = [0, -10]
  } else {
    reportedMetric = 'invalid'
  }

  // 5) Flags.
  const flags: ResultFlag[] = []
  if (input.clipped) flags.push('clipped')
  if (band.uncertain) flags.push('uncertain-freq')
  if (reportedMetric === 'EDT-only') flags.push('low-INR')
  if (Number.isFinite(reportedR2) && reportedR2 < r2Floor) flags.push('non-linear')

  return {
    band,
    sampleRate: input.sampleRate,
    inrDb: inr,
    reportedMetric,
    reportedRtSeconds: reportedRt,
    reportedR2,
    reportedRange,
    reportedDbRange,
    edtSeconds: edt.rtSeconds,
    edtR2: edt.regression.r2,
    edtRegression: edt.regression,
    edtRange: [edt.sampleStart, edt.sampleEnd],
    edcDb,
    noiseFloorDb,
    flags,
  }
}
