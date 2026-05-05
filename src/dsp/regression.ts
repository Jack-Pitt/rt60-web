// Linear least-squares regression of y vs x with R-squared.
//
// We use this to fit a straight line to the energy decay curve in dB
// over a chosen range (e.g. -5 dB to -25 dB for T20). The slope of that
// line tells us the decay rate; multiplying by -60 / slope (and dividing
// by the corresponding decade range) gives RT60.
//
// R-squared (the coefficient of determination) tells us how linear the
// fit was — values near 1 mean the decay was straight, lower values
// flag a curved or noisy decay that the user should inspect by eye.

export interface RegressionResult {
  /** Slope in y-units per x-unit. For our use, dB per second. */
  slope: number
  /** y-intercept in y-units. */
  intercept: number
  /** Coefficient of determination, 0..1. 1 = perfect line, 0 = no fit. */
  r2: number
  /** Number of points actually used in the fit. */
  n: number
}

/**
 * Fit y = slope*x + intercept by ordinary least squares.
 * Both arrays must be the same length. NaN/Infinity points are dropped.
 */
export function linearRegression(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
): RegressionResult {
  if (x.length !== y.length) {
    throw new Error(`x and y must be same length (got ${x.length} vs ${y.length})`)
  }
  // First pass: count valid points and compute sums.
  let n = 0
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]
    const yi = y[i]
    if (!Number.isFinite(xi) || !Number.isFinite(yi)) continue
    n++
    sumX += xi
    sumY += yi
    sumXY += xi * yi
    sumXX += xi * xi
  }
  if (n < 2) {
    return { slope: NaN, intercept: NaN, r2: NaN, n }
  }
  const meanX = sumX / n
  const meanY = sumY / n
  const denom = sumXX - n * meanX * meanX
  if (denom === 0) {
    // All x identical -> can't fit a line.
    return { slope: NaN, intercept: NaN, r2: NaN, n }
  }
  const slope = (sumXY - n * meanX * meanY) / denom
  const intercept = meanY - slope * meanX

  // R^2 = 1 - SSres/SStot
  let ssRes = 0
  let ssTot = 0
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]
    const yi = y[i]
    if (!Number.isFinite(xi) || !Number.isFinite(yi)) continue
    const predicted = slope * xi + intercept
    ssRes += (yi - predicted) ** 2
    ssTot += (yi - meanY) ** 2
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot
  return { slope, intercept, r2, n }
}

/**
 * Fit a line to the portion of an EDC between two dB levels and convert
 * the slope to a reverberation time normalised to a 60 dB decay.
 *
 * For T30: pass dbStart = -5, dbEnd = -35. The straight-line fit is
 * extrapolated to a 60 dB drop, so the returned RT is 60 / |slope|
 * (slope in dB/s).
 *
 * Returns { rtSeconds, regression, sampleStart, sampleEnd } so the UI can
 * draw the regression line and the dB markers on the decay plot.
 */
export interface RtFitResult {
  rtSeconds: number
  regression: RegressionResult
  /** Inclusive sample index of the first sample used in the fit. */
  sampleStart: number
  /** Inclusive sample index of the last sample used in the fit. */
  sampleEnd: number
}

export function fitDecayRT(
  edcDb: Float32Array,
  sampleRate: number,
  dbStart: number,
  dbEnd: number,
): RtFitResult {
  if (dbStart >= dbEnd && dbEnd >= dbStart) {
    // dbStart should be the upper bound (less negative), dbEnd the lower.
  }
  // Find first sample where EDC <= dbStart (the start of the regression
  // window) and the first sample after that where EDC <= dbEnd.
  let sampleStart = -1
  let sampleEnd = -1
  for (let i = 0; i < edcDb.length; i++) {
    if (sampleStart < 0 && edcDb[i] <= dbStart) sampleStart = i
    if (sampleStart >= 0 && edcDb[i] <= dbEnd) {
      sampleEnd = i
      break
    }
  }
  if (sampleStart < 0 || sampleEnd < 0 || sampleEnd <= sampleStart) {
    return {
      rtSeconds: NaN,
      regression: { slope: NaN, intercept: NaN, r2: NaN, n: 0 },
      sampleStart,
      sampleEnd,
    }
  }
  const span = sampleEnd - sampleStart + 1
  const x = new Float64Array(span)
  const y = new Float64Array(span)
  for (let i = 0; i < span; i++) {
    x[i] = (sampleStart + i) / sampleRate
    y[i] = edcDb[sampleStart + i]
  }
  const reg = linearRegression(x, y)
  // Slope is dB/s, must be negative for a real decay. RT60 extrapolates to
  // a 60 dB drop: time to drop 60 dB = 60 / |slope|.
  const rtSeconds = reg.slope < 0 ? 60 / -reg.slope : NaN
  return { rtSeconds, regression: reg, sampleStart, sampleEnd }
}
