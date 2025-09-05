import Homey from 'homey';

import { SonnenBatterieClient } from '../service/SonnenBatterieClient';
import { SonnenBatteries } from '../domain/SonnenBatteryDevices';

export abstract class SonnenDriver extends Homey.Driver {

  protected deviceName!: string;
  protected deviceId!: string;

  /**
   * onInit is called when the driver is initialized.
   */
  override async onInit(): Promise<void> {
    super.onInit();
    this.log(this.constructor.name + ' has been initialized for device: ' + this.deviceName + ' with ID: ' + this.deviceId);
  }

  /**
    * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
    * This should return an array with the data of devices that are available for pairing.
    */
  override async onPairListDevices(): Promise<Array<{ name: string; data: { id: string }; store: { lanip: string } }>> {
    try {
      const batteries: SonnenBatteries = await SonnenBatterieClient.discoverBatteries();

      if (batteries) {
        this.log('Devices found: ', batteries);
        const results = batteries.map(battery => ({
          name: battery.info + " " + this.deviceName,
          data: {
            id: battery.device + "_" + this.deviceId,
          },
          store: {
            lanip: battery.lanip,
          },
        }));

        return results;
      }
    } catch (error) {
      this.error('Error occured while pairing', error);
    }

    return [];
  }

  protected createSonnenBatterieClient(device: Homey.Device): SonnenBatterieClient {
    const batteryAuthToken: string = this.homey.settings.get("BatteryAuthToken");
    return new SonnenBatterieClient(batteryAuthToken, device.getStore().lanip);
  }
};
