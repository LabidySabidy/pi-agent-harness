/**
 * pricing.ts — DeepSeek peak / off-peak billing model.
 *
 * WHY THIS EXISTS:
 * DeepSeek bills a peak rate and an off-peak rate that is exactly HALF of it
 * ("Off-peak rates are half of the peak rates" — api-docs.deepseek.com/quick_start/pricing).
 * The catalog record's `cost` block stores the PEAK figure, and the peak figure is
 * the BASE rate — off-peak is a discount, not the other way round. So the catalog is
 * correct and must NOT be restated; the error was that nothing applied the discount.
 *
 * Peak hours: 01:00-04:00 and 06:00-10:00 UTC, Monday through Friday.
 * All other hours are off-peak. (Six hours a day, weekdays only.)
 *
 * Applied per RECORD timestamp, not per session: a session can span peak and
 * off-peak, and averaging it into one bucket reintroduces the error this fixes.
 */

/** Peak windows as [startHour, endHour) in UTC. */
export const PEAK_WINDOWS_UTC: ReadonlyArray<readonly [number, number]> = [
  [1, 4],
  [6, 10],
];

/** Off-peak is billed at this fraction of the peak (catalog) rate. */
export const OFF_PEAK_MULTIPLIER = 0.5;

/**
 * True when `ts` falls inside a peak window: 01:00-04:00 or 06:00-10:00 UTC,
 * Monday-Friday. Every other instant is off-peak.
 */
export function isPeak(ts: string | number | Date): boolean {
  const d = ts instanceof Date ? ts : new Date(ts);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return true; // unknown time -> assume peak (the higher, conservative rate)

  const dow = d.getUTCDay(); // 0 = Sunday, 6 = Saturday
  if (dow === 0 || dow === 6) return false;

  const hour = d.getUTCHours();
  return PEAK_WINDOWS_UTC.some(([start, end]) => hour >= start && hour < end);
}

/**
 * Billing multiplier for an instant. Peak = 1 (the catalog rate), off-peak = 0.5.
 */
export function rateMultiplier(ts: string | number | Date): number {
  return isPeak(ts) ? 1 : OFF_PEAK_MULTIPLIER;
}

/**
 * Split a session's recorded cost into peak and off-peak portions.
 *
 * `perRecordCosts` are the incremental costs observed at known timestamps. Cost is
 * accumulated per record because that is the only granularity at which the
 * timestamp is known; a session-level total has no single time.
 */
export interface RepricedRecords {
  /** Cost at the peak (catalog) rate, as recorded. */
  recorded: number;
  /** Peak portion of `recorded`. */
  peak: number;
  /** Off-peak portion of `recorded` (before the discount). */
  offPeakRecorded: number;
  /** The spend estimate: peak at full rate, off-peak at half. */
  adjusted: number;
  /** Share of recorded cost that fell in off-peak hours (0-1). */
  offPeakShare: number;
}

/**
 * Split a session's recorded cost into peak and off-peak portions and apply the
 * off-peak discount.
 *
 * `perRecordCosts` are the incremental costs observed at known timestamps. Cost is
 * accumulated per record because that is the only granularity at which the
 * timestamp is known; a session-level total has no single time.
 */
export function repriceRecords(
  records: ReadonlyArray<{ ts: string; cost: number }>,
): RepricedRecords {
  let peak = 0;
  let offPeakRecorded = 0;
  for (const r of records) {
    if (!(r.cost > 0)) continue;
    if (isPeak(r.ts)) peak += r.cost;
    else offPeakRecorded += r.cost;
  }
  const recorded = peak + offPeakRecorded;
  const adjusted = peak + offPeakRecorded * OFF_PEAK_MULTIPLIER;
  return {
    recorded,
    peak,
    offPeakRecorded,
    adjusted,
    offPeakShare: recorded > 0 ? offPeakRecorded / recorded : 0,
  };
}
