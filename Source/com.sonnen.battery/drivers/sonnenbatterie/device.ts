import _ from 'underscore';
import { SonnenBatterieClient } from '../../service/SonnenBatterieClient';
import { isValidIPv4, SonnenDevice } from '../../lib/SonnenDevice';
import { SonnenState } from '../../domain/SonnenState';
import { TimeOfUseSchedule } from '../../domain/TimeOfUse';
import { LocalizedError } from '../../domain/LocalizedError';
import { throwLocalizedError, resolveOperatingMode, resolveCircleColor } from '../../lib/LocalizationService';
import { KNOWN_OPERATING_MODES, resolveOperatingModeSyncAction, shouldWriteOperatingModeToBattery } from '../../domain/OperatingModes';
import { isValidBackupBuffer, parseBackupBuffer, shouldWriteBackupBufferToBattery } from '../../domain/BackupBuffer';
import { CapabilityChangeRequest, ControlActions, TargetPowerMode, TargetPowerModeValue } from '../../domain/TargetPowerMode';
import { PowerLimits, SiteLimitsResponse, TargetPowerLimits } from '../../domain/TargetPowerLimits';

export class BatteryDevice extends SonnenDevice {
  /**
   * Visible counterparts of the hidden Homey Energy target power capabilities.
   * They are opt-in via the "show_target_power_controls" device setting and
   * only exist on the device while that setting is enabled; the hidden
   * built-ins always remain present so flows and EMS apps keep working.
   */
  private static readonly TARGET_POWER_VISIBLE_CAPABILITIES: readonly string[] = [
    'target_power_visible_capability',
    'target_power_mode_visible_capability',
  ];

  private state: SonnenState = new SonnenState();
  private updateIntervalId: NodeJS.Timeout | undefined;
  private refreshTimeoutId: NodeJS.Timeout | undefined;
  private readonly batteryDateUpdateInterval = 3600; // 1 hour in seconds
  private lastReportedOperatingMode: string | null = null;
  private lastReportedBackupBuffer: number | null = null;
  private missingCapabilitiesWarned = new Set<string>();
  private targetPowerModeState: TargetPowerModeValue | null = null;
  /**
   * Tail of the target-power application chain: batches are appended via
   * promise chaining and applied strictly one at a time, in order.
   */
  private targetPowerQueueWorker: Promise<void> = Promise.resolve();
  /** Batches queued or in flight (liveness signal for the verification). */
  private pendingTargetPowerBatches: number = 0;
  /** The state the last processed batch wrote (no-op/echo filter). */
  private lastWrittenTargetPowerState: { power: number | null; mode: TargetPowerModeValue | null } | null = null;
  private targetPowerVerifyTimeoutId: NodeJS.Timeout | undefined;
  private readonly targetPowerVerificationDelayMillis = 1500;
  private targetPowerControlsRegistered: boolean = false;
  private targetPowerVisibleControlsRegistered: boolean = false;
  private powerLimits: PowerLimits = { charge: TargetPowerLimits.DEFAULT_LIMIT_W, discharge: TargetPowerLimits.DEFAULT_LIMIT_W, source: 'default' };
  private siteLimitsCache: { fetchedAt: number; data: SiteLimitsResponse | null } | null = null;
  private readonly siteLimitsCacheTtlMillis = 600000; // 10 minutes


  async onInit() {
    super.onInit();

    await this.gracefullyAddOrRemoveCapabilities();
    this.registerResetMetersButton();
    await this.syncTargetPowerControls(this.getSetting('show_target_power_controls') === true);
    await this.updateHemsSupportNote();

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
    if (this.targetPowerVerifyTimeoutId) {
      this.homey.clearTimeout(this.targetPowerVerifyTimeoutId);
      this.targetPowerVerifyTimeoutId = undefined;
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
    // Let an in-flight target power application finish so the battery is not
    // left with a half-applied control sequence and stale capability values.
    // The verification timer is cleared only afterwards: the final batch
    // schedules it during application.
    await this.targetPowerQueueWorker.catch(() => undefined);
    if (this.targetPowerVerifyTimeoutId) {
      this.homey.clearTimeout(this.targetPowerVerifyTimeoutId);
      this.targetPowerVerifyTimeoutId = undefined;
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

      if (newDeviceIP && !_.isEmpty(newDeviceIP.trim()) && !isValidIPv4(newDeviceIP)) {
        throwLocalizedError(new LocalizedError("error.validation.invalid_ip_format"));
      }
    }

    if (_.contains(changedKeys, "device_discovery")) {
      const useAutoDiscovery = newSettings["device_discovery"] as boolean;
      this.log("Settings", "AutoDiscovery", useAutoDiscovery);

      if (useAutoDiscovery) {
        const discoveredIP = await SonnenBatterieClient.findBatteryIP(this.getData().id);
        if (!discoveredIP) {
          throwLocalizedError(new LocalizedError("connection.error_no_batteries"));
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
          throwLocalizedError(new LocalizedError("error.validation.operatingModeChangeMismatchingTimeOfUseScheduleChange"));
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
          throwLocalizedError(error);
        }
      }
    }

    if (_.contains(changedKeys, "prognosis_charging")) {
      const prognosisCharging = newSettings["prognosis_charging"] as boolean;
      this.log("Settings", "PrognosisCharging", prognosisCharging);

      try {
        await this.createSonnenBatterieClient().setPrognosisCharging(prognosisCharging);
      } catch (error) {
        throwLocalizedError(error);
      }
    }

    if (_.contains(changedKeys, "backup_buffer")) {
      const newBackupBuffer = Math.round(+(newSettings["backup_buffer"] as number));
      this.log("Settings", "BackupBuffer", newBackupBuffer, this.lastReportedBackupBuffer);

      if (!isValidBackupBuffer(newBackupBuffer)) {
        throwLocalizedError(new LocalizedError("error.validation.backupBuffer"));
      }

      // Skip the battery round-trip when the change was just a programmatic sync
      // of a value the battery itself reported (setSettings re-enters onSettings)
      if (!shouldWriteBackupBufferToBattery(newBackupBuffer, this.lastReportedBackupBuffer)) {
        this.log("Settings", "BackupBuffer", newBackupBuffer, "already active on battery, skipping battery write");
      } else {
        try {
          await this.createSonnenBatterieClient().setBackupBuffer(newBackupBuffer);
        } catch (error) {
          throwLocalizedError(error);
        }
      }
    }

    if (_.contains(changedKeys, "installation_date")) {
      const newInstallationDate = newSettings["installation_date"] as string;
      this.log("Settings", "InstallationDate", newInstallationDate);

      if (newInstallationDate && newInstallationDate.trim()) {
        const installationDate = new Date(newInstallationDate);
        const localNow = this.getLocalNow();
        if (isNaN(installationDate.getTime())) {
          throwLocalizedError(new LocalizedError("error.validation.invalid_installation_date_format"));
        }
        if (installationDate > localNow) {
          throwLocalizedError(new LocalizedError("error.validation.installation_date_in_future"));
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
          throwLocalizedError(new LocalizedError("error.validation.operatingModeChangeMismatchingTimeOfUseScheduleChange"));
        }
        
        // Only allow setting schedule when either current or new operating mode is Time-of-Use
        if (currentOperatingMode !== mode_ToU && newOperatingMode !== mode_ToU) {
          throwLocalizedError(new LocalizedError("error.validation.timeOfUseChangeMismatchingOperatingMode"));
        }
      }
      
      try {
        const schedule = TimeOfUseSchedule.fromString(scheduleRaw);
        await this.createSonnenBatterieClient().setSchedule(schedule);
      } catch (error) {
        throwLocalizedError(error);
      }
    }

    if (_.contains(changedKeys, "show_target_power_controls")) {
      const showTargetPowerControls = newSettings["show_target_power_controls"] === true;
      this.log("Settings", "ShowTargetPowerControls", showTargetPowerControls);

      await this.syncTargetPowerControls(showTargetPowerControls);
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
   * single debounced operation (Homey recommends 500ms). Once-guarded: it
   * must only run after the capabilities are present, and Homey offers no
   * unregister, so repeated calls would leak duplicate handlers.
   */
  private registerTargetPowerControls() {
    if (this.targetPowerControlsRegistered) {
      return;
    }
    this.targetPowerControlsRegistered = true;
    this.registerMultipleCapabilityListener(['target_power', 'target_power_mode'], async (values) => {
      this.log('Target power change:', JSON.stringify(values));
      await this.handleTargetPowerChange(values);
    }, 500);
  }

  /**
   * Registers the combined listener for the visible counterparts of the
   * target power capabilities. Called as soon as the twins are added (opt-in
   * setting enabled or restored on init). Registration happens only once per
   * session: Homey offers no unregister, and a removed capability stops
   * producing events anyway, so re-registering on every toggle would leak
   * duplicate handlers.
   */
  private registerTargetPowerVisibleControls() {
    if (this.targetPowerVisibleControlsRegistered) {
      return;
    }
    this.targetPowerVisibleControlsRegistered = true;
    this.registerMultipleCapabilityListener([...BatteryDevice.TARGET_POWER_VISIBLE_CAPABILITIES], async (values) => {
      this.log('Target power change (visible controls):', JSON.stringify(values));
      await this.handleTargetPowerChange(values);
    }, 500);
  }

  /**
   * Synchronizes the target power capabilities with the EMS toggle.
   * Platform-adaptive, because the built-in capabilities cannot be hidden on
   * Homey Pro 2019 (that platform ignores `uiComponent` overrides for
   * built-in capabilities, in the manifest merge as well as at runtime):
   *
   * - Homey Pro (Early 2023) and newer honor `uiComponent: null`: the
   *   built-ins stay on the device (hidden from the card) so flows and EMS
   *   apps always work, and the toggle adds/removes the visible twin
   *   capabilities.
   * - Homey Pro 2019: the toggle controls the built-ins' presence instead —
   *   off removes them entirely (clean metrics card, no EMS control), on
   *   adds them back. They render visibly and are already interactive there,
   *   so the twins would only duplicate them and are never used.
   */
  private async syncTargetPowerControls(show: boolean): Promise<void> {
    const builtInsAlwaysPresent = this.isEnergyFullySupported();
    await this.syncTargetPowerBuiltInPresence(show || builtInsAlwaysPresent);
    if (show || builtInsAlwaysPresent) {
      this.registerTargetPowerControls();
      await this.initializeTargetPowerCapabilities();
    }
    if (builtInsAlwaysPresent) {
      await this.syncTargetPowerVisibleCapabilities(show);
    }
  }

  /**
   * Adds or removes the hidden built-in target power capabilities.
   */
  private async syncTargetPowerBuiltInPresence(present: boolean): Promise<void> {
    for (const capability of ['target_power', 'target_power_mode']) {
      const has = this.hasCapability(capability);
      if (present && !has) {
        await this.addCapability(capability);
      } else if (!present && has) {
        await this.removeCapability(capability);
      }
    }
  }

  /**
   * The settings dialog is a static manifest declaration, but the EMS
   * toggle's effect differs per Homey generation. This app-maintained
   * label-type note renders the platform-specific sentence next to the
   * toggle, so each user only ever reads the sentence that is true for
   * their Homey.
   */
  private async updateHemsSupportNote(): Promise<void> {
    const note = this.isEnergyFullySupported()
      ? this.homey.__('settings.hemsSupportNoteVisibility')
      : this.homey.__('settings.hemsSupportNotePresence');
    if (this.getSetting('hems_support_note') !== note) {
      await this.setSettingsSafe({ hems_support_note: note });
    }
  }

  /**
   * Initializes the target power capability values for freshly added
   * capabilities (existing devices get them via the graceful migration).
   * Falls back to the persisted operating mode (synced from the battery by
   * the polling loop) so flows act on the real mode even before the first
   * poll completed; defaults to self consumption otherwise, consistent with
   * the settings-page operating mode default.
   */
  private async initializeTargetPowerCapabilities() {
    this.targetPowerModeState = (this.getCapabilityValue('target_power_mode') as TargetPowerModeValue) ?? null;
    if (this.targetPowerModeState === null || this.targetPowerModeState === undefined) {
      const storedOperatingMode = this.getSetting('operating_mode') as string | undefined;
      const persistedMode = storedOperatingMode !== undefined && storedOperatingMode !== null
        ? TargetPowerMode.fromOperatingMode(storedOperatingMode)
        : null;
      const initialMode: TargetPowerModeValue = persistedMode ?? 'self_consumption';
      await this.setCapabilityValueSafe('target_power_mode', initialMode);
      this.targetPowerModeState = initialMode;
    }
    const currentPower = this.getCapabilityValue('target_power');
    if (currentPower === null || currentPower === undefined) {
      await this.setCapabilityValueSafe('target_power', 0);
    }
    // Seed the bookkeeping from the final state so an echo of these writes
    // (should the platform re-invoke listeners on app-side writes) is
    // recognized as a no-op instead of being applied to the battery at boot.
    const seededPower = this.getCapabilityValue('target_power');
    this.lastWrittenTargetPowerState = {
      power: seededPower === null || seededPower === undefined ? null : +seededPower,
      mode: this.targetPowerModeState,
    };
  }

  /**
   * Adds or removes the visible counterparts of the hidden Homey Energy
   * target power capabilities, depending on the user's opt-in setting.
   * The hidden built-ins stay present either way so flows and EMS apps
   * keep working; the twins only mirror them on the device UI.
   *
   * Only called on platforms that honor the `uiComponent: null` hide for
   * built-in capabilities (Homey Pro (Early 2023) and newer); Homey Pro 2019
   * manages the built-ins' presence instead and never uses the twins.
   */
  private async syncTargetPowerVisibleCapabilities(show: boolean): Promise<void> {
    for (const capability of BatteryDevice.TARGET_POWER_VISIBLE_CAPABILITIES) {
      const has = this.hasCapability(capability);
      if (show && !has) {
        await this.addCapability(capability);
      } else if (!show && has) {
        await this.removeCapability(capability);
      }
    }

    if (show) {
      this.registerTargetPowerVisibleControls();

      // Freshly added capabilities start without a value: seed them from the
      // canonical hidden built-ins so the card opens on the real state. The
      // twins were just added (or already exist) when show is true, so the
      // writes go through setCapabilityValueSafe directly.
      const power = this.getCapabilityValue('target_power');
      const mode = this.targetPowerModeState ?? (this.getCapabilityValue('target_power_mode') as TargetPowerModeValue | null);
      const seededPower = power === null || power === undefined ? 0 : +power;
      const seededMode = mode ?? 'self_consumption';
      await this.setCapabilityValueSafe('target_power_visible_capability', seededPower);
      await this.setCapabilityValueSafe('target_power_mode_visible_capability', seededMode);
      // Seed the bookkeeping so an echo of these writes is recognized as a
      // no-op instead of being applied to the battery.
      this.lastWrittenTargetPowerState = { power: seededPower, mode: seededMode };
    }
  }

  /**
   * Writes a value onto a visible twin of the target power capabilities.
   * The twins are opt-in and may be absent; unlike setCapabilityValueSafe
   * this must not log for every user without the setting enabled.
   */
  private async setTargetPowerTwinValueIfPresent(capability: string, value: unknown): Promise<void> {
    if (!this.hasCapability(capability)) {
      return;
    }
    await this.setCapabilityValueSafe(capability, value);
  }

  /**
   * Extracts the requested power/mode from a capability change batch, no
   * matter which surface it arrived on (hidden built-in or visible twin).
   * A value written on the twin takes precedence when both surfaces report
   * in the same debounced batch; a twin value of 0 is a legitimate request
   * and must not be skipped.
   */
  private static readControlRequest(values: Record<string, unknown>): CapabilityChangeRequest {
    const power = values.target_power_visible_capability ?? values.target_power ?? null;
    const mode = values.target_power_mode_visible_capability ?? values.target_power_mode ?? null;
    return {
      targetPower: power !== null && power !== undefined ? +power : null,
      targetPowerMode: mode as TargetPowerModeValue | null,
    };
  }

  /**
   * Entry point for all target-power capability writes (both surfaces, both
   * listeners). Batches are chained onto {@link targetPowerQueueWorker} and
   * applied strictly one at a time, in order: every user intent is processed
   * exactly once and the final processed batch converges the capability
   * state to the actually applied (clamped) value — WYSIWYG between the
   * slider, the list row and the battery, no matter how fast the value is
   * changed.
   *
   * Resolves immediately on purpose: Homey finalizes the user's raw
   * capability value after the listener returns, so a corrective write made
   * within the listener transaction is discarded (observed 2026-11-08: a
   * clamped 32500 W → 4600 W write-back was overwritten by the raw drag
   * value). The chained application runs after the transaction has closed,
   * and {@link scheduleTargetPowerVerification} re-checks the result.
   */
  private handleTargetPowerChange(values: Record<string, unknown>): Promise<void> {
    if (this.isNoOpTargetPowerChange(values)) {
      // Re-applying the state this handler just wrote (echo of the clamp
      // write-back / reset / mode write, or a repeated identical user write)
      // would be a no-op; skipping it also rules out write-back echo loops.
      this.log('Ignoring no-op target power change:', JSON.stringify(values));
      return Promise.resolve();
    }
    this.pendingTargetPowerBatches++;
    this.targetPowerQueueWorker = this.targetPowerQueueWorker
      .catch(() => undefined) // isolate a failed batch from the ones after it
      .then(() => this.applyTargetPowerChange(values))
      .catch((e) => {
        // The listener resolves immediately, so errors can no longer surface
        // through the capability UI; log them and keep the chain alive.
        this.error('Failed to apply target power change', e);
      })
      .finally(() => {
        this.pendingTargetPowerBatches--;
      });
    return Promise.resolve();
  }

  /**
   * Applies one batch: plan the control transition, drive the battery, and
   * write the resulting state back onto both surfaces so the stored
   * capability values always match what was actually applied (the battery
   * silently accepts oversized setpoints, so the clamped value is written
   * back; leaving Homey control resets the stored power so a later re-entry
   * starts from idle).
   */
  private async applyTargetPowerChange(values: Record<string, unknown>): Promise<void> {
    const request = BatteryDevice.readControlRequest(values);
    const currentPowerValue = this.getCapabilityValue('target_power');
    const plan = TargetPowerMode.planCapabilityChange(request, {
      currentMode: this.targetPowerModeState,
      currentPower: currentPowerValue === null || currentPowerValue === undefined ? null : +currentPowerValue,
      limits: this.powerLimits,
    });

    if (request.targetPowerMode === null && request.targetPower !== null && plan.requestedMode !== this.targetPowerModeState) {
      this.log('Implied mode switch: writing target_power hands control to Homey');
    }

    await this.applyControlActions(plan.actions);
    this.targetPowerModeState = plan.requestedMode;

    let writtenPower: number | null = null;
    if (plan.resetTargetPower) {
      writtenPower = 0;
      await this.setCapabilityValueSafe('target_power', 0);
      await this.setTargetPowerTwinValueIfPresent('target_power_visible_capability', 0);
    } else {
      writtenPower = plan.writeBackPower !== null ? plan.writeBackPower : request.targetPower;
      if (writtenPower !== null) {
        await this.setCapabilityValueSafe('target_power', writtenPower);
        await this.setTargetPowerTwinValueIfPresent('target_power_visible_capability', writtenPower);
      }
    }
    await this.setCapabilityValueSafe('target_power_mode', plan.requestedMode);
    await this.setTargetPowerTwinValueIfPresent('target_power_mode_visible_capability', plan.requestedMode);
    this.lastWrittenTargetPowerState = {
      power: writtenPower !== null ? writtenPower : this.lastWrittenTargetPowerState?.power ?? null,
      mode: plan.requestedMode,
    };
    if (plan.writeBackPower !== null) {
      // A clamp correction happened: this is the only write Homey's delayed
      // finalization of the user's raw set can revert, so schedule the
      // verification re-check for exactly this signature.
      this.scheduleTargetPowerVerification(writtenPower as number, request.targetPower as number);
    }
  }

  /**
   * Schedules a delayed re-check of the capability values a batch wrote. The
   * listener resolves before the write-back happens (see
   * {@link handleTargetPowerChange}), so in the rare case where Homey's own
   * finalization of the user's raw set lands *after* our correction, this
   * re-write heals the divergence instead of leaving the raw value displayed.
   */
  private scheduleTargetPowerVerification(expectedPower: number, rawPower: number): void {
    if (this.targetPowerVerifyTimeoutId) {
      this.homey.clearTimeout(this.targetPowerVerifyTimeoutId);
    }
    this.targetPowerVerifyTimeoutId = this.homey.setTimeout(() => {
      this.targetPowerVerifyTimeoutId = undefined;
      this.verifyTargetPowerWrittenState(expectedPower, rawPower);
    }, this.targetPowerVerificationDelayMillis);
  }

  /**
   * Re-reads the power surfaces and re-writes the clamped value when Homey
   * overrode it after the listener transaction. The heal is deliberately
   * narrow: a surface is only corrected when it holds the **raw requested
   * value** — the identifiable signature of the platform finalization. Any
   * other divergence is a legitimate external write (sonnen app, other apps,
   * flows) that must not be touched. Skipped while batches are queued or in
   * flight — newer activity owns the state then.
   */
  private async verifyTargetPowerWrittenState(expectedPower: number, rawPower: number): Promise<void> {
    try {
      if (this.pendingTargetPowerBatches > 0) {
        return; // newer batches are queued or in flight and own the state
      }
      const overridden = (capability: string): boolean => {
        if (!this.hasCapability(capability)) {
          return false;
        }
        const stored = this.getCapabilityValue(capability);
        return stored !== null && stored !== undefined && +stored === rawPower && rawPower !== expectedPower;
      };
      const builtInOverridden = overridden('target_power');
      const twinOverridden = overridden('target_power_visible_capability');
      if (!builtInOverridden && !twinOverridden) {
        return;
      }
      this.error('Target power capability value was overridden after the listener transaction, re-writing:',
        'expected', expectedPower,
        'raw', rawPower,
        'built-in', this.getCapabilityValue('target_power'),
        'twin', this.getCapabilityValue('target_power_visible_capability'));
      if (builtInOverridden) {
        await this.setCapabilityValueSafe('target_power', expectedPower);
      }
      if (twinOverridden) {
        await this.setTargetPowerTwinValueIfPresent('target_power_visible_capability', expectedPower);
      }
    } catch (e) {
      this.error('Failed to verify/re-write the target power capability value', e);
    }
  }

  /**
   * True when a batch requests exactly the state this handler last wrote —
   * an echo of the write-back/reset/mode write, or a repeated identical user
   * write. Both are no-ops: the capability state and the battery setpoint
   * already match the request.
   *
   * The comparison includes the **actual stored state**, not just the
   * bookkeeping: external writers (the polling mode sync, the sonnen app,
   * other apps) can move the capabilities without a batch, and a request
   * matching only stale bookkeeping must still be applied.
   */
  private isNoOpTargetPowerChange(values: Record<string, unknown>): boolean {
    const applied = this.lastWrittenTargetPowerState;
    if (!applied) {
      return false;
    }
    if (this.targetPowerModeState !== applied.mode) {
      // The mode moved externally since the last write: re-assert control.
      return false;
    }
    const request = BatteryDevice.readControlRequest(values);
    const storedPower = this.getCapabilityValue('target_power');
    const storedPowerNum = storedPower === null || storedPower === undefined ? null : +storedPower;
    if (request.targetPower !== null
      && (request.targetPower !== storedPowerNum || request.targetPower !== applied.power)) {
      return false;
    }
    if (request.targetPowerMode !== null && request.targetPowerMode !== applied.mode) {
      return false;
    }
    return true;
  }

  /**
   * Resolves the device's power limits from the cached `site/limits` response
   * (preferred, newer systems) and `IC_InverterMaxPower_w` from the already
   * fetched configurations (fallback). Results are stored as device settings
   * for diagnostics.
   */
  private async refreshPowerLimits(configurationsJson: Record<string, unknown>): Promise<PowerLimits> {
    const siteLimits = await this.getSiteLimitsCached();
    const inverterMaxPowerW = configurationsJson['IC_InverterMaxPower_w'] as string | number | null | undefined ?? null;
    const limits = TargetPowerLimits.resolve(siteLimits, inverterMaxPowerW);
    const chargeSetting = `${limits.charge} W (${limits.source})`;
    const dischargeSetting = `${limits.discharge} W (${limits.source})`;

    // The setting comparison also covers the initial sync: without it, a device
    // whose resolved limits equal the in-memory default would keep empty labels.
    if (limits.charge !== this.powerLimits.charge || limits.discharge !== this.powerLimits.discharge || limits.source !== this.powerLimits.source
      || this.getSetting('max_charge_power') !== chargeSetting || this.getSetting('max_discharge_power') !== dischargeSetting) {
      this.log('Resolved power limits:', JSON.stringify(limits));
      this.powerLimits = limits;
      await this.setSettingsSafe({ max_charge_power: chargeSetting, max_discharge_power: dischargeSetting });
    }

    return limits;
  }

  private async getSiteLimitsCached(): Promise<SiteLimitsResponse | null> {
    const now = Date.now();
    if (this.siteLimitsCache && (now - this.siteLimitsCache.fetchedAt) < this.siteLimitsCacheTtlMillis) {
      return this.siteLimitsCache.data;
    }

    try {
      const data = await this.createSonnenBatterieClient().getSiteLimits() as SiteLimitsResponse;
      this.siteLimitsCache = { fetchedAt: now, data };
      return data;
    } catch (error) {
      // Older systems may not support the endpoint; fall back to the inverter limit
      this.log('Could not read site limits, falling back to inverter limit', error);
      this.siteLimitsCache = { fetchedAt: now, data: null };
      return null;
    }
  }

  /**
   * Applies the planned control actions sequentially to the battery:
   * operatingMode → setpoint.
   */
  private async applyControlActions(actions: ControlActions): Promise<void> {
    this.log('Applying control actions:', JSON.stringify(actions));
    const client = this.createSonnenBatterieClient();

    try {
      if (actions.operatingMode !== null) {
        await client.setOperatingMode(actions.operatingMode);
      }
      if (actions.setpoint) {
        await client.setSetpoint(actions.setpoint.direction, actions.setpoint.watts);
      }
    } catch (error) {
      // Re-sync the local state with the battery: a partially applied
      // sequence must not leave stale assumptions (e.g. the target_power_mode
      // capability).
      this.refreshState().catch((refreshError) => {
        this.error('Failed to refresh state after a failed control action', refreshError);
      });

      // Re-throw localized so the error surfaces in the Flow card / UI
      throwLocalizedError(error);
    }

    if (actions.operatingMode !== null || actions.setpoint !== null) {
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
      'backup_buffer_capability',
      'state_core_control_module_capability',
      'total_cyclecount_capability',
      'cyclecount_7day_rate_capability',
      'cyclecount_30day_rate_capability',
      'cyclecount_installation_rate_capability'
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
    // The target power capabilities are opt-in on Homey Pro 2019 (their
    // presence is controlled by the EMS toggle, see syncTargetPowerControls):
    // never self-heal them there while the toggle is off, or every boot would
    // resurrect the tiles.
    const targetPowerCapabilities = ['target_power', 'target_power_mode'];
    const targetPowerOptOut = !this.isEnergyFullySupported() && this.getSetting('show_target_power_controls') !== true;
    for (const capability of manifestCapabilities) {
      // Sub-capabilities of the energy system are conditionally managed above
      if (!this.isEnergyFullySupported() && conditionalEnergyCapabilities.includes(capability)) {
        continue;
      }
      if (targetPowerOptOut && targetPowerCapabilities.includes(capability)) {
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
      const actualBatteries: [string, ...string[]] =
        new Array(numberBatteries).fill('INTERNAL') as [string, ...string[]];
      const energy = (await this.getEnergy()) || {
        homeBattery: true,
        batteries: [] as unknown as [string, ...string[]],
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
      this.setCapabilityValueSafe('eclipse_capability', resolveCircleColor(latestDataJson.ic_status['Eclipse Led']));
      this.setCapabilityValueSafe('state_bms_capability', this.homey.__('stateBms.' + latestDataJson.ic_status.statebms.replaceAll(' ', '')) ?? latestDataJson.ic_status.statebms);
      this.setCapabilityValueSafe('state_inverter_capability', this.homey.__('stateInverter.' + latestDataJson.ic_status.stateinverter.replaceAll(' ', '')) ?? latestDataJson.ic_status.stateinverter);
      this.setCapabilityValueSafe('state_core_control_module_capability', this.homey.__('stateCoreControlModule.' + latestDataJson.ic_status.statecorecontrolmodule.replaceAll(' ', '')) ?? latestDataJson.ic_status.statecorecontrolmodule);
      this.setCapabilityValueSafe('online_capability', !latestDataJson.ic_status['DC Shutdown Reason'].HW_Shutdown);
      this.setCapabilityValueSafe('alarm_generic', latestDataJson.ic_status['Eclipse Led']['Solid Red']);

      // Refresh the device power limits used for target_power clamping
      try {
        await this.refreshPowerLimits(configurationsJson);
      } catch (limitsError) {
        this.error('Could not refresh power limits', limitsError);
      }
      
      const scheduleRaw = configurationsJson['EM_ToU_Schedule'];
      const tou = new TimeOfUseSchedule(scheduleRaw);
      if (this.isDebugMode()) {
        this.log("Parsed Time-of-Use schedule: " + tou.toString());
      }
      await this.setSettingsSafe({ 'time_of_use_schedule': tou.toString() });

      const operatingMode = configurationsJson['EM_OperatingMode'];
      const operatingModeText = resolveOperatingMode(operatingMode);
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
      // modes (sonnen app, battery UI, other flows). Skipped while the
      // built-ins are absent (Homey Pro 2019 with the EMS toggle off).
      // Modes without a capability representation leave the capability
      // unchanged. Manual (mode 1) is ambiguous (homey and manual are both
      // its carriers), so the resolution is sticky on the current state.
      const targetPowerMode = TargetPowerMode.resolveExternalMode(operatingMode, this.targetPowerModeState);
      if (targetPowerMode !== null && this.hasCapability('target_power_mode') && targetPowerMode !== this.targetPowerModeState) {
        this.log('Syncing target_power_mode with externally changed operating mode', operatingMode, '->', targetPowerMode);
        await this.setCapabilityValueSafe('target_power_mode', targetPowerMode);
        await this.setTargetPowerTwinValueIfPresent('target_power_mode_visible_capability', targetPowerMode);
        this.targetPowerModeState = targetPowerMode;
      }

      const prognosisCharging = configurationsJson['EM_Prognosis_Charging'];
      const prognosisChargingMode = prognosisCharging === "1";
      this.setCapabilityValueSafe('prognosis_charging_capability', prognosisChargingMode);
      await this.setSettingsSafe({ 'prognosis_charging': prognosisChargingMode });

      const backupBuffer = parseBackupBuffer(configurationsJson['EM_USOC']);
      if (backupBuffer !== null) {
        this.lastReportedBackupBuffer = backupBuffer;
        this.setCapabilityValueSafe('backup_buffer_capability', backupBuffer);
        if (+(this.getSetting('backup_buffer') ?? NaN) !== backupBuffer) {
          await this.setSettingsSafe({ 'backup_buffer': backupBuffer });
        }
      } else {
        this.log('Battery reported no usable backup buffer value, keeping the last known value');
      }

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