import { SonnenDriver } from '../../lib/SonnenDriver';

module.exports = class GridMeterDriver extends SonnenDriver {

  async onInit() {
    this.driverName = "Grid";
    this.driverId = "gridMeter";
    super.onInit();
  }

};