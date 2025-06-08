import { SonnenDevice } from '../../lib/SonnenDevice';

module.exports = class SolarPanelDevice extends SonnenDevice {

  private readonly handleUpdateEvent = (currentState: any, statusJson: any): void => {
    this.log("Received currentState: " + JSON.stringify(currentState, null, 2));
    this.log("Received statusJson:   " + JSON.stringify(statusJson, null, 2));

    // FIXME: Using the default (sub)capability disallows overriding the icons, so use custom capabilities when the default capability is not required for the energy tab.
    this.setCapabilityValue('measure_power', statusJson.Production_W);
    this.setCapabilityValue('meter_power', currentState.totalProduction_Wh / 1000);
    this.setCapabilityValue('meter_power.daily', currentState.totalDailyProduction_Wh / 1000);
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
