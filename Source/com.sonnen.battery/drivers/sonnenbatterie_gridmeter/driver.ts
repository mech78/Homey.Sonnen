import { SonnenDriver } from '../../lib/SonnenDriver';

module.exports = class GridMeterDriver extends SonnenDriver {

  async onInit() {
    this.deviceName = this.homey.__('device.gridMeter');
    this.deviceId = "gridMeter";
    super.onInit();

    // Device-based conditions:

    this.homey.flow.getConditionCard("grid_feed_in_current")
      .registerRunListener(async (args) => this.handleGridFeedInCurrent(args));
      
    this.homey.flow.getConditionCard("grid_consumption_current")
      .registerRunListener(async (args) => this.handleGridConsumptionCurrent(args));
  }

  async handleGridFeedInCurrent(args: any) {
    const toGridValue = +this.getDevices()[0].getCapabilityValue("grid_feed_in_current_capability"); // always positive
    this.log("TRIGGER", "toGrid", toGridValue, "arg", args.power, "VALID", toGridValue >= 0);

    if (toGridValue < 0) {
      return false;
    }
    return (toGridValue > args.power);
  }

  async handleGridConsumptionCurrent(args: any) {
    const fromGridValue = +this.getDevices()[0].getCapabilityValue("grid_consumption_current_capability"); // always positive
    this.log("TRIGGER", "fromGrid", fromGridValue, "arg", args.power, "VALID", fromGridValue >= 0);

    if (fromGridValue < 0) {
      return false;
    }

    return (fromGridValue > args.power);
  }

};