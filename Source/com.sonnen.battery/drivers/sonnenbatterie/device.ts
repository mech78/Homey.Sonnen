import _ from 'underscore';
import { SonnenBatterieClient } from '../../service/SonnenBatterieClient';
import { SonnenDevice } from '../../lib/SonnenDevice';
import { SonnenState } from '../../domain/SonnenState';
import { TimeOfUseSchedule } from '../../domain/TimeOfUse';
import { LocalizedError } from '../../domain/LocalizedError';
import { LocalizationService } from '../../lib/LocalizationService';

export class BatteryDevice extends SonnenDevice {
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
      this.state.updateState(await this.loadLatestState(this.state, this.getSetting("device_discovery") ?? true));
    }, batteryPullInterval * 1000);

    // Do an initial load
    this.state.updateState(await this.loadLatestState(this.state, this.getSetting("device_discovery") ?? true));
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

    const mode_ToU = "10"; // Time-of-Use operating mode

    if (_.contains(changedKeys, "device_ip")) {
      const newDeviceIP = newSettings["device_ip"] as string;
      this.log("Settings", "IP", newDeviceIP);

      if (newDeviceIP && !_.isEmpty(newDeviceIP.trim())) {
        const ipv4Regex = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/; // "pattern" property in json doesn't appear to work
        if (!ipv4Regex.test(newDeviceIP)) {
          LocalizationService.getInstance().throwLocalizedError(new LocalizedError("error.validation.invalid_ip_format"));
        }
      }
    }

    if (_.contains(changedKeys, "device_discovery")) {
      const useAutoDiscovery = newSettings["device_discovery"] as boolean;
      this.log("Settings", "AutoDiscovery", useAutoDiscovery);

      if (useAutoDiscovery) {
        const discoveredIP = await SonnenBatterieClient.findBatteryIP(this.getData().id);
        if (!discoveredIP) {
          LocalizationService.getInstance().throwLocalizedError(new LocalizedError("connection.error_no_batteries"));
        }
      }
    }

    if (_.contains(changedKeys, "operating_mode")) {
      const newOperatingMode = newSettings["operating_mode"] as string;
      const currentOperatingMode = this.getSetting("operating_mode") as string;
      this.log("Settings", "OperatingMode", newOperatingMode, currentOperatingMode);

      // Prevent changing operating mode away from 10 when setting a non-empty time-of-use schedule at the same time
      if (currentOperatingMode === mode_ToU && newOperatingMode !== mode_ToU && _.contains(changedKeys, "time_of_use_schedule")) {
        const scheduleRaw = newSettings["time_of_use_schedule"] as string;
        const isScheduleEmpty = !scheduleRaw || scheduleRaw.trim() === '';
        if (!isScheduleEmpty) {
          LocalizationService.getInstance().throwLocalizedError(new LocalizedError("error.validation.operatingModeChangeMismatchingTimeOfUseScheduleChange"));
        }
      }

      try {
        await this.createSonnenBatterieClient().setOperatingMode(newOperatingMode);
        
        // Clear time-of-use schedule when operating mode is changed away from 10
        if (currentOperatingMode === mode_ToU && newOperatingMode !== mode_ToU) {
          this.log("Settings", "Clearing time-of-use schedule as operating mode is changed away from Time-of-Use");
          await this.createSonnenBatterieClient().clearSchedule();
        }     
      } catch (error) {
        LocalizationService.getInstance().throwLocalizedError(error);
      }
    }

    if (_.contains(changedKeys, "prognosis_charging")) {
      const prognosisCharging = newSettings["prognosis_charging"] as boolean;
      this.log("Settings", "PrognosisCharging", prognosisCharging);

      try {
        await this.createSonnenBatterieClient().setPrognosisCharging(prognosisCharging);
      } catch (error) {
        LocalizationService.getInstance().throwLocalizedError(error);
      }
    }

    if (_.contains(changedKeys, "time_of_use_schedule")) {
      const newOperatingMode = newSettings["operating_mode"] as string;
      const currentOperatingMode = this.getSetting("operating_mode") as string;
      const scheduleRaw = newSettings["time_of_use_schedule"] as string;
      
      // Always allow setting an empty schedule regardless of operating mode
      const isScheduleEmpty = !scheduleRaw || scheduleRaw.trim() === '';
      this.log("Settings", "TimeOfUseSchedule", scheduleRaw, isScheduleEmpty, newOperatingMode, currentOperatingMode);
      
      if (!isScheduleEmpty) {
        // Prevent applying schedule if operating mode is being changed away from Time-of-Use
        if (currentOperatingMode === mode_ToU && newOperatingMode !== mode_ToU) {
          LocalizationService.getInstance().throwLocalizedError(new LocalizedError("error.validation.operatingModeChangeMismatchingTimeOfUseScheduleChange"));
        }
        
        // Only allow setting schedule when either current or new operating mode is Time-of-Use
        if (currentOperatingMode !== mode_ToU && newOperatingMode !== mode_ToU) {
          LocalizationService.getInstance().throwLocalizedError(new LocalizedError("error.validation.timeOfUseChangeMismatchingOperatingMode"));
        }
      }
      
      try {
        const schedule = TimeOfUseSchedule.fromString(scheduleRaw);
        await this.createSonnenBatterieClient().setSchedule(schedule);
      } catch (error) {
        LocalizationService.getInstance().throwLocalizedError(error);
      }
    }

    await this.refreshState(); // immediately refresh UI
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
      'prognosis_charging_capability',
      'state_core_control_module_capability'
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

    // TODO: maybe add a gracefully migration from store-based "autodiscovery" and "lanip" to settings-based "device_discovery" and "device_ip"
  }

  private async loadLatestState(lastState: SonnenState, retryOnError = true): Promise<SonnenState> {
    try {
      const client = this.createSonnenBatterieClient();

      this.log("Fetching data...");

      const latestDataJson = await client.getLatestData();
      const statusJson = await client.getStatus();
      const configurations = await client.getConfigurations();

      // update device's batteries to actual number of internal batteries
      const numberBatteries = +latestDataJson.ic_status.nrbatterymodules;
      const actualBatteries = new Array(numberBatteries).fill('INTERNAL');
      const energy = (await this.getEnergy()) || {
        homeBattery: true,
        batteries: [],
        "meterPowerImportedCapability": "meter_power.charged",
        "meterPowerExportedCapability": "meter_power.discharged"
      };

      if (!_.isEqual(energy.batteries, actualBatteries)) {
        energy.batteries = actualBatteries;
        this.log("Update batteries (once): ", energy);
        await this.setEnergy(energy);
      }

      const currentUpdate = new Date(latestDataJson.Timestamp);
      if (!lastState.lastUpdate) {
        lastState.lastUpdate = currentUpdate; // if no last update, use current update
      }
      if (this.isNewDay(currentUpdate, lastState.lastUpdate)) {
        this.homey.settings.set('deviceState', this.state); // backup state at least once a day as there seems to be no proper hook during an app shutdown/restart one can use.
      }
      this.log('Fetched at ' + currentUpdate.toISOString() + ' compute changes since ' + lastState.lastUpdate.toISOString());

      const grid_feed_in_W = +statusJson.GridFeedIn_W > 0 ? +statusJson.GridFeedIn_W : 0;
      const grid_consumption_W = +statusJson.GridFeedIn_W < 0 ? -1 * statusJson.GridFeedIn_W : 0;
      const toBattery_W = (statusJson.Pac_total_W ?? 0) < 0 ? -1 * statusJson.Pac_total_W : 0;
      const fromBattery_W = (statusJson.Pac_total_W ?? 0) > 0 ? statusJson.Pac_total_W : 0;

      // Track today's max/min values
      const todayMaxConsumption_Wh = this.isNewDay(currentUpdate, lastState.lastUpdate)
        ? statusJson.Consumption_W
        : Math.max(lastState.todayMaxConsumption_Wh, statusJson.Consumption_W);
        
      const todayMinConsumption_Wh = this.isNewDay(currentUpdate, lastState.lastUpdate)
        ? statusJson.Consumption_W
        : Math.min(lastState.todayMinConsumption_Wh, statusJson.Consumption_W);
        
      const todayMaxGridFeedIn_Wh = this.isNewDay(currentUpdate, lastState.lastUpdate)
        ? grid_feed_in_W
        : Math.max(lastState.todayMaxGridFeedIn_Wh, grid_feed_in_W);
        
      const todayMaxGridConsumption_Wh = this.isNewDay(currentUpdate, lastState.lastUpdate)
        ? grid_consumption_W
        : Math.max(lastState.todayMaxGridConsumption_Wh, grid_consumption_W);
        
      const todayMaxProduction_Wh = this.isNewDay(currentUpdate, lastState.lastUpdate)
        ? statusJson.Production_W
        : Math.max(lastState.todayMaxProduction_Wh, statusJson.Production_W);

      const currentState = new SonnenState({
        lastUpdate: currentUpdate,

        totalDailyToBattery_Wh: this.aggregateTotal(lastState.totalDailyToBattery_Wh, toBattery_W, lastState.lastUpdate, currentUpdate, true),
        totalDailyFromBattery_Wh: this.aggregateTotal(lastState.totalDailyFromBattery_Wh, fromBattery_W, lastState.lastUpdate, currentUpdate, true),
        totalDailyProduction_Wh: this.aggregateTotal(lastState.totalDailyProduction_Wh, statusJson.Production_W, lastState.lastUpdate, currentUpdate, true),
        totalDailyConsumption_Wh: this.aggregateTotal(lastState.totalDailyConsumption_Wh, statusJson.Consumption_W, lastState.lastUpdate, currentUpdate, true),
        totalDailyGridFeedIn_Wh: this.aggregateTotal(lastState.totalDailyGridFeedIn_Wh, grid_feed_in_W, lastState.lastUpdate, currentUpdate, true),
        totalDailyGridConsumption_Wh: this.aggregateTotal(lastState.totalDailyGridConsumption_Wh, grid_consumption_W, lastState.lastUpdate, currentUpdate, true),

        totalToBattery_Wh: this.aggregateTotal(lastState.totalToBattery_Wh, toBattery_W, lastState.lastUpdate, currentUpdate),
        totalFromBattery_Wh: this.aggregateTotal(lastState.totalFromBattery_Wh, fromBattery_W, lastState.lastUpdate, currentUpdate),
        totalProduction_Wh: this.aggregateTotal(lastState.totalProduction_Wh, statusJson.Production_W, lastState.lastUpdate, currentUpdate),
        totalConsumption_Wh: this.aggregateTotal(lastState.totalConsumption_Wh, statusJson.Consumption_W, lastState.lastUpdate, currentUpdate),
        totalGridFeedIn_Wh: this.aggregateTotal(lastState.totalGridFeedIn_Wh, grid_feed_in_W, lastState.lastUpdate, currentUpdate),
        totalGridConsumption_Wh: this.aggregateTotal(lastState.totalGridConsumption_Wh, grid_consumption_W, lastState.lastUpdate, currentUpdate),
        
        todayMaxConsumption_Wh,
        todayMinConsumption_Wh,
        todayMaxGridFeedIn_Wh,
        todayMaxGridConsumption_Wh,
        todayMaxProduction_Wh,
      });

      this.log("Emitting data update for other devices...");
      this.homey.emit('sonnenBatterieUpdate', currentState, statusJson);

      this.setCapabilityValue('measure_battery', +statusJson.USOC); // Percentage on battery
      this.setCapabilityValue('measure_power', -statusJson.Pac_total_W); // inverted to match the Homey Energy (positive = charging, negative = discharging)
      if (this.isEnergyFullySupported()) {
        this.setCapabilityValue('meter_power.charged', currentState.totalToBattery_Wh / 1000);
        this.setCapabilityValue('meter_power.discharged', currentState.totalFromBattery_Wh / 1000);
      }

      this.setCapabilityValue('to_battery_capability', toBattery_W);
      this.setCapabilityValue('from_battery_capability', fromBattery_W);
      this.setCapabilityValue('to_battery_daily_capability', currentState.totalDailyToBattery_Wh / 1000);
      this.setCapabilityValue('from_battery_daily_capability', currentState.totalDailyFromBattery_Wh / 1000);
      this.setCapabilityValue('to_battery_total_capability', currentState.totalToBattery_Wh / 1000);
      this.setCapabilityValue('from_battery_total_capability', currentState.totalFromBattery_Wh / 1000);

      const remaining_energy_Wh = +latestDataJson.FullChargeCapacity * (statusJson.USOC / 100);
      this.setCapabilityValue('capacity_remaining_capability', remaining_energy_Wh / 1000);
      this.setCapabilityValue('capacity_capability', +latestDataJson.FullChargeCapacity / 1000);

      let chargingState: string;
      if (statusJson.Pac_total_W < 0) {
        chargingState = 'charging';
      } else if (statusJson.Pac_total_W > 0) {
        chargingState = 'discharging';
      } else {
        chargingState = 'idle';
      }
      this.setCapabilityValue('battery_charging_state', chargingState);

      this.setCapabilityValue('number_battery_capability', numberBatteries);
      this.setCapabilityValue('eclipse_capability', LocalizationService.getInstance().resolveCircleColor(latestDataJson.ic_status['Eclipse Led']));
      this.setCapabilityValue('state_bms_capability', this.homey.__('stateBms.' + latestDataJson.ic_status.statebms.replaceAll(' ', '')) ?? latestDataJson.ic_status.statebms);
      this.setCapabilityValue('state_inverter_capability', this.homey.__('stateInverter.' + latestDataJson.ic_status.stateinverter.replaceAll(' ', '')) ?? latestDataJson.ic_status.stateinverter);
      this.setCapabilityValue('state_core_control_module_capability', this.homey.__('stateCoreControlModule.' + latestDataJson.ic_status.statecorecontrolmodule.replaceAll(' ', '')) ?? latestDataJson.ic_status.statecorecontrolmodule);
      this.setCapabilityValue('online_capability', !latestDataJson.ic_status['DC Shutdown Reason'].HW_Shutdown);
      this.setCapabilityValue('alarm_generic', latestDataJson.ic_status['Eclipse Led']['Solid Red']);
      
      const scheduleRaw = configurations['EM_ToU_Schedule'];
      const tou = new TimeOfUseSchedule(scheduleRaw);
      this.log('Parsed Time-of-Use schedule:', tou.toJSONString());
      this.setSettings({ 'time_of_use_schedule': tou.toString() });

      const operatingMode = configurations['EM_OperatingMode'];
      const operatingModeText = LocalizationService.getInstance().resolveOperatingMode(operatingMode);
      this.setCapabilityValue('operating_mode_capability', operatingModeText);
      this.setSettings({ 'operating_mode': '' + operatingMode });

      const prognosisCharging = configurations['EM_Prognosis_Charging'];
      const prognosisChargingMode = prognosisCharging === "1";
      this.setCapabilityValue('prognosis_charging_capability', prognosisChargingMode);
      this.setSettings({ 'prognosis_charging': prognosisChargingMode });
 
      /*
      if (Math.random() < 0.5) {
        throw new Error("random");
      }
      */

      this.unsetWarning(); // clear any previous warning
      return currentState;
    } catch (e) {
      this.error('Error occured fetching data. Retry: ' + retryOnError, e)
      return this.mayRetryWithAutoDiscovery(lastState, retryOnError); 
    }
  }

  private async mayRetryWithAutoDiscovery(lastState: SonnenState, retryOnError: boolean): Promise<SonnenState> {
    if (retryOnError) {
      try {
        const homeyDeviceId = this.getData().id; // as set by onPairListDevices() in driver.ts
        const currentIP = await SonnenBatterieClient.findBatteryIP(homeyDeviceId); // Maybe IP has changed, lets try and fix this...
        if (currentIP) {
          this.log(`Found device ${homeyDeviceId} with IP ${currentIP}`);
          const storedIP = this.getSetting("device_ip") as string;
          if (storedIP !== currentIP) {
            this.setSettings({ "device_ip": currentIP });
            const notification = this.homey.__("connection.notification_ip_changed", { ip: currentIP });
            await this.homey.notifications.createNotification({ excerpt: notification });    
            return await this.loadLatestState(lastState, false); // Try and reload data
          }
        }
      } catch (err) {
        this.log('Failed to find sonnen batteries', err);
      }
    }
   
    await this.setWarning(this.homey.__("connection.error", { ip: this.getSetting("device_ip") }));
    return lastState; // always return some valid state even on error
  }

  private aggregateTotal(totalEnergy_Wh: number, currentPower_W: number, lastUpdate: Date, currentUpdate: Date, resetDaily: boolean = false): number {
      let totalEnergyResult_Wh = resetDaily && this.isNewDay(currentUpdate, lastUpdate) ? 0 : (totalEnergy_Wh ?? 0);
      const sampleIntervalMillis = currentUpdate.getTime() - lastUpdate.getTime(); // should be ~30000ms resp. polling frequency
      const sampleEnergy_Wh = (currentPower_W ?? 0) * (sampleIntervalMillis / 60 / 60 / 1000); // Wh
      totalEnergyResult_Wh += sampleEnergy_Wh;
      return totalEnergyResult_Wh;
  }

  private isNewDay(currentUpdate: Date, lastUpdate: Date) {
    return currentUpdate.getDay() !== lastUpdate.getDay();
  }

  public async refreshState() {
    this.loadLatestState(this.state, false);
  }

}
module.exports = BatteryDevice;