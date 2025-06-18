import Homey from 'homey';

export abstract class SonnenDevice extends Homey.Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log(this.constructor.name + ' has been initialized');
  }

  /**
   * onUninit is called when the device is uninitialized.
   */
  async onUninit(): Promise<void> {
    this.log(this.constructor.name + ' has been uninitialized');
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
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
  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
      this.log(this.constructor.name + ' settings where changed: ' +
          changedKeys.join(', ') +
          '. old settings: ' + JSON.stringify(oldSettings) +
          ', new settings: ' + JSON.stringify(newSettings));
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    this.log(this.constructor.name + ' was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log(this.constructor.name + ' has been deleted');
  }

  /**
   * @returns {boolean} true if the device supports energy features as Cloud or Homey Pro (early 2023) or later , false otherwise
   */
  isEnergyFullySupported(): boolean {
    return (this.homey.platform === "cloud" || (this.homey.platformVersion ?? 0) >= 2);
  }

};
