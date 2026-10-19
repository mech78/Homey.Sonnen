import { TargetPowerMode } from '../domain/TargetPowerMode';
import { LocalizedError } from '../domain/LocalizedError';

describe('TargetPowerMode', () => {
  describe('toOperatingMode (mode mapping)', () => {
    it('should map homey to Manual (1)', () => {
      expect(TargetPowerMode.toOperatingMode('homey')).toBe('1');
    });

    it('should map self_consumption to mode 2', () => {
      expect(TargetPowerMode.toOperatingMode('self_consumption')).toBe('2');
    });

    it('should map time_of_use to mode 10', () => {
      expect(TargetPowerMode.toOperatingMode('time_of_use')).toBe('10');
    });

    it('should round-trip with fromOperatingMode for all supported values', () => {
      const modes = ['homey', 'self_consumption', 'time_of_use'] as const;
      for (const mode of modes) {
        expect(TargetPowerMode.fromOperatingMode(TargetPowerMode.toOperatingMode(mode))).toBe(mode);
      }
    });

    it('should throw a LocalizedError for unknown mode values', () => {
      expect(() => TargetPowerMode.toOperatingMode('unknown' as never)).toThrow(LocalizedError);
    });
  });

  describe('fromOperatingMode (state sync)', () => {
    it('should map operating modes 1, 2 and 10', () => {
      expect(TargetPowerMode.fromOperatingMode('1')).toBe('homey');
      expect(TargetPowerMode.fromOperatingMode('2')).toBe('self_consumption');
      expect(TargetPowerMode.fromOperatingMode('10')).toBe('time_of_use');
    });

    it('should return null for modes without a capability representation (e.g. module extension)', () => {
      expect(TargetPowerMode.fromOperatingMode('6')).toBeNull();
    });

    it('should accept numeric input', () => {
      expect(TargetPowerMode.fromOperatingMode(10 as unknown as string)).toBe('time_of_use');
    });
  });

  describe('isValidTargetPower (setpoint validation)', () => {
    it('should accept whole non-negative watts including zero', () => {
      expect(TargetPowerMode.isValidTargetPower(0)).toBe(true);
      expect(TargetPowerMode.isValidTargetPower(100)).toBe(true);
      expect(TargetPowerMode.isValidTargetPower(4600)).toBe(true);
    });

    it('should reject negative and fractional values', () => {
      expect(TargetPowerMode.isValidTargetPower(-100)).toBe(false);
      expect(TargetPowerMode.isValidTargetPower(0.5)).toBe(false);
    });
  });

  describe('decomposeTargetPower (signed power decomposition)', () => {
    it('should decompose positive values into a charge setpoint', () => {
      expect(TargetPowerMode.decomposeTargetPower(3000)).toEqual({ direction: 'charge', watts: 3000 });
    });

    it('should decompose negative values into a discharge setpoint with absolute watts', () => {
      expect(TargetPowerMode.decomposeTargetPower(-3000)).toEqual({ direction: 'discharge', watts: 3000 });
    });

    it('should return null for zero (idle)', () => {
      expect(TargetPowerMode.decomposeTargetPower(0)).toBeNull();
    });

    it('should throw for fractional values', () => {
      expect(() => TargetPowerMode.decomposeTargetPower(100.5)).toThrow(LocalizedError);
    });
  });

  describe('planPowerControl (idle/standby state machine)', () => {
    const base = {
      previousMode: 'self_consumption' as const,
      requestedPower: null,
      currentPower: null,
      standbyActive: false,
    };

    it('should switch to Manual and apply the setpoint when entering homey mode', () => {
      const actions = TargetPowerMode.planPowerControl({
        ...base,
        requestedMode: 'homey',
        requestedPower: 3000,
      });

      expect(actions).toEqual({
        disableStandby: false,
        enableStandby: false,
        operatingMode: '1',
        setpoint: { direction: 'charge', watts: 3000 },
      });
    });

    it('should disable standby before applying a setpoint when standby is active', () => {
      const actions = TargetPowerMode.planPowerControl({
        ...base,
        requestedMode: 'homey',
        requestedPower: -2000,
        currentPower: -2000,
        standbyActive: true,
      });

      expect(actions.disableStandby).toBe(true);
      expect(actions.enableStandby).toBe(false);
      expect(actions.setpoint).toEqual({ direction: 'discharge', watts: 2000 });
    });

    it('should enable standby for 0 W when not already in standby', () => {
      const actions = TargetPowerMode.planPowerControl({
        ...base,
        requestedMode: 'homey',
        requestedPower: 0,
      });

      expect(actions).toEqual({
        disableStandby: false,
        enableStandby: true,
        operatingMode: '1',
        setpoint: null,
      });
    });

    it('should keep an already active standby for 0 W and only switch the operating mode', () => {
      const actions = TargetPowerMode.planPowerControl({
        ...base,
        requestedMode: 'homey',
        requestedPower: 0,
        standbyActive: true,
      });

      expect(actions).toEqual({
        disableStandby: false,
        enableStandby: false,
        operatingMode: '1',
        setpoint: null,
      });
    });

    it('should not repeat the operating mode switch when already in homey mode', () => {
      const actions = TargetPowerMode.planPowerControl({
        ...base,
        previousMode: 'homey',
        requestedMode: 'homey',
        requestedPower: 1500,
      });

      expect(actions.operatingMode).toBeNull();
      expect(actions.setpoint).toEqual({ direction: 'charge', watts: 1500 });
    });

    it('should fall back to the stored power value when only the mode changed', () => {
      const actions = TargetPowerMode.planPowerControl({
        ...base,
        previousMode: 'self_consumption',
        requestedMode: 'homey',
        currentPower: 2000,
      });

      expect(actions.setpoint).toEqual({ direction: 'charge', watts: 2000 });
    });

    it('should treat unknown previous mode as a mode change', () => {
      const actions = TargetPowerMode.planPowerControl({
        ...base,
        previousMode: null,
        requestedMode: 'homey',
        requestedPower: 1000,
      });

      expect(actions.operatingMode).toBe('1');
    });

    it('should restore the mapped operating mode and drop the setpoint when leaving homey mode', () => {
      const actions = TargetPowerMode.planPowerControl({
        ...base,
        previousMode: 'homey',
        currentPower: 3000,
        requestedMode: 'self_consumption',
      });

      expect(actions).toEqual({
        disableStandby: false,
        enableStandby: false,
        operatingMode: '2',
        setpoint: null,
      });
    });

    it('should disable standby when leaving homey mode while standby is active', () => {
      const actions = TargetPowerMode.planPowerControl({
        ...base,
        previousMode: 'homey',
        requestedMode: 'time_of_use',
        standbyActive: true,
      });

      expect(actions).toEqual({
        disableStandby: true,
        enableStandby: false,
        operatingMode: '10',
        setpoint: null,
      });
    });

    it('should do nothing when the non-homey mode is unchanged', () => {
      const actions = TargetPowerMode.planPowerControl({
        ...base,
        previousMode: 'self_consumption',
        requestedMode: 'self_consumption',
        currentPower: 3000,
      });

      expect(actions).toEqual({
        disableStandby: false,
        enableStandby: false,
        operatingMode: null,
        setpoint: null,
      });
    });

    it('should throw for a fractional power value', () => {
      expect(() => TargetPowerMode.planPowerControl({
        ...base,
        requestedMode: 'homey',
        requestedPower: 100.5,
      })).toThrow(LocalizedError);
    });
  });

  describe('planCapabilityChange (combined capability listener planning)', () => {
    const limits = { charge: 46000, discharge: 46000, source: 'default' as const };
    const baseState = {
      currentMode: 'self_consumption' as const,
      currentPower: 0,
      standbyActive: false,
      limits,
    };

    it('should hand control to Homey when only target_power is written (implied mode switch)', () => {
      const plan = TargetPowerMode.planCapabilityChange(
        { targetPower: 2000, targetPowerMode: null },
        baseState,
      );

      expect(plan.requestedMode).toBe('homey');
      expect(plan.actions.operatingMode).toBe('1');
      expect(plan.actions.setpoint).toEqual({ direction: 'charge', watts: 2000 });
      expect(plan.writeBackPower).toBeNull();
      expect(plan.resetTargetPower).toBe(false);
    });

    it('should let an explicit target_power_mode write win over the implied switch', () => {
      const plan = TargetPowerMode.planCapabilityChange(
        { targetPower: 2000, targetPowerMode: 'self_consumption' },
        baseState,
      );

      expect(plan.requestedMode).toBe('self_consumption');
      expect(plan.actions.operatingMode).toBeNull();
      expect(plan.actions.setpoint).toBeNull();
      expect(plan.resetTargetPower).toBe(false);
    });

    it('should write back the clamped value for an oversized charge request', () => {
      const plan = TargetPowerMode.planCapabilityChange(
        { targetPower: 20000, targetPowerMode: null },
        { ...baseState, limits: { charge: 5000, discharge: 5000, source: 'inverter' } },
      );

      expect(plan.actions.setpoint).toEqual({ direction: 'charge', watts: 5000 });
      expect(plan.writeBackPower).toBe(5000);
    });

    it('should write back the clamped value for an oversized discharge request', () => {
      const plan = TargetPowerMode.planCapabilityChange(
        { targetPower: -10000, targetPowerMode: null },
        { ...baseState, limits: { charge: 46000, discharge: 3000, source: 'site' } },
      );

      expect(plan.actions.setpoint).toEqual({ direction: 'discharge', watts: 3000 });
      expect(plan.writeBackPower).toBe(-3000);
    });

    it('should apply the stored power when only the mode is switched to homey', () => {
      const plan = TargetPowerMode.planCapabilityChange(
        { targetPower: null, targetPowerMode: 'homey' },
        { ...baseState, currentPower: -1500 },
      );

      expect(plan.requestedMode).toBe('homey');
      expect(plan.actions.setpoint).toEqual({ direction: 'discharge', watts: 1500 });
      expect(plan.writeBackPower).toBeNull();
    });

    it('should reset the stored power when Homey control is left via a mode-only change', () => {
      const plan = TargetPowerMode.planCapabilityChange(
        { targetPower: null, targetPowerMode: 'self_consumption' },
        { ...baseState, currentMode: 'homey', currentPower: -1500 },
      );

      expect(plan.requestedMode).toBe('self_consumption');
      expect(plan.actions.setpoint).toBeNull();
      expect(plan.resetTargetPower).toBe(true);
    });

    it('should not reset the stored power when the same change writes a new power value', () => {
      const plan = TargetPowerMode.planCapabilityChange(
        { targetPower: 2000, targetPowerMode: 'self_consumption' },
        { ...baseState, currentMode: 'homey', currentPower: -1500 },
      );

      expect(plan.resetTargetPower).toBe(false);
    });

    it('should plan nothing when the non-homey mode is unchanged', () => {
      const plan = TargetPowerMode.planCapabilityChange(
        { targetPower: null, targetPowerMode: 'self_consumption' },
        baseState,
      );

      expect(plan.actions).toEqual({
        disableStandby: false,
        enableStandby: false,
        operatingMode: null,
        setpoint: null,
      });
      expect(plan.writeBackPower).toBeNull();
      expect(plan.resetTargetPower).toBe(false);
    });

    it('should plan the idle standby path when neither power nor mode was ever set', () => {
      const plan = TargetPowerMode.planCapabilityChange(
        { targetPower: null, targetPowerMode: 'homey' },
        { ...baseState, currentMode: null, currentPower: null },
      );

      expect(plan.requestedMode).toBe('homey');
      expect(plan.actions.operatingMode).toBe('1');
      expect(plan.actions.setpoint).toBeNull();
      expect(plan.actions.enableStandby).toBe(true);
    });

    it('should throw a LocalizedError for a fractional requested power', () => {
      expect(() => TargetPowerMode.planCapabilityChange(
        { targetPower: 100.5, targetPowerMode: null },
        baseState,
      )).toThrow(LocalizedError);
    });
  });
});
