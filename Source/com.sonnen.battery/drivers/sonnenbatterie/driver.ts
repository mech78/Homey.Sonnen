import _ from 'underscore';
import { SonnenBatterieClient } from '../../service/SonnenBatterieClient';
import { SonnenDriver } from '../../lib/SonnenDriver';

module.exports = class SonnenBatterieDriver extends SonnenDriver {

  async onInit() {
    this.deviceName = this.homey.__('device.battery');
    this.deviceId = "sonnenBattery";
    super.onInit();

    const setToC_card       = this.homey.flow.getActionCard("set-time-of-use");
    const setToCHours_card  = this.homey.flow.getActionCard("set-time-of-use-hours");
    const setToCHoursString_card = this.homey.flow.getActionCard("set-time-of-use-hours-string");
    const resetToC_card = this.homey.flow.getActionCard("reset-time-of-use");
    const pauseToC_card = this.homey.flow.getActionCard("pause-time-of-use");

    const startToC_card = this.homey.flow.getActionCard("start-charge");
    const stopToC_card = this.homey.flow.getActionCard("stop-charge");

    const zeroPad = (num: any, places: any) => String(num).padStart(places, '0');

    var batteryAuthToken  = this.homey.settings.get("BatteryAuthToken");

    var sonnenBatterieClient = new SonnenBatterieClient(batteryAuthToken);

    setToC_card.registerRunListener(async (args) => {
      var baseUrl   = SonnenBatterieClient.GetBaseUrl(this.getDevices()[0].getStore().lanip);
      var timeStart = args.Start;
      var timeEnd   = args.End;
      var maxPower  = args.MaxPower;

      var commandResult = await sonnenBatterieClient.SetSchedule(baseUrl, timeStart, timeEnd, maxPower);
      this.log("Result", commandResult, args.Power);

      await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Set ToC between ${timeStart} and ${timeEnd} with max power ${maxPower}.`});

      if (commandResult.HasError)
        throw Error(commandResult.error);

    });

    setToCHours_card.registerRunListener(async (args) => {
      var baseUrl   = SonnenBatterieClient.GetBaseUrl(this.getDevices()[0].getStore().lanip);
      var timeStart = args.Start;
      var hours     = args.Hours;
      var maxPower  = args.MaxPower;

      // Calculate end from timeStart and hours.
      var timeStartHours   = +timeStart.split(":", 1)[0];
      var timeStartMinutes =  timeStart.split(":", 2)[1];
      var timeEndHours = (timeStartHours + hours) % 24; // Handle overflow.
      var timeEndHoursFormatted = zeroPad(timeEndHours, 2);

      var timeEnd = `${timeEndHoursFormatted}:${timeStartMinutes}`;

      var commandResult = await sonnenBatterieClient.SetSchedule(baseUrl, timeStart, timeEnd, maxPower);
      this.log("Result", commandResult, args.Power);

      await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Set ToC-hours (${hours}) between ${timeStart} and ${timeEnd} with max power ${maxPower}.`});

      if (commandResult.HasError)
        throw Error(commandResult.error);

    });

    setToCHoursString_card.registerRunListener(async (args) => {
      var baseUrl   = SonnenBatterieClient.GetBaseUrl(this.getDevices()[0].getStore().lanip);
      var timeStart = args.Start;
      var hours     = args.Hours;
      var maxPower  = args.MaxPower;

      // Calculate end from timeStart and hours.
      var timeStartHours   = +timeStart.split(":", 1)[0];
      var timeStartMinutes =  timeStart.split(":", 2)[1].trim();
      var timeEndHours = (timeStartHours + hours) % 24; // Handle overflow.
      var timeEndHoursFormatted = zeroPad(timeEndHours, 2);

          timeStart = `${zeroPad(timeStartHours, 2)}:${zeroPad(timeStartMinutes,2)}`;
      var timeEnd = `${timeEndHoursFormatted}:${timeStartMinutes}`;

      //this.log("INPUT", timeStart, timeEnd, maxPower);

      var commandResult = await sonnenBatterieClient.SetSchedule(baseUrl, timeStart, timeEnd, maxPower);
      this.log("Result", commandResult, args.Power);

      await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Set ToC-hours (${hours}) between ${timeStart} and ${timeEnd} with max power ${maxPower}.`});

      if (commandResult.HasError)
        throw Error(commandResult.error);

    });

    resetToC_card.registerRunListener(async () => {
      var baseUrl   = SonnenBatterieClient.GetBaseUrl(this.getDevices()[0].getStore().lanip);
      // Set empty schedule

      var commandResult = await sonnenBatterieClient.ClearSchedule(baseUrl);
      this.log("Result", commandResult);

      await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Reset ToC.`});

      if (commandResult.HasError)
        throw Error(commandResult.error);

    });

    pauseToC_card.registerRunListener(async (args) => {
      var baseUrl   = SonnenBatterieClient.GetBaseUrl(this.getDevices()[0].getStore().lanip);
      var timeStart = args.Start;
      var timeEnd   = args.End;

      var commandResult =       await sonnenBatterieClient.SetSchedule(baseUrl, timeStart, timeEnd, 0);
      this.log("Result", commandResult, args.Power);

      await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Pause ToC between ${timeStart} and ${timeEnd}.`});

      if (commandResult.HasError)
        throw Error(commandResult.error);

    });

    startToC_card.registerRunListener(async (args) => {
      var baseUrl   = SonnenBatterieClient.GetBaseUrl(this.getDevices()[0].getStore().lanip);
      // Set full schedule

      var commandResult =       await sonnenBatterieClient.SetSchedule(baseUrl, "00:00", "23:59", args.Power);
      this.log("Result", commandResult, args.Power);

      await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Start ToC.`});

      if (commandResult.HasError)
        throw Error(commandResult.error);
    });

    stopToC_card.registerRunListener(async () => {
      var baseUrl   = SonnenBatterieClient.GetBaseUrl(this.getDevices()[0].getStore().lanip);
      // Set empty schedule

      var commandResult = await sonnenBatterieClient.ClearSchedule(baseUrl);
      this.log("Result", commandResult);

      await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Stop ToC.`});

      if (commandResult.HasError)
        throw Error(commandResult.error);

    });

    // Conditions:
    const fromBatteryTrigger    = this.homey.flow.getConditionCard("power-from-battery");
    const toBatteryTrigger      = this.homey.flow.getConditionCard("power-to-battery");
    const toGridTrigger         = this.homey.flow.getConditionCard("deliver-to-grid");
    const fromGridTrigger       = this.homey.flow.getConditionCard("consumption-from-grid");
    const batteryLevelBelowCard = this.homey.flow.getConditionCard("battery-level-below");
    const batteryLevelAboveCard = this.homey.flow.getConditionCard("battery-level-above");

    fromBatteryTrigger.registerRunListener(async (args) => {
      return (+this.getDevices()[0].getCapabilityValue("from_battery_capability")) > 0;
    });

    toBatteryTrigger.registerRunListener(async (args) => {
      return (+this.getDevices()[0].getCapabilityValue("to_battery_capability")) > 0;
    });

    toGridTrigger.registerRunListener(async (args) => {
      var toGridValue = +this.getDevices()[0].getCapabilityValue("grid_feed_in_capability") * 1000;
      this.log("TRIGGER", "toGrid", toGridValue, "arg", args.Power, "VALID", toGridValue > 0);
      
      if (toGridValue > 0)
        return false; // not current feeding  grid

        return (toGridValue < args.Power);
    });

    fromGridTrigger.registerRunListener(async (args) => {      
      var fromGridValue = +this.getDevices()[0].getCapabilityValue("grid_consumption_capability") * 1000;      
      this.log("TRIGGER", "fromGrid", fromGridValue, "arg", args.Power, "VALID", fromGridValue < 0);

      if (fromGridValue < 0)
        return false; // not current consuming from grid

      return (fromGridValue > args.Power);
    });

    batteryLevelBelowCard.registerRunListener(async (args) => {      
      var argPercentage = args.Percentage;
      var batteryLevel  = +this.getDevices()[0].getCapabilityValue("measure_battery");
      
      this.log("TRIGGER", "battery level below", batteryLevel, "arg", argPercentage, "VALID", batteryLevel < argPercentage);

      return (batteryLevel < argPercentage);
    });

    batteryLevelAboveCard.registerRunListener(async (args) => {      
      var argPercentage = args.Percentage;
      var batteryLevel  = +this.getDevices()[0].getCapabilityValue("measure_battery");
      
      this.log("TRIGGER", "battery level above", batteryLevel, "arg", argPercentage, "VALID", batteryLevel >= argPercentage);

      return (batteryLevel >= argPercentage);
    });

  }

}

