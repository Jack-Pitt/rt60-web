// Noise floor and INR estimation per band.

/** RMS amplitude of a signal: sqrt(mean(x^2)). */
export function rms(signal: ArrayLike<number>): number {
  if (signal.length === 0) return 0
  let sumSq = 0
  for (let i = 0; i < signal.length; i++) {
    const s = signal[i]
    sumSq += s * s
  }
  return Math.sqrt(sumSq / signal.length)
}

/** Peak absolute amplitude of a signal: max(|x|). */
export function peakAbs(signal: ArrayLike<number>): number {
  let p = 0
  for (let i = 0; i < signal.length; i++) {
    const a = Math.abs(signal[i])
    if (a > p) p = a
  }
  return p
}

/**
 * Impulse-to-noise ratio in dB.
 *
 * impulsePeakAmp is the peak |sample| of the bandpass-filtered impulse
 * response. noiseRmsAmp is the RMS amplitude of the bandpass-filtered
 * post-decay background noise. INR is 20*log10(peak/RMS), expressed as
 * a positive number when the impulse is above the noise.
 *
 * Returns -Infinity if either input is zero (avoid log(0)).
 */
export function inrDb(impulsePeakAmp: number, noiseRmsAmp: number): number {
  if (impulsePeakAmp <= 0 || noiseRmsAmp <= 0) return -Infinity
  return 20 * Math.log10(impulsePeakAmp / noiseRmsAmp)
}
