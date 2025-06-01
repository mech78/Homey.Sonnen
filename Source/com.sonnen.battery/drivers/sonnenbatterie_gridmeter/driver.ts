import { SonnenDriver } from '../../lib/SonnenDriver';

module.exports = class GridMeterDriver extends SonnenDriver {

  async onInit() {
    this.driverName = "Grid Meter Driver";
    this.driverId = "gridMeter";
    super.onInit();
  }

};