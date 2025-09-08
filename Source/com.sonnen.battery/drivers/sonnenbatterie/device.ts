import _ from 'underscore';
import { SonnenBatterieClient } from '../../service/SonnenBatterieClient';
import { SonnenDevice } from '../../lib/SonnenDevice';
import { SonnenState } from '../../domain/SonnenState';
import { TimeOfUseSchedule } from '../../domain/TimeOfUse';
import { LocalizedError } from '../../domain/LocalizedError';
import { LocalizationService } from '../../lib/LocalizationService';

module.exports = class BatteryDevice extends SonnenDevice {
  private state: SonnenState = new SonnenState();
  private updateIntervalId: NodeJS.Timeout | undefined;

  async onInit() {
    super.onInit();

    await this.gracefullyAddOrRemoveCapabilities();
    this.registerResetMetersButton();

    const batteryPullInterval = +(this.homey.settings.get('BatteryPullInterval') || '30');

    let storedState: SonnenState;
    try {
      this.log('Retrieving stored state...');
      storedState = this.homey.settings.get('deviceState') || this.state;
    } catch (e) {
      this.log('Failed to retrieve stored state, use new state', e);
      storedState = this.state;
    }
    this.state.updateState(storedState); // apply stored state to current state
    this.state.updateState({ lastUpdate: null });
    this.log('Retrieved stored state: ' + JSON.stringify(this.state, null, 2));

    // Pull battery status regularly
    this.updateIntervalId = this.homey.setInterval(async () => {
      this.state.updateState(await this.loadLatestState(this.state, this.getSetting("device-discovery") ?? true));
    }, batteryPullInterval * 1000);

    // Do an initial load
    this.state.updateState(await this.loadLatestState(this.state, this.getSetting("device-discovery") ?? true));
  }

  async onDeleted() {
    if (this.updateIntervalId) {
      this.homey.clearInterval(this.updateIntervalId);
    }
    // Store current state
    this.homey.settings.set('deviceState', this.state);

    super.onDeleted();
  }

  async onUninit() {
    // Store current state
    this.homey.settings.set('deviceState', this.state);

    super.onUninit();
  }

  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null; };
    newSettings: { [key: string]: boolean | string | number | undefined | null; };
    changedKeys: string[];
  }): Promise<string | void> {
    super.onSettings({ oldSettings, newSettings, changedKeys });

    if (_.contains(changedKeys, "device-ip")) {
      const newDeviceIP = newSettings["device-ip"] as string;
      this.log("Settings", "IP", newDeviceIP);

      if (newDeviceIP && !_.isEmpty(newDeviceIP.trim())) {
        const ipv4Regex = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/; // "pattern" property in json doesn't appear to work
        if (!ipv4Regex.test(newDeviceIP)) {
          LocalizationService.getInstance().throwLocalizedError(new LocalizedError("error.validation.invalid_ip_format"));
        }
      }
    }

    if (_.contains(changedKeys, "device-discovery")) {
      const useAutoDiscovery = newSettings["device-discovery"] as boolean;
      this.log("Settings", "AutoDiscovery", useAutoDiscovery);

      if (useAutoDiscovery) {
        const discoveredIP = await SonnenBatterieClient.findBatteryIP(this.getData().id);
        if (!discoveredIP) {
          LocalizationService.getInstance().throwLocalizedError(new LocalizedError("connection.error_no_batteries"));
        }
      }
    }

    if (_.contains(changedKeys, "operating-mode")) {
      const operatingMode = newSettings["operating-mode"] as number;
      this.log("Settings", "OperatingMode", operatingMode);

      const result = await this.createSonnenBatterieClient().setOperationMode(operatingMode);
      LocalizationService.getInstance().throwLocalizedErrorIfAny(result);
    }

    if (_.contains(changedKeys, "prognosis-charging")) {
      const prognosisCharging = newSettings["prognosis-charging"] as boolean;
      this.log("Settings", "PrognosisCharging", prognosisCharging);

      const result = await this.createSonnenBatterieClient().setPrognosisCharging(prognosisCharging);
      LocalizationService.getInstance().throwLocalizedErrorIfAny(result);
    }

    if (_.contains(changedKeys, "time-of-use-schedule")) {
      const scheduleRaw = newSettings["time-of-use-schedule"] as string;
      this.log("Settings", "TimeOfUseSchedule", scheduleRaw);

      const schedule = TimeOfUseSchedule.fromString(scheduleRaw); // TODO: localize all errors somewhere
      const result = await this.createSonnenBatterieClient().setSchedule(schedule);
      LocalizationService.getInstance().throwLocalizedErrorIfAny(result);
    }

  }

  /**
   * Homey SDK3's new Date() is always in UTC but SonnenBatterie timestamps are local,
   * so match with Homey's local timezone
   * @returns {Date}
   */
  private getLocalNow(): Date {
    const timezone = this.homey.clock.getTimezone() as string;
    return new Date(
      new Date().toLocaleString('en-US', { hour12: false, timeZone: timezone })
    );
  }

  private registerResetMetersButton() {
    this.registerCapabilityListener('button.reset_meter', async () => {
      this.state = new SonnenState({ lastUpdate: this.getLocalNow() }); // TODO: currently deletes all sums, not just daily sums. Might want to split into two buttons, one for daily reset and one for total reset.
    });
  }

  private async gracefullyAddOrRemoveCapabilities() {
    // https://apps.developer.homey.app/guides/how-to-breaking-changes

    // Baseline version 1.3.1
    let toAddAfter1_3_1: string[] = [
      'to_battery_capability',
      'from_battery_capability',
      'to_battery_daily_capability',
      'from_battery_daily_capability',
      'to_battery_total_capability',
      'from_battery_total_capability',
      'capacity_remaining_capability',
      'operating_mode_capability',
      'prognosis_charging_capability'
    ];

    if (this.isEnergyFullySupported()) {
      toAddAfter1_3_1 = [
        ...toAddAfter1_3_1,
        'meter_power.charged',
        'meter_power.discharged'
      ];
    }

    let toRemoveAfter1_3_1: string[] = [
      'meter_power',
      'production_capability',
      'consumption_capability',
      'consumption_daily_capability',
      'grid_feed_in_capability',
      'grid_feed_in_daily_capability',
      'grid_consumption_capability',
      'grid_consumption_daily_capability',
      'autarky_capability',
      'self_consumption_capability'
    ];

    if (!this.isEnergyFullySupported()) {
      toRemoveAfter1_3_1 = [
        ...toRemoveAfter1_3_1,
        'meter_power.charged',
        'meter_power.discharged'
      ];
    }

    for (const capability of toAddAfter1_3_1) {
      if (!this.hasCapability(capability)) {
        await this.addCapability(capability);
      }
    }

    for (const capability of toRemoveAfter1_3_1) {
      if (this.hasCapability(capability)) {
        await this.removeCapability(capability);
      }
    }

    // TODO: maybe add a gracefully migration from store-based "autodiscovery" and "lanip" to settings-based "device-discovery" and "device-ip"
  }

  private async loadLatestState(lastState: SonnenState, retryOnError = true): Promise<SonnenState> {
    try {
      const client = this.createSonnenBatterieClient();
      const newState = await client.getStatus();

      // Update all capabilities
      await this.updateCapabilities(newState, lastState);

      return newState;
    } catch (error) {
      this.error('Error retrieving status:', error);

      // Retry once more
      if (retryOnError) {
        this.log('Retrying to load latest state...');
        return this.loadLatestState(lastState, false);
      }

      // Return last known state
      return lastState;
    }
  }

  private async updateCapabilities(newState: SonnenState, lastState: SonnenState) {
    // Update battery level
    await this.setCapabilityValue('measure_battery', newState.currentBatteryChargePercentage);

    // Update grid feed-in and consumption
    await this.setCapabilityValue('measure_power.grid_feed_in', newState.gridFeedInWatts);
    await this.setCapabilityValue('measure_power.grid_consumption', newState.gridConsumptionWatts);

    // Update production and consumption
    await this.setCapabilityValue('measure_power.production', newState.productionWatts);
    await this.setCapabilityValue('measure_power.consumption', newState.consumptionWatts);

    // Update battery charge/discharge
    await this.setCapabilityValue('measure_power.to_battery', newState.batteryChargingWatts);
    await this.setCapabilityValue('measure_power.from_battery', newState.batteryDischargingWatts);

    // Update daily values
    await this.setCapabilityValue('meter_power.to_battery.daily', newState.batteryChargedTodayWh);
    await this.setCapabilityValue('meter_power.from_battery.daily', newState.batteryDischargedTodayWh);

    // Update total values
    await this.setCapabilityValue('meter_power.to_battery.total', newState.batteryChargedTotalWh);
    await this.setCapabilityValue('meter_power.from_battery.total', newState.batteryDischargedTotalWh);

    // Update remaining capacity
    await this.setCapabilityValue('capacity_remaining_capability', newState.remainingCapacityWh);

    // Update operating mode
    await this.setCapabilityValue('operating_mode_capability', newState.operatingMode);

    // Update prognosis charging
    await this.setCapabilityValue('prognosis_charging_capability', newState.prognosisChargingEnabled);

    // Update autarky and self consumption
    await this.setCapabilityValue('autarky_capability', newState.autarkyPercent);
    await this.setCapabilityValue('self_consumption_capability', newState.selfConsumptionPercent);

    // Update energy meters if supported
    if (this.isEnergyFullySupported()) {
      await this.setCapabilityValue('meter_power.charged', newState.batteryChargedTotalWh / 1000);
      await this.setCapabilityValue('meter_power.discharged', newState.batteryDischargedTotalWh / 1000);
    }

    // Trigger flows based on state changes
    this.triggerFlows(newState, lastState);
  }

  private triggerFlows(newState: SonnenState, lastState: SonnenState) {
    // Trigger battery level changed flow
    if (newState.currentBatteryChargePercentage !== lastState.currentBatteryChargePercentage) {
      this.homey.flow.getDeviceTriggerCard('battery_level_changed')
        .trigger(this, { 'battery_level': newState.currentBatteryChargePercentage })
        .catch(this.error);
    }

    // Trigger grid status changed flow
    if ((newState.gridFeedInWatts > 0 && lastState.gridFeedInWatts <= 0) ||
      (newState.gridFeedInWatts <= 0 && lastState.gridFeedInWatts > 0)) {
      this.homey.flow.getDeviceTriggerCard('grid_status_changed')
        .trigger(this, { 'grid_status': newState.gridFeedInWatts > 0 ? 'feeding_in' : 'consuming' })
        .catch(this.error);
    }
  }
}