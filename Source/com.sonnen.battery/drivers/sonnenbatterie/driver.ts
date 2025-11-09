import Homey from 'homey';
import _ from 'underscore'; // eslint-disable-line @typescript-eslint/no-unused-vars
import { SonnenDriver } from '../../lib/SonnenDriver';
import { LocalizationService } from '../../lib/LocalizationService';
import { BatteryDevice } from './device';
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

    this.homey.flow.getActionCard("set_manual_charging")
      .registerRunListener(async (args) => this.handleManualCharging(args));
      
    this.homey.flow.getActionCard("set_manual_discharging")
      .registerRunListener(async (args) => this.handleManualDischarging(args));     

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

  private async handleSetTimeOfUse(args: { device: BatteryDevice, start: string, end: string, max_power: number }): Promise<void> {
    const timeStart = args.start;
    const timeEnd = args.end;
    const maxPower = args.max_power;

    const commandResult = await this.createSonnenBatterieClient(args.device).setScheduleEntry(timeStart, timeEnd, maxPower);
    this.log("Result", commandResult, args.start, args.end, args.max_power);
    LocalizationService.getInstance().throwLocalizedErrorIfAny(commandResult);
    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Set time-of-use between ${timeStart} and ${timeEnd} with max. ${maxPower}W.` });
    await args.device.refreshState(); // immediately refresh UI
  };

  private async handleSetTimeOfUseByStartTimeAndHours(args: { device: BatteryDevice, start: string, hours: number, max_power: number }): Promise<void> {
    const timeStart = args.start;
    const hours = args.hours;
    const maxPower = args.max_power;

    // Calculate end from timeStart and hours.
    const timeStartHours    = Number(timeStart.split(":")[0]);
    const timeStartMinutes  = Number(timeStart.split(":")[1]);
    const timeEndHours = (timeStartHours + hours) % 24; // Handle overflow.

    const timeStartHoursFormatted = this.zeroPad(timeStartHours, 2);
    const timeEndHoursFormatted = this.zeroPad(timeEndHours, 2);
    const timeStartMinutesFormatted = this.zeroPad(timeStartMinutes, 2);
    const timeEndMinutesFormatted = timeStartMinutesFormatted;

    const startTime: string = `${timeStartHoursFormatted}:${timeStartMinutesFormatted}`;
    const endTime: string = `${timeEndHoursFormatted}:${timeEndMinutesFormatted}`;

    const commandResult = await this.createSonnenBatterieClient(args.device).setScheduleEntry(startTime, endTime, maxPower);
    this.log("Result", commandResult, args.start, args.hours, args.max_power);
    LocalizationService.getInstance().throwLocalizedErrorIfAny(commandResult);
    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Set time-of-use between ${startTime} and ${endTime} with max. ${maxPower}W.` });
    await args.device.refreshState(); // immediately refresh UI
  }

  private async handleClearTimeOfUse(args: { device: BatteryDevice }): Promise<void> {
    const commandResult = await this.createSonnenBatterieClient(args.device).clearSchedule(); // Set empty schedule
    this.log("Result", commandResult);
    LocalizationService.getInstance().throwLocalizedErrorIfAny(commandResult);
    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Clear time-of-use.` });
    await args.device.refreshState(); // immediately refresh UI
  }

  private async handlePauseTimeOfUse(args: { device: BatteryDevice, start: string; end: string }): Promise<void> {
    const timeStart = args.start;
    const timeEnd = args.end;

    const commandResult = await this.createSonnenBatterieClient(args.device).setScheduleEntry(timeStart, timeEnd, 0);
    this.log("Result", commandResult, args.start, args.end);
    LocalizationService.getInstance().throwLocalizedErrorIfAny(commandResult);
    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Pause time-of-use between ${timeStart} and ${timeEnd}.` });
    await args.device.refreshState(); // immediately refresh UI
  }

  private async handleStartTimeOfUse(args: { device: BatteryDevice, power: number }): Promise<void> {
    const commandResult = await this.createSonnenBatterieClient(args.device).setScheduleEntry("00:00", "23:59", args.power); // Set full schedule
    this.log("Result", commandResult, args.power);
    LocalizationService.getInstance().throwLocalizedErrorIfAny(commandResult);
    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Start time-of-use (24h).` });
    await args.device.refreshState(); // immediately refresh UI
  }

  private async handleSwitchOperatingMode(args: { device: BatteryDevice, operating_mode: string }): Promise<void> {
    const commandResult = await this.createSonnenBatterieClient(args.device).setOperatingMode(args.operating_mode);
    this.log("Result", commandResult, args.operating_mode);
    LocalizationService.getInstance().throwLocalizedErrorIfAny(commandResult);
    const operatingModeText = LocalizationService.getInstance().resolveOperatingMode(args.operating_mode);
    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Changed operating mode to "${operatingModeText}"` });
    await args.device.refreshState(); // immediately refresh UI
  }

  private async handleSetPrognosisCharging(args: { device: BatteryDevice, active: boolean }): Promise<void> {
    const commandResult = await this.createSonnenBatterieClient(args.device).setPrognosisCharging(args.active)
    this.log("Result", commandResult, args.active);
    LocalizationService.getInstance().throwLocalizedErrorIfAny(commandResult);
    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Prognosis charging ${args.active ? "active" : "inactive"}` });
    await args.device.refreshState(); // immediately refresh UI
  }

  private async handleManualCharging(args: { device: BatteryDevice, power: number }): Promise<void> {
    const commandResult = await this.createSonnenBatterieClient(args.device).setSetpoint('charge', args.power);
    this.log("Result", commandResult, args.power);
    LocalizationService.getInstance().throwLocalizedErrorIfAny(commandResult);
    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Manual charging with max. ${args.power}W.` });
    await args.device.refreshState(); // immediately refresh UI
  }

  private async handleManualDischarging(args: { device: BatteryDevice, power: number }): Promise<void> {
    const commandResult = await this.createSonnenBatterieClient(args.device).setSetpoint('discharge', args.power);
    this.log("Result", commandResult, args.power);
    LocalizationService.getInstance().throwLocalizedErrorIfAny(commandResult);
    await this.homey.notifications.createNotification({ excerpt: `SonnenBatterie: Manual dicharging with max. ${args.power}W.` });
    await args.device.refreshState(); // immediately refresh UI
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

  private async handleOperatingModeEquals(args: { device: Homey.Device, operating_mode: string }): Promise<boolean> {
    const currentOperatingMode = args.device.getCapabilityValue("operating_mode_capability");
    const operatingMode = LocalizationService.getInstance().resolveOperatingMode(args.operating_mode);

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

