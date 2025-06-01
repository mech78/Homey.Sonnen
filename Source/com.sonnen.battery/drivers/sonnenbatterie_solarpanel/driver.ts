import { SonnenDriver } from '../../lib/SonnenDriver';

module.exports = class SolarPanelDriver extends SonnenDriver {

  async onInit() {
    this.deviceName = this.homey.__('device.solarPanel');
    this.deviceId = "solarPanel";
    super.onInit();
  }

};