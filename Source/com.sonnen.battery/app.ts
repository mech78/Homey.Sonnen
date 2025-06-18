import Homey from 'homey';

module.exports = class BatteryApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('BatteryApp has been initialized');
  }

}
