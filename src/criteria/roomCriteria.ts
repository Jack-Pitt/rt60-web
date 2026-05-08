// Room-use design criteria for the comparison plot.
//
// Each entry maps a room type to an "ideal" RT range PLUS a wider
// "acceptable" range, so the plot overlay can show three zones:
//   - inside the ideal band -> on-target (pale green)
//   - between ideal and acceptable -> ok but not ideal (pale amber)
//   - outside the acceptable band -> bad (no overlay; lines stand out)
//
// Values are loosely aligned with AS/NZS 2107:2016 mid-frequency
// targets and recalibrated based on field experience — slightly wider
// than the prior version since real working rooms typically run
// somewhat above the textbook target without being problematic.

export interface CriteriaBand {
  lower: number
  upper: number
}

export interface RoomCriteriaResult {
  /** Tight target — measurement clearly meets the design spec. */
  ideal: CriteriaBand
  /** Wider band — measurement is acceptable but not optimal. */
  acceptable: CriteriaBand
  /** Optional caveat shown beside the plot. */
  warning?: string
}

export interface RoomCriteria {
  id: string
  label: string
  description?: string
  rangeFor(volumeM3: number): RoomCriteriaResult | null
}

/** Build a result from a target, ideal-tolerance, and acceptable-tolerance. */
function bandsFromTarget(
  target: number,
  idealTol: number,
  acceptableTol: number,
): { ideal: CriteriaBand; acceptable: CriteriaBand } {
  return {
    ideal: { lower: target * (1 - idealTol), upper: target * (1 + idealTol) },
    acceptable: {
      lower: target * (1 - acceptableTol),
      upper: target * (1 + acceptableTol),
    },
  }
}

/** Speech-priority rooms — modest log-volume scaling on the target. */
function speechRange(
  baseT: number,
  scale: number,
  idealTol: number,
  acceptableTol: number,
  typical: { min: number; max: number },
) {
  return (volumeM3: number): RoomCriteriaResult | null => {
    if (!Number.isFinite(volumeM3) || volumeM3 < 1) return null
    const T = baseT + scale * Math.log10(Math.max(50, volumeM3) / 50)
    const out = bandsFromTarget(T, idealTol, acceptableTol)
    let warning: string | undefined
    if (volumeM3 < typical.min || volumeM3 > typical.max) {
      warning = `Outside the typical volume range for this use (${typical.min}–${typical.max} m³). Range is extrapolated; consider a different category.`
    }
    return { ...out, warning }
  }
}

/** Use-driven targets that don't depend much on volume. Pass an explicit
 *  ideal and acceptable band per use. */
function fixedRange(
  ideal: CriteriaBand,
  acceptable: CriteriaBand,
  typical: { min: number; max: number },
) {
  return (volumeM3: number): RoomCriteriaResult | null => {
    if (!Number.isFinite(volumeM3) || volumeM3 < 1) return null
    const warning =
      volumeM3 < typical.min || volumeM3 > typical.max
        ? `Outside the typical volume range for this use (${typical.min}–${typical.max} m³).`
        : undefined
    return { ideal, acceptable, warning }
  }
}

/** Curated room-use list. Targets are mid-frequency-averaged (T_mid =
 *  500 Hz + 1 kHz octaves per ISO 3382 / AS/NZS 2107 conventions). */
export const ROOM_CRITERIA: RoomCriteria[] = [
  // ---- Office ----
  {
    id: 'office-private',
    label: 'Office — private',
    description: 'AS/NZS 2107 typical target ≈ 0.5 s mid-band.',
    // Target ~0.5 s, scales mildly. ±20% ideal, ±50% acceptable —
    // generous enough to accept rooms running slightly hot.
    rangeFor: speechRange(0.50, 0.05, 0.20, 0.50, { min: 30, max: 250 }),
  },
  {
    id: 'office-open',
    label: 'Office — open plan',
    description: 'Larger spaces shift the target up modestly.',
    rangeFor: speechRange(0.55, 0.10, 0.20, 0.50, { min: 100, max: 2000 }),
  },

  // ---- Speech-priority general ----
  {
    id: 'meeting',
    label: 'Meeting / conference / boardroom',
    description: 'AS/NZS 2107 typical target ≈ 0.5 s.',
    rangeFor: speechRange(0.50, 0.10, 0.20, 0.50, { min: 30, max: 400 }),
  },
  {
    id: 'classroom',
    label: 'Classroom / lecture theatre',
    description:
      'Smaller classrooms target ≈ 0.5 s; lecture theatres scale up to ≈ 0.8–1.0 s.',
    rangeFor: speechRange(0.50, 0.20, 0.20, 0.50, { min: 100, max: 5000 }),
  },
  {
    id: 'restaurant',
    label: 'Restaurant / café',
    description: 'Wide tolerance; depends on style and ambience.',
    rangeFor: speechRange(0.75, 0.15, 0.25, 0.55, { min: 100, max: 2000 }),
  },
  {
    id: 'reception',
    label: 'Reception / lobby',
    rangeFor: speechRange(0.70, 0.20, 0.25, 0.55, { min: 100, max: 3000 }),
  },

  // ---- Critical listening ----
  {
    id: 'listening-room',
    label: 'Listening room',
    description:
      'ITU-R BS.1116-3 / AES TD1001 — critical listening: ≈ 0.3 s.',
    rangeFor: fixedRange(
      { lower: 0.25, upper: 0.40 }, // ideal
      { lower: 0.20, upper: 0.50 }, // acceptable
      { min: 50, max: 300 },
    ),
  },
  {
    id: 'studio-recording',
    label: 'Recording studio (live room)',
    description: 'Live rooms vary; control rooms run shorter still.',
    rangeFor: fixedRange(
      { lower: 0.20, upper: 0.45 },
      { lower: 0.15, upper: 0.60 },
      { min: 30, max: 200 },
    ),
  },

  // ---- Auditoria ----
  {
    id: 'auditorium-speech',
    label: 'Auditorium — speech',
    rangeFor: speechRange(0.95, 0.20, 0.20, 0.40, { min: 500, max: 5000 }),
  },
  {
    id: 'auditorium-music',
    label: 'Auditorium — music / concert hall',
    description: 'Wide range; depends on repertoire (orchestral vs chamber).',
    rangeFor: fixedRange(
      { lower: 1.50, upper: 2.20 },
      { lower: 1.20, upper: 2.60 },
      { min: 1000, max: 30000 },
    ),
  },

  // ---- Sport / leisure / large hard-surfaced ----
  {
    id: 'sport-pool',
    label: 'Sports hall / gym / pool',
    description:
      'Combined category — large hard-surfaced spaces. RT inherent to volume.',
    rangeFor: fixedRange(
      { lower: 1.40, upper: 2.20 },
      { lower: 1.00, upper: 2.80 },
      { min: 500, max: 15000 },
    ),
  },
]

export function findCriteria(id: string): RoomCriteria | undefined {
  return ROOM_CRITERIA.find((c) => c.id === id)
}
