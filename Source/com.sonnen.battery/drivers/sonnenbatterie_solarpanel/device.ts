import { SonnenDevice } from '../../lib/SonnenDevice';
import { SonnenState } from '../../domain/SonnenState';

module.exports = class SolarPanelDevice extends SonnenDevice {

  private readonly handleUpdateEvent = (currentState: any, statusJson: any): void => {
    this.log("Received currentState: " + (currentState as SonnenState).toLog());
    this.log("Received statusJson:   " + JSON.stringify(statusJson, null, 2));

    this.setCapabilityValue('measure_power', statusJson.Production_W);
    
    this.setCapabilityValue('production_current_capability', statusJson.Production_W);
    this.setCapabilityValue('production_daily_capability', currentState.totalDailyProduction_Wh / 1000);
    this.setCapabilityValue('production_total_capability', currentState.totalProduction_Wh / 1000);
    this.setCapabilityValue('meter_power', currentState.totalProduction_Wh / 1000);
    this.setCapabilityValue('production_today_max_capability', currentState.todayMaxProduction_Wh);

    const percentageGridFeedIn = (currentState.totalDailyGridFeedIn_Wh / currentState.totalDailyProduction_Wh) * 100;
    const percentageSelfConsumption = 100 - percentageGridFeedIn;
    this.setCapabilityValue('self_consumption_capability', +percentageSelfConsumption);
  }

  async onInit() {
    this.homey.on('sonnenBatterieUpdate', this.handleUpdateEvent);
    await this.gracefullyAddOrRemoveCapabilities();
    super.onInit();
  }

  async onDeleted() {
    this.homey.removeListener('sonnenBatterieUpdate', this.handleUpdateEvent);
    super.onDeleted();
  }

  private async gracefullyAddOrRemoveCapabilities() {

    const toAdd: string[] = [
      'production_today_max_capability'
    ];

    for (const capability of toAdd) {
      if (!this.hasCapability(capability)) {
        await this.addCapability(capability);
      }
    }

  }

};
