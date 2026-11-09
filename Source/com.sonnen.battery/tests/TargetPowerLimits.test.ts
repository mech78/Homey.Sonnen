import { TargetPowerLimits } from '../domain/TargetPowerLimits';

describe('TargetPowerLimits', () => {
  describe('resolve (limit source priority)', () => {
    it('should use the per-direction site limits when present', () => {
      const limits = TargetPowerLimits.resolve({
        p_bess_inv_max_import_limit: 4800,
        p_bess_inv_max_export_limit: 4600,
      }, null);

      expect(limits).toEqual({ charge: 4800, discharge: 4600, source: 'site' });
    });

    it('should parse string site limit values', () => {
      const limits = TargetPowerLimits.resolve({
        p_bess_inv_max_import_limit: '4800',
        p_bess_inv_max_export_limit: '4600',
      }, null);

      expect(limits).toEqual({ charge: 4800, discharge: 4600, source: 'site' });
    });

    it('should fall back to the inverter limit when the site response is empty', () => {
      const limits = TargetPowerLimits.resolve({}, '4600');

      expect(limits).toEqual({ charge: 4600, discharge: 4600, source: 'inverter' });
    });

    it('should fall back to the inverter limit when the site response is null', () => {
      const limits = TargetPowerLimits.resolve(null, 5000);

      expect(limits).toEqual({ charge: 5000, discharge: 5000, source: 'inverter' });
    });

    it('should mix sources per direction when the site response is partial', () => {
      const limits = TargetPowerLimits.resolve({
        p_bess_inv_max_import_limit: 4800,
        p_bess_inv_max_export_limit: null,
      }, '4600');

      expect(limits).toEqual({ charge: 4800, discharge: 4600, source: 'site' });
    });

    it('should use the safe default when no source provides limits', () => {
      const limits = TargetPowerLimits.resolve(null, null);

      expect(limits).toEqual({
        charge: TargetPowerLimits.DEFAULT_LIMIT_W,
        discharge: TargetPowerLimits.DEFAULT_LIMIT_W,
        source: 'default',
      });
    });

    it('should ignore zero and invalid values', () => {
      const limits = TargetPowerLimits.resolve({
        p_bess_inv_max_import_limit: 0,
        p_bess_inv_max_export_limit: 'not-a-number',
      }, '');

      expect(limits).toEqual({
        charge: TargetPowerLimits.DEFAULT_LIMIT_W,
        discharge: TargetPowerLimits.DEFAULT_LIMIT_W,
        source: 'default',
      });
    });
  });

  describe('clampTargetPower', () => {
    const limits = { charge: 4600, discharge: 4600, source: 'inverter' as const };

    it('should clamp a positive target to the charge limit', () => {
      expect(TargetPowerLimits.clampTargetPower(10000, limits)).toEqual({ value: 4600, clamped: true });
    });

    it('should clamp a negative target to the discharge limit', () => {
      expect(TargetPowerLimits.clampTargetPower(-10000, limits)).toEqual({ value: -4600, clamped: true });
    });

    it('should keep values within limits unchanged', () => {
      expect(TargetPowerLimits.clampTargetPower(3000, limits)).toEqual({ value: 3000, clamped: false });
      expect(TargetPowerLimits.clampTargetPower(-3000, limits)).toEqual({ value: -3000, clamped: false });
    });

    it('should keep boundary values unchanged', () => {
      expect(TargetPowerLimits.clampTargetPower(4600, limits)).toEqual({ value: 4600, clamped: false });
      expect(TargetPowerLimits.clampTargetPower(-4600, limits)).toEqual({ value: -4600, clamped: false });
    });

    it('should never clamp zero (idle path)', () => {
      expect(TargetPowerLimits.clampTargetPower(0, limits)).toEqual({ value: 0, clamped: false });
    });

    it('should support asymmetric limits', () => {
      const asymmetric = { charge: 4800, discharge: 3200, source: 'site' as const };
      expect(TargetPowerLimits.clampTargetPower(5000, asymmetric).value).toBe(4800);
      expect(TargetPowerLimits.clampTargetPower(-5000, asymmetric).value).toBe(-3200);
    });
  });
});
