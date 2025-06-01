import { SonnenDriver } from '../../lib/SonnenDriver';

module.exports = class HouseholdMeterDriver extends SonnenDriver {

  async onInit() {
    this.deviceName = "Household";
    this.deviceId = "householdMeter";
    super.onInit();
  }

};
