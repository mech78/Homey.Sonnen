import { SonnenDriver } from '../../lib/SonnenDriver';

module.exports = class HouseholdMeterDriver extends SonnenDriver {

  async onInit() {
    this.driverName = "Household";
    this.driverId = "householdMeter";
    super.onInit();
  }

};
