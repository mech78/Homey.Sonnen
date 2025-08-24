import Homey from 'homey';
import axios from 'axios';

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
      const response = await axios.get('https://find-my.sonnen-batterie.com/find');

      if (response.data) {
        this.log('results found', response.data);
        const results = [];
        for (const e of response.data) {
          results.push({
            name: e.info + " " + this.deviceName,
            data: {
              id: e.device + "_" + this.deviceId,
            },
            store: {
              lanip: e.lanip,
            },
          });
        }

        return results;
      }
    } catch (error) {
      this.error('Error occured while pairing', error);
    }

    return [];
  }
};
