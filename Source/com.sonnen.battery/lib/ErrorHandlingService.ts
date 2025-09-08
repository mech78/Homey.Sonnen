import { SonnenCommandResult } from '../domain/SonnenCommandResult';
import { LocalizedError } from '../domain/LocalizedError';

export class ErrorHandlingService {
  private static instance: ErrorHandlingService;
  private homey: any;

  private constructor() {}

  static getInstance(): ErrorHandlingService {
    if (!ErrorHandlingService.instance) {
      ErrorHandlingService.instance = new ErrorHandlingService();
    }
    return ErrorHandlingService.instance;
  }

  initialize(homey: any): void {
    this.homey = homey;
  }

  throwLocalizedErrorMessageForKnownErrors(result: SonnenCommandResult | Error): void {
    // Handle LocalizedError
    if (result instanceof LocalizedError) {
      const message = result.i18nArgs ? this.homey.__(result.i18nKey, result.i18nArgs) : this.homey.__(result.i18nKey);
      throw new Error(message);
    }

    // Handle SonnenCommandResult
    if (result instanceof SonnenCommandResult) {
      this.homey.log('Command result: ' + result?.toString());
      if (result?.hasError) {
        if (result.i18nKey) {
          const message = result.i18nArgs ? this.homey.__(result.i18nKey, result.i18nArgs) : this.homey.__(result.i18nKey);
          throw new Error(message);
        } else if (result.statusCode) {
          if (result.statusCode === 401) {
            throw new Error(this.homey.__("error.http.401"));
          }
          throw new Error(this.homey.__("error.http.other", { "statusCode": result.statusCode }));
        } else {
          throw new Error(this.homey.__("error.unknown", { "error": result.message }));
        }
      }
      return; // no error
    }

    // Fallback for regular errors
    throw result;
  }
}