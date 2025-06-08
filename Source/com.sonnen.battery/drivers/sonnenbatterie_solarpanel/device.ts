import { SonnenDevice } from '../../lib/SonnenDevice';

module.exports = class SolarPanelDevice extends SonnenDevice {

  private readonly handleUpdateEvent = (currentState: any, statusJson: any): void => {
    this.log("Received currentState: " + JSON.stringify(currentState, null, 2));
    this.log("Received statusJson:   " + JSON.stringify(statusJson, null, 2));

    this.setCapabilityValue('measure_power', statusJson.Production_W);
    
    this.setCapabilityValue('production_current_capability', statusJson.Production_W);
    this.setCapabilityValue('production_daily_capability', currentState.totalDailyProduction_Wh / 1000);
    this.setCapabilityValue('production_total_capability', currentState.totalProduction_Wh / 1000);
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
