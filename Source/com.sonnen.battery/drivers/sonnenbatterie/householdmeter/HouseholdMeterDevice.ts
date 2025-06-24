import { SonnenDevice } from '../../../lib/SonnenDevice';

export class HouseholdMeterDevice extends SonnenDevice {

  private readonly handleUpdateEvent = (currentState: any, statusJson: any): void => {
    this.device.log("Received currentState: " + JSON.stringify(currentState, null, 2));
    this.device.log("Received statusJson:   " + JSON.stringify(statusJson, null, 2));

    this.device.setCapabilityValue('measure_power', statusJson.Consumption_W);

    this.device.setCapabilityValue('consumption_current_capability', statusJson.Consumption_W);
    this.device.setCapabilityValue('consumption_daily_capability', currentState.totalDailyConsumption_Wh / 1000);
    this.device.setCapabilityValue('consumption_total_capability', currentState.totalConsumption_Wh / 1000);

    var percentageGridConsumption = (currentState.totalDailyGridConsumption_Wh / currentState.totalDailyConsumption_Wh) * 100;
    var percentageSelfProduction = 100 - percentageGridConsumption;
    this.device.setCapabilityValue('autarky_capability', +percentageSelfProduction);
  };

  async onInit() {
    this.device.homey.on('sonnenBatterieUpdate', this.handleUpdateEvent);
    super.onInit();
  }

  async onDeleted() {
    this.device.homey.removeListener('sonnenBatterieUpdate', this.handleUpdateEvent);
    super.onDeleted();
  }

};
