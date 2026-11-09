import { SonnenDriver } from '../../lib/SonnenDriver';

module.exports = class SonnenBatterieEmsDriver extends SonnenDriver {

  async onInit(): Promise<void> {
    this.deviceName = this.homey.__('device.emsControl');
    this.deviceId = "sonnenEmsControl";
    super.onInit();
  }

};
