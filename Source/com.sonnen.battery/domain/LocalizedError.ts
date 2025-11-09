/**
 * Custom error class that carries localization information
 * This allows domain classes to throw errors that can be localized
 * without having direct access to the Homey localization function
 */
export class LocalizedError extends Error {
  /**
   * Creates a new LocalizedError instance
   * @param i18nKey The localization key to use
   * @param i18nArgs Optional arguments for the localization string
   */
  constructor(
    public readonly i18nKey: string,
    public readonly i18nArgs?: Record<string, string>
  ) {
    super(i18nKey);
    this.name = 'LocalizedError';
  }
}