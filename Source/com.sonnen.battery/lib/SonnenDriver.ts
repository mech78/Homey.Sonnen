import Homey from 'homey';

import { SonnenBatterieClient } from '../service/SonnenBatterieClient';
import { SonnenBatteryDevices } from '../domain/SonnenBatteryDevices';

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
      const devices: SonnenBatteryDevices = await SonnenBatterieClient.discoverDevices();

      if (devices) {
        this.log('Devices found: ', devices);
        const results = devices.map(device => ({
          name: device.info + " " + this.deviceName,
          data: {
            id: device.device + "_" + this.deviceId,
          },
          store: {
            lanip: device.lanip,
          },
        }));

        return results;
      }
    } catch (error) {
      this.error('Error occured while pairing', error);
    }

    return [];
  }
};
