/**
 * Minimal Homey SDK stub for unit tests. The real SDK is not installed in
 * node_modules; tests import device modules only to exercise method-level
 * logic on manually constructed instances (no SDK functionality is invoked
 * at import time).
 */
class Device {
  log(..._args: unknown[]): void { /* no-op */ }
  error(..._args: unknown[]): void { /* no-op */ }
}
class Driver { /* no-op */ }
class App { /* no-op */ }

const Homey = { Device, Driver, App };
export default Homey;
