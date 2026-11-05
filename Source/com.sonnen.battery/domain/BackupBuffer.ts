/**
 * Backup buffer (EM_USOC) helpers.
 *
 * The backup buffer is the state of charge the battery will not discharge
 * below during normal operation: it discharges down to the buffer but never
 * below it. It is read from and written to
 * /api/v2/configurations as the "EM_USOC" key (a string-encoded integer).
 *
 * Valid values per the sonnen API ("WritableConfigurations" in openapi.json):
 * - 0: disable the backup buffer
 * - 5-100: backup buffer percentage capacity range
 * Values 1-4 are rejected by the battery with "Invalid value for EM_USOC".
 *
 * Kept in the domain layer so it can be unit-tested without the Homey SDK.
 */
export const BACKUP_BUFFER_DISABLED = 0;
export const BACKUP_BUFFER_MIN_PERCENT = 5;
export const BACKUP_BUFFER_MAX_PERCENT = 100;

/**
 * Whether a value is acceptable for EM_USOC: 0 (disabled) or an integer
 * percentage between 5 and 100.
 */
export function isValidBackupBuffer(percent: number): boolean {
  if (!Number.isInteger(percent)) {
    return false;
  }
  return percent === BACKUP_BUFFER_DISABLED
    || (percent >= BACKUP_BUFFER_MIN_PERCENT && percent <= BACKUP_BUFFER_MAX_PERCENT);
}

/**
 * Parse a battery-reported EM_USOC value (string or number) into an integer.
 * Returns null when the value is absent or not numeric, so callers can keep
 * the last known value instead of writing garbage into the capability.
 */
export function parseBackupBuffer(raw: unknown): number | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const parsed = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Decide whether a user-initiated backup buffer change must be written to the
 * battery. A programmatic sync (onSettings re-entered from a polling
 * setSettings) must not echo the value back: it equals the value the battery
 * itself reported last.
 */
export function shouldWriteBackupBufferToBattery(
  newValue: number,
  lastReportedValue: number | null,
): boolean {
  return lastReportedValue === null || newValue !== lastReportedValue;
}
