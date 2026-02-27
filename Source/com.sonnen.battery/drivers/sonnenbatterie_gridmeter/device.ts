import { SonnenDevice } from '../../lib/SonnenDevice';
import { SonnenState } from '../../domain/SonnenState';

module.exports = class GridMeterDevice extends SonnenDevice {

  private readonly handleUpdateEvent = (currentState: any, statusJson: any): void => {
    this.log("Received event data update");
    if (this.isDebugMode()) {
      this.log("Received currentState: " + (currentState as SonnenState).toLog());
      this.log("Received statusJson:   " + JSON.stringify(statusJson, null, 2));
    }

    this.setCapabilityValue('measure_power', -statusJson.GridFeedIn_W);
    if (this.isEnergyFullySupported()) {
      this.setCapabilityValue('meter_power.imported', currentState.totalGridConsumption_Wh / 1000);
      this.setCapabilityValue('meter_power.exported', currentState.totalGridFeedIn_Wh / 1000);
    }
    this.setCapabilityValue('grid_consumption_current_capability', +statusJson.GridFeedIn_W < 0 ? -1 * statusJson.GridFeedIn_W : 0);
    this.setCapabilityValue('grid_consumption_daily_capability', currentState.totalDailyGridConsumption_Wh / 1000);
    this.setCapabilityValue('grid_consumption_total_capability', currentState.totalGridConsumption_Wh / 1000);
    this.setCapabilityValue('grid_consumption_today_max_capability', currentState.todayMaxGridConsumption_Wh);
    
    this.setCapabilityValue('grid_feed_in_current_capability', +statusJson.GridFeedIn_W > 0 ? +statusJson.GridFeedIn_W : 0);
    this.setCapabilityValue('grid_feed_in_daily_capability', currentState.totalDailyGridFeedIn_Wh / 1000);
    this.setCapabilityValue('grid_feed_in_total_capability', currentState.totalGridFeedIn_Wh / 1000);
    this.setCapabilityValue('grid_feed_in_today_max_capability', currentState.todayMaxGridFeedIn_Wh);
  }

  async onInit() {
    this.homey.on('sonnenBatterieUpdate', this.handleUpdateEvent);
    await this.gracefullyAddOrRemoveCapabilities();
    super.onInit();
  }

  private async gracefullyAddOrRemoveCapabilities() {

    const toAdd: string[] = [
      'grid_consumption_today_max_capability',
      'grid_feed_in_today_max_capability',
    ];

    for (const capability of toAdd) {
      if (!this.hasCapability(capability)) {
        await this.addCapability(capability);
      }
    }

    if (!this.isEnergyFullySupported()) {

      const unsupportedForOlderHomeys = [
        'meter_power.imported',
        'meter_power.exported'
      ];

      for (const capability of unsupportedForOlderHomeys) {
        if (this.hasCapability(capability)) {
          await this.removeCapability(capability);
        }
      }
    }
  }

  async onDeleted() {
    this.homey.removeListener('sonnenBatterieUpdate', this.handleUpdateEvent);
    super.onDeleted();
  }

};
