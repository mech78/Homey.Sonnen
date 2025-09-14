import Homey from 'homey';
import _ from 'underscore'; // eslint-disable-line @typescript-eslint/no-unused-vars
import { SonnenDriver } from '../../lib/SonnenDriver';
import { LocalizationService } from '../../lib/LocalizationService';
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

    this.homey.flow.getActionCard("switch_operating_mode")
      .registerRunListener(async (args) => this.handleSwitchOperatingMode(args));

    this.homey.flow.getActionCard("set_prognosis_charging")
      .registerRunListener(async (args) => this.handleSetPrognosisCharging(args));

    // Device-specific conditions:

    this.homey.flow.getConditionCard("battery_level_below")
      .registerRunListener(async (args) => this.handleBatteryLevelBelow(args));

    this.homey.flow.getConditionCard("battery_level_above_or_equal")
      .registerRunListener(async (args) => this.handleBatteryLevelAboveOrEqual(args));

    this.homey.flow.getConditionCard("operating_mode_equals")
      .registerRunListener(async (args) => this.handleOperatingModeEquals(args));

    this.homey.flow.getConditionCard("prognosis_charging_equals")
      .registerRunListener(async (args) => this.handlePrognosisChargingEquals(args));

    // Device-specific triggers (not needed for custom capabilities following the naming convention):

  }

  private async handleSetTimeOfUse(args: { device: Homey.Device, start: string, end: string, max_power: number }): Promise<void> {
    const timeStart = args.start;
    const timeEnd = args.end;
    const maxPower = args.max_power;

    const commandResult = await this.createSonnenBatterieClient(args.device).setScheduleEntry(timeStart, timeEnd, maxPower);
    this.log("Result", commandResult, args.start, args.end, args.max_power);
    LocalizationService.getInstance().throwLocalizedErrorIfAny(commandResult);
    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Set time-of-use between ${timeStart} and ${timeEnd} with maximum power ${maxPower}.` });
  };

  private async handleSetTimeOfUseByStartTimeAndHours(args: { device: Homey.Device, start: string, hours: number, max_power: number }): Promise<void> {
    const timeStart = args.start;
    const hours = args.hours;
    const maxPower = args.max_power;

    // Calculate end from timeStart and hours.
    const timeStartHours = +timeStart.split(":", 1)[0];
    const timeStartMinutes = timeStart.split(":", 2)[1];
    const timeEndHours = (timeStartHours + hours) % 24; // Handle overflow.
    const timeEndHoursFormatted = this.zeroPad(timeEndHours, 2);

    const timeEnd: string = `${timeEndHoursFormatted}:${timeStartMinutes}`;

    const commandResult = await this.createSonnenBatterieClient(args.device).setScheduleEntry(timeStart, timeEnd, maxPower);
    this.log("Result", commandResult, args.start, args.hours, args.max_power);
    LocalizationService.getInstance().throwLocalizedErrorIfAny(commandResult);
    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Set ToC-hours (${hours}) between ${timeStart} and ${timeEnd} with max power ${maxPower}.` });
  }

  private async handleClearTimeOfUse(args: { device: Homey.Device }): Promise<void> {
    const commandResult = await this.createSonnenBatterieClient(args.device).clearSchedule(); // Set empty schedule
    this.log("Result", commandResult);
    LocalizationService.getInstance().throwLocalizedErrorIfAny(commandResult);
    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Clear time-of-use.` });
  }

  private async handlePauseTimeOfUse(args: { device: Homey.Device, start: string; end: string }): Promise<void> {
    const timeStart = args.start;
    const timeEnd = args.end;

    const commandResult = await this.createSonnenBatterieClient(args.device).setScheduleEntry(timeStart, timeEnd, 0);
    this.log("Result", commandResult, args.start, args.end);
    LocalizationService.getInstance().throwLocalizedErrorIfAny(commandResult);
    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Pause time-of-use between ${timeStart} and ${timeEnd}.` });
  }

  private async handleStartTimeOfUse(args: { device: Homey.Device, power: number }): Promise<void> {
    const commandResult = await this.createSonnenBatterieClient(args.device).setScheduleEntry("00:00", "23:59", args.power); // Set full schedule
    this.log("Result", commandResult, args.power);
    LocalizationService.getInstance().throwLocalizedErrorIfAny(commandResult);
    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Start time-of-use.` });
  }

  private async handleSwitchOperatingMode(args: { device: Homey.Device, operating_mode: number }): Promise<void> {
    const commandResult = await this.createSonnenBatterieClient(args.device).setOperatingMode(args.operating_mode);
    this.log("Result", commandResult, args.operating_mode);
    LocalizationService.getInstance().throwLocalizedErrorIfAny(commandResult);
  }

  private async handleSetPrognosisCharging(args: { device: Homey.Device, active: boolean }): Promise<void> {
    const commandResult = await this.createSonnenBatterieClient(args.device).setPrognosisCharging(args.active)
    this.log("Result", commandResult, args.active);
    LocalizationService.getInstance().throwLocalizedErrorIfAny(commandResult);
  }

  private async handleBatteryLevelBelow(args: { device: Homey.Device, percentage: number }): Promise<boolean> {
    const argPercentage = args.percentage;
    const batteryLevel = +args.device.getCapabilityValue("measure_battery");

    this.log("CONDITION", "battery level below", batteryLevel, "arg", argPercentage, "VALID", batteryLevel < argPercentage);

    return (batteryLevel < argPercentage);
  }

  private async handleBatteryLevelAboveOrEqual(args: { device: Homey.Device, percentage: number }): Promise<boolean> {
    const argPercentage = args.percentage;
    const batteryLevel = +args.device.getCapabilityValue("measure_battery");

    this.log("CONDITION", "battery level above", batteryLevel, "arg", argPercentage, "VALID", batteryLevel >= argPercentage);

    return (batteryLevel >= argPercentage);
  }

  private async handleOperatingModeEquals(args: { device: Homey.Device, operating_mode: number }): Promise<boolean> {
    const currentOperatingMode = args.device.getCapabilityValue("operating_mode_capability");
    const operatingMode = LocalizationService.getInstance().resolveOperatingMode("" + args.operating_mode);

    const result = currentOperatingMode === operatingMode;
    this.log("CONDITION", "operating mode", currentOperatingMode, "arg", args.operating_mode, "->", operatingMode, "VALID", result);

    return result;
  }

    private async handlePrognosisChargingEquals(args: { device: Homey.Device, active: boolean }): Promise<boolean> {
    const currentPrognosisCharging = args.device.getCapabilityValue("prognosis_charging_capability") as boolean;

    const result = currentPrognosisCharging === args.active;
    this.log("CONDITION", "prognosis charging", currentPrognosisCharging, "arg", args.active, "VALID", result);

    return result;
  }

  private zeroPad(num: number, places: number): string {
    return String(num).padStart(places, '0');
  }

}

