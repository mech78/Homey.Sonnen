import Homey from 'homey';
import axios from 'axios';
import { SonnenDriver } from '../../lib/SonnenDriver';

module.exports = class HouseholdMeterDriver extends SonnenDriver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    super.onInit();    
    this.deviceName = "Haushalt";
    this.deviceId = "householdMeter";
  }

  /**
   * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    return super.onPairListDevices();
  }

};
