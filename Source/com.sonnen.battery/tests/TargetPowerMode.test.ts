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

    it('should map manual, module_extension and optimization to their modes', () => {
      expect(TargetPowerMode.toOperatingMode('manual')).toBe('1');
      expect(TargetPowerMode.toOperatingMode('module_extension')).toBe('6');
      expect(TargetPowerMode.toOperatingMode('optimization')).toBe('11');
    });

    it('should share the Manual (1) carrier between homey and manual', () => {
      expect(TargetPowerMode.toOperatingMode('homey')).toBe('1');
      expect(TargetPowerMode.toOperatingMode('manual')).toBe('1');
    });

    it('should round-trip with fromOperatingMode for all device-side values', () => {
      const modes = ['manual', 'self_consumption', 'module_extension', 'time_of_use', 'optimization'] as const;
      for (const mode of modes) {
        expect(TargetPowerMode.fromOperatingMode(TargetPowerMode.toOperatingMode(mode))).toBe(mode);
      }
    });

    it('should throw a LocalizedError for unknown mode values', () => {
      expect(() => TargetPowerMode.toOperatingMode('unknown' as never)).toThrow(LocalizedError);
    });
  });

  describe('fromOperatingMode (state sync)', () => {
    it('should map the device-side operating modes', () => {
      expect(TargetPowerMode.fromOperatingMode('1')).toBe('manual');
      expect(TargetPowerMode.fromOperatingMode('2')).toBe('self_consumption');
      expect(TargetPowerMode.fromOperatingMode('6')).toBe('module_extension');
      expect(TargetPowerMode.fromOperatingMode('10')).toBe('time_of_use');
      expect(TargetPowerMode.fromOperatingMode('11')).toBe('optimization');
    });

    it('should never derive homey from a battery operating mode', () => {
      // homey is Homey-side state; even mode 1 maps to the device-side manual
      expect(TargetPowerMode.fromOperatingMode('1')).toBe('manual');
    });

    it('should return null for modes without a capability representation', () => {
      expect(TargetPowerMode.fromOperatingMode('8')).toBeNull();
      expect(TargetPowerMode.fromOperatingMode('99')).toBeNull();
    });

    it('should accept numeric input', () => {
      expect(TargetPowerMode.fromOperatingMode(10 as unknown as string)).toBe('time_of_use');
    });
  });

  describe('resolveExternalMode (polling sync with sticky Manual carrier)', () => {
    it('should keep homey sticky when the battery reports Manual (mode 1)', () => {
      expect(TargetPowerMode.resolveExternalMode('1', 'homey')).toBe('homey');
    });

    it('should keep a user-chosen manual sticky when the battery reports mode 1', () => {
      expect(TargetPowerMode.resolveExternalMode('1', 'manual')).toBe('manual');
    });

    it('should resolve an external switch to Manual from another strategy as manual', () => {
      expect(TargetPowerMode.resolveExternalMode('1', 'self_consumption')).toBe('manual');
      expect(TargetPowerMode.resolveExternalMode('1', 'time_of_use')).toBe('manual');
      expect(TargetPowerMode.resolveExternalMode('1', null)).toBe('manual');
    });

    it('should map the strategy modes directly regardless of the current state', () => {
      expect(TargetPowerMode.resolveExternalMode('2', 'homey')).toBe('self_consumption');
      expect(TargetPowerMode.resolveExternalMode('6', 'manual')).toBe('module_extension');
      expect(TargetPowerMode.resolveExternalMode('10', 'homey')).toBe('time_of_use');
      expect(TargetPowerMode.resolveExternalMode('11', null)).toBe('optimization');
    });

    it('should return null for unknown operating modes', () => {
      expect(TargetPowerMode.resolveExternalMode('8', 'homey')).toBeNull();
      expect(TargetPowerMode.resolveExternalMode('99', null)).toBeNull();
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

    it('should switch the operating mode for the full strategy set when leaving homey mode', () => {
      const expectations: Record<string, string> = {
        manual: '1',
        self_consumption: '2',
        module_extension: '6',
        time_of_use: '10',
        optimization: '11',
      };
      for (const [requestedMode, operatingMode] of Object.entries(expectations)) {
        const actions = TargetPowerMode.planPowerControl({
          ...base,
          previousMode: 'homey',
          requestedMode: requestedMode as never,
        });

        expect(actions.operatingMode).toBe(operatingMode);
        expect(actions.setpoint).toBeNull();
      }
    });

    it('should re-assert the Manual carrier mode when homey control starts from manual', () => {
      // manual and homey share carrier mode 1; the idempotent re-write guards
      // against a stale capability state (external change between polls)
      const actions = TargetPowerMode.planPowerControl({
        ...base,
        previousMode: 'manual',
        requestedMode: 'homey',
        requestedPower: 1200,
      });

      expect(actions.operatingMode).toBe('1');
      expect(actions.setpoint).toEqual({ direction: 'charge', watts: 1200 });
    });

    it('should disable standby and drop the setpoint when handing control from homey to manual', () => {
      const actions = TargetPowerMode.planPowerControl({
        ...base,
        previousMode: 'homey',
        requestedMode: 'manual',
        currentPower: 2500,
        standbyActive: true,
      });

      expect(actions).toEqual({
        disableStandby: true,
        enableStandby: false,
        operatingMode: '1',
        setpoint: null,
      });
    });

    it('should do nothing when manual is unchanged', () => {
      const actions = TargetPowerMode.planPowerControl({
        ...base,
        previousMode: 'manual',
        requestedMode: 'manual',
        currentPower: 3000,
      });

      expect(actions).toEqual({
        disableStandby: false,
        enableStandby: false,
        operatingMode: null,
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

    it('should also reset the stored power when Homey control is handed to manual', () => {
      const plan = TargetPowerMode.planCapabilityChange(
        { targetPower: null, targetPowerMode: 'manual' },
        { ...baseState, currentMode: 'homey', currentPower: -1500 },
      );

      expect(plan.requestedMode).toBe('manual');
      expect(plan.actions.setpoint).toBeNull();
      expect(plan.actions.disableStandby).toBe(false);
      expect(plan.resetTargetPower).toBe(true);
    });

    it('should hand EMS control to manual-side homey with an implied mode switch', () => {
      const plan = TargetPowerMode.planCapabilityChange(
        { targetPower: 2500, targetPowerMode: null },
        { ...baseState, currentMode: 'manual', currentPower: 0 },
      );

      expect(plan.requestedMode).toBe('homey');
      expect(plan.actions.operatingMode).toBe('1');
      expect(plan.actions.setpoint).toEqual({ direction: 'charge', watts: 2500 });
      expect(plan.resetTargetPower).toBe(false);
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
