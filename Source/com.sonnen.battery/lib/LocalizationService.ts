import Homey from 'homey';
import { SonnenCommandResult } from '../domain/SonnenCommandResult';
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

  public throwLocalizedErrorIfAny(result: SonnenCommandResult): void {
    const homey = this.app.homey;
    
    // Handle SonnenCommandResult
    homey.log('Command result: ' + result?.toString());
    if (result?.hasError) {
      if (result.i18nKey) {
        const message = result.i18nArgs ? homey.__(result.i18nKey, result.i18nArgs) : homey.__(result.i18nKey);
        throw new Error(message);
      } else if (result.statusCode) {
        if (result.statusCode === 401) {
          throw new Error(homey.__("error.http.401"));
        }
        throw new Error(homey.__("error.http.other", { "statusCode": result.statusCode }));
      } else {
        throw new Error(homey.__("error.unknown", { "error": result.message }));
      }
    }
  }
}