import { SonnenDriver } from '../../lib/SonnenDriver';

module.exports = class SolarPanelDriver extends SonnenDriver {

  async onInit() {
    this.driverName = "Solar Panel";
    this.driverId = "solarPanel";
    super.onInit();
  }

};