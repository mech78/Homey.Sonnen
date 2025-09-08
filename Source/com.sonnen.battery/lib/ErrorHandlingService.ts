import Homey from 'homey';
import { SonnenCommandResult } from '../domain/SonnenCommandResult';
import { LocalizedError } from '../domain/LocalizedError';

export class ErrorHandlingService {
  private static instance: ErrorHandlingService;
  private app: Homey.App;

  private constructor(app: Homey.App) {
    this.app = app;
  }

  public static initialize(app: Homey.App) {
    if (this.instance) {
      throw new Error('ErrorHandlingService has already been initialized');
    }
    this.instance = new ErrorHandlingService(app);
  }

  public static getInstance(): ErrorHandlingService {
    if (!this.instance) {
      throw new Error('ErrorHandlingService has not been initialized. Call initialize() first.');
    }
    
    return this.instance;
  }

  public throwLocalizedErrorMessageForKnownErrors(result: SonnenCommandResult | Error): void {
    // Handle LocalizedError
    if (result instanceof LocalizedError) {
      const message = result.i18nArgs ? this.app.homey.__(result.i18nKey, result.i18nArgs) : this.app.homey.__(result.i18nKey);
      throw new Error(message);
    }

    // Handle SonnenCommandResult
    if (result instanceof SonnenCommandResult) {
      this.app.homey.log('Command result: ' + result?.toString());
      if (result?.hasError) {
        if (result.i18nKey) {
          const message = result.i18nArgs ? this.app.homey.__(result.i18nKey, result.i18nArgs) : this.app.homey.__(result.i18nKey);
          throw new Error(message);
        } else if (result.statusCode) {
          if (result.statusCode === 401) {
            throw new Error(this.app.homey.__("error.http.401"));
          }
          throw new Error(this.app.homey.__("error.http.other", { "statusCode": result.statusCode }));
        } else {
          throw new Error(this.app.homey.__("error.unknown", { "error": result.message }));
        }
      }
      return; // no error
    }

    // Fallback for regular errors
    throw result;
  }
}