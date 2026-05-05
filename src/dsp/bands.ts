// Third-octave band definitions per IEC 61260, base-10 system.
//
// The base-10 third-octave system places centre frequencies at
//   f_n = 1000 * 10^(n/10)
// for integer n. The band edges are
//   f_lower = f_centre / 10^(1/20)  (one sixth-octave below centre)
//   f_upper = f_centre * 10^(1/20)  (one sixth-octave above centre)
// giving a band width of one third-octave (10^(1/10) ratio).
//
// We define exactly the 24 bands listed in the project brief, from 50 Hz
// to 10 kHz inclusive. Centre frequencies are the rounded "preferred"
// values everyone uses in practice (e.g. 1250 Hz for the 10^(1/10)*1000
// ratio = 1258.9 Hz exact). For filter design we use the rounded values
// because (a) they match what is shown to the user, and (b) the third-
// octave bandwidth is wide enough that a few-percent shift is irrelevant.

export interface Band {
  /** Preferred (rounded) centre frequency in Hz. */
  centre: number
  /** Lower -3 dB edge in Hz, computed as centre / 10^(1/20). */
  lower: number
  /** Upper -3 dB edge in Hz, computed as centre * 10^(1/20). */
  upper: number
  /** Phone microphone response is unreliable in the bottom and top of the
   *  audible range. The brief asks us to flag bands 50–100 Hz and
   *  6.3–10 kHz as "uncertain — phone mic response" with an estimated
   *  +/- 20% error bound on the result. */
  uncertain: boolean
}

const PREFERRED_CENTRES_HZ = [
  50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
  1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000,
]

const SIXTH_OCTAVE_RATIO = Math.pow(10, 1 / 20) // ≈ 1.122

function isUncertainCentre(c: number): boolean {
  return c <= 100 || c >= 6300
}

export const BANDS: ReadonlyArray<Band> = PREFERRED_CENTRES_HZ.map((c) => ({
  centre: c,
  lower: c / SIXTH_OCTAVE_RATIO,
  upper: c * SIXTH_OCTAVE_RATIO,
  uncertain: isUncertainCentre(c),
}))

/** Look up a band by its preferred centre frequency. */
export function bandByCentre(centre: number): Band | undefined {
  return BANDS.find((b) => b.centre === centre)
}
