import { SonnenDriver } from '../../lib/SonnenDriver';

module.exports = class GridMeterDriver extends SonnenDriver {

  async onInit() {
    this.deviceName = this.homey.__('device.gridMeter');
    this.deviceId = "gridMeter";
    super.onInit();
  }

};