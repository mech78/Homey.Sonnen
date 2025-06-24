import { SonnenDevice } from '../../../lib/SonnenDevice';

export class GridMeterDevice extends SonnenDevice {

  private readonly handleUpdateEvent = (currentState: any, statusJson: any): void => {
    this.device.log("Received currentState: " + JSON.stringify(currentState, null, 2));
    this.device.log("Received statusJson:   " + JSON.stringify(statusJson, null, 2));

    this.device.setCapabilityValue('measure_power', -statusJson.GridFeedIn_W);
    if (this.isEnergyFullySupported()) {
      this.device.setCapabilityValue('meter_power.imported', currentState.totalGridConsumption_Wh / 1000);
      this.device.setCapabilityValue('meter_power.exported', currentState.totalGridFeedIn_Wh / 1000);
    }
    this.device.setCapabilityValue('grid_consumption_current_capability', +statusJson.GridFeedIn_W < 0 ? -1 * statusJson.GridFeedIn_W : 0);
    this.device.setCapabilityValue('grid_consumption_daily_capability', currentState.totalDailyGridConsumption_Wh / 1000);
    this.device.setCapabilityValue('grid_consumption_total_capability', currentState.totalGridConsumption_Wh / 1000);
    
    this.device.setCapabilityValue('grid_feed_in_current_capability', +statusJson.GridFeedIn_W > 0 ? +statusJson.GridFeedIn_W : 0);
    this.device.setCapabilityValue('grid_feed_in_daily_capability', currentState.totalDailyGridFeedIn_Wh / 1000);
    this.device.setCapabilityValue('grid_feed_in_total_capability', currentState.totalGridFeedIn_Wh / 1000);
  }

  async onInit() {
    this.device.homey.on('sonnenBatterieUpdate', this.handleUpdateEvent);
    await this.gracefullyAddOrRemoveCapabilities();
    super.onInit();
  }

  private async gracefullyAddOrRemoveCapabilities() {
    if (!this.isEnergyFullySupported()) {

      const unsupportedForOlderHomeys = [
        'meter_power.imported',
        'meter_power.exported'
      ];

      for (const capability of unsupportedForOlderHomeys) {
        if (this.device.hasCapability(capability)) {
          await this.device.removeCapability(capability);
        }
      }
    }
  }

  async onDeleted() {
    this.device.homey.removeListener('sonnenBatterieUpdate', this.handleUpdateEvent);
    super.onDeleted();
  }

};
