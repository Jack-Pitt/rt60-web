// Schroeder backward integration.
//
// Given the squared (= instantaneous power) impulse response of a band,
// the energy decay curve (EDC) at time t is the integral of power from
// t to infinity:
//
//   EDC(t) = integral over [t, infinity] of p^2(tau) dtau
//
// In a discrete signal we sum from the last sample backwards, building
// up a cumulative sum from the right. Then we convert to dB relative to
// the maximum value (which lives at t=0 because the integral is the
// largest there) so the decay is easy to read on a log axis.
//
// Reasoning behind the trick: a single recorded impulse response is one
// noisy realisation of the room. Squaring it and summing left-to-right
// is just energy. But Schroeder showed that summing right-to-left from
// the *end* of the IR back to time t gives the ensemble average of the
// energy decay — which is what we actually want when we talk about RT60.
// It also smooths the curve hugely without adding any phase distortion.

/**
 * Compute the Schroeder energy-decay curve in dB, normalised so the peak
 * is 0 dB.
 *
 * @param signal The bandpass-filtered impulse response samples.
 * @returns Float32Array of the same length where each element is dB
 *          relative to the start-of-decay energy. The first sample is
 *          always 0 dB; subsequent samples are negative.
 */
export function schroederEdcDb(signal: Float32Array): Float32Array {
  const n = signal.length
  const cumulative = new Float64Array(n)

  // 1) Square the signal (instantaneous power) and integrate backwards.
  //    cumulative[i] = sum from k=i to n-1 of signal[k]^2
  let acc = 0
  for (let i = n - 1; i >= 0; i--) {
    const s = signal[i]
    acc += s * s
    cumulative[i] = acc
  }

  // 2) Convert to dB relative to the start (peak of the decay).
  //    Avoid log10(0) by clamping.
  const peak = cumulative[0]
  const out = new Float32Array(n)
  if (peak <= 0) {
    out.fill(-Infinity)
    return out
  }
  const FLOOR_DB = -200
  const minRatio = Math.pow(10, FLOOR_DB / 10) // ratio below which we clamp
  for (let i = 0; i < n; i++) {
    const ratio = cumulative[i] / peak
    out[i] = ratio > minRatio ? 10 * Math.log10(ratio) : FLOOR_DB
  }
  return out
}
