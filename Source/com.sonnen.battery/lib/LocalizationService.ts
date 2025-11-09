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

  public throwLocalizedError(error: Error): void {
    const homey = this.app.homey;
    
    // Handle LocalizedError
    if (error instanceof LocalizedError) {
      const message = error.i18nArgs ? homey.__(error.i18nKey, error.i18nArgs) : homey.__(error.i18nKey);
      throw new Error(message);
    }

    // Fallback for regular errors
    throw error;
  }

  public resolveOperatingMode(mode: string): string {
    return this.app.homey.__('operatingMode.' + mode) ?? mode;
  }

  public resolveCircleColor(eclipseLed: Record<string, boolean>): string {
    let key = 'Unknown';
    if (eclipseLed) {
      key = Object.keys(eclipseLed).find(key => eclipseLed[key] === true) ?? key; 
    }
    return this.app.homey.__('eclipseLed.' + key.replaceAll(' ', '')) ?? key;
  }
}