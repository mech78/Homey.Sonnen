import { SonnenDriver } from '../../lib/SonnenDriver';

module.exports = class HouseholdMeterDriver extends SonnenDriver {

  async onInit() {
    this.deviceName = this.homey.__('device.householdMeter');
    this.deviceId = "householdMeter";
    super.onInit();
  }

};
