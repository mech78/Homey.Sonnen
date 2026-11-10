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
  private powerLimits: PowerLimits = { charge: TargetPowerLimits.DEFAULT_LIMIT_W, discharge: TargetPowerLimits.DEFAULT_LIMIT_W, source: 'default' };
  private siteLimitsCache: { fetchedAt: number; data: SiteLimitsResponse | null } | null = null;
  private readonly siteLimitsCacheTtlMillis = 600000; // 10 minutes


  async onInit() {
    super.onInit();

    await this.gracefullyAddOrRemoveCapabilities();
    this.registerResetMetersButton();
    await this.syncTargetPowerControls(this.getSetting('show_target_power_controls') === true);

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
    await this.teardownTargetPowerControls();
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
    await this.teardownTargetPowerControls();
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

    if (_.contains(changedKeys, "show_target_power_controls")) {
      const showTargetPowerControls = newSettings["show_target_power_controls"] === true;
      this.log("Settings", "ShowTargetPowerControls", showTargetPowerControls);
      if (showTargetPowerControls) {
        await this.syncTargetPowerControls(true);
      } else {
        await this.disableTargetPowerControl();
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
          await this.applyExternalOperatingMode(newOperatingMode);

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
   * Synchronizes the target power surface with the "EMS power control"
   * device setting. The built-in `target_power` / `target_power_mode`
   * capabilities are added when enabled and removed when disabled — on both
   * platforms identically, with no duplicated twin capabilities. Removed
   * capabilities cannot receive writes from Homey Energy, EMS apps or flows,
   * which is what makes the opt-out real instead of cosmetic.
   */
  private async syncTargetPowerControls(show: boolean): Promise<void> {
    await this.syncTargetPowerPresence(show);
    if (show) {
      this.registerTargetPowerControls();
      await this.initializeTargetPowerCapabilities();
      // KISS: always re-range on visibility — the write is idempotent and
      // guarantees the slider matches the real device limits (the poll loop
      // keeps it updated afterwards).
      await this.applyTargetPowerSliderLimits(this.powerLimits);
    }
  }

  /**
   * Adds or removes the built-in target power capabilities.
   */
  private async syncTargetPowerPresence(present: boolean): Promise<void> {
    for (const capability of ['target_power', 'target_power_mode']) {
      try {
        const has = this.hasCapability(capability);
        if (present && !has) {
          await this.addCapability(capability);
        } else if (!present && has) {
          await this.removeCapability(capability);
        }
      } catch (error) {
        this.error(`Failed to sync the presence of "${capability}"`, error);
      }
    }
  }

  /**
   * Clears in-flight target-power state. Called from onDeleted/onUninit.
   * A queued batch is awaited so a partially applied control sequence cannot
   * be interrupted mid-way by app teardown.
   */
  private async teardownTargetPowerControls(): Promise<void> {
    if (this.targetPowerVerifyTimeoutId) {
      this.homey.clearTimeout(this.targetPowerVerifyTimeoutId);
      this.targetPowerVerifyTimeoutId = undefined;
    }
    await this.targetPowerQueueWorker.catch(() => undefined);
  }

  /**
   * Registers the combined listener for `target_power` and `target_power_mode`
   * so mode + power changes are applied as a single debounced operation
   * (Homey recommends 500ms). Once-guarded: Homey offers no unregister, so
   * repeated calls would leak duplicate handlers. A removed capability stops
   * producing events anyway, so the once-guard across toggle cycles is safe.
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
   * Initializes the target power capability values for freshly added
   * capabilities. The controller model is two-valued (`homey` / `device`):
   * enabling the surface never takes control by itself, so the seeded state
   * is `device` — the battery keeps running whatever strategy the user's
   * `operating_mode` setting has it on (visible on the operating mode card).
   */
  private async initializeTargetPowerCapabilities() {
    this.targetPowerModeState = (this.getCapabilityValue('target_power_mode') as TargetPowerModeValue) ?? null;
    if (this.targetPowerModeState === null || this.targetPowerModeState === undefined) {
      await this.setCapabilityValueSafe('target_power_mode', 'device');
      this.targetPowerModeState = 'device';
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
   * The operating mode captured before Homey took control (persisted in an
   * undeclared device setting — the same storage pattern the platform's own
   * energy keys use), validated against the known operating modes. `null`
   * means no usable backup exists and an exit must not write any mode.
   */
  private getPersistedPriorOperatingMode(): string | null {
    const mode = this.getSetting('target_power_prior_operating_mode');
    return typeof mode === 'string' && (KNOWN_OPERATING_MODES as readonly string[]).includes(mode) ? mode : null;
  }

  /**
   * Captures the battery's current operating mode before Homey takes
   * control, so an exit can restore it. Only called on the transition into
   * control. Without a readable mode, nothing is persisted and the exit
   * later applies no mode change at all (never a guessed default).
   */
  private async capturePriorOperatingMode(): Promise<void> {
    const mode = this.getSetting('operating_mode') as string | undefined;
    if (typeof mode === 'string' && (KNOWN_OPERATING_MODES as readonly string[]).includes(mode)) {
      await this.setSettingsSafe({ target_power_prior_operating_mode: mode });
      this.log('Captured prior operating mode before Homey control:', mode);
    } else {
      this.log('No known operating mode to capture before Homey control; exit will not restore a mode');
      await this.setSettingsSafe({ target_power_prior_operating_mode: '' });
    }
  }

  private async clearPersistedPriorOperatingMode(): Promise<void> {
    await this.setSettingsSafe({ target_power_prior_operating_mode: '' });
  }

  /**
   * Extracts the requested power/mode from a capability change batch.
   */
  private static readControlRequest(values: Record<string, unknown>): CapabilityChangeRequest {
    return {
      targetPower: values.target_power !== null && values.target_power !== undefined ? +values.target_power : null,
      targetPowerMode: (values.target_power_mode as TargetPowerModeValue) ?? null,
    };
  }

  /**
   * Entry point for all target-power capability writes. Batches are chained
   * onto {@link targetPowerQueueWorker} and applied strictly one at a time,
   * in order: every user intent is processed exactly once and the final
   * processed batch converges the capability state to the actually applied
   * (clamped) value — WYSIWYG between the slider and the battery, no matter
   * how fast the value is changed.
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
   * write the resulting state back onto the capabilities so the stored
   * values always match what was actually applied (the battery silently
   * accepts oversized setpoints, so the clamped value is written back;
   * leaving Homey control resets the stored power so a later re-entry
   * starts from idle).
   */
  private async applyTargetPowerChange(values: Record<string, unknown>): Promise<void> {
    const request = BatteryDevice.readControlRequest(values);
    const currentPowerValue = this.getCapabilityValue('target_power');
    const wasControlling = this.targetPowerModeState === 'homey';
    const plan = TargetPowerMode.planCapabilityChange(request, {
      currentMode: this.targetPowerModeState,
      currentPower: currentPowerValue === null || currentPowerValue === undefined ? null : +currentPowerValue,
      limits: this.powerLimits,
      restoreOperatingMode: wasControlling ? this.getPersistedPriorOperatingMode() : null,
    });

    if (request.targetPowerMode === null && request.targetPower !== null && plan.requestedMode !== this.targetPowerModeState) {
      this.log('Implied mode switch: writing target_power hands control to Homey');
    }

    if (plan.requestedMode === 'homey' && !wasControlling) {
      // Entering control: remember the battery's own strategy so an exit can
      // restore it. Must happen before the operating mode is switched to
      // Manual below.
      await this.capturePriorOperatingMode();
    }

    await this.applyControlActions(plan.actions);
    this.targetPowerModeState = plan.requestedMode;

    let writtenPower: number | null = null;
    if (plan.resetTargetPower) {
      writtenPower = 0;
      await this.setCapabilityValueSafe('target_power', 0);
    } else {
      writtenPower = plan.writeBackPower !== null ? plan.writeBackPower : request.targetPower;
      if (writtenPower !== null) {
        await this.setCapabilityValueSafe('target_power', writtenPower);
      }
    }
    await this.setCapabilityValueSafe('target_power_mode', plan.requestedMode);
    this.lastWrittenTargetPowerState = {
      power: writtenPower !== null ? writtenPower : this.lastWrittenTargetPowerState?.power ?? null,
      mode: plan.requestedMode,
    };
    if (plan.requestedMode === 'device' && wasControlling) {
      // The captured mode was consumed by the restore — do not keep it
      // around as a stale backup for a future control period.
      await this.clearPersistedPriorOperatingMode();
    }
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
   * Re-reads the power capability and re-writes the clamped value when Homey
   * overrode it after the listener transaction. The heal is deliberately
   * narrow: the capability is only corrected when it holds the **raw
   * requested value** — the identifiable signature of the platform
   * finalization. Any other divergence is a legitimate external write (sonnen
   * app, other apps, flows) that must not be touched. Skipped while batches
   * are queued or in flight — newer activity owns the state then.
   */
  private async verifyTargetPowerWrittenState(expectedPower: number, rawPower: number): Promise<void> {
    try {
      if (this.pendingTargetPowerBatches > 0) {
        return; // newer batches are queued or in flight and own the state
      }
      if (!this.hasCapability('target_power')) {
        return;
      }
      const stored = this.getCapabilityValue('target_power');
      const overridden = stored !== null && stored !== undefined && +stored === rawPower && rawPower !== expectedPower;
      if (!overridden) {
        return;
      }
      this.error('Target power capability value was overridden after the listener transaction, re-writing:',
        'expected', expectedPower,
        'raw', rawPower,
        'stored', stored);
      await this.setCapabilityValueSafe('target_power', expectedPower);
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
   * Applies an operating mode from **outside** the target-power control path
   * (settings dialog, operating-mode card/flow actions). Per the controller
   * model, every such application of a mode while Homey is in control is a
   * return of control to the device: the controller exits (capability to
   * `device`, stored power reset, prior-mode memory cleared) and the
   * requested mode is then applied to the battery. Exits are chained onto
   * the control queue so they cannot interleave with an in-flight setpoint
   * batch; the mode write itself proceeds immediately (the queued exit
   * performs no operating-mode write of its own).
   *
   * Public: the driver's flow actions call this for their operating-mode
   * writes — the one deliberate entry point for external mode applications.
   */
  public async applyExternalOperatingMode(mode: string): Promise<void> {
    if (this.targetPowerModeState === 'homey') {
      this.exitTargetPowerControlToDevice(`operating mode ${mode} applied outside Homey control`);
    }
    await this.createSonnenBatterieClient().setOperatingMode(mode);
  }

  /**
   * Exits Homey control and returns the controller to `device`. Used by the
   * poll sync (battery reported a strategy mode while controlling) and by
   * {@link applyExternalOperatingMode}. The battery is **not** switched to
   * any mode here — it already runs the strategy the exit is reacting to.
   * Chained onto the control queue; a stale signal (state already left) is
   * a no-op.
   */
  private exitTargetPowerControlToDevice(reason: string): void {
    this.targetPowerQueueWorker = this.targetPowerQueueWorker
      .catch(() => undefined)
      .then(async () => {
        if (this.targetPowerModeState !== 'homey') {
          return; // stale signal: control already left via another path
        }
        this.log('Exiting Homey control:', reason);
        this.targetPowerModeState = 'device';
        await this.setCapabilityValueSafe('target_power_mode', 'device');
        await this.setCapabilityValueSafe('target_power', 0);
        await this.clearPersistedPriorOperatingMode();
        this.lastWrittenTargetPowerState = { power: 0, mode: 'device' };
      })
      .catch((e) => this.error('Failed to exit target power control', e));
  }

  /**
   * Disables the EMS power-control surface: removes the capabilities and,
   * when Homey was in control, restores the captured prior operating mode.
   * Per the controller model there is **no default mode**: without a capture
   * (control was never taken, or the backup is unusable) the battery's mode
   * is left untouched — at worst it stays in Manual, where a leftover
   * setpoint expires on its own.
   */
  private async disableTargetPowerControl(): Promise<void> {
    const wasControlling = this.targetPowerModeState === 'homey';
    const priorMode = wasControlling ? this.getPersistedPriorOperatingMode() : null;

    await this.syncTargetPowerControls(false);
    this.targetPowerModeState = null;
    this.lastWrittenTargetPowerState = null;

    if (wasControlling && priorMode !== null) {
      this.log('Restoring the captured prior operating mode after disabling EMS power control:', priorMode);
      try {
        await this.createSonnenBatterieClient().setOperatingMode(priorMode);
      } catch (error) {
        this.error('Failed to restore the prior operating mode after disabling EMS power control', error);
        throwLocalizedError(error);
      }
    } else if (wasControlling) {
      this.log('No prior operating mode captured; leaving the battery mode untouched');
    }
    await this.clearPersistedPriorOperatingMode();
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
      throwLocalizedError(error); // re-throw localized so the UI/Flow shows it
    }
  }

  /**
   * Limits the target power slider to the resolved device power limits,
   * using **partial** option writes (`{ min, max }` only) — the
   * community-proven pattern; Homey merges them into the capability's
   * options. Full options objects are silently rejected by the platform
   * (observed 2026-11-08: a merged write containing `title`/`units`/`icon`
   * did not apply the range).
   *
   * KISS contract: always write, no compare, no readbacks. The capabilities
   * are runtime-added by the toggle, so there is no hidden-by-uiComponent
   * variant to protect — the write is safe on both platforms (experiment
   * E2 verifies the 2019 options API on runtime-added capabilities).
   */
  private async applyTargetPowerSliderLimits(limits: PowerLimits): Promise<void> {
    const min = -limits.discharge;
    const max = limits.charge;
    try {
      await this.setCapabilityOptions('target_power', { min, max });
      this.log('Limited target power slider range:', 'target_power', `${min} ... ${max}`);
    } catch (e) {
      this.error('Failed to limit the range of "target_power"', e);
    }
  }

  /**
   * Resolves the device's real power limits from the cached `site/limits`
   * response (preferred, newer systems) and `IC_InverterMaxPower_w` from the
   * already-fetched configurations (fallback; older systems return an empty
   * site limits object). Re-ranges the slider only when the resolved limits
   * changed — the poll runs this on every cycle.
   */
  private async refreshPowerLimits(configurationsJson: Record<string, unknown>): Promise<PowerLimits> {
    const siteLimits = await this.getSiteLimitsCached();
    const inverterMaxPowerW = (configurationsJson['IC_InverterMaxPower_w'] as string | number | null | undefined) ?? null;
    const limits = TargetPowerLimits.resolve(siteLimits, inverterMaxPowerW);

    if (limits.charge !== this.powerLimits.charge || limits.discharge !== this.powerLimits.discharge || limits.source !== this.powerLimits.source) {
      this.log('Resolved power limits:', JSON.stringify(limits));
      this.powerLimits = limits;
      if (this.hasCapability('target_power')) {
        await this.applyTargetPowerSliderLimits(limits);
      }
    }

    return limits;
  }

  /**
   * Reads the site power limits through a short-lived TTL cache: the limits
   * change rarely, and the endpoint is called on every poll cycle. Older
   * systems that cannot serve the endpoint are remembered as `null` so the
   * resolution falls back to the inverter limit without re-requesting it.
   */
  private async getSiteLimitsCached(): Promise<SiteLimitsResponse | null> {
    const now = Date.now();
    if (this.siteLimitsCache && (now - this.siteLimitsCache.fetchedAt) < this.siteLimitsCacheTtlMillis) {
      return this.siteLimitsCache.data;
    }

    const client = this.createSonnenBatterieClient();
    try {
      const data = await client.getSiteLimits() as SiteLimitsResponse;
      this.siteLimitsCache = { data, fetchedAt: now };
      return data;
    } catch (error) {
      this.log('Could not read site limits, falling back to the inverter power limit', error);
      this.siteLimitsCache = { data: null, fetchedAt: now };
      return null;
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

      // Refresh the device power limits used for target_power clamping and
      // slider re-ranging. Non-fatal: the previous/default limits stay
      // active for this cycle and the next poll retries.
      try {
        await this.refreshPowerLimits(configurationsJson);
      } catch (limitsError) {
        this.error('Could not refresh power limits', limitsError);
      }

      // Sync the controller state with externally changed operating modes
      // (sonnen app, battery UI). Skipped while the capabilities are absent
      // (EMS power control disabled). Rule: mode 1 (Manual) is the carrier
      // of Homey control and is sticky — our own writes and an external
      // sonnen-app Manual are indistinguishable by mode value alone. Any
      // other reported mode means the battery runs its own strategy again:
      // the controller exits to `device` (queued; the exit itself writes no
      // operating mode).
      const targetPowerMode = TargetPowerMode.resolveControllerMode(operatingMode, this.targetPowerModeState);
      if (targetPowerMode !== null && this.hasCapability('target_power_mode') && targetPowerMode !== this.targetPowerModeState) {
        this.exitTargetPowerControlToDevice(`battery operating mode changed externally to ${operatingMode}`);
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