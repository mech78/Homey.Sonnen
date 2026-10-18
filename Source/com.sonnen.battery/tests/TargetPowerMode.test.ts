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
});
