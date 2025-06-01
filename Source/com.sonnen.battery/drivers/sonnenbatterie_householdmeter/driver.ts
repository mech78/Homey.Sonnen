import { SonnenDriver } from '../../lib/SonnenDriver';

module.exports = class HouseholdMeterDriver extends SonnenDriver {

  async onInit() {
    this.driverName = "Household Meter Driver";
    this.driverId = "householdMeter";
    super.onInit();
  }

};
