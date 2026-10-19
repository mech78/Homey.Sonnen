import { LocalizationService } from '../lib/LocalizationService';

type InitApp = Parameters<typeof LocalizationService.initialize>[0];

describe('LocalizationService', () => {
  const translateMock = jest.fn((_key: string): string | undefined => undefined);

  beforeAll(() => {
    const app = { homey: { __: translateMock } } as unknown as InitApp;
    LocalizationService.initialize(app);
  });

  beforeEach(() => {
    translateMock.mockReset();
    // Homey's __() returns the key itself when no translation exists
    translateMock.mockImplementation((key: string) => key);
  });

  describe('resolveOperatingMode', () => {
    it.each([
      ['1', 'Manual'],
      ['2', 'Self consumption'],
      ['6', 'Module extension (30%)'],
      ['10', 'Time-of-Use'],
      ['11', 'Automatic - Optimization'],
    ])('should resolve known operating mode %s to its translation', (mode, translation) => {
      translateMock.mockImplementation((key: string) =>
        key === 'operatingMode.' + mode ? translation : key
      );

      expect(LocalizationService.getInstance().resolveOperatingMode(mode)).toBe(translation);
      expect(translateMock).toHaveBeenCalledWith('operatingMode.' + mode);
    });

    it('should fall back to the raw mode for an unknown mode instead of the i18n key', () => {
      // Homey's __() returns the requested key when the translation is missing
      expect(LocalizationService.getInstance().resolveOperatingMode('8')).toBe('8');
    });

    it('should fall back to the raw mode when the translation is undefined', () => {
      translateMock.mockReturnValue(undefined);

      expect(LocalizationService.getInstance().resolveOperatingMode('8')).toBe('8');
    });

    it('should fall back to the raw mode when the translation is empty', () => {
      translateMock.mockReturnValue('');

      expect(LocalizationService.getInstance().resolveOperatingMode('8')).toBe('8');
    });
  });

  describe('resolveCircleColor', () => {
    it('should resolve a known Eclipse LED state to its translation', () => {
      translateMock.mockImplementation((key: string) =>
        key === 'eclipseLed.SolidRed' ? 'solid red' : key
      );

      expect(
        LocalizationService.getInstance().resolveCircleColor({ 'Solid Red': true })
      ).toBe('solid red');
      expect(translateMock).toHaveBeenCalledWith('eclipseLed.SolidRed');
    });

    it('should fall back to the state name for an unknown Eclipse LED state', () => {
      // No translation for 'SolidMagenta', so __() returns the key itself;
      // the fallback is the state name as found on the Eclipse LED record
      expect(
        LocalizationService.getInstance().resolveCircleColor({ 'Solid Magenta': true })
      ).toBe('Solid Magenta');
    });

    it('should resolve to Unknown when no LED state is active', () => {
      translateMock.mockImplementation((key: string) =>
        key === 'eclipseLed.Unknown' ? 'unknown' : key
      );

      expect(LocalizationService.getInstance().resolveCircleColor({ 'Solid Red': false })).toBe('unknown');
      expect(translateMock).toHaveBeenCalledWith('eclipseLed.Unknown');
    });

    it('should resolve to Unknown when the Eclipse LED state is missing', () => {
      translateMock.mockImplementation((key: string) =>
        key === 'eclipseLed.Unknown' ? 'unknown' : key
      );

      expect(LocalizationService.getInstance().resolveCircleColor(null as unknown as Record<string, boolean>)).toBe('unknown');
    });
  });

  describe('initialization', () => {
    it('should throw when initialized twice', () => {
      // Load a fresh module copy so the singleton starts uninitialized
      jest.resetModules();
      const { LocalizationService: FreshService } = require('../lib/LocalizationService');

      const app = { homey: { __: () => undefined } } as unknown as InitApp;
      expect(() => FreshService.initialize(app)).not.toThrow();
      expect(() => FreshService.initialize(app)).toThrow('has already been initialized');
    });
  });
});
