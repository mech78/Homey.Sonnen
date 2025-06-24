import { SonnenDevice } from '../../../lib/SonnenDevice';

export class SolarPanelDevice extends SonnenDevice {

  private readonly handleUpdateEvent = (currentState: any, statusJson: any): void => {
    this.device.log("Received currentState: " + JSON.stringify(currentState, null, 2));
    this.device.log("Received statusJson:   " + JSON.stringify(statusJson, null, 2));

    this.device.setCapabilityValue('measure_power', statusJson.Production_W);
    
    this.device.setCapabilityValue('production_current_capability', statusJson.Production_W);
    this.device.setCapabilityValue('production_daily_capability', currentState.totalDailyProduction_Wh / 1000);
    this.device.setCapabilityValue('production_total_capability', currentState.totalProduction_Wh / 1000);
    this.device.setCapabilityValue('meter_power', currentState.totalProduction_Wh / 1000);

    var percentageGridFeedIn = (currentState.totalDailyGridFeedIn_Wh / currentState.totalDailyProduction_Wh) * 100;
    var percentageSelfConsumption = 100 - percentageGridFeedIn;
    this.device.setCapabilityValue('self_consumption_capability', +percentageSelfConsumption);
  }

  async onInit() {
    this.device.homey.on('sonnenBatterieUpdate', this.handleUpdateEvent);
    super.onInit();
  }

  async onDeleted() {
    this.device.homey.removeListener('sonnenBatterieUpdate', this.handleUpdateEvent);
    super.onDeleted();
  }

};
