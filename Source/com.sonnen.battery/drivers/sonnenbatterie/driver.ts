import Homey from 'homey';
import _ from 'underscore'; // eslint-disable-line @typescript-eslint/no-unused-vars
import { SonnenCommandResult } from '../../domain/SonnenCommandResult';
import { SonnenDriver } from '../../lib/SonnenDriver';
module.exports = class SonnenBatterieDriver extends SonnenDriver {

  async onInit(): Promise<void> {
    this.deviceName = this.homey.__('device.battery');
    this.deviceId = "sonnenBattery";
    super.onInit();

    // Device-specific actions:

    this.homey.flow.getActionCard("set_time_of_use")
      .registerRunListener(async (args) => this.handleSetTimeOfUse(args));

    this.homey.flow.getActionCard("set_time_of_use_hours")
      .registerRunListener(async (args) => this.handleSetTimeOfUseByStartTimeAndHours(args));

    this.homey.flow.getActionCard("set_time_of_use_hours_string")
      .registerRunListener(async (args) => this.handleSetTimeOfUseByStartTimeAndHours(args));

    this.homey.flow.getActionCard("reset_time_of_use")
      .registerRunListener(async (args) => this.handleClearTimeOfUse(args));

    this.homey.flow.getActionCard("pause_time_of_use")
      .registerRunListener(async (args) => this.handlePauseTimeOfUse(args));

    this.homey.flow.getActionCard("start_charge")
      .registerRunListener(async (args) => this.handleStartTimeOfUse(args));

    this.homey.flow.getActionCard("stop_charge")
      .registerRunListener(async (args) => this.handleClearTimeOfUse(args));

    // Device-specific conditions:

    this.homey.flow.getConditionCard("battery_level_below")
      .registerRunListener(async (args) => this.handleBatteryLevelBelow(args));

    this.homey.flow.getConditionCard("battery_level_above_or_equal")
      .registerRunListener(async (args) => this.handleBatteryLevelAboveOrEqual(args));
  }

  private async handleSetTimeOfUse(args: { device: Homey.Device, start: string, end: string, maxPower: number }): Promise<void> {
    const timeStart = args.start;
    const timeEnd = args.end;
    const maxPower = args.maxPower;

    this.log("handleSetTimeOfUse", args.start, args.end, args.maxPower);
    this.log("handleSetTimeOfUse", typeof args.start, typeof args.end, typeof args.maxPower);

    const commandResult: SonnenCommandResult = await this.createSonnenBatterieClient(args.device).setSchedule(timeStart, timeEnd, maxPower);
    this.log("Result", commandResult, args.maxPower);

    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Set time-of-use between ${timeStart} and ${timeEnd} with maximum power ${maxPower}.` });

    if (commandResult.hasError) {
      throw Error(commandResult.error);
    }
  };

  private async handleSetTimeOfUseByStartTimeAndHours(args: { device: Homey.Device, start: string, hours: number, maxPower: number }): Promise<void> {
    const timeStart = args.start;
    const hours = args.hours;
    const maxPower = args.maxPower;

    this.log("handleSetTimeOfUseByStartTimeAndHours", args.start, args.hours, args.maxPower);
    this.log("handleSetTimeOfUseByStartTimeAndHours", typeof args.start, typeof args.hours, typeof args.maxPower);

    // Calculate end from timeStart and hours.
    const timeStartHours = +timeStart.split(":", 1)[0];
    const timeStartMinutes = timeStart.split(":", 2)[1];
    const timeEndHours = (timeStartHours + hours) % 24; // Handle overflow.
    const timeEndHoursFormatted = this.zeroPad(timeEndHours, 2);

    const timeEnd: string = `${timeEndHoursFormatted}:${timeStartMinutes}`;

    const commandResult: SonnenCommandResult = await this.createSonnenBatterieClient(args.device).setSchedule(timeStart, timeEnd, maxPower);
    this.log("Result", commandResult, args.maxPower);

    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Set ToC-hours (${hours}) between ${timeStart} and ${timeEnd} with max power ${maxPower}.` });

    if (commandResult.hasError) {
      throw Error(commandResult.error);
    }
  }

  private async handleClearTimeOfUse(args: { device: Homey.Device }): Promise<void> {
    // Set empty schedule

    const commandResult: SonnenCommandResult = await this.createSonnenBatterieClient(args.device).clearSchedule();
    this.log("Result", commandResult);

    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Clear time-of-use.` });

    if (commandResult.hasError) {
      throw Error(commandResult.error);
    }
  }

  private async handlePauseTimeOfUse(args: { device: Homey.Device, start: string; end: string }): Promise<void> {
    const timeStart = args.start;
    const timeEnd = args.end;

    const commandResult: SonnenCommandResult = await this.createSonnenBatterieClient(args.device).setSchedule(timeStart, timeEnd, 0);
    this.log("Result", commandResult, args.start, args.end);

    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Pause time-of-use between ${timeStart} and ${timeEnd}.` });

    if (commandResult.hasError) {
      throw Error(commandResult.error);
    }
  }

  private async handleStartTimeOfUse(args: { device: Homey.Device, power: number }): Promise<void> {
    // Set full schedule

    this.log("handleStartTimeOfUse", args.power);
    const commandResult: SonnenCommandResult = await this.createSonnenBatterieClient(args.device).setSchedule("00:00", "23:59", args.power);
    this.log("Result", commandResult, args.power);

    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Start time-of-use.` });

    if (commandResult.hasError) {
      throw Error(commandResult.error);
    }
  }

  private async handleBatteryLevelBelow(args: { device: Homey.Device, percentage: number }): Promise<boolean> {
    const argPercentage = args.percentage;
    const batteryLevel = +args.device.getCapabilityValue("measure_battery");

    this.log("TRIGGER", "battery level below", batteryLevel, "arg", argPercentage, "VALID", batteryLevel < argPercentage);

    return (batteryLevel < argPercentage);
  }

  private async handleBatteryLevelAboveOrEqual(args: { device: Homey.Device, percentage: number }): Promise<boolean> {
    const argPercentage = args.percentage;
    const batteryLevel = +args.device.getCapabilityValue("measure_battery");

    this.log("TRIGGER", "battery level above", batteryLevel, "arg", argPercentage, "VALID", batteryLevel >= argPercentage);

    return (batteryLevel >= argPercentage);
  }

  private zeroPad(num: number, places: number): string {
    return String(num).padStart(places, '0');
  }

}

