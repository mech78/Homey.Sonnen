export class SonnenCommandResult {

  constructor(
    public hasError: boolean,
    public message: string,                       // internal technical (error) message
    public statusCode?: number,                   // e.g. HTTP status codes: 400, 500
    public i18nKey?: string,                      // e.g. "error.validation_failed" or message key for success
    public i18nArgs?: { [key: string]: string },  // e.g. { field: "EM_ToU_Schedule", reason: "invalid threshold" }
  ){}

  toString(): string {
    const parts: string[] = [];
    
    parts.push(`hasError: ${this.hasError}`);
    
    if (this.message) {
      parts.push(`message: "${this.message}"`);
    }
    
    if (this.statusCode !== undefined) {
      parts.push(`statusCode: ${this.statusCode}`);
    }
    
    if (this.i18nKey) {
      parts.push(`i18nKey: "${this.i18nKey}"`);
    }
    
    if (this.i18nArgs) {
      parts.push(`i18nArgs: ${JSON.stringify(this.i18nArgs)}`);
    }
    
    return `SonnenCommandResult { ${parts.join(', ')} }`;
  }
}