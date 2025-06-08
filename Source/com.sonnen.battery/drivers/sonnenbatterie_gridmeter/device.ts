import { SonnenDevice } from '../../lib/SonnenDevice';

module.exports = class GridMeterDevice extends SonnenDevice {

  private readonly handleUpdateEvent = (currentState: any, statusJson: any): void => {
    this.log("Received currentState: " + JSON.stringify(currentState, null, 2));
    this.log("Received statusJson:   " + JSON.stringify(statusJson, null, 2));

    this.setCapabilityValue('measure_power', -statusJson.GridFeedIn_W);
    this.setCapabilityValue('meter_power.imported', currentState.totalGridConsumption_Wh / 1000);
    this.setCapabilityValue('meter_power.exported', currentState.totalGridFeedIn_Wh / 1000);

    this.setCapabilityValue('grid_consumption_current_capability', +statusJson.GridFeedIn_W < 0 ? -1 * statusJson.GridFeedIn_W : 0);
    this.setCapabilityValue('grid_consumption_daily_capability', currentState.totalDailyGridConsumption_Wh / 1000);
    this.setCapabilityValue('grid_consumption_total_capability', currentState.totalGridConsumption_Wh / 1000);
    
    this.setCapabilityValue('grid_feed_in_current_capability', +statusJson.GridFeedIn_W > 0 ? +statusJson.GridFeedIn_W : 0);
    this.setCapabilityValue('grid_feed_in_daily_capability', currentState.totalDailyGridFeedIn_Wh / 1000);
    this.setCapabilityValue('grid_feed_in_total_capability', currentState.totalGridFeedIn_Wh / 1000);
  }

  async onInit() {
    this.homey.on('sonnenBatterieUpdate', this.handleUpdateEvent);
    super.onInit();
  }

  async onDeleted() {
    this.homey.removeListener('sonnenBatterieUpdate', this.handleUpdateEvent);
    super.onDeleted();
  }

};
