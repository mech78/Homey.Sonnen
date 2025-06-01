import { SonnenDriver } from '../../lib/SonnenDriver';

module.exports = class HouseholdMeterDriver extends SonnenDriver {

  async onInit() {
    this.deviceName = "Household Meter";
    this.deviceId = "householdMeter";
    super.onInit();
  }

};
