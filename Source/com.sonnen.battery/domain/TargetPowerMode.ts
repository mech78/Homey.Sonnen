import { LocalizedError } from './LocalizedError';
import { PowerLimits, TargetPowerLimits } from './TargetPowerLimits';

/**
 * Values supported by the Homey `target_power_mode` capability.
 *
 * This is the **two-value controller model**: the capability only answers
 * *who controls the power*, never *which strategy the battery runs*.
 *
 * - `homey`: Homey (Energy / EMS apps / flows) drives the setpoint. The
 *   battery is switched to Manual (operating mode 1), the only mode in which
 *   a setpoint is held without an expiry timer.
 * - `device`: the battery runs its own strategy again. The strategy is
 *   selected exclusively through the app's `operating_mode` setting; on exit
 *   the device layer restores the operating mode captured when control was
 *   taken (see {@link TargetPowerMode.resolveControllerMode} and the device
 *   layer's prior-mode backup).
 */
export type TargetPowerModeValue = 'homey' | 'device';

/**
 * Direction of a sonnenBatterie setpoint command.
 */
export type SetpointDirection = 'charge' | 'discharge';

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
  /**
   * The operating mode captured before Homey took control, to restore on
   * exit. Only meaningful when `requestedMode` is `'device'` and the mode
   * actually changed. `null` means no backup exists — the honest no-op:
   * the device layer then applies **no** operating mode change at all (never
   * a guessed default).
   */
  restoreOperatingMode: string | null;
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
  /**
   * The operating mode captured before Homey took control (validated by the
   * device layer), or null when none was captured. Only consumed when the
   * requested change exits control.
   */
  restoreOperatingMode: string | null;
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
   * setpoint without an expiry timer. The `device` exit is not a mapping —
   * it restores the captured prior mode (see {@link planPowerControl}).
   */
  public static toOperatingMode(mode: TargetPowerModeValue): string {
    if (mode === 'homey') {
      return '1';
    }
    throw new LocalizedError('error.validation.invalid_target_power_mode', { mode });
  }

  /**
   * Resolves the controller state for an operating mode read from the
   * battery (polling sync), given the current capability state.
   *
   * Rule: battery mode 1 (Manual) is the carrier of Homey control and is
   * **sticky** — the current state is kept, because our own control writes
   * and an external sonnen-app Manual are indistinguishable by mode value
   * alone. Any other reported operating mode means the battery runs its own
   * strategy again, so the controller returns to `device`. `null` means
   * "leave the capability unchanged" (unknown mode, or unseeded capability).
   */
  public static resolveControllerMode(operatingMode: string, currentState: TargetPowerModeValue | null): TargetPowerModeValue | null {
    const mode = String(operatingMode);
    if (mode === '1') {
      return currentState;
    }
    return currentState === null ? null : 'device';
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
      // Leaving Homey control: the battery returns to its own strategy.
      // The operating mode to restore is the captured prior mode — when no
      // backup exists, no operating mode is written at all (never a guessed
      // default; at worst the battery stays in Manual, where its setpoint
      // expires on its own via the remote-command timeout).
      const restore = modeChanged ? input.restoreOperatingMode ?? null : null;
      return {
        operatingMode: restore,
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
      ?? (request.targetPower !== null ? 'homey' : state.currentMode ?? 'device');
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
      restoreOperatingMode: requestedMode !== 'homey' && previousMode === 'homey'
        ? state.restoreOperatingMode
        : null,
    });

    return {
      requestedMode,
      actions,
      writeBackPower,
      resetTargetPower: previousMode === 'homey' && requestedMode !== 'homey' && request.targetPower === null,
    };
  }
}
