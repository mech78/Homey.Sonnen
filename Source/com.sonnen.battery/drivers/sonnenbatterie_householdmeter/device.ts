import { SonnenDevice } from '../../lib/SonnenDevice';

module.exports = class HouseholdMeterDevice extends SonnenDevice {

  private readonly handleUpdateEvent = (currentState: any, statusJson: any): void => {
    this.log("Received currentState: " + JSON.stringify(currentState, null, 2));
    this.log("Received statusJson:   " + JSON.stringify(statusJson, null, 2));

    this.setCapabilityValue('measure_power', statusJson.Consumption_W);

    this.setCapabilityValue('consumption_current_capability', statusJson.Consumption_W);
    this.setCapabilityValue('consumption_daily_capability', currentState.totalDailyConsumption_Wh / 1000);
    this.setCapabilityValue('consumption_total_capability', currentState.totalConsumption_Wh / 1000);

    const percentageGridConsumption = (currentState.totalDailyGridConsumption_Wh / currentState.totalDailyConsumption_Wh) * 100;
    const percentageSelfProduction = 100 - percentageGridConsumption;
    this.setCapabilityValue('autarky_capability', +percentageSelfProduction);
  };

  async onInit() {
    this.homey.on('sonnenBatterieUpdate', this.handleUpdateEvent);
    super.onInit();
  }

  async onDeleted() {
    this.homey.removeListener('sonnenBatterieUpdate', this.handleUpdateEvent);
    super.onDeleted();
  }

};
