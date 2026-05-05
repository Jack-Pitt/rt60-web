// Biquad filters and Butterworth bandpass design.
//
// A "biquad" is a 2nd-order IIR filter section described by 5 coefficients:
//   y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
// We always normalise so a0 = 1.
//
// To get a 6th-order bandpass we cascade THREE biquads — the brief asks
// for this so each third-octave band rejects neighbours by enough to keep
// energy from leaking between bands.
//
// Filter design:
//   1. Pre-warp the requested band edges so the bilinear transform gives
//      the right cutoff in the discrete world.
//   2. Build the 3rd-order analogue Butterworth lowpass prototype: poles
//      at angles spread evenly on the left half of the unit circle.
//   3. Apply the standard lowpass-to-bandpass mapping
//        s_LP -> (s_BP^2 + omega0^2) / (BW * s_BP)
//      which doubles the order from 3 to 6 — each LP pole becomes a
//      conjugate pair of BP poles, which we group into a biquad section.
//   4. Bilinear-transform each analogue biquad into the discrete-time
//      coefficients we use at runtime.
//   5. Scale the cascade so the overall gain at the band centre is 1.
//
// All maths is in pure functions so it can be unit-tested without any
// audio context.

/** Discrete-time biquad coefficients (a0 normalised to 1). */
export interface BiquadCoeffs {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

// --- Stateful runtime filter ----------------------------------------------

/**
 * Run a cascade of biquads over a sample buffer, in-place stable Direct
 * Form II Transposed implementation. Transposed form is preferred because
 * it has better numerical stability for fixed-coefficient floating-point
 * filters than Direct Form I or II.
 */
export function applyBiquadCascade(
  input: Float32Array,
  sections: ReadonlyArray<BiquadCoeffs>,
): Float32Array {
  // Two state variables per section. We keep them across the whole input.
  const z1 = new Float64Array(sections.length)
  const z2 = new Float64Array(sections.length)
  const out = new Float32Array(input.length)

  for (let n = 0; n < input.length; n++) {
    // Cascade: feed each section's output into the next.
    let x = input[n]
    for (let s = 0; s < sections.length; s++) {
      const { b0, b1, b2, a1, a2 } = sections[s]
      const y = b0 * x + z1[s]
      z1[s] = b1 * x - a1 * y + z2[s]
      z2[s] = b2 * x - a2 * y
      x = y
    }
    out[n] = x
  }
  return out
}

// --- Butterworth bandpass design -----------------------------------------

/**
 * Design a 6th-order Butterworth bandpass as 3 cascaded biquads.
 *
 * @param fLow      Lower -3 dB frequency in Hz (e.g. band lower edge)
 * @param fHigh     Upper -3 dB frequency in Hz (e.g. band upper edge)
 * @param sampleRate Sample rate in Hz (e.g. 48000)
 * @returns 3 biquad sections; the cascade has unity gain at the band centre.
 */
export function designButterworthBandpass(
  fLow: number,
  fHigh: number,
  sampleRate: number,
): BiquadCoeffs[] {
  const N = 3 // order of LP prototype; bandpass order = 2N = 6

  // Step 1: Pre-warp. The bilinear transform maps the analog frequency
  // axis to the digital one nonlinearly; pre-warping with tan() corrects
  // the cutoff frequencies so they land where we want post-transform.
  const Fs = sampleRate
  const omegaLow = 2 * Fs * Math.tan((Math.PI * fLow) / Fs)
  const omegaHigh = 2 * Fs * Math.tan((Math.PI * fHigh) / Fs)
  const omega0 = Math.sqrt(omegaLow * omegaHigh) // analog geometric centre
  const BW = omegaHigh - omegaLow                // analog bandwidth
  const omega0Sq = omega0 * omega0

  // Step 2 + 3: build the LP prototype poles, then map each to bandpass
  // pole pairs. We only need to enumerate poles in the upper half plane
  // (and any real pole) — the lower-half conjugates produce conjugate
  // BP poles which we'll pair up to form real-coefficient biquads.
  const sections: BiquadCoeffs[] = []

  for (let k = 1; k <= N; k++) {
    // Standard analog Butterworth LP pole on the unit circle in the LHP.
    const theta = ((2 * k - 1) * Math.PI) / (2 * N)
    const lpRe = -Math.sin(theta)
    const lpIm = Math.cos(theta)

    if (Math.abs(lpIm) < 1e-12) {
      // Real LP pole (e.g. for N=3 the middle pole at -1). The LP-to-BP
      // map gives a quadratic in s_BP whose two roots are a conjugate
      // pair — that's one biquad on its own.
      const aRe = lpRe * BW
      const D = aRe * aRe - 4 * omega0Sq // discriminant; negative for narrow BW
      // For our use case D is always negative (narrow third-octave band
      // relative to centre), so the roots are (aRe ± j*sqrt(-D)) / 2.
      const qRe = aRe / 2
      const qIm = D >= 0 ? Math.sqrt(D) / 2 : Math.sqrt(-D) / 2
      sections.push(buildBpBiquad(qRe, qIm, Fs))
    } else if (lpIm > 0) {
      // Complex LP pole in the upper half plane. Solve the BP quadratic
      //   s_BP^2 - (lp * BW) * s_BP + omega0^2 = 0
      // Two complex roots q1, q2; each one's conjugate comes from the
      // lower-half LP pole, so each q_i forms one biquad with its
      // conjugate (which we represent by the (qRe, |qIm|) pair).
      const bRe = -lpRe * BW
      const bIm = -lpIm * BW
      // Discriminant = b^2 - 4c, with c = omega0^2 (real). Compute as complex.
      const discRe = bRe * bRe - bIm * bIm - 4 * omega0Sq
      const discIm = 2 * bRe * bIm
      // Complex sqrt: sqrt(p + jq) = sqrt((|p+jq|+p)/2) + j*sign(q)*sqrt((|p+jq|-p)/2)
      const mag = Math.hypot(discRe, discIm)
      const sqrtRe = Math.sqrt(Math.max(0, (mag + discRe) / 2))
      const sqrtIm =
        (discIm >= 0 ? 1 : -1) * Math.sqrt(Math.max(0, (mag - discRe) / 2))
      // Two roots: q = (-b ± sqrt(disc)) / 2
      const negBRe = lpRe * BW
      const negBIm = lpIm * BW
      const q1Re = (negBRe + sqrtRe) / 2
      const q1Im = (negBIm + sqrtIm) / 2
      const q2Re = (negBRe - sqrtRe) / 2
      const q2Im = (negBIm - sqrtIm) / 2
      // Each root and its conjugate (from the LHP partner LP pole) form a
      // biquad; we use |im| because conjugating just flips sign.
      sections.push(buildBpBiquad(q1Re, Math.abs(q1Im), Fs))
      sections.push(buildBpBiquad(q2Re, Math.abs(q2Im), Fs))
    }
    // Lower-half (lpIm < 0) is the conjugate of the upper-half pole already
    // handled above — skip to avoid double-counting.
  }

  // Step 5: normalise the cascade so the gain at the (digital) centre
  // frequency is exactly 1. The Butterworth LP prototype + LP-to-BP +
  // bilinear chain doesn't promise this on its own.
  // Digital centre (warped back from analog omega0):
  const fCentreDigital = Math.sqrt(fLow * fHigh)
  const cascadeGainAtCentre = magnitudeAt(sections, fCentreDigital, Fs)
  if (cascadeGainAtCentre > 0) {
    // Spread the inverse gain evenly across all sections so each section
    // contributes the same amount of the normalisation. Equivalent to
    // dividing one section's b coefficients by the full gain.
    const scale = Math.pow(1 / cascadeGainAtCentre, 1 / sections.length)
    for (const s of sections) {
      s.b0 *= scale
      s.b1 *= scale
      s.b2 *= scale
    }
  }
  return sections
}

/**
 * Build a single discrete biquad from one analog conjugate-pole pair (q, q*).
 *
 * The analog section is
 *   H(s) = s / (s^2 + g*s + h)
 * with g = -2*Re(q), h = |q|^2. The bandpass numerator factor of `s`
 * gives one zero at DC (analog s=0 -> digital z=1) and one at infinity
 * (analog s=infty -> digital z=-1), so the digital numerator becomes
 * z^2 - 1, i.e. b0=1, b1=0, b2=-1 before scaling.
 */
function buildBpBiquad(qRe: number, qIm: number, Fs: number): BiquadCoeffs {
  const g = -2 * qRe
  const h = qRe * qRe + qIm * qIm
  const K = 2 * Fs                  // bilinear transform pre-factor
  const a0 = K * K + g * K + h
  return {
    b0: K / a0,                     // numerator scaled by K (from the lone `s` factor)
    b1: 0,
    b2: -K / a0,
    a1: (2 * h - 2 * K * K) / a0,
    a2: (K * K - g * K + h) / a0,
  }
}

/**
 * Magnitude response of a biquad cascade at a given frequency.
 * Used both for design-time gain normalisation and for tests.
 */
export function magnitudeAt(
  sections: ReadonlyArray<BiquadCoeffs>,
  freqHz: number,
  sampleRate: number,
): number {
  const w = (2 * Math.PI * freqHz) / sampleRate
  // z = e^{jw}. Compute H(z) for one biquad, then multiply across cascade.
  // H(z) = (b0 + b1*z^-1 + b2*z^-2) / (1 + a1*z^-1 + a2*z^-2)
  // Split into real and imag parts using e^{-jw} = cos(w) - j*sin(w).
  const c1 = Math.cos(w)
  const s1 = Math.sin(w)
  const c2 = Math.cos(2 * w)
  const s2 = Math.sin(2 * w)

  let mag = 1
  for (const sec of sections) {
    const numRe = sec.b0 + sec.b1 * c1 + sec.b2 * c2
    const numIm = -sec.b1 * s1 - sec.b2 * s2
    const denRe = 1 + sec.a1 * c1 + sec.a2 * c2
    const denIm = -sec.a1 * s1 - sec.a2 * s2
    const numMag = Math.hypot(numRe, numIm)
    const denMag = Math.hypot(denRe, denIm)
    mag *= denMag === 0 ? 0 : numMag / denMag
  }
  return mag
}
