import Homey from 'homey';
import { LocalizedError } from '../domain/LocalizedError';

export class LocalizationService {
  private static instance: LocalizationService;
  private app: Homey.App;

  private constructor(app: Homey.App) {
    this.app = app;
  }

  public static initialize(app: Homey.App) {
    if (this.instance) {
      throw new Error('LocalizationService has already been initialized');
    }
    this.instance = new LocalizationService(app);
  }

  public static getInstance(): LocalizationService {
    if (!this.instance) {
      throw new Error('LocalizationService has not been initialized. Call initialize() first.');
    }
    return this.instance;
  }

  public throwLocalizedError(error: unknown): void {
    const homey = this.app.homey;
    
    // Handle LocalizedError
    if (error instanceof LocalizedError) {
      const message = error.i18nArgs ? homey.__(error.i18nKey, error.i18nArgs) : homey.__(error.i18nKey);
      if (message === null || message === undefined) {
        throw new Error(`<${error.i18nKey}>`); // Fallback if translation is missing, display the i18nKey
      }
      throw new Error(message);
    }

    // Fallback for regular errors
    throw error;
  }

  public resolveOperatingMode(mode: string): string {
    return this.resolveTranslation('operatingMode.' + mode, mode);
  }

  public resolveCircleColor(eclipseLed: Record<string, boolean>): string {
    let key = 'Unknown';
    if (eclipseLed) {
      key = Object.keys(eclipseLed).find(key => eclipseLed[key] === true) ?? key; 
    }
    return this.resolveTranslation('eclipseLed.' + key.replaceAll(' ', ''), key);
  }

  /**
   * Resolves an i18n key to its translation.
   * Homey's __() returns the key itself when no translation exists,
   * so fall back to the provided fallback in that case.
   */
  private resolveTranslation(i18nKey: string, fallback: string): string {
    const translated = this.app.homey.__(i18nKey);
    return translated && translated !== i18nKey ? translated : fallback;
  }
}