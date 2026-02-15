import Homey from 'homey';
import { LocalizationService } from './lib/LocalizationService';

module.exports = class BatteryApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log(`BatteryApp has been initialized. Running on Node.js ${process.version}`);
    
    // Initialize the error handling service
    LocalizationService.initialize(this);
    
    this.homey.on('unload', this.onUninitialize);
  }

  /**
   * Workaround for bug https://github.com/athombv/homey-apps-sdk-issues/issues/401
   * As onUninit() does _not_ get called, the event 'unload' is used to handle the uninitialization of the app.
   * Whenever this gets fixed, just rename this method to onUninit() and remove the event listener in onInit().
   */
  async onUninitialize() {
    this.log('BatteryApp has been uninitialized');
    // unfortunately no access to property of this.homey works. So cannot access drivers or settings to store state.
  }
  
}
