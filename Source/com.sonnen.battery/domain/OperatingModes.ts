/**
 * Operating modes as defined in driver.settings.compose.json ("operating_mode" dropdown).
 * The battery's EM_OperatingMode can report values outside this list (e.g. other
 * firmware modes); writing them into the dropdown setting would make Homey reject
 * the whole settings object with "Invalid Value: operating_mode".
 *
 * Kept in the domain layer so it can be unit-tested without the Homey SDK.
 */
export const KNOWN_OPERATING_MODES = ['1', '2', '6', '10', '11'] as const;

/** The Time-of-Use operating mode. */
export const MODE_TIME_OF_USE = '10';

export type OperatingModeSyncAction = 'sync' | 'skip-unchanged' | 'unknown';

/**
 * Decide how to reconcile a battery-reported operating mode with the
 * "operating_mode" settings dropdown:
 * - 'sync': the dropdown must be updated to the reported mode
 * - 'skip-unchanged': the dropdown already matches (or nothing was reported)
 * - 'unknown': the battery reports a mode outside the dropdown; leave the
 *   setting alone (writing it would make Homey reject the settings object)
 */
export function resolveOperatingModeSyncAction(
  reportedMode: string | null,
  storedMode: string | undefined,
  knownModes: readonly string[] = KNOWN_OPERATING_MODES,
): OperatingModeSyncAction {
  if (reportedMode === null) {
    return 'skip-unchanged';
  }
  if (!knownModes.includes(reportedMode)) {
    return 'unknown';
  }
  return storedMode === reportedMode ? 'skip-unchanged' : 'sync';
}

/**
 * Decide whether a user-initiated operating mode change must be written to the
 * battery. A programmatic sync (onSettings re-entered from a polling setSettings)
 * must not echo the value back: it equals the mode the battery itself reported last.
 */
export function shouldWriteOperatingModeToBattery(
  newMode: string,
  lastReportedMode: string | null,
): boolean {
  return lastReportedMode === null || newMode !== lastReportedMode;
}
