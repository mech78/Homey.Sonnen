import { SonnenDriver } from '../../lib/SonnenDriver';

module.exports = class GridMeterDriver extends SonnenDriver {

  async onInit() {
    this.deviceName = this.homey.__('device.gridMeter');
    this.deviceId = "gridMeter";
    super.onInit();

    const toGridTrigger         = this.homey.flow.getConditionCard("deliver-to-grid");
    const fromGridTrigger       = this.homey.flow.getConditionCard("consumption-from-grid");

    toGridTrigger.registerRunListener(async (args) => {
      var toGridValue = +this.getDevices()[0].getCapabilityValue("grid_feed_in_current_capability");
      this.log("TRIGGER", "toGrid", toGridValue, "arg", args.Power, "VALID", toGridValue > 0);
      
      if (toGridValue > 0)
        return false; // not current feeding  grid

        return (toGridValue < args.Power);
    });

    fromGridTrigger.registerRunListener(async (args) => {      
      var fromGridValue = +this.getDevices()[0].getCapabilityValue("grid_consumption_current_capability");      
      this.log("TRIGGER", "fromGrid", fromGridValue, "arg", args.Power, "VALID", fromGridValue < 0);

      if (fromGridValue < 0)
        return false; // not current consuming from grid

      return (fromGridValue > args.Power);
    });
  }

};