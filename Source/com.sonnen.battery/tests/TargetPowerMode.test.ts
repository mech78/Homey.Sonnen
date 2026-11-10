import { LocalizedError } from '../domain/LocalizedError';
import { TargetPowerMode } from '../domain/TargetPowerMode';

const LIMITS = { charge: 4600, discharge: 4600, source: 'inverter' as const };

describe('TargetPowerMode (two-value controller model)', () => {
  describe('toOperatingMode', () => {
    it('maps homey to Manual (1) — the only mode holding a setpoint without expiry', () => {
      expect(TargetPowerMode.toOperatingMode('homey')).toBe('1');
    });

    it('throws for device — the exit is a restore, not a mapping', () => {
      expect(() => TargetPowerMode.toOperatingMode('device')).toThrow(LocalizedError);
    });
  });

  describe('resolveControllerMode (polling sync)', () => {
    it('keeps the current state sticky when the battery reports Manual (mode 1)', () => {
      expect(TargetPowerMode.resolveControllerMode('1', 'homey')).toBe('homey');
      expect(TargetPowerMode.resolveControllerMode('1', 'device')).toBe('device');
      expect(TargetPowerMode.resolveControllerMode('1', null)).toBeNull();
    });

    it('returns device when the battery reports a strategy mode while Homey controls', () => {
      expect(TargetPowerMode.resolveControllerMode('2', 'homey')).toBe('device');
      expect(TargetPowerMode.resolveControllerMode('10', 'homey')).toBe('device');
      expect(TargetPowerMode.resolveControllerMode('11', 'homey')).toBe('device');
    });

    it('returns device when not controlling and the strategy mode changed', () => {
      expect(TargetPowerMode.resolveControllerMode('2', 'device')).toBe('device');
    });

    it('returns null for an unseeded capability so the caller leaves it unchanged', () => {
      expect(TargetPowerMode.resolveControllerMode('2', null)).toBeNull();
      expect(TargetPowerMode.resolveControllerMode('1', null)).toBeNull();
    });
  });

  describe('decomposeTargetPower (signed power decomposition)', () => {
    it('decomposes positive values into a charge setpoint', () => {
      expect(TargetPowerMode.decomposeTargetPower(1500)).toEqual({ direction: 'charge', watts: 1500 });
    });

    it('decomposes negative values into a discharge setpoint with absolute watts', () => {
      expect(TargetPowerMode.decomposeTargetPower(-2300)).toEqual({ direction: 'discharge', watts: 2300 });
    });

    it('returns null for zero (idle)', () => {
      expect(TargetPowerMode.decomposeTargetPower(0)).toBeNull();
    });
  });

  describe('planPowerControl (control state machine)', () => {
    it('switches to Manual and applies the setpoint when entering homey mode', () => {
      const actions = TargetPowerMode.planPowerControl({
        requestedMode: 'homey',
        previousMode: 'device',
        requestedPower: 1500,
        currentPower: null,
        restoreOperatingMode: '2',
      });

      expect(actions).toEqual({
        operatingMode: '1',
        setpoint: { direction: 'charge', watts: 1500 },
      });
    });

    it('applies an explicit 0 W stop setpoint for idle when entering homey mode', () => {
      const actions = TargetPowerMode.planPowerControl({
        requestedMode: 'homey',
        previousMode: 'device',
        requestedPower: 0,
        currentPower: 4200,
        restoreOperatingMode: '2',
      });

      expect(actions).toEqual({
        operatingMode: '1',
        setpoint: { direction: 'charge', watts: 0 },
      });
    });

    it('does not repeat the operating mode switch when already in homey mode', () => {
      const actions = TargetPowerMode.planPowerControl({
        requestedMode: 'homey',
        previousMode: 'homey',
        requestedPower: 1500,
        currentPower: 1500,
        restoreOperatingMode: '2',
      });

      expect(actions.operatingMode).toBeNull();
      expect(actions.setpoint).toEqual({ direction: 'charge', watts: 1500 });
    });

    it('restores the captured prior mode and drops the setpoint when leaving homey mode', () => {
      const actions = TargetPowerMode.planPowerControl({
        requestedMode: 'device',
        previousMode: 'homey',
        requestedPower: null,
        currentPower: 4200,
        restoreOperatingMode: '10',
      });

      expect(actions).toEqual({ operatingMode: '10', setpoint: null });
    });

    it('writes no operating mode when leaving homey mode without a captured backup', () => {
      const actions = TargetPowerMode.planPowerControl({
        requestedMode: 'device',
        previousMode: 'homey',
        requestedPower: null,
        currentPower: 4200,
        restoreOperatingMode: null,
      });

      // The honest no-op: never a guessed default mode.
      expect(actions).toEqual({ operatingMode: null, setpoint: null });
    });

    it('does not write an operating mode when the device mode is unchanged', () => {
      const actions = TargetPowerMode.planPowerControl({
        requestedMode: 'device',
        previousMode: 'device',
        requestedPower: null,
        currentPower: null,
        restoreOperatingMode: '10',
      });

      expect(actions).toEqual({ operatingMode: null, setpoint: null });
    });
  });

  describe('planCapabilityChange (combined capability listener planning)', () => {
    const state = (overrides: Partial<Parameters<typeof TargetPowerMode.planCapabilityChange>[1]> = {}) => ({
      currentMode: 'device' as const,
      currentPower: 0,
      limits: LIMITS,
      restoreOperatingMode: null,
      ...overrides,
    });

    it('hands control to Homey when only target_power is written (implied mode switch)', () => {
      const plan = TargetPowerMode.planCapabilityChange({ targetPower: 2000, targetPowerMode: null }, state());

      expect(plan.requestedMode).toBe('homey');
      expect(plan.actions).toEqual({
        operatingMode: '1',
        setpoint: { direction: 'charge', watts: 2000 },
      });
    });

    it('lets an explicit target_power_mode write win over the implied switch', () => {
      const plan = TargetPowerMode.planCapabilityChange(
        { targetPower: 2000, targetPowerMode: 'device' },
        state({ currentMode: 'homey', restoreOperatingMode: '2' }),
      );

      expect(plan.requestedMode).toBe('device');
      expect(plan.actions).toEqual({ operatingMode: '2', setpoint: null });
      // A combined power+mode write is not a mode-only exit: the stored power
      // stays (a later homey re-entry starts from idle regardless).
      expect(plan.resetTargetPower).toBe(false);
    });

    it('starts idle from a stale stored power on a mode-only entry into homey', () => {
      const plan = TargetPowerMode.planCapabilityChange(
        { targetPower: null, targetPowerMode: 'homey' },
        state({ currentMode: 'device', currentPower: 4200 }),
      );

      expect(plan.requestedMode).toBe('homey');
      expect(plan.actions).toEqual({
        operatingMode: '1',
        setpoint: { direction: 'charge', watts: 0 },
      });
      expect(plan.writeBackPower).toBe(0); // stale stored power reset
    });

    it('resets the stored power when leaving Homey control to a device mode', () => {
      const plan = TargetPowerMode.planCapabilityChange(
        { targetPower: null, targetPowerMode: 'device' },
        state({ currentMode: 'homey', currentPower: 4200, restoreOperatingMode: '2' }),
      );

      expect(plan.resetTargetPower).toBe(true);
      expect(plan.actions).toEqual({ operatingMode: '2', setpoint: null });
    });

    it('does not flag a power write as a control exit', () => {
      const plan = TargetPowerMode.planCapabilityChange(
        { targetPower: 3000, targetPowerMode: null },
        state({ currentMode: 'homey', currentPower: 2000 }),
      );

      expect(plan.resetTargetPower).toBe(false);
      expect(plan.actions).toEqual({ operatingMode: null, setpoint: { direction: 'charge', watts: 3000 } });
    });

    it('clamps over-limit setpoints and carries the write-back', () => {
      const plan = TargetPowerMode.planCapabilityChange({ targetPower: 20000, targetPowerMode: null }, state());

      expect(plan.actions.setpoint).toEqual({ direction: 'charge', watts: 4600 });
      expect(plan.writeBackPower).toBe(4600);
    });
  });
});
