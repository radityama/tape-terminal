/** Chart timestamps use a fixed simulated epoch, never the wall clock. */
export const SIM_EPOCH_SEC = Date.UTC(2026, 0, 5, 0, 0, 0) / 1000;
export const SIM_OPEN_SECONDS = 9.5 * 3600;

export function simMarketTimestamp(day: number, secondsOfDay: number): number {
  return SIM_EPOCH_SEC + (day - 1) * 86400 + Math.floor(secondsOfDay);
}

/** Daily bars are anchored to the simulated session open, matching generated history. */
export function simCandleBucket(timestamp: number, timeframeSec: number): number {
  if (timeframeSec === 86400) {
    return Math.floor((timestamp - SIM_OPEN_SECONDS) / 86400) * 86400 + SIM_OPEN_SECONDS;
  }
  return Math.floor(timestamp / timeframeSec) * timeframeSec;
}
