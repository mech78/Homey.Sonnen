import { SonnenDevice } from '../../lib/SonnenDevice';

module.exports = class GridMeterDevice extends SonnenDevice {

  private handleUpdateEvent(currentState: any, statusJson: any) {
    this.log("Received currentState: " + JSON.stringify(currentState, null, 2));
    this.log("Received statusJson:   " + JSON.stringify(statusJson, null, 2));

    this.setCapabilityValue('measure_power', -statusJson.GridFeedIn_W);
    //this.setCapabilityValue('meter_power', currentState.totalConsumption_Wh / 1000);
    this.setCapabilityValue('meter_power.imported', currentState.totalGridConsumption_Wh / 1000);
    this.setCapabilityValue('meter_power.exported', currentState.totalGridFeedIn_Wh / 1000);
  }

  async onInit() {
    this.deviceName = 'Grid Meter Device';
    super.onInit();
    this.homey.on('sonnenBatterieUpdate', this.handleUpdateEvent.bind(this));
  }

};
