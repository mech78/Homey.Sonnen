import { SonnenDevice } from '../../lib/SonnenDevice';
import { throwLocalizedError } from '../../lib/LocalizationService';
import {
  CapabilityChangePlan,
  CapabilityChangeRequest,
  ControlActions,
  TargetPowerMode,
  TargetPowerModeValue,
} from '../../domain/TargetPowerMode';
import { PowerLimits, SiteLimitsResponse, TargetPowerLimits } from '../../domain/TargetPowerLimits';

module.exports = class SonnenEmsControlDevice extends SonnenDevice {

  private siteLimitsCache: { data: SiteLimitsResponse | null; fetchedAt: number } | null = null;
  private siteLimitsCacheTtlMillis = 60 * 60 * 1000; // 1 hour

  private controlQueueWorker: Promise<void> = Promise.resolve();
  private targetPowerModeState: TargetPowerModeValue | null = null;
  // Stable field-initializer wrappers so onDeleted's removeListener actually
  // matches the onInit registration (an inline arrow would be a fresh
  // function reference and would leak the listener).
  private controlUpdateListener = (operatingMode: unknown) => this.handleControlUpdateEvent(operatingMode);
  private limitsUpdateListener = (limits: unknown) => this.handleLimitsUpdateEvent(limits);
  private powerLimits: PowerLimits = {
    charge: TargetPowerLimits.DEFAULT_LIMIT_W,
    discharge: TargetPowerLimits.DEFAULT_LIMIT_W,
    source: 'default',
  };

  /**
   * onInit is called when the device is initialized.
   */
  override async onInit(): Promise<void> {
    this.targetPowerModeState = (this.getCapabilityValue('target_power_mode') as TargetPowerModeValue) ?? null;
    if (this.targetPowerModeState === null) {
      // Consistent with the battery device's operating-mode default; the real
      // battery mode arrives with the next poll via the update bus.
      await this.setCapabilityValueSafe('target_power_mode', 'self_consumption');
      this.targetPowerModeState = 'self_consumption';
    }
    const currentPower = this.getCapabilityValue('target_power');
    if (currentPower === null || currentPower === undefined) {
      await this.setCapabilityValueSafe('target_power', 0);
    }

    this.registerMultipleCapabilityListener(
      ['target_power', 'target_power_mode'],
      (values: Record<string, unknown>) => this.handleTargetPowerChange(values),
      500,
    );

    // The battery device keeps polling and shares its raw operating mode and
    // its resolved power limits via the bus, so this device never polls (or
    // reports) anything itself.
    this.homey.on('sonnenControlUpdate', this.controlUpdateListener);
    this.homey.on('sonnenLimitsUpdate', this.limitsUpdateListener);

    // Best effort; on failure the family-bound manifest range stays active.
    await this.refreshPowerLimits();

    super.onInit();
  }

  /**
   * onDeleted is called when the user deleted the device.
   * Best effort: hand the battery back to its default behavior so no setpoint
   * survives the device (deleting the device means leaving EMS control).
   */
  override async onDeleted(): Promise<void> {
    this.homey.removeListener('sonnenControlUpdate', this.controlUpdateListener);
    this.homey.removeListener('sonnenLimitsUpdate', this.limitsUpdateListener);
    try {
      await this.createSonnenBatterieClient().setOperatingMode('2'); // Self consumption
    } catch (error) {
      this.error('Failed to reset the battery operating mode after device deletion', error);
    }
    super.onDeleted();
  }

  private handleTargetPowerChange(values: Record<string, unknown>): Promise<void> {
    this.log('Target power change:', JSON.stringify(values));
    const request: CapabilityChangeRequest = {
      targetPower: values.target_power !== null && values.target_power !== undefined ? +values.target_power : null,
      targetPowerMode: (values.target_power_mode as TargetPowerModeValue) ?? null,
    };

    // Serialize the API writes so rapid capability changes cannot race on the
    // battery. Resolving immediately is fine: Homey stores the raw capability
    // value either way, and the honest-state write-backs below correct the
    // stored state before the next change is applied.
    this.controlQueueWorker = this.controlQueueWorker
      .catch(() => undefined) // isolate a failed batch from the ones after it
      .then(() => this.processTargetPowerChange(request))
      .catch((e) => this.error('Failed to apply target power change', e));
    return Promise.resolve();
  }

  private async processTargetPowerChange(request: CapabilityChangeRequest): Promise<void> {
    const currentPowerValue = this.getCapabilityValue('target_power');
    const plan = TargetPowerMode.planCapabilityChange(request, {
      currentMode: this.targetPowerModeState,
      currentPower: currentPowerValue === null || currentPowerValue === undefined ? null : +currentPowerValue,
      limits: this.powerLimits,
    });
    await this.applyTargetPowerPlan(plan);
  }

  private async applyTargetPowerPlan(plan: CapabilityChangePlan): Promise<void> {
    await this.applyControlActions(plan.actions);
    this.targetPowerModeState = plan.requestedMode;

    // Honest capability state: surface the implied mode switch (e.g. writing
    // target_power hands control to Homey) so the UI mirrors the mode that
    // was actually applied. Homey finalizes the listener's raw capability
    // value after the listener returns; this write runs inside the queued
    // worker afterwards, so the platform cannot overwrite it.
    const storedMode = this.getCapabilityValue('target_power_mode') as TargetPowerModeValue | null;
    if (storedMode !== plan.requestedMode) {
      await this.setCapabilityValueSafe('target_power_mode', plan.requestedMode);
    }

    // Honest capability state: leaving Homey control resets the stored power
    // to idle, and a corrected (clamped/reset) effective power is written back.
    if (plan.resetTargetPower) {
      await this.setCapabilityValueSafe('target_power', 0);
    } else if (plan.writeBackPower !== null) {
      await this.setCapabilityValueSafe('target_power', plan.writeBackPower);
    }
  }

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
      this.error('Failed to apply control actions to the battery', error);
      throwLocalizedError(error); // re-throw localized so the UI/Flow shows it
    }
  }

  private async handleControlUpdateEvent(operatingMode: unknown): Promise<void> {
    // Sticky: battery mode 1 (Manual) is carried by both `homey` and `manual`,
    // so an established state must survive an external read.
    const mode = TargetPowerMode.resolveExternalMode(String(operatingMode), this.targetPowerModeState);
    if (mode === null || mode === this.targetPowerModeState) {
      return;
    }
    this.log('Syncing target_power_mode with externally changed operating mode', operatingMode, '->', mode);
    await this.setCapabilityValueSafe('target_power_mode', mode);
    this.targetPowerModeState = mode;
  }

  /**
   * Applies the power limits the battery device fans out over the update bus.
   * The only side effect is a slider re-range, and only when the limits
   * actually changed — the fan-out arrives on every battery poll.
   */
  private async handleLimitsUpdateEvent(payload: unknown): Promise<void> {
    if (payload === null || typeof payload !== 'object') {
      return;
    }
    const limits = payload as Partial<PowerLimits>;
    const charge = Number(limits.charge);
    const discharge = Number(limits.discharge);
    if (!Number.isFinite(charge) || !Number.isFinite(discharge) || charge <= 0 || discharge <= 0) {
      return;
    }
    if (charge === this.powerLimits.charge && discharge === this.powerLimits.discharge) {
      return;
    }
    this.log('Received changed power limits from the battery device bus:', charge, discharge, '— re-ranging the target_power slider');
    this.powerLimits = {
      charge,
      discharge,
      source: typeof limits.source === 'string' ? limits.source as PowerLimits['source'] : 'default',
    };
    await this.applyTargetPowerSliderLimits();
  }

  /**
   * Resolves the device's real power limits and re-ranges the target_power
   * slider. This replaces driver-side clamping: the platform clamps
   * everything written inside this range (manual writes, the flow card,
   * EMS apps), so the driver never sees a value it must correct.
   *
   * Bootstrap fallback for devices where the battery device is not paired
   * (or its fan-out has not arrived yet): limits come from `site/limits`
   * (preferred, newer systems) with `IC_InverterMaxPower_w` from the
   * configurations as fallback — older systems return an empty site limits
   * object (observed 2026-11-10), so the inverter value is what actually
   * yields a realistic slider range on them. Ongoing updates arrive via
   * {@link handleLimitsUpdateEvent}.
   */
  private async refreshPowerLimits(): Promise<void> {
    try {
      const client = this.createSonnenBatterieClient();
      const now = Date.now();
      let siteLimits: SiteLimitsResponse | null;
      if (this.siteLimitsCache && (now - this.siteLimitsCache.fetchedAt) < this.siteLimitsCacheTtlMillis) {
        siteLimits = this.siteLimitsCache.data;
      } else {
        try {
          const data = await client.getSiteLimits();
          this.siteLimitsCache = { data, fetchedAt: now };
          siteLimits = data;
        } catch (error) {
          // Older systems may not support the endpoint; fall back to the
          // inverter limit below.
          this.log('Could not read site limits, falling back to the inverter power limit', error);
          this.siteLimitsCache = { data: null, fetchedAt: now };
          siteLimits = null;
        }
      }

      let inverterMaxPowerW: string | number | null = null;
      try {
        const configurationsJson = await client.getConfigurations();
        inverterMaxPowerW = (configurationsJson['IC_InverterMaxPower_w'] as string | number | null | undefined) ?? null;
      } catch (error) {
        this.log('Could not read the configurations for the inverter power limit', error);
      }

      this.powerLimits = TargetPowerLimits.resolve(siteLimits, inverterMaxPowerW);
      this.log('Resolved power limits:', JSON.stringify(this.powerLimits), '— re-ranging the target_power slider');
      await this.applyTargetPowerSliderLimits();
    } catch (error) {
      // Older systems may not support the endpoint; fall back to the default
      // family bound from the manifest (the battery still ignores over-limit
      // setpoints on its side).
      this.error('Could not read site power limits, keeping the default slider range', error);
    }
  }

  private async applyTargetPowerSliderLimits(): Promise<void> {
    // Partial option writes only ({ min, max }); full option objects (with
    // e.g. title/units/uiComponent) are silently rejected by the platform.
    try {
      await this.setCapabilityOptions('target_power', {
        min: -this.powerLimits.discharge,
        max: this.powerLimits.charge,
      });
      this.log('Limited target power slider range:', 'target_power', -this.powerLimits.discharge, '...', this.powerLimits.charge);
    } catch (e) {
      this.error('Failed to limit the range of "target_power"', e);
    }
  }

  private async setCapabilityValueSafe(capability: string, value: unknown): Promise<void> {
    try {
      await this.setCapabilityValue(capability, value);
    } catch (e) {
      this.error(`Failed to set capability "${capability}" to "${value}"`, e);
    }
  }

};
