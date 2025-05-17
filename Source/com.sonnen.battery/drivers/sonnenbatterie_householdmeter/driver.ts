import Homey from 'homey';
import axios from 'axios';

module.exports = class HouseholdMeterDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('HouseholdMeterDriver has been initialized');
  }

  /**
   * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    try {
      const response = await axios.get('https://find-my.sonnen-batterie.com/find');

      if (response.data) {
        this.log('results found', response.data);
        const results = [];
        for (const e of response.data) {
          results.push({
            name: e.info + " Household Meter",
            data: {
              id: e.device + "_householdMeter",
            },
            store: {
              lanip: e.lanip,
            },
          });
        }

        return results;
      }
    } catch (error) {
      console.error(error);
    }

    return [];
  }

};
