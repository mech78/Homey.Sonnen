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

  /**
   * @param error The error to throw, potentially of type LocalizedError to localize first
   */
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

  /**
   * @param sonnenCommandResult The SonnenCommandResult that may contain an error to throw localized, or NOOP if no error
   */
  public throwLocalizedErrorIfAny(sonnenCommandResult: SonnenCommandResult): void {
    const homey = this.app.homey;
    
    homey.log('Command result: ' + sonnenCommandResult?.toString());
    if (sonnenCommandResult?.hasError) {
      if (sonnenCommandResult.i18nKey) {
        const message = sonnenCommandResult.i18nArgs ? homey.__(sonnenCommandResult.i18nKey, sonnenCommandResult.i18nArgs) : homey.__(sonnenCommandResult.i18nKey);
        throw new Error(message);
      } else if (sonnenCommandResult.statusCode) {
        if (sonnenCommandResult.statusCode === 401) {
          throw new Error(homey.__("error.http.401"));
        }
        throw new Error(homey.__("error.http.other", { "statusCode": sonnenCommandResult.statusCode }));
      } else {
        throw new Error(homey.__("error.unknown", { "error": sonnenCommandResult.message }));
      }
    }
    // No error, do nothing
  }
}