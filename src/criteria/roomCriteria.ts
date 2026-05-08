// Room-use design criteria for the comparison plot.
//
// Each entry maps a room type to a recommended RT range as a function
// of room volume. Values are loosely aligned with AS/NZS 2107:2016
// "Recommended Design Sound Levels and Reverberation Times for Building
// Interiors" — the reference standard for the Australasian market.
//
// Treat these as starting points rather than dispositive: AS/NZS 2107
// gives mid-frequency-averaged targets, allows looser tolerance at the
// frequency extremes, and varies with usage detail. The plot overlay
// drawn from these values is a quick "in the ballpark" check, not a
// compliance verdict.

export interface RoomCriteriaResult {
  /** Lower RT bound for the use + volume combination, in seconds. */
  lower: number
  /** Upper RT bound, in seconds. */
  upper: number
  /** Optional caveat shown beside the plot, e.g. when the volume
   *  is outside the standard's typical range for this use. */
  warning?: string
}

export interface RoomCriteria {
  /** Stable id for option keys. */
  id: string
  /** Label shown in the dropdown. */
  label: string
  /** Optional one-line description shown below the inputs. */
  description?: string
  /** Returns the recommended RT range for the given volume in m³.
   *  May return null when the inputs are not enough to compute a
   *  range (e.g. volume not yet entered). */
  rangeFor(volumeM3: number): RoomCriteriaResult | null
}

/** Convenience builder for use cases where the target T scales modestly
 *  with log-volume (most speech rooms). Returns a target plus ±tolerance. */
function speechRange(
  baseT: number,
  scale: number,
  toleranceFraction: number,
  typical: { min: number; max: number },
) {
  return (volumeM3: number): RoomCriteriaResult | null => {
    if (!Number.isFinite(volumeM3) || volumeM3 < 1) return null
    const T = baseT + scale * Math.log10(Math.max(50, volumeM3) / 50)
    const lower = T * (1 - toleranceFraction)
    const upper = T * (1 + toleranceFraction)
    let warning: string | undefined
    if (volumeM3 < typical.min || volumeM3 > typical.max) {
      warning = `Outside the typical volume range for this use (${typical.min}–${typical.max} m³). Range is extrapolated; consider a different category.`
    }
    return { lower, upper, warning }
  }
}

/** For uses where the target is roughly fixed regardless of volume
 *  (recording studios, swimming pools, gyms — driven by use, not size). */
function fixedRange(
  lower: number,
  upper: number,
  typical: { min: number; max: number },
) {
  return (volumeM3: number): RoomCriteriaResult | null => {
    if (!Number.isFinite(volumeM3) || volumeM3 < 1) return null
    const warning =
      volumeM3 < typical.min || volumeM3 > typical.max
        ? `Outside the typical volume range for this use (${typical.min}–${typical.max} m³).`
        : undefined
    return { lower, upper, warning }
  }
}

/** Curated list of common building uses with associated RT criteria.
 *  Targets are mid-frequency-averaged; the standards allow looser
 *  tolerances at the frequency extremes which we don't model here. */
export const ROOM_CRITERIA: RoomCriteria[] = [
  // ---- Speech-priority spaces ----
  {
    id: 'office-private',
    label: 'Office — private',
    description: 'AS/NZS 2107 typical target ≈ 0.4 s mid-band.',
    rangeFor: speechRange(0.40, 0.10, 0.15, { min: 30, max: 200 }),
  },
  {
    id: 'office-open',
    label: 'Office — open plan',
    description: 'Larger spaces shift the target up modestly.',
    rangeFor: speechRange(0.50, 0.10, 0.20, { min: 100, max: 2000 }),
  },
  {
    id: 'meeting',
    label: 'Meeting / conference room',
    description: 'AS/NZS 2107 typical target ≈ 0.5 s mid-band.',
    rangeFor: speechRange(0.45, 0.10, 0.15, { min: 40, max: 300 }),
  },
  {
    id: 'boardroom',
    label: 'Boardroom',
    rangeFor: speechRange(0.45, 0.10, 0.15, { min: 50, max: 400 }),
  },
  {
    id: 'classroom-primary',
    label: 'Classroom — primary',
    description: 'AS/NZS 2107 / ANSI S12.60 ≈ 0.4–0.5 s.',
    rangeFor: speechRange(0.40, 0.05, 0.15, { min: 100, max: 300 }),
  },
  {
    id: 'classroom-secondary',
    label: 'Classroom — secondary / tertiary',
    rangeFor: speechRange(0.45, 0.08, 0.15, { min: 100, max: 500 }),
  },
  {
    id: 'lecture-theatre',
    label: 'Lecture theatre',
    description: 'Target scales notably with volume.',
    rangeFor: speechRange(0.55, 0.20, 0.20, { min: 200, max: 5000 }),
  },
  {
    id: 'library-study',
    label: 'Library — study area',
    rangeFor: speechRange(0.60, 0.10, 0.20, { min: 100, max: 2000 }),
  },
  {
    id: 'restaurant',
    label: 'Restaurant / café',
    description: 'Wide tolerance; depends on style and use.',
    rangeFor: speechRange(0.70, 0.15, 0.25, { min: 100, max: 2000 }),
  },
  {
    id: 'reception',
    label: 'Reception / lobby',
    rangeFor: speechRange(0.65, 0.20, 0.25, { min: 100, max: 3000 }),
  },

  // ---- Music-priority spaces ----
  {
    id: 'music-rehearsal',
    label: 'Music rehearsal room',
    description: 'Higher RT preferred for ensemble work.',
    rangeFor: speechRange(0.85, 0.10, 0.20, { min: 100, max: 500 }),
  },
  {
    id: 'studio-recording',
    label: 'Recording studio (live room)',
    description: 'Live rooms vary; control rooms run shorter still.',
    rangeFor: fixedRange(0.20, 0.40, { min: 30, max: 200 }),
  },
  {
    id: 'auditorium-speech',
    label: 'Auditorium — speech',
    rangeFor: speechRange(0.90, 0.20, 0.20, { min: 500, max: 5000 }),
  },
  {
    id: 'auditorium-music',
    label: 'Auditorium — music / concert hall',
    description: 'Wide range; depends on repertoire (orchestral vs chamber).',
    rangeFor: fixedRange(1.50, 2.20, { min: 1000, max: 30000 }),
  },

  // ---- Sport / leisure ----
  {
    id: 'gymnasium',
    label: 'Gymnasium / sports hall',
    description: 'High RT inherent to large hard-surfaced spaces.',
    rangeFor: fixedRange(1.50, 2.20, { min: 1000, max: 15000 }),
  },
  {
    id: 'swimming-pool',
    label: 'Swimming pool enclosure',
    rangeFor: fixedRange(1.50, 2.00, { min: 1000, max: 10000 }),
  },
]

/** Look up a criteria entry by id. */
export function findCriteria(id: string): RoomCriteria | undefined {
  return ROOM_CRITERIA.find((c) => c.id === id)
}
