import _ from 'underscore';
import { SonnenBatterieClient } from '../../service/SonnenBatterieClient';
import { SonnenDevice } from '../../lib/SonnenDevice';
import { SonnenState } from '../../domain/SonnenState';
import { TimeOfUseSchedule } from '../../domain/TimeOfUse';
import { LocalizedError } from '../../domain/LocalizedError';
import { LocalizationService } from '../../lib/LocalizationService';
import { KNOWN_OPERATING_MODES, resolveOperatingModeSyncAction, shouldWriteOperatingModeToBattery } from '../../domain/OperatingModes';
import { ControlActions, TargetPowerMode, TargetPowerModeValue } from '../../domain/TargetPowerMode';

export class BatteryDevice extends SonnenDevice {
  private state: SonnenState = new SonnenState();
  private updateIntervalId: NodeJS.Timeout | undefined;
  private refreshTimeoutId: NodeJS.Timeout | undefined;
  private readonly batteryDateUpdateInterval = 3600; // 1 hour in seconds
  private lastReportedOperatingMode: string | null = null;
  private missingCapabilitiesWarned = new Set<string>();
  private manualStandbyActive: boolean = false;
  private targetPowerModeState: TargetPowerModeValue | null = null;


  async onInit() {
    super.onInit();

    await this.gracefullyAddOrRemoveCapabilities();
    this.registerResetMetersButton();
    this.registerTargetPowerControls();
    await this.initializeTargetPowerCapabilities();

    const batteryPullInterval = +(this.homey.settings.get('BatteryPullInterval') || '30');

    let storedState: SonnenState;
    try {
      this.log('Retrieving stored state...');
      const rawStoredState = this.homey.settings.get('deviceState');
      storedState = SonnenState.fromObject(rawStoredState);
    } catch (e) {
      this.log('Failed to retrieve stored state, use new state', e);
      storedState = this.state;
    }
    this.state.updateState(storedState); // apply stored state to current state
    this.state.updateState({ lastUpdate: null });
    this.log('Retrieved stored state: ' + this.state.toLog());

    // Pull battery status regularly
    this.updateIntervalId = this.homey.setInterval(async () => {
      // A rejection escaping a timer callback surfaces as an unhandled rejection,
      // so contain it here even though loadLatestState has its own error handling.
      try {
        this.state.updateState(await this.loadLatestState(this.state, this.getSetting("device_discovery") ?? true));
      } catch (e) {
        this.error('Error during polling', e);
      }
    }, batteryPullInterval * 1000);

    // Do an initial load
    this.state.updateState(await this.loadLatestState(this.state, this.getSetting("device_discovery") ?? true));
  }

  async onDeleted() {
    if (this.updateIntervalId) {
      this.homey.clearInterval(this.updateIntervalId);
      this.updateIntervalId = undefined;
    }
    if (this.refreshTimeoutId) {
      this.homey.clearTimeout(this.refreshTimeoutId);
      this.refreshTimeoutId = undefined;
    }
    this.saveDeviceState();

    super.onDeleted();
  }

  async onUninit() {
    if (this.updateIntervalId) {
      this.homey.clearInterval(this.updateIntervalId);
      this.updateIntervalId = undefined;
    }
    if (this.refreshTimeoutId) {
      this.homey.clearTimeout(this.refreshTimeoutId);
      this.refreshTimeoutId = undefined;
    }
    this.saveDeviceState();

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

      // Skip the battery round-trip when the change was just a programmatic sync
      // of a mode the battery itself reported (setSettings re-enters onSettings)
      if (!shouldWriteOperatingModeToBattery(newOperatingMode, this.lastReportedOperatingMode)) {
        this.log("Settings", "OperatingMode", newOperatingMode, "already active on battery, skipping battery write");
      } else {
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

    if (_.contains(changedKeys, "installation_date")) {
      const newInstallationDate = newSettings["installation_date"] as string;
      this.log("Settings", "InstallationDate", newInstallationDate);

      if (newInstallationDate && newInstallationDate.trim()) {
        const installationDate = new Date(newInstallationDate);
        const localNow = this.getLocalNow();
        if (isNaN(installationDate.getTime())) {
          LocalizationService.getInstance().throwLocalizedError(new LocalizedError("error.validation.invalid_installation_date_format"));
        }
        if (installationDate > localNow) {
          LocalizationService.getInstance().throwLocalizedError(new LocalizedError("error.validation.installation_date_in_future"));
        }
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

    // Defer the refresh until this onSettings handler has completed: the
    // setSettings() calls inside loadLatestState() fail with
    // "Cannot set Settings while this.onSettings is still pending"
    // when run while Homey still considers onSettings in-flight.
    if (this.refreshTimeoutId) {
      this.homey.clearTimeout(this.refreshTimeoutId);
    }
    this.refreshTimeoutId = this.homey.setTimeout(() => {
      this.refreshTimeoutId = undefined;
      this.refreshState().catch((err) => this.error('Deferred refreshState failed', err));
    }, 500);
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

  /**
   * Registers the combined listener for the Homey Energy `target_power` and
   * `target_power_mode` capabilities so mode + power changes are applied as a
   * single debounced operation (Homey recommends 500ms).
   */
  private registerTargetPowerControls() {
    this.registerMultipleCapabilityListener(['target_power', 'target_power_mode'], async (values) => {
      this.log('Target power change:', JSON.stringify(values));
      await this.handleTargetPowerChange(values);
    }, 500);
  }

  /**
   * Initializes the target power capability values for freshly added
   * capabilities (existing devices get them via the graceful migration).
   * Default is device control in self consumption, consistent with the
   * settings-page operating mode default.
   */
  private async initializeTargetPowerCapabilities() {
    this.targetPowerModeState = (this.getCapabilityValue('target_power_mode') as TargetPowerModeValue) ?? null;
    if (this.targetPowerModeState === null || this.targetPowerModeState === undefined) {
      await this.setCapabilityValue('target_power_mode', 'self_consumption');
      this.targetPowerModeState = 'self_consumption';
    }
    const currentPower = this.getCapabilityValue('target_power');
    if (currentPower === null || currentPower === undefined) {
      await this.setCapabilityValue('target_power', 0);
    }
  }

  private async handleTargetPowerChange(values: Record<string, unknown>): Promise<void> {
    const requestedMode = (values.target_power_mode
      ?? this.targetPowerModeState
      ?? 'self_consumption') as TargetPowerModeValue;
    const requestedPower = values.target_power !== undefined && values.target_power !== null ? +values.target_power : null;
    const currentPowerValue = this.getCapabilityValue('target_power');
    const currentPower = currentPowerValue === null || currentPowerValue === undefined ? null : +currentPowerValue;

    const actions = TargetPowerMode.planPowerControl({
      requestedMode,
      previousMode: this.targetPowerModeState,
      requestedPower,
      currentPower,
      standbyActive: this.manualStandbyActive,
    });

    await this.applyControlActions(actions);
    this.targetPowerModeState = requestedMode;
  }

  /**
   * Applies the planned control actions sequentially to the battery:
   * disableStandby → operatingMode → enableStandby → setpoint.
   */
  private async applyControlActions(actions: ControlActions): Promise<void> {
    const client = this.createSonnenBatterieClient();

    try {
      if (actions.disableStandby) {
        await client.setStandby(false);
        this.manualStandbyActive = false;
      }
      if (actions.operatingMode !== null) {
        await client.setOperatingMode(actions.operatingMode);
      }
      if (actions.enableStandby) {
        await client.setStandby(true);
        this.manualStandbyActive = true;
      }
      if (actions.setpoint) {
        await client.setSetpoint(actions.setpoint.direction, actions.setpoint.watts);
      }
    } catch (error) {
      // Re-throw localized so the error surfaces in the Flow card / UI
      LocalizationService.getInstance().throwLocalizedError(error);
    }

    if (actions.operatingMode !== null || actions.setpoint !== null || actions.enableStandby || actions.disableStandby) {
      await this.refreshState(); // immediately refresh UI
    }
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
      'state_core_control_module_capability',
      'total_cyclecount_capability',
      'cyclecount_7day_rate_capability',
      'cyclecount_30day_rate_capability',
      'cyclecount_installation_rate_capability',
      'target_power',
      'target_power_mode'
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

    // Self-healing: sync with the driver manifest. Devices paired with old app
    // versions can miss capabilities that no migration list covers; every
    // setCapabilityValue() on such a capability then crashes with
    // "Invalid Capability: ..." on each poll. Repair them on every init.
    const manifestCapabilities: string[] = this.driver.manifest?.capabilities ?? [];
    const conditionalEnergyCapabilities = ['meter_power.charged', 'meter_power.discharged'];
    for (const capability of manifestCapabilities) {
      // Sub-capabilities of the energy system are conditionally managed above
      if (!this.isEnergyFullySupported() && conditionalEnergyCapabilities.includes(capability)) {
        continue;
      }
      if (!this.hasCapability(capability)) {
        this.log('Self-healing: adding missing capability: ' + capability);
        await this.addCapability(capability);
      }
    }

    // TODO: maybe add a gracefully migration from store-based "autodiscovery" and "lanip" to settings-based "device_discovery" and "device_ip"
  }

  private async loadLatestState(lastState: SonnenState, retryOnError = true): Promise<SonnenState> {
    try {
      const client = this.createSonnenBatterieClient();

      this.log("Fetching data...");

      const [latestDataJson, statusJson, configurationsJson, batteryJson] = await Promise.all([
        client.getLatestData(),
        client.getStatus(),
        client.getConfigurations(),
        client.getBattery(),
      ]);

      const currentUpdate = new Date(latestDataJson.Timestamp);

      // Battery data is fetched every cycle (e.g. for battery capacity), but cycle count
      // snapshots are taken at most once per hour to avoid polluting the ring buffer queues
      const shouldUpdateBatteryData = this.isUpdateDue(currentUpdate, lastState.lastBatteryDataUpdate, this.batteryDateUpdateInterval);

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

      
      if (!lastState.lastUpdate) {
        lastState.lastUpdate = currentUpdate; // if no last update, use current update
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
        lastBatteryDataUpdate: shouldUpdateBatteryData ? currentUpdate : lastState.lastBatteryDataUpdate,

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
        total_cycleCount: batteryJson.cyclecount,
        cycleCount7DayQueue: lastState.cycleCount7DayQueue,
        cycleCount30DayQueue: lastState.cycleCount30DayQueue,
        installationDate: lastState.installationDate,
      });

      if (this.isDebugMode()) {
        this.log("Emitting currentState and statusJson to other devices...\n" + currentState.toLog() + "\n" + JSON.stringify(statusJson, null, 2));
        this.log("Battery data:\n" + JSON.stringify(batteryJson, null, 2));
      }
      this.homey.emit('sonnenBatterieUpdate', currentState, statusJson);

      this.setCapabilityValueSafe('measure_battery', +statusJson.USOC); // Percentage on battery
      this.setCapabilityValueSafe('measure_power', -statusJson.Pac_total_W); // inverted to match the Homey Energy (positive = charging, negative = discharging)
      if (this.isEnergyFullySupported()) {
        this.setCapabilityValueSafe('meter_power.charged', currentState.totalToBattery_Wh / 1000);
        this.setCapabilityValueSafe('meter_power.discharged', currentState.totalFromBattery_Wh / 1000);
      }

      this.setCapabilityValueSafe('to_battery_capability', toBattery_W);
      this.setCapabilityValueSafe('from_battery_capability', fromBattery_W);
      this.setCapabilityValueSafe('to_battery_daily_capability', currentState.totalDailyToBattery_Wh / 1000);
      this.setCapabilityValueSafe('from_battery_daily_capability', currentState.totalDailyFromBattery_Wh / 1000);
      this.setCapabilityValueSafe('to_battery_total_capability', currentState.totalToBattery_Wh / 1000);
      this.setCapabilityValueSafe('from_battery_total_capability', currentState.totalFromBattery_Wh / 1000);

      const fullChargeCapacity_Wh = +batteryJson.fullchargecapacitywh;
      this.setCapabilityValueSafe('capacity_capability', fullChargeCapacity_Wh / 1000); // kWh
      this.setCapabilityValueSafe('capacity_remaining_capability', fullChargeCapacity_Wh * (+statusJson.USOC / 100) / 1000); // usable energy in kWh

      let chargingState: string;
      if (statusJson.Pac_total_W < 0) {
        chargingState = 'charging';
      } else if (statusJson.Pac_total_W > 0) {
        chargingState = 'discharging';
      } else {
        chargingState = 'idle';
      }
      this.setCapabilityValueSafe('battery_charging_state', chargingState);

      this.setCapabilityValueSafe('number_battery_capability', numberBatteries);
      this.setCapabilityValueSafe('eclipse_capability', LocalizationService.getInstance().resolveCircleColor(latestDataJson.ic_status['Eclipse Led']));
      this.setCapabilityValueSafe('state_bms_capability', this.homey.__('stateBms.' + latestDataJson.ic_status.statebms.replaceAll(' ', '')) ?? latestDataJson.ic_status.statebms);
      this.setCapabilityValueSafe('state_inverter_capability', this.homey.__('stateInverter.' + latestDataJson.ic_status.stateinverter.replaceAll(' ', '')) ?? latestDataJson.ic_status.stateinverter);
      this.setCapabilityValueSafe('state_core_control_module_capability', this.homey.__('stateCoreControlModule.' + latestDataJson.ic_status.statecorecontrolmodule.replaceAll(' ', '')) ?? latestDataJson.ic_status.statecorecontrolmodule);
      this.setCapabilityValueSafe('online_capability', !latestDataJson.ic_status['DC Shutdown Reason'].HW_Shutdown);
      this.setCapabilityValueSafe('alarm_generic', latestDataJson.ic_status['Eclipse Led']['Solid Red']);

      // Track the manual standby flag (used by the target power idle logic);
      // automatic/protective standby reasons are ignored here on purpose.
      const standbyReason = latestDataJson.ic_status['Standby Reason'];
      if (standbyReason) {
        this.manualStandbyActive = standbyReason.Manual === true;
      }
      
      const scheduleRaw = configurationsJson['EM_ToU_Schedule'];
      const tou = new TimeOfUseSchedule(scheduleRaw);
      if (this.isDebugMode()) {
        this.log("Parsed Time-of-Use schedule: " + tou.toString());
      }
      await this.setSettingsSafe({ 'time_of_use_schedule': tou.toString() });

      const operatingMode = configurationsJson['EM_OperatingMode'];
      const operatingModeText = LocalizationService.getInstance().resolveOperatingMode(operatingMode);
      this.setCapabilityValueSafe('operating_mode_capability', operatingModeText);

      const reportedOperatingMode = operatingMode === undefined || operatingMode === null ? null : String(operatingMode);
      this.lastReportedOperatingMode = reportedOperatingMode;
      const storedOperatingMode = this.getSetting('operating_mode') as string | undefined;
      const syncAction = resolveOperatingModeSyncAction(reportedOperatingMode, storedOperatingMode, KNOWN_OPERATING_MODES);
      if (syncAction === 'sync') {
        await this.setSettingsSafe({ 'operating_mode': reportedOperatingMode });
      } else if (syncAction === 'unknown') {
        this.error('Battery reported unknown operating mode "' + reportedOperatingMode + '", not syncing it into the operating_mode setting');
      }

      // Sync the target_power_mode capability with externally changed operating
      // modes (sonnen app, battery UI, other flows). Modes without a capability
      // representation (e.g. 6 = module extension) leave the capability unchanged.
      const targetPowerMode = TargetPowerMode.fromOperatingMode(operatingMode);
      if (targetPowerMode !== null && targetPowerMode !== this.targetPowerModeState) {
        this.log('Syncing target_power_mode with externally changed operating mode', operatingMode, '->', targetPowerMode);
        await this.setCapabilityValueSafe('target_power_mode', targetPowerMode);
        this.targetPowerModeState = targetPowerMode;
      }

      const prognosisCharging = configurationsJson['EM_Prognosis_Charging'];
      const prognosisChargingMode = prognosisCharging === "1";
      this.setCapabilityValueSafe('prognosis_charging_capability', prognosisChargingMode);
      await this.setSettingsSafe({ 'prognosis_charging': prognosisChargingMode });
      
      if (shouldUpdateBatteryData) {
        currentState.addCycleCountSnapshot(currentUpdate, batteryJson.cyclecount);
      }

      this.setCapabilityValueSafe('total_cyclecount_capability', currentState.total_cycleCount);
      this.setCapabilityValueSafe('cyclecount_7day_rate_capability', currentState.get7DayAverageCycleCountRate());    
      this.setCapabilityValueSafe('cyclecount_30day_rate_capability', currentState.get30DayAverageCycleCountRate());

      const installationDateSetting = this.getSetting('installation_date') as string | undefined;
      const trimmedDate = installationDateSetting?.trim();
      currentState.installationDate = trimmedDate ? new Date(trimmedDate) : null;

      this.setCapabilityValueSafe('cyclecount_installation_rate_capability', currentState.getInstallationAverageCycleCountRate()); 
 
      if (this.isNewDay(currentUpdate, lastState.lastUpdate) || shouldUpdateBatteryData) {
        this.saveDeviceState(); // backup state at least once a day or when batteryData is updated as there seems to be no proper hook during an app shutdown/restart one can use.
      }

      this.unsetWarning(); // clear any previous warning
      return currentState;
    } catch (e) {
      this.error('Error occurred fetching data. Retry: ' + retryOnError, e)
      return this.mayRetryWithAutoDiscovery(lastState, retryOnError); 
    }
  }

  private isUpdateDue(currentUpdate: Date, lastUpdate: Date | null, updateIntervalSeconds: number): boolean {
    return !lastUpdate ||
      (currentUpdate.getTime() - lastUpdate.getTime()) > (updateIntervalSeconds * 1000);
  }

  /**
   * setCapabilityValue() on a capability the device does not have does not
   * throw at the call site; the error is emitted asynchronously and reported
   * as a crash on every poll. Guard the call, warn only once per capability
   * and contain any other rejection so it cannot escape as an unhandled one.
   */
  private async setCapabilityValueSafe(capability: string, value: unknown): Promise<void> {
    if (!this.hasCapability(capability)) {
      if (!this.missingCapabilitiesWarned.has(capability)) {
        this.missingCapabilitiesWarned.add(capability);
        this.error('Skipping update for missing capability: ' + capability);
      }
      return;
    }
    try {
      await this.setCapabilityValue(capability, value);
    } catch (e) {
      this.error('Failed to set capability "' + capability + '"', e);
    }
  }

  /**
   * Settings written during polling can collide with an in-flight onSettings()
   * ("Cannot set Settings while this.onSettings is still pending"); contain the
   * rejection so it cannot surface as an unhandled one.
   */
  private async setSettingsSafe(settings: { [key: string]: boolean | string | number | undefined | null; }): Promise<void> {
    try {
      await this.setSettings(settings);
    } catch (e) {
      this.error('Failed to sync settings to device: ' + Object.keys(settings).join(', '), e);
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
            await this.setSettingsSafe({ "device_ip": currentIP });
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

  public async refreshState(): Promise<void> {
    await this.loadLatestState(this.state, false);
  }

  public saveDeviceState(): Date | null {
    this.homey.settings.set('deviceState', this.state);
    this.log('Saved deviceState to settings: ' + this.state.toLog());
    return this.state.lastUpdate;
  }

  public resetCycleCountQueues(): Date | null {
    this.state.resetCycleCountQueues();
    this.saveDeviceState();
    return this.state.lastUpdate;
  }

}
module.exports = BatteryDevice;