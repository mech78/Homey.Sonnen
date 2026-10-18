/**
 * AC power limits of a sonnenBatterie, used to clamp `target_power` values.
 *
 * The battery silently accepts (and ignores) setpoints beyond its physical
 * limits, so the app must clamp itself to give flows and EMS apps honest
 * feedback about the applied power.
 */
export interface PowerLimits {
  /** Maximum AC charging power in watts (positive `target_power` values). */
  charge: number;
  /** Maximum AC discharging power in watts (absolute value for negative targets). */
  discharge: number;
  /** Where the limits came from (for diagnostics/logging). */
  source: 'site' | 'inverter' | 'default';
}

/**
 * Subset of the `GET /api/v2/site/limits` response relevant for power clamping.
 * Only present on newer hybrid/AC-coupled system generations; older systems
 * return an empty object.
 */
export interface SiteLimitsResponse {
  p_bess_inv_max_import_limit?: number | string | null;
  p_bess_inv_max_export_limit?: number | string | null;
  [key: string]: unknown;
}

/**
 * Pure clamping logic for `target_power` against device-specific limits.
 *
 * Limit source priority (per direction):
 * 1. `site/limits` → `p_bess_inv_max_import_limit` (charge) /
 *    `p_bess_inv_max_export_limit` (discharge)
 * 2. `IC_InverterMaxPower_w` from configurations (both directions)
 * 3. safe default (the app-wide family bound)
 */
export class TargetPowerLimits {

  /** Fallback limit matching the app-wide 0–46000 W convention. */
  public static readonly DEFAULT_LIMIT_W = 46000;

  public static resolve(siteLimits: SiteLimitsResponse | null, inverterMaxPowerW: number | string | null): PowerLimits {
    const hasSiteLimits = siteLimits !== null && siteLimits !== undefined && Object.keys(siteLimits).length > 0;
    const siteCharge = hasSiteLimits ? this.toPositiveNumber(siteLimits!.p_bess_inv_max_import_limit) : null;
    const siteDischarge = hasSiteLimits ? this.toPositiveNumber(siteLimits!.p_bess_inv_max_export_limit) : null;
    const inverterLimit = this.toPositiveNumber(inverterMaxPowerW);

    const charge = siteCharge ?? inverterLimit ?? this.DEFAULT_LIMIT_W;
    const discharge = siteDischarge ?? inverterLimit ?? this.DEFAULT_LIMIT_W;

    const source: PowerLimits['source'] = siteCharge !== null || siteDischarge !== null
      ? 'site'
      : inverterLimit !== null
        ? 'inverter'
        : 'default';

    return { charge, discharge, source };
  }

  /**
   * Clamps a signed `target_power` value to the device limits.
   * `0` never enters the clamp path (idle is handled via standby, not setpoints).
   *
   * @returns the clamped value and whether it was modified (for logging).
   */
  public static clampTargetPower(watts: number, limits: PowerLimits): { value: number; clamped: boolean } {
    if (watts > 0) {
      const value = Math.min(watts, limits.charge);
      return { value, clamped: value !== watts };
    }
    if (watts < 0) {
      const value = Math.max(watts, -limits.discharge);
      return { value, clamped: value !== watts };
    }
    return { value: watts, clamped: false };
  }

  private static toPositiveNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return null;
  }
}
