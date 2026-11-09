import { LocalizedError } from './LocalizedError';
import { PowerLimits, TargetPowerLimits } from './TargetPowerLimits';

/**
 * Values supported by the Homey `target_power_mode` capability.
 *
 * `homey` is Homey's reserved value for "an EMS (Homey Energy / EMS apps) is
 * in control". The device-side values mirror the sonnenBatterie operating
 * modes one-to-one, so the capability doubles as a standardized
 * representation of the battery's operating mode.
 *
 * `homey` and `manual` both map to battery operating mode 1 (Manual): the
 * difference is purely who is expected to write setpoints — an EMS for
 * `homey`, the sonnen app for `manual`.
 */
export type TargetPowerModeValue = 'homey' | 'manual' | 'self_consumption' | 'module_extension' | 'time_of_use' | 'optimization';

/**
 * Direction of a sonnenBatterie setpoint command.
 */
export type SetpointDirection = 'charge' | 'discharge';

/**
 * sonnenBatterie `EM_OperatingMode` values used by this feature:
 * 1 = Manual (carrier mode for setpoints, held by both `homey` and `manual`),
 * 2 = Self consumption, 6 = Module extension (30%), 10 = Time-of-Use,
 * 11 = Automatic - Optimization.
 */
const MODE_TO_OPERATING_MODE: Record<Exclude<TargetPowerModeValue, 'homey'>, string> = {
  manual: '1',
  self_consumption: '2',
  module_extension: '6',
  time_of_use: '10',
  optimization: '11',
};

const OPERATING_MODE_TO_MODE: Record<string, TargetPowerModeValue> = {
  '1': 'manual',
  '2': 'self_consumption',
  '6': 'module_extension',
  '10': 'time_of_use',
  '11': 'optimization',
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
  /** `EM_OperatingMode` to switch to, or null when the mode is unchanged. */
  operatingMode: string | null;
  /**
   * Setpoint to apply (a 0 W charge setpoint stops power), or null when no
   * setpoint is needed (e.g. a mode-only change).
   */
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
   * Maps a sonnenBatterie `EM_OperatingMode` back to the device-side
   * `target_power_mode` value, or null when the operating mode has no
   * capability representation. Mode 1 (Manual) maps to `manual`, the
   * device-side carrier; `homey` is Homey-side state and is never derived
   * from the battery. Use {@link resolveExternalMode} for polling syncs,
   * which must keep an established `homey`/`manual` state sticky.
   */
  public static fromOperatingMode(operatingMode: string): TargetPowerModeValue | null {
    return OPERATING_MODE_TO_MODE[String(operatingMode)] ?? null;
  }

  /**
   * Resolves the `target_power_mode` value for an operating mode read from
   * the battery (polling sync), given the current capability state.
   *
   * Battery mode 1 (Manual) is ambiguous: both `homey` and `manual` are its
   * carriers. The rule is sticky:
   * - current state `homey` or `manual` → keep it (Homey control implies
   *   battery mode 1; a user-chosen `manual` must survive polling)
   * - any other current state → the battery was switched to Manual
   *   externally (e.g. via the sonnen app), so Homey is not in control
   *
   * All other operating modes map directly; unknown modes yield null and the
   * caller must leave the capability unchanged.
   */
  public static resolveExternalMode(operatingMode: string, currentState: TargetPowerModeValue | null): TargetPowerModeValue | null {
    const mode = String(operatingMode);
    if (mode === '1' && (currentState === 'homey' || currentState === 'manual')) {
      return currentState;
    }
    return OPERATING_MODE_TO_MODE[mode] ?? null;
  }

  /**
   * Decomposes a signed `target_power` value into a setpoint command.
   * Positive values charge, negative values discharge; zero yields null here —
   * idle is planned as an explicit 0 W stop setpoint (see {@link planPowerControl}).
   *
   * Values reaching this layer are guaranteed whole numbers by the entry layer
   * (capability options `step`/`decimals: 0`, flow-card args `step: 1`); the
   * client's `setSetpoint` additionally enforces the battery's API contract
   * (non-negative integers) on the unsigned magnitude.
   */
  public static decomposeTargetPower(watts: number): SetpointCommand | null {
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
   * actions in order: operatingMode → setpoint.
   *
   * Idle (0 W) is an explicit 0 W stop setpoint. Manual standby must never be
   * used: its enable/disable round-trips force an inverter/DC re-init cycle,
   * and setpoints arriving inside that startup window can leave the battery
   * permanently wedged in `Init`/STARTUP (observed 2026-11-08, recoverable
   * only via power cycle). A validated 0 W stop stops an active 4200 W charge
   * within seconds and leaves the system healthy.
   */
  public static planPowerControl(input: PlanPowerControlInput): ControlActions {
    const power = input.requestedPower ?? input.currentPower ?? 0;

    const modeChanged = input.requestedMode !== input.previousMode;

    if (input.requestedMode !== 'homey') {
      // The battery follows its own strategy; a stored setpoint expires on its
      // own via the remote-command timeout outside Manual mode, and Manual mode
      // is the device-side carrier for external (sonnen app) setpoints.
      return {
        operatingMode: modeChanged ? this.toOperatingMode(input.requestedMode) : null,
        setpoint: null,
      };
    }

    // Homey in control: Manual mode carries the setpoint (no expiry timer).
    return {
      operatingMode: modeChanged ? '1' : null,
      setpoint: power === 0 ? { direction: 'charge', watts: 0 } : this.decomposeTargetPower(power),
    };
  }

  /**
   * Plans a combined `target_power` / `target_power_mode` capability change.
   *
   * Homey Energy semantics: writing `target_power` hands control to Homey
   * (implied mode switch to `homey`) unless `target_power_mode` is written in
   * the same change. A mode-only write to `homey` starts from idle: the
   * effective power is 0 (a stale stored target power is never re-applied
   * implicitly) and the stored value resets to 0 so the capability state
   * stays honest. The plan also carries the bookkeeping the device needs for
   * honest capability state: the clamped power to write back when the
   * requested value exceeded the device limits, and the reset of the stored
   * target power when Homey control is left.
   */
  public static planCapabilityChange(request: CapabilityChangeRequest, state: CapabilityChangeState): CapabilityChangePlan {
    const requestedMode = request.targetPowerMode
      ?? (request.targetPower !== null ? 'homey' : state.currentMode ?? 'self_consumption');
    const previousMode = state.currentMode;

    // Observed 2026-11-08: a mode-only UI toggle to homey re-applied a stale
    // stored 4200 W charge. Handing control to Homey must start from idle.
    const isModeOnlyHomeyEntry = request.targetPower === null && requestedMode === 'homey';
    const effectivePower = isModeOnlyHomeyEntry ? 0 : request.targetPower ?? state.currentPower;
    let writeBackPower: number | null = null;
    let power: number | null = null;
    if (effectivePower !== null) {
      const clamped = TargetPowerLimits.clampTargetPower(effectivePower, state.limits);
      power = clamped.value;
      if (clamped.clamped) {
        writeBackPower = clamped.value;
      } else if (isModeOnlyHomeyEntry && state.currentPower !== null && state.currentPower !== 0) {
        // Reset the stale stored power so the capability mirrors the idle start
        writeBackPower = 0;
      }
    }

    const actions = this.planPowerControl({
      requestedMode,
      previousMode,
      requestedPower: power,
      currentPower: null,
    });

    return {
      requestedMode,
      actions,
      writeBackPower,
      resetTargetPower: previousMode === 'homey' && requestedMode !== 'homey' && request.targetPower === null,
    };
  }
}
