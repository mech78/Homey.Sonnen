import { LocalizedError } from './LocalizedError';
import { PowerLimits, TargetPowerLimits } from './TargetPowerLimits';

/**
 * Values supported by the Homey `target_power_mode` capability.
 *
 * `homey` is Homey's reserved value for "Homey is in control". The device-side
 * values intentionally mirror the sonnenBatterie operating modes that are
 * relevant for power management, so the capability doubles as a standardized
 * representation of the battery's operating mode.
 */
export type TargetPowerModeValue = 'homey' | 'self_consumption' | 'time_of_use';

/**
 * Direction of a sonnenBatterie setpoint command.
 */
export type SetpointDirection = 'charge' | 'discharge';

/**
 * sonnenBatterie `EM_OperatingMode` values used by this feature:
 * 1 = Manual (carrier mode for Homey-controlled setpoints),
 * 2 = Self consumption, 10 = Time-of-Use.
 */
const MODE_TO_OPERATING_MODE: Record<Exclude<TargetPowerModeValue, 'homey'>, string> = {
  self_consumption: '2',
  time_of_use: '10',
};

const OPERATING_MODE_TO_MODE: Record<string, TargetPowerModeValue> = {
  '1': 'homey',
  '2': 'self_consumption',
  '10': 'time_of_use',
};

/**
 * A concrete setpoint command for the sonnenBatterie API.
 */
export interface SetpointCommand {
  direction: SetpointDirection;
  watts: number;
}

/**
 * The actions a control transition requires. The device layer applies these
 * sequentially to the sonnenBatterie API; the planning itself is pure logic.
 */
export interface ControlActions {
  /** True when manual standby must be disabled before anything else. */
  disableStandby: boolean;
  /** True when manual standby must be enabled (idle request). */
  enableStandby: boolean;
  /** `EM_OperatingMode` to switch to, or null when the mode is unchanged. */
  operatingMode: string | null;
  /** Setpoint to apply, or null when no setpoint is needed (e.g. idle). */
  setpoint: SetpointCommand | null;
}

export interface PlanPowerControlInput {
  /** The new `target_power_mode` capability value. */
  requestedMode: TargetPowerModeValue;
  /** The previous `target_power_mode` capability value, or null when unknown. */
  previousMode: TargetPowerModeValue | null;
  /** The new `target_power` value in watts, or null when only the mode changed. */
  requestedPower: number | null;
  /** The previously stored `target_power` value in watts, or null when unknown. */
  currentPower: number | null;
  /** Whether manual standby is currently active on the battery. */
  standbyActive: boolean;
}

/**
 * A capability change received by the combined `target_power` /
 * `target_power_mode` listener. Fields are null when the capability was not
 * part of the change.
 */
export interface CapabilityChangeRequest {
  /** Newly written `target_power` value in watts, or null when unchanged. */
  targetPower: number | null;
  /** Newly written `target_power_mode` value, or null when unchanged. */
  targetPowerMode: TargetPowerModeValue | null;
}

/**
 * The capability/battery state a capability change is planned against.
 */
export interface CapabilityChangeState {
  /** Current `target_power_mode` capability value, or null when unknown. */
  currentMode: TargetPowerModeValue | null;
  /** Current stored `target_power` capability value in watts, or null when unknown. */
  currentPower: number | null;
  /** Whether manual standby is currently active on the battery. */
  standbyActive: boolean;
  /** Device power limits used to clamp the effective power. */
  limits: PowerLimits;
}

/**
 * The result of planning a capability change: the actions to apply to the
 * battery plus the bookkeeping the device needs to keep the stored capability
 * state honest.
 */
export interface CapabilityChangePlan {
  /** The effective requested mode after applying Homey's implied mode switch. */
  requestedMode: TargetPowerModeValue;
  /** Actions to apply to the battery. */
  actions: ControlActions;
  /**
   * Clamped power to write back to the `target_power` capability so the stored
   * value matches what was actually applied, or null when nothing was clamped.
   */
  writeBackPower: number | null;
  /**
   * True when Homey control was left and the stored target power must be
   * reset to 0 so a later re-entry starts from idle instead of re-applying a
   * stale setpoint.
   */
  resetTargetPower: boolean;
}

/**
 * Pure mapping/decision logic for the Homey `target_power` / `target_power_mode`
 * capabilities against the sonnenBatterie operating modes and setpoint API.
 */
export class TargetPowerMode {

  /**
   * Maps a `target_power_mode` value to the sonnenBatterie `EM_OperatingMode`.
   * `homey` maps to Manual (1), the only mode in which the battery holds a
   * setpoint without an expiry timer.
   */
  public static toOperatingMode(mode: TargetPowerModeValue): string {
    if (mode === 'homey') {
      return '1';
    }
    const operatingMode = MODE_TO_OPERATING_MODE[mode];
    if (operatingMode === undefined) {
      throw new LocalizedError('error.validation.invalid_target_power_mode', { mode });
    }
    return operatingMode;
  }

  /**
   * Maps a sonnenBatterie `EM_OperatingMode` back to a `target_power_mode`
   * value, or null when the operating mode has no capability representation
   * (e.g. mode 6 "Module extension"). Used to sync the capability with
   * externally changed modes.
   */
  public static fromOperatingMode(operatingMode: string): TargetPowerModeValue | null {
    return OPERATING_MODE_TO_MODE[String(operatingMode)] ?? null;
  }

  /**
   * Validates that a power value is a whole non-negative number of watts,
   * matching the battery's setpoint API constraints (negative or fractional
   * values are rejected with "invalid argument").
   */
  public static isValidTargetPower(watts: number): boolean {
    return Number.isInteger(watts) && watts >= 0;
  }

  /**
   * Decomposes a signed `target_power` value into a setpoint command.
   * Positive values charge, negative values discharge, zero means idle
   * (no setpoint — manual standby is used instead).
   */
  public static decomposeTargetPower(watts: number): SetpointCommand | null {
    if (!this.isValidTargetPower(Math.abs(watts))) {
      throw new LocalizedError('error.validation.invalid_setpoint_power', { power: String(watts) });
    }
    if (watts > 0) {
      return { direction: 'charge', watts };
    }
    if (watts < 0) {
      return { direction: 'discharge', watts: Math.abs(watts) };
    }
    return null;
  }

  /**
   * Plans the actions required for a `target_power` / `target_power_mode`
   * capability change. Pure function — the device layer applies the returned
   * actions in order: disableStandby → operatingMode → enableStandby/setpoint.
   */
  public static planPowerControl(input: PlanPowerControlInput): ControlActions {
    const power = input.requestedPower ?? input.currentPower ?? 0;
    if (!this.isValidTargetPower(Math.abs(power))) {
      throw new LocalizedError('error.validation.invalid_setpoint_power', { power: String(power) });
    }

    const modeChanged = input.requestedMode !== input.previousMode;

    if (input.requestedMode !== 'homey') {
      return {
        disableStandby: input.standbyActive,
        enableStandby: false,
        operatingMode: modeChanged ? this.toOperatingMode(input.requestedMode) : null,
        setpoint: null,
      };
    }

    // Homey in control: Manual mode carries the setpoint (no expiry timer).
    // Idle (0 W) is implemented via persistent manual standby instead of a
    // transient 0 W setpoint.
    if (power === 0) {
      return {
        disableStandby: false,
        enableStandby: !input.standbyActive,
        operatingMode: modeChanged ? '1' : null,
        setpoint: null,
      };
    }

    return {
      disableStandby: input.standbyActive,
      enableStandby: false,
      operatingMode: modeChanged ? '1' : null,
      setpoint: this.decomposeTargetPower(power),
    };
  }

  /**
   * Plans a combined `target_power` / `target_power_mode` capability change.
   *
   * Homey Energy semantics: writing `target_power` hands control to Homey
   * (implied mode switch to `homey`) unless `target_power_mode` is written in
   * the same change. The plan also carries the bookkeeping the device needs
   * for honest capability state: the clamped power to write back when the
   * requested value exceeded the device limits, and the reset of the stored
   * target power when Homey control is left.
   */
  public static planCapabilityChange(request: CapabilityChangeRequest, state: CapabilityChangeState): CapabilityChangePlan {
    const requestedMode = request.targetPowerMode
      ?? (request.targetPower !== null ? 'homey' : state.currentMode ?? 'self_consumption');
    const previousMode = state.currentMode;

    const effectivePower = request.targetPower ?? state.currentPower;
    let writeBackPower: number | null = null;
    let power: number | null = null;
    if (effectivePower !== null) {
      const clamped = TargetPowerLimits.clampTargetPower(effectivePower, state.limits);
      power = clamped.value;
      if (clamped.clamped) {
        writeBackPower = clamped.value;
      }
    }

    const actions = this.planPowerControl({
      requestedMode,
      previousMode,
      requestedPower: power,
      currentPower: null,
      standbyActive: state.standbyActive,
    });

    return {
      requestedMode,
      actions,
      writeBackPower,
      resetTargetPower: previousMode === 'homey' && requestedMode !== 'homey' && request.targetPower === null,
    };
  }
}
