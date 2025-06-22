import { SonnenDriver } from '../../lib/SonnenDriver';

interface TriggerArgs {
  Power: number;
}

module.exports = class GridMeterDriver extends SonnenDriver {

  async onInit() {
    this.deviceName = this.homey.__('device.gridMeter');
    this.deviceId = "gridMeter";
    super.onInit();

    // Deprecated app based
    const toGridTrigger = this.homey.flow.getConditionCard("deliver-to-grid");
    const fromGridTrigger = this.homey.flow.getConditionCard("consumption-from-grid");

    toGridTrigger.registerRunListener(async (args) => this.handleGridFeedInCurrent(args));
    fromGridTrigger.registerRunListener(async (args) => this.handleGridConsumptionCurrent(args));

    // New device-based
    const gridFeedInCurrentCondition = this.homey.flow.getConditionCard("grid_feed_in_current");
    const gridConsumptionCurrentCondition = this.homey.flow.getConditionCard("grid_consumption_current");

    gridFeedInCurrentCondition.registerRunListener(async (args) => this.handleGridFeedInCurrent(args));
    gridConsumptionCurrentCondition.registerRunListener(async (args) => this.handleGridConsumptionCurrent(args));
  }

  async handleGridFeedInCurrent(args: any) {
    var toGridValue = +this.getDevices()[0].getCapabilityValue("grid_feed_in_current_capability"); // always positive
    this.log("TRIGGER", "toGrid", toGridValue, "arg", args.Power, "VALID", toGridValue >= 0);

    if (toGridValue < 0) {
      return false;
    }
    return (toGridValue > args.Power);
  }

  async handleGridConsumptionCurrent(args: any) {
    var fromGridValue = +this.getDevices()[0].getCapabilityValue("grid_consumption_current_capability"); // always positive
    this.log("TRIGGER", "fromGrid", fromGridValue, "arg", args.Power, "VALID", fromGridValue >= 0);

    if (fromGridValue < 0) {
      return false;
    }

    return (fromGridValue > args.Power);
  }

};