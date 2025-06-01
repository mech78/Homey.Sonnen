import { SonnenDriver } from '../../lib/SonnenDriver';

module.exports = class SolarPanelDriver extends SonnenDriver {

  async onInit() {
    this.deviceName = "Solar Panel";
    this.deviceId = "solarPanel";
    super.onInit();
  }

};