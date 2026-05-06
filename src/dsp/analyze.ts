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

/** Critical flags whose presence overrides the row's metric colour to red.
 *  A measurement that was clipped or has a non-linear decay is unreliable
 *  regardless of which T-metric was nominally reportable.
 *  (low-INR is implied by EDT-only or invalid metric, so isn't critical
 *  on its own.) */
export const CRITICAL_FLAGS: ReadonlyArray<ResultFlag> = [
  'clipped',
  'non-linear',
]

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
  /** Full regression result for the reported metric, kept so the plot can
   *  draw the line directly (slope/intercept) without re-fitting. Null
   *  for EDT-only and invalid where there's no T30/T20 line. */
  reportedRegression: RegressionResult | null

  /** EDT seconds (always computed). NaN if the EDC didn't reach -10 dB. */
  edtSeconds: number
  edtR2: number
  edtRegression: RegressionResult
  /** Inclusive sample range used for the EDT regression. */
  edtRange: [number, number]

  /** Energy-decay curve in dB relative to peak. */
  edcDb: Float32Array

  /** Noise RMS in dB below impulse peak amplitude. Negative; useful for
   *  understanding INR but NOT directly comparable to the EDC scale. */
  noiseFloorDb: number
  /** "Noise plateau" level in dB relative to the EDC peak. Computed as
   *  10*log10((noiseRms^2 * impulse_length) / total_impulse_energy) — the
   *  level the EDC would reach if the IR window contained only noise.
   *  Drawn as a horizontal line on the decay plot to show where the
   *  algorithm believes noise dominates. */
  noisePlateauDb: number

  /** All flags applicable to this band. */
  flags: ResultFlag[]
}

export interface AnalysisInput {
  impulse: Float32Array
  /** Post-decay background segment. Always used. */
  noise: Float32Array
  /** Optional pre-impulse background segment. When present, INR is
   *  computed against the WORSE (higher-RMS) of pre vs post per band, and
   *  bands whose pre/post differ by > BACKGROUND_DELTA_DB are flagged
   *  'background-changed'. */
  preNoise?: Float32Array
  sampleRate: number
  /** Whether the raw impulse recording hit ±1.0 anywhere; carried in to flag bands. */
  clipped: boolean
  /** Sample index within `impulse` where the trigger fired (i.e. how
   *  many samples of pre-trigger margin were prepended). Used only for
   *  display — the analysis itself doesn't depend on it. */
  triggerSampleIndex?: number
}

/** Decay-curve pipeline output that doesn't depend on band metadata.
 *  Both BandResult and OverallResult contain one of these. */
export interface DecayPipelineResult {
  sampleRate: number
  inrDb: number
  reportedMetric: ReportedMetric
  reportedRtSeconds: number
  reportedR2: number
  reportedRange: [number, number]
  reportedDbRange: [number, number]
  reportedRegression: RegressionResult | null
  edtSeconds: number
  edtR2: number
  edtRegression: RegressionResult
  edtRange: [number, number]
  edcDb: Float32Array
  noiseFloorDb: number
  noisePlateauDb: number
  flags: ResultFlag[]
}

/** Result for the unfiltered (broadband) impulse, shown as the default
 *  "Overall" view on the decay-curve display. Same shape as a BandResult
 *  but without band metadata. */
export type OverallResult = DecayPipelineResult

export interface AnalysisResult {
  sampleRate: number
  bands: BandResult[]
  /** Broadband (unfiltered) decay curve and metrics. Always computed. */
  overall: OverallResult
  /** Whether the original raw recording clipped (any band). */
  clipped: boolean
  /** Raw recorded impulse buffer (with pre-trigger margin) so the user
   *  can inspect the time-domain waveform for AGC pumping or clipping
   *  artefacts. Optional — measurements saved before this field was
   *  introduced won't have it. */
  rawImpulse?: Float32Array
  /** Sample index within rawImpulse where the trigger fired. */
  triggerSampleIndex?: number
}

export interface InrThresholds {
  t30: number
  t20: number
  edtOnly: number
}

/** Decision thresholds per the brief, exported so the UI/Settings can reference them. */
export const DEFAULT_INR_THRESHOLDS: InrThresholds = {
  t30: 35,
  t20: 25,
  edtOnly: 15,
}

export interface AnalyzeOptions {
  /** Override the default INR thresholds. Useful for the Settings view. */
  inrThresholds?: InrThresholds
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
  // Broadband ("Overall") analysis on the unfiltered signals. Default
  // view on the decay-curve display.
  const overall = analyseOverall(input, thresholds, r2Floor)
  return {
    sampleRate: input.sampleRate,
    bands: results,
    overall,
    clipped: input.clipped,
    // Keep a reference to the raw recording for the diagnostic waveform
    // display and (later) re-analysis with different settings. We don't
    // copy because the caller's buffer is captured-once and not mutated.
    rawImpulse: input.impulse,
    triggerSampleIndex: input.triggerSampleIndex,
  }
}

function analyseBand(
  input: AnalysisInput,
  band: Band,
  thresholds: InrThresholds,
  r2Floor: number,
): BandResult {
  // Design and apply the bandpass filter for this band.
  const sections = designButterworthBandpass(band.lower, band.upper, input.sampleRate)
  const filteredImpulse = applyBiquadCascade(input.impulse, sections)
  const filteredNoise = applyBiquadCascade(input.noise, sections)
  const filteredPreNoise = input.preNoise
    ? applyBiquadCascade(input.preNoise, sections)
    : null

  const pipeline = runDecayPipeline(
    filteredImpulse,
    filteredNoise,
    filteredPreNoise,
    input.sampleRate,
    input.clipped,
    thresholds,
    r2Floor,
  )
  if (band.uncertain) pipeline.flags.push('uncertain-freq')

  return { ...pipeline, band }
}

function analyseOverall(
  input: AnalysisInput,
  thresholds: InrThresholds,
  r2Floor: number,
): OverallResult {
  // No filtering — the broadband impulse and noise are used as-is. This
  // is the conventional "overall energy decay" view in acoustic software,
  // dominated by whatever frequency content the impulse source produced.
  return runDecayPipeline(
    input.impulse,
    input.noise,
    input.preNoise ?? null,
    input.sampleRate,
    input.clipped,
    thresholds,
    r2Floor,
  )
}

/**
 * Shared pipeline used by both per-band and broadband analysis. Takes
 * already-filtered (or unfiltered, for broadband) signals and produces
 * the EDC + INR + reported metric + flags. Band-specific concerns
 * (band metadata, uncertain-freq flag) are layered on by the caller.
 */
function runDecayPipeline(
  filteredImpulse: Float32Array,
  filteredNoise: Float32Array,
  filteredPreNoise: Float32Array | null,
  sampleRate: number,
  clipped: boolean,
  thresholds: InrThresholds,
  r2Floor: number,
): DecayPipelineResult {
  // 1) Energy-decay curve.
  const edcDb = schroederEdcDb(filteredImpulse)

  // 2) Noise floor and INR. When a pre-impulse background is supplied, take
  //    the louder of pre vs post — the impulse is only as detectable as the
  //    worst of the two backgrounds.
  const peak = peakAbs(filteredImpulse)
  const noiseRmsPost = rms(filteredNoise)
  const noiseRmsPre = filteredPreNoise ? rms(filteredPreNoise) : noiseRmsPost
  const noiseRmsEffective = Math.max(noiseRmsPre, noiseRmsPost)
  const inr = inrDb(peak, noiseRmsEffective)
  const noiseFloorDb =
    peak > 0 && noiseRmsEffective > 0 ? 20 * Math.log10(noiseRmsEffective / peak) : -Infinity

  // Noise plateau on the EDC scale: where the EDC would land if the IR
  // window contained only noise of this RMS. Drawn as the horizontal noise
  // line on the decay plot.
  let totalImpulseEnergy = 0
  for (let i = 0; i < filteredImpulse.length; i++) {
    const s = filteredImpulse[i]
    totalImpulseEnergy += s * s
  }
  const noiseEnergyOverWindow = noiseRmsEffective * noiseRmsEffective * filteredImpulse.length
  const noisePlateauDb =
    totalImpulseEnergy > 0 && noiseEnergyOverWindow > 0
      ? 10 * Math.log10(noiseEnergyOverWindow / totalImpulseEnergy)
      : -Infinity

  // Always compute EDT (0 to -10 dB).
  const edt = fitDecayRT(edcDb, sampleRate, 0, -10)

  // 3) Pick the reportable metric per the brief.
  let reportedMetric: ReportedMetric = 'invalid'
  let reportedRt = NaN
  let reportedR2 = NaN
  let reportedRange: [number, number] = [-1, -1]
  let reportedDbRange: [number, number] = [0, 0]
  let reportedRegression: RegressionResult | null = null

  if (inr >= thresholds.t30) {
    const fit = fitDecayRT(edcDb, sampleRate, -5, -35)
    reportedMetric = 'T30'
    reportedRt = fit.rtSeconds
    reportedR2 = fit.regression.r2
    reportedRange = [fit.sampleStart, fit.sampleEnd]
    reportedDbRange = [-5, -35]
    reportedRegression = fit.regression
  } else if (inr >= thresholds.t20) {
    const fit = fitDecayRT(edcDb, sampleRate, -5, -25)
    reportedMetric = 'T20'
    reportedRt = fit.rtSeconds
    reportedR2 = fit.regression.r2
    reportedRange = [fit.sampleStart, fit.sampleEnd]
    reportedDbRange = [-5, -25]
    reportedRegression = fit.regression
  } else if (inr >= thresholds.edtOnly) {
    reportedMetric = 'EDT-only'
    reportedRt = NaN
    reportedR2 = NaN
    reportedRange = [edt.sampleStart, edt.sampleEnd]
    reportedDbRange = [0, -10]
    reportedRegression = null
  } else {
    reportedMetric = 'invalid'
  }

  // 4) Flags. Band-specific flags (uncertain-freq) are added by callers.
  const flags: ResultFlag[] = []
  if (clipped) flags.push('clipped')
  if (reportedMetric === 'EDT-only') flags.push('low-INR')
  if (Number.isFinite(reportedR2) && reportedR2 < r2Floor) flags.push('non-linear')

  return {
    sampleRate,
    inrDb: inr,
    reportedMetric,
    reportedRtSeconds: reportedRt,
    reportedR2,
    reportedRange,
    reportedDbRange,
    reportedRegression,
    edtSeconds: edt.rtSeconds,
    edtR2: edt.regression.r2,
    edtRegression: edt.regression,
    edtRange: [edt.sampleStart, edt.sampleEnd],
    edcDb,
    noiseFloorDb,
    noisePlateauDb,
    flags,
  }
}
