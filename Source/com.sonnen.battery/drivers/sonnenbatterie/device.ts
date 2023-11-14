import Homey from 'homey';
import axios from 'axios';
import _ from 'underscore';

class BatteryDevice extends Homey.Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('BatteryDevice has been initialized');


    var batteryBaseUrl   = this.homey.settings.get("BatteryBaseUrl");
    var batteryAuthToken = this.homey.settings.get("BatteryAuthToken");

    // Pull battery status 
    setInterval(() => {
      this.loadBatteryState(batteryBaseUrl, batteryAuthToken);
    }, 15 * 60 * 1000 /* pull quarter hour */);

    // Get latest state:
    this.loadBatteryState(batteryBaseUrl, batteryAuthToken);

  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('BatteryDevice has been added');
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
    this.log("MyDevice settings where changed");
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    this.log('MyDevice was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log('MyDevice has been deleted');
  }

  public loadBatteryState = (baseUrl: string, authKey: string) => {
    // Arrange
    var options = {
      method: 'get',
      headers: {
        'Auth-Token': `${authKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    // Act
    axios.get(`${baseUrl}/api/v2/latestdata`, options)
      .then((response) => {
        var batteryJson = response.data;
        console.log("RESPONSE", batteryJson);
        //USOC
        this.setCapabilityValue("measure_battery", +batteryJson.USOC);

      })
      .catch((error) => {
        console.log("ERROR", error);
      })
      .finally(() => {
        // always executed
      });
  }

}

module.exports = BatteryDevice;
