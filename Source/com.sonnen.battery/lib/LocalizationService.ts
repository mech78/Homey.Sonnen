import Homey from 'homey';
import { LocalizedError } from '../domain/LocalizedError';

/**
 * Localization helpers.
 *
 * Homey's translation function lives on the app's Homey instance, which is
 * created by the Homey runtime: devices and drivers do not have a natural
 * reference to it. The app instance is therefore bound once via initialize()
 * during BatteryApp.onInit() and kept in the module scope - a plain module
 * reference instead of a singleton class, as there is exactly one app per
 * runtime and no instance state beyond that reference.
 */
let app: Homey.App | undefined;

/**
 * Thrown by resolve helpers when accessed before initialize().
 * Exported so callers can narrow it without string comparison.
 */
export class LocalizationNotInitializedError extends Error {
  constructor() {
    super('LocalizationService has not been initialized. Call initialize() first.');
    this.name = 'LocalizationNotInitializedError';
  }
}

export function initialize(homeyApp: Homey.App): void {
  if (app !== undefined) {
    throw new Error('LocalizationService has already been initialized');
  }
  app = homeyApp;
}

function requireApp(): Homey.App {
  if (app === undefined) {
    throw new LocalizationNotInitializedError();
  }
  return app;
}

export function throwLocalizedError(error: unknown): void {
  const homey = requireApp().homey;

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

export function resolveOperatingMode(mode: string): string {
  return resolveTranslation('operatingMode.' + mode, mode);
}

export function resolveCircleColor(eclipseLed: Record<string, boolean>): string {
  let key = 'Unknown';
  if (eclipseLed) {
    key = Object.keys(eclipseLed).find(key => eclipseLed[key] === true) ?? key;
  }
  return resolveTranslation('eclipseLed.' + key.replaceAll(' ', ''), key);
}

/**
 * Resolves an i18n key to its translation.
 * Homey's __() returns the key itself when no translation exists,
 * so fall back to the provided fallback in that case.
 */
function resolveTranslation(i18nKey: string, fallback: string): string {
  const translated = requireApp().homey.__(i18nKey);
  return translated && translated !== i18nKey ? translated : fallback;
}
