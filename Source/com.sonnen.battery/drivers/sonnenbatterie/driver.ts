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
    await this.handleSetTimeOfUseInternal(args.device, args.start, args.end, args.max_power);
  };

  private async handleSetTimeOfUseByStartTimeAndHours(args: { device: BatteryDevice, start: string, hours: number, max_power: number }): Promise<void> {
    const argTimeStart = args.start.trim();

    // Calculate end from timeStart and hours.
    const timeStartHours    = Number(argTimeStart.split(":")[0]);
    const timeStartMinutes  = Number(argTimeStart.split(":")[1]);
    const timeEndHours = (timeStartHours + args.hours) % 24; // Handle overflow.

    const timeStartHoursFormatted = this.zeroPad(timeStartHours, 2);
    const timeEndHoursFormatted = this.zeroPad(timeEndHours, 2);
    const timeStartMinutesFormatted = this.zeroPad(timeStartMinutes, 2);
    const timeEndMinutesFormatted = timeStartMinutesFormatted;

    const timeStart: string = `${timeStartHoursFormatted}:${timeStartMinutesFormatted}`;
    const timeEnd: string = `${timeEndHoursFormatted}:${timeEndMinutesFormatted}`;

    await this.handleSetTimeOfUseInternal(args.device, timeStart, timeEnd, args.max_power);
  }

  private async handleSetTimeOfUseInternal(device: BatteryDevice, timeStart: string, timeEnd: string, maxPower: number) {
    try {
      await this.createSonnenBatterieClient(device).setScheduleEntry(timeStart, timeEnd, maxPower);

      const notification = this.homey.__("notification.setToU", { startTime: timeStart, endTime: timeEnd, maxPower: maxPower });
      await this.homey.notifications.createNotification({ excerpt: notification });

      await device.refreshState(); // immediately refresh UI
    } catch (error) {
      LocalizationService.getInstance().throwLocalizedError(error);
    }
  }

  private async handleClearTimeOfUse(args: { device: BatteryDevice }): Promise<void> {
    try {
      await this.createSonnenBatterieClient(args.device).clearSchedule(); // Set empty schedule
      
      const notification = this.homey.__("notification.clearedToU");
      await this.homey.notifications.createNotification({ excerpt: notification });
      
      await args.device.refreshState(); // immediately refresh UI
    } catch (error) {
      LocalizationService.getInstance().throwLocalizedError(error);
    }
  }

  private async handlePauseTimeOfUse(args: { device: BatteryDevice, start: string; end: string }): Promise<void> {
    const timeStart = args.start;
    const timeEnd = args.end;

    try {
      await this.createSonnenBatterieClient(args.device).setScheduleEntry(timeStart, timeEnd, 0);
      
      const notification = this.homey.__("notification.pausedToU", { startTime: timeStart, endTime: timeEnd});
      await this.homey.notifications.createNotification({ excerpt: notification });

      await args.device.refreshState(); // immediately refresh UI
    } catch (error) {
      LocalizationService.getInstance().throwLocalizedError(error);
    }
  }

  private async handleStartTimeOfUse(args: { device: BatteryDevice, power: number }): Promise<void> {
    try {
      await this.createSonnenBatterieClient(args.device).setScheduleEntry("00:00", "23:59", args.power); // Set full schedule
      
      const notification = this.homey.__("notification.startedToU");
      await this.homey.notifications.createNotification({ excerpt: notification });
      
      await args.device.refreshState(); // immediately refresh UI
    } catch (error) {
      LocalizationService.getInstance().throwLocalizedError(error);
    }
  }

  private async handleSwitchOperatingMode(args: { device: BatteryDevice, operating_mode: string }): Promise<void> {
    try {
      await this.createSonnenBatterieClient(args.device).setOperatingMode(args.operating_mode);
      const operatingModeText = LocalizationService.getInstance().resolveOperatingMode(args.operating_mode);

      const notification = this.homey.__("notification.changedOperatingMode", { operatingMode: operatingModeText });
      await this.homey.notifications.createNotification({ excerpt: notification });

      await args.device.refreshState(); // immediately refresh UI
    } catch (error) {
      LocalizationService.getInstance().throwLocalizedError(error);
    }
  }

  private async handleSetPrognosisCharging(args: { device: BatteryDevice, active: boolean }): Promise<void> {
    try {
      await this.createSonnenBatterieClient(args.device).setPrognosisCharging(args.active)

      const state = this.homey.__(args.active ? "active" : "inactive");
      const notification = this.homey.__("notification.changedPrognosisCharging", { state: state });
      await this.homey.notifications.createNotification({ excerpt: notification });  

      await args.device.refreshState(); // immediately refresh UI
    } catch (error) {
      LocalizationService.getInstance().throwLocalizedError(error);
    }
  }

  private async handleManualCharging(args: { device: BatteryDevice, power: number }): Promise<void> {
    try {
      await this.createSonnenBatterieClient(args.device).setSetpoint('charge', args.power);

      const notification = this.homey.__("notification.startedManualCharging", { maxPower: args.power });
      await this.homey.notifications.createNotification({ excerpt: notification });  

      await args.device.refreshState(); // immediately refresh UI
    } catch (error) {
      LocalizationService.getInstance().throwLocalizedError(error);
    }
  }

  private async handleManualDischarging(args: { device: BatteryDevice, power: number }): Promise<void> {
    try {
      await this.createSonnenBatterieClient(args.device).setSetpoint('discharge', args.power);

      const notification = this.homey.__("notification.startedManualDischarging", { maxPower: args.power });
      await this.homey.notifications.createNotification({ excerpt: notification });  

      await args.device.refreshState(); // immediately refresh UI
    } catch (error) {
      LocalizationService.getInstance().throwLocalizedError(error);
    }
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

