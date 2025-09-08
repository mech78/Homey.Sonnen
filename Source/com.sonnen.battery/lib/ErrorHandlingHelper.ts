import { SonnenCommandResult } from '../domain/SonnenCommandResult';
import { LocalizedError } from '../domain/LocalizedError';

export class ErrorHandlingHelper {
  /**
   * Handles known errors by throwing localized error messages
   * @param homey The Homey instance for accessing localization and logging
   * @param result The result or error to handle
   */
  static throwLocalizedErrorMessageForKnownErrors(homey: any, result: SonnenCommandResult | Error): void {
    // Handle LocalizedError
    if (result instanceof LocalizedError) {
      const message = result.i18nArgs ? homey.__(result.i18nKey, result.i18nArgs) : homey.__(result.i18nKey);
      throw new Error(message);
    }

    // Handle SonnenCommandResult
    if (result instanceof SonnenCommandResult) {
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
      return; // no error
    }

    // Fallback for regular errors
    throw result;
  }
}