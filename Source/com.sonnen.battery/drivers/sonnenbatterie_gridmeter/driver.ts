import { SonnenDriver } from '../../lib/SonnenDriver';

module.exports = class GridMeterDriver extends SonnenDriver {

  async onInit() {
    this.deviceName = "Grid";
    this.deviceId = "gridMeter";
    super.onInit();
  }

};