import Homey from 'homey';
import { SonnenBatterieClient } from '../service/SonnenBatterieClient';

const IPV4_REGEX = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/**
 * Whether a device setting value is a usable IPv4 address.
 * Rejects null/empty values (which device settings can transiently
 * return while the platform applies a settings write).
 */
export function isValidIPv4(value: unknown): value is string {
  return typeof value === 'string' && IPV4_REGEX.test(value.trim());
}

export abstract class SonnenDevice extends Homey.Device {

  protected DEBUG_MODE: boolean = false;
  private lastKnownDeviceIp: string | null = null;


  /**
   * onInit is called when the device is initialized.
   */
  override async onInit(): Promise<void> {
    this.log(this.constructor.name + ' has been initialized');
  }

  /**
   * onUninit is called when the device is uninitialized.
   */
  override async onUninit(): Promise<void> {
    this.log(this.constructor.name + ' has been uninitialized');
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  override async onAdded(): Promise<void> {
    this.log(this.constructor.name + ' has been added');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  override async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
      this.log(this.constructor.name + ' settings were changed: ' +
          changedKeys.join(', ') +
          '. old settings: ' + JSON.stringify(oldSettings) +
          ', new settings: ' + JSON.stringify(newSettings));
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  override async onRenamed(name: string): Promise<void> {
    this.log(this.constructor.name + ' was renamed to: ' + name);
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  override async onDeleted(): Promise<void> {
    this.log(this.constructor.name + ' has been deleted');
  }

  /**
   * @returns {boolean} true if the device supports energy features as Cloud or Homey Pro (early 2023) or later , false otherwise
   */
  protected isEnergyFullySupported(): boolean {
    return (this.homey.platform === "cloud" || (this.homey.platformVersion ?? 0) >= 2);
  }

  protected isDebugMode(): boolean {
    return this.DEBUG_MODE;
  }

  protected createSonnenBatterieClient(): SonnenBatterieClient {
    const batteryAuthToken: string = this.homey.settings.get("BatteryAuthToken");
    const deviceIp: unknown = this.getSetting("device_ip");
    if (isValidIPv4(deviceIp)) {
      this.lastKnownDeviceIp = deviceIp.trim();
    } else if (isValidIPv4(this.lastKnownDeviceIp)) {
      // The settings store can transiently return an empty/invalid value
      // while the platform applies a settings write (observed on Homey 2019),
      // breaking only the fetches that happen inside that window. Fall back
      // to the last known good IP; the in-memory cache is never persisted,
      // so it cannot go stale across restarts or real IP changes.
      this.log('Device IP setting is not readable (' + JSON.stringify(deviceIp) + '), falling back to last known IP');
    }
    const effectiveIp = isValidIPv4(deviceIp) ? deviceIp.trim() : this.lastKnownDeviceIp;
    return new SonnenBatterieClient(batteryAuthToken, effectiveIp as string);
  }

};
