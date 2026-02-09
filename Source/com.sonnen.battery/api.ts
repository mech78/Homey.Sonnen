import { BatteryDevice } from "./drivers/sonnenbatterie/device";

module.exports = {
  async saveDeviceState({ homey }: { homey: any }) {
    homey.log('Received request to save device state');
    const battery: BatteryDevice = homey.drivers.getDriver('sonnenbatterie').getDevices()[0]; // as long as only one batterydevice is supported
    if (battery) {
      const lastUpdate = battery.saveDeviceState()?.toLocaleString(homey.i18n.getLanguage());
      return { saved: true, lastUpdate };
    }
    return { saved: false };
  },

  async resetCycleCountBuffers({ homey }: { homey: any }) {
    homey.log('Received request to reset cycle count buffers');
    const battery: BatteryDevice = homey.drivers.getDriver('sonnenbatterie').getDevices()[0]; // as long as only one batterydevice is supported
    if (battery) {
      battery.resetCycleCountBuffers();
      return { reset: true };
    }
    return { reset: false };
  },
};