import _ from 'underscore';
import { SonnenBatterieClient } from '../../service/SonnenBatterieClient';
import { SonnenCommandResult } from '../../domain/SonnenCommandResult';
import { SonnenDriver } from '../../lib/SonnenDriver';

module.exports = class SonnenBatterieDriver extends SonnenDriver {

  private sonnenBatterieClient!: SonnenBatterieClient;

  async onInit() {
    this.deviceName = this.homey.__('device.battery');
    this.deviceId = "sonnenBattery";
    super.onInit();

    const batteryAuthToken: string = this.homey.settings.get("BatteryAuthToken");
    this.sonnenBatterieClient = new SonnenBatterieClient(batteryAuthToken);

    // Device-specific actions:

    this.homey.flow.getActionCard("set_time_of_use")
      .registerRunListener(async (args) => this.handleSetTimeOfUse(args));

    this.homey.flow.getActionCard("set_time_of_use_hours")
      .registerRunListener(async (args) => this.handleSetTimeOfUseByStartTimeAndHours(args));

    this.homey.flow.getActionCard("set_time_of_use_hours_string")
      .registerRunListener(async (args) => this.handleSetTimeOfUseByStartTimeAndHours(args));

    this.homey.flow.getActionCard("reset_time_of_use")
      .registerRunListener(async () => this.handleClearTimeOfUse());

    this.homey.flow.getActionCard("pause_time_of_use")
      .registerRunListener(async (args) => this.handlePauseTimeOfUse(args));

    this.homey.flow.getActionCard("start_charge")
      .registerRunListener(async (args) => this.handleStartTimeOfUse(args));

    this.homey.flow.getActionCard("stop_charge")
      .registerRunListener(async () => this.handleClearTimeOfUse());

    // Device-specific conditions:

    this.homey.flow.getConditionCard("battery_level_below")
      .registerRunListener(async (args) => this.handleBatteryLevelBelow(args));

    this.homey.flow.getConditionCard("battery_level_above_or_equal")
      .registerRunListener(async (args) => this.handleBatteryLevelAboveOrEqual(args));
  }

  private async handleSetTimeOfUse(args: { start: string, end: string, maxPower: number }) {
    const baseUrl: string = SonnenBatterieClient.GetBaseUrl(this.getDevices()[0].getStore().lanip);
    const timeStart: string = args.start;
    const timeEnd: string = args.end;
    const maxPower: number = args.maxPower;

    this.log("handleSetTimeOfUse", args.start, args.end, args.maxPower);
    this.log("handleSetTimeOfUse", typeof args.start, typeof args.end, typeof args.maxPower);

    const commandResult: SonnenCommandResult = await this.sonnenBatterieClient.SetSchedule(baseUrl, timeStart, timeEnd, maxPower);
    this.log("Result", commandResult, args.maxPower);

    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Set time-of-use between ${timeStart} and ${timeEnd} with maximum power ${maxPower}.` });

    if (commandResult.HasError) {
      throw Error(commandResult.error);
    }
  };

  private async handleSetTimeOfUseByStartTimeAndHours(args: { start: string, hours: number, maxPower: number }) {
    const baseUrl: string = SonnenBatterieClient.GetBaseUrl(this.getDevices()[0].getStore().lanip);
    const timeStart: string = args.start;
    const hours: number = args.hours;
    const maxPower: number = args.maxPower;

    this.log("handleSetTimeOfUseByStartTimeAndHours", args.start, args.hours, args.maxPower);
    this.log("handleSetTimeOfUseByStartTimeAndHours", typeof args.start, typeof args.hours, typeof args.maxPower);

    // Calculate end from timeStart and hours.
    const timeStartHours: number = +timeStart.split(":", 1)[0];
    const timeStartMinutes: string = timeStart.split(":", 2)[1];
    const timeEndHours: number = (timeStartHours + hours) % 24; // Handle overflow.
    const timeEndHoursFormatted: string = this.zeroPad(timeEndHours, 2);

    const timeEnd: string = `${timeEndHoursFormatted}:${timeStartMinutes}`;

    const commandResult: SonnenCommandResult = await this.sonnenBatterieClient.SetSchedule(baseUrl, timeStart, timeEnd, maxPower);
    this.log("Result", commandResult, args.maxPower);

    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Set ToC-hours (${hours}) between ${timeStart} and ${timeEnd} with max power ${maxPower}.` });

    if (commandResult.HasError) {
      throw Error(commandResult.error);
    }
  }

  private async handleClearTimeOfUse() {
    const baseUrl: string = SonnenBatterieClient.GetBaseUrl(this.getDevices()[0].getStore().lanip);
    // Set empty schedule

    const commandResult: SonnenCommandResult = await this.sonnenBatterieClient.ClearSchedule(baseUrl);
    this.log("Result", commandResult);

    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Clear time-of-use.` });

    if (commandResult.HasError) {
      throw Error(commandResult.error);
    }
  }

  private async handlePauseTimeOfUse(args: { start: string; end: string }) {
    const baseUrl: string = SonnenBatterieClient.GetBaseUrl(this.getDevices()[0].getStore().lanip);
    const timeStart: string = args.start;
    const timeEnd: string = args.end;

    const commandResult: SonnenCommandResult = await this.sonnenBatterieClient.SetSchedule(baseUrl, timeStart, timeEnd, 0);
    this.log("Result", commandResult, args.start, args.end);

    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Pause time-of-use between ${timeStart} and ${timeEnd}.` });

    if (commandResult.HasError) {
      throw Error(commandResult.error);
    }
  }

  private async handleStartTimeOfUse(args: { power: number }) {
    const baseUrl: string = SonnenBatterieClient.GetBaseUrl(this.getDevices()[0].getStore().lanip);
    // Set full schedule

    const commandResult: SonnenCommandResult = await this.sonnenBatterieClient.SetSchedule(baseUrl, "00:00", "23:59", args.power);
    this.log("Result", commandResult, args.power);

    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Start time-of-use.` });

    if (commandResult.HasError) {
      throw Error(commandResult.error);
    }
  }

  private async handleBatteryLevelBelow(args: { percentage: number }) {
    const argPercentage: number = args.percentage;
    const batteryLevel: number = +this.getDevices()[0].getCapabilityValue("measure_battery");

    this.log("TRIGGER", "battery level below", batteryLevel, "arg", argPercentage, "VALID", batteryLevel < argPercentage);

    return (batteryLevel < argPercentage);
  }

  private async handleBatteryLevelAboveOrEqual(args: { percentage: number }) {
    const argPercentage: number = args.percentage;
    const batteryLevel: number = +this.getDevices()[0].getCapabilityValue("measure_battery");

    this.log("TRIGGER", "battery level above", batteryLevel, "arg", argPercentage, "VALID", batteryLevel >= argPercentage);

    return (batteryLevel >= argPercentage);
  }

  private zeroPad(num: number, places: number): string {
    return String(num).padStart(places, '0');
  }

}

