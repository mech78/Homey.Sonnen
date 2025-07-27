import _ from 'underscore';
import { SonnenBatterieClient } from '../../service/SonnenBatterieClient';
import { SonnenDriver } from '../../lib/SonnenDriver';

module.exports = class SonnenBatterieDriver extends SonnenDriver {

  private sonnenBatterieClient!: SonnenBatterieClient;

  async onInit() {
    this.deviceName = this.homey.__('device.battery');
    this.deviceId = "sonnenBattery";
    super.onInit();

    var batteryAuthToken = this.homey.settings.get("BatteryAuthToken");
    this.sonnenBatterieClient = new SonnenBatterieClient(batteryAuthToken);

    // Device-specific actions:

    this.homey.flow.getActionCard("set_time_of_use")
      .registerRunListener(async (args) => this.handleSetTimeOfUse(args));

    this.homey.flow.getActionCard("set_time_of_use_hours")
      .registerRunListener(async (args) => this.handleSetTimeOfUseByStartTimeAndHours(args));

    this.homey.flow.getActionCard("set_time_of_use_hours_string")
      .registerRunListener(async (args) => this.handleSetTimeOfUseByStartTimeAndHours(args));

    this.homey.flow.getActionCard("reset_time_of_use")
      .registerRunListener(async () => this.clearTimeOfUse());

    this.homey.flow.getActionCard("pause_time_of_use")
      .registerRunListener(async (args) => this.pauseTimeOfUse(args));

    this.homey.flow.getActionCard("start_charge")
      .registerRunListener(async (args) => this.startTimeOfUse(args));

    this.homey.flow.getActionCard("stop_charge")
      .registerRunListener(async () => this.clearTimeOfUse());

    // Device-specific conditions:

    this.homey.flow.getConditionCard("battery_level_below")
      .registerRunListener(async (args) => this.handleBatteryLevelBelow(args));

    this.homey.flow.getConditionCard("battery_level_above_or_equal")
      .registerRunListener(async (args) => this.handleBatteryLevelAboveOrEqual(args));
  }

  async handleSetTimeOfUse(args: {start: string, end: string, maxPower: number}) {
    var baseUrl = SonnenBatterieClient.GetBaseUrl(this.getDevices()[0].getStore().lanip);
    var timeStart = args.start;
    var timeEnd = args.end;
    var maxPower = args.maxPower;

    this.log("handleSetTimeOfUse", args.start, args.end, args.maxPower);
    this.log("handleSetTimeOfUse", typeof args.start, typeof args.end, typeof args.maxPower);

    var commandResult = await this.sonnenBatterieClient.SetSchedule(baseUrl, timeStart, timeEnd, maxPower);
    this.log("Result", commandResult, args.maxPower);

    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Set time-of-use between ${timeStart} and ${timeEnd} with maximum power ${maxPower}.` });

    if (commandResult.HasError) {
      throw Error(commandResult.error);
    }
  };

  async handleSetTimeOfUseByStartTimeAndHours(args: { start: string, hours: number, maxPower: number }) {
    var baseUrl = SonnenBatterieClient.GetBaseUrl(this.getDevices()[0].getStore().lanip);
    var timeStart = args.start;
    var hours = args.hours;
    var maxPower = args.maxPower;

    this.log("handleSetTimeOfUseByStartTimeAndHours", args.start, args.hours, args.maxPower);
    this.log("handleSetTimeOfUseByStartTimeAndHours", typeof args.start, typeof args.hours, typeof args.maxPower);

    // Calculate end from timeStart and hours.
    var timeStartHours = +timeStart.split(":", 1)[0];
    var timeStartMinutes = timeStart.split(":", 2)[1];
    var timeEndHours = (timeStartHours + hours) % 24; // Handle overflow.
    var timeEndHoursFormatted = this.zeroPad(timeEndHours, 2);

    var timeEnd = `${timeEndHoursFormatted}:${timeStartMinutes}`;

    var commandResult = await this.sonnenBatterieClient.SetSchedule(baseUrl, timeStart, timeEnd, maxPower);
    this.log("Result", commandResult, args.maxPower);

    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Set ToC-hours (${hours}) between ${timeStart} and ${timeEnd} with max power ${maxPower}.` });

    if (commandResult.HasError) {
      throw Error(commandResult.error);
    }

  }

  async clearTimeOfUse() {
    var baseUrl = SonnenBatterieClient.GetBaseUrl(this.getDevices()[0].getStore().lanip);
    // Set empty schedule

    var commandResult = await this.sonnenBatterieClient.ClearSchedule(baseUrl);
    this.log("Result", commandResult);

    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Clear time-of-use.` });

    if (commandResult.HasError) {
      throw Error(commandResult.error);
    }

  }

  async pauseTimeOfUse(args: any) {
    var baseUrl = SonnenBatterieClient.GetBaseUrl(this.getDevices()[0].getStore().lanip);
    var timeStart = args.start;
    var timeEnd = args.end;

    var commandResult = await this.sonnenBatterieClient.SetSchedule(baseUrl, timeStart, timeEnd, 0);
    this.log("Result", commandResult, args.power);

    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Pause time-of-use between ${timeStart} and ${timeEnd}.` });

    if (commandResult.HasError) {
      throw Error(commandResult.error);
    }
  }

  async startTimeOfUse(args: any) {
    var baseUrl = SonnenBatterieClient.GetBaseUrl(this.getDevices()[0].getStore().lanip);
    // Set full schedule

    var commandResult = await this.sonnenBatterieClient.SetSchedule(baseUrl, "00:00", "23:59", args.power);
    this.log("Result", commandResult, args.power);

    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Start time-of-use.` });

    if (commandResult.HasError) {
      throw Error(commandResult.error);
    }
  }

 

  async handleBatteryLevelBelow(args: any) {
    var argPercentage = args.percentage;
    var batteryLevel = +this.getDevices()[0].getCapabilityValue("measure_battery");

    this.log("TRIGGER", "battery level below", batteryLevel, "arg", argPercentage, "VALID", batteryLevel < argPercentage);

    return (batteryLevel < argPercentage);
  }

  async handleBatteryLevelAboveOrEqual(args: any) {
    var argPercentage = args.percentage;
    var batteryLevel = +this.getDevices()[0].getCapabilityValue("measure_battery");

    this.log("TRIGGER", "battery level above", batteryLevel, "arg", argPercentage, "VALID", batteryLevel >= argPercentage);

    return (batteryLevel >= argPercentage);
  }

  private zeroPad(num: any, places: any) {
    return String(num).padStart(places, '0');
  }

}

