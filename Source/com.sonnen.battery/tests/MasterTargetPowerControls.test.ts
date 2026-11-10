// device.ts re-assigns module.exports to the class; handle both export shapes.
const deviceModule = require('../drivers/sonnenbatterie/device');
const BatteryDevice = (deviceModule.BatteryDevice ?? deviceModule) as unknown as { prototype: object };

// The harness deliberately treats the device as a loose bag of members:
// methods are taken from the prototype and collaborators are stubbed on it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDevice = Record<string, any>;

/**
 * Builds a BatteryDevice-like harness without invoking the Homey Device
 * constructor: methods are taken from the prototype, collaborators are
 * stubbed on the instance (TS "private" is compile-time only).
 */
function createDevice(settings: Record<string, unknown> = {}, capabilities: Record<string, unknown> = {}): AnyDevice {
  const device = Object.create(BatteryDevice.prototype) as AnyDevice;
  device.missingCapabilitiesWarned = new Set<string>();
  device.lastReportedOperatingMode = null;
  device.lastReportedBackupBuffer = null;
  device.log = jest.fn();
  device.error = jest.fn();
  device.hasCapability = jest.fn((capability: string) => capability in capabilities);
  device.addCapability = jest.fn(async (capability: string) => {
    capabilities[capability] = null;
  });
  device.removeCapability = jest.fn(async (capability: string) => {
    delete capabilities[capability];
  });
  device.getCapabilityValue = jest.fn((capability: string) => capabilities[capability] ?? null);
  device.setCapabilityValue = jest.fn(async (capability: string, value: unknown) => {
    capabilities[capability] = value;
  });
  device.setCapabilityOptions = jest.fn();
  device.registerMultipleCapabilityListener = jest.fn();
  device.getSetting = jest.fn((key: string) => settings[key]);
  device.setSettings = jest.fn();
  device.setSettingsSafe = jest.fn(async (values: Record<string, unknown>) => undefined);
  device.homey = {
    on: jest.fn(),
    removeListener: jest.fn(),
    setTimeout: jest.fn((fn: () => void) => 1),
    clearTimeout: jest.fn(),
    settings: { get: jest.fn(() => '30') },
  };
  device.refreshState = jest.fn(async () => undefined);
  device.siteLimitsCache = null;
  device.siteLimitsCacheTtlMillis = 600000;
  device.targetPowerQueueWorker = Promise.resolve();
  device.targetPowerControlsRegistered = false;
  device.targetPowerModeState = null;
  device.powerLimits = { charge: 46000, discharge: 46000, source: 'default' };
  device.createSonnenBatterieClient = jest.fn(() => device.client);
  device.client = {
    setOperatingMode: jest.fn(async () => undefined),
    setSetpoint: jest.fn(async () => undefined),
    getSiteLimits: jest.fn(async () => ({})),
  };
  return device;
}

async function applyChange(device: AnyDevice, values: Record<string, unknown>): Promise<void> {
  device.handleTargetPowerChange(values);
  await device.targetPowerQueueWorker;
}

describe('target power toggle lifecycle', () => {
  it('enabling adds the built-in capabilities, seeds them and re-ranges the slider', async () => {
    const settings = { operating_mode: '2' };
    const device = createDevice(settings);

    await device.syncTargetPowerControls(true);

    expect(device.hasCapability('target_power')).toBe(true);
    expect(device.hasCapability('target_power_mode')).toBe(true);
    expect(device.registerMultipleCapabilityListener).toHaveBeenCalledWith(
      ['target_power', 'target_power_mode'],
      expect.any(Function),
      500,
    );
    // Seeded from the persisted operating mode (2 = self consumption)
    expect(device.targetPowerModeState).toBe('self_consumption');
    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_power_mode', 'self_consumption');
    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_power', 0);
    // Bookkeeping seeded so boot-time echoes are no-ops
    expect(device.lastWrittenTargetPowerState).toEqual({ power: 0, mode: 'self_consumption' });
    expect(device.setCapabilityOptions).toHaveBeenCalledWith('target_power', { min: -46000, max: 46000 });
  });

  it('disabling removes the built-in capabilities', async () => {
    const device = createDevice({}, { target_power: 0, target_power_mode: 'homey' });
    device.targetPowerModeState = 'homey';

    await device.syncTargetPowerControls(false);

    expect(device.hasCapability('target_power')).toBe(false);
    expect(device.hasCapability('target_power_mode')).toBe(false);
  });
});

describe('target power control path', () => {
  it('applies a power write in homey mode with the implied mode switch and write-backs', async () => {
    const device = createDevice({}, { target_power_mode: 'self_consumption', target_power: 0 });
    device.targetPowerModeState = 'self_consumption';
    device.powerLimits = { charge: 4600, discharge: 4600, source: 'inverter' };

    await applyChange(device, { target_power: 2000 });

    expect(device.client.setOperatingMode).toHaveBeenCalledWith('1'); // Manual carries the setpoint
    expect(device.client.setSetpoint).toHaveBeenCalledWith('charge', 2000);
    expect(device.targetPowerModeState).toBe('homey');
    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_power_mode', 'homey');
  });

  it('clamps over-limit setpoints and writes the clamped value back', async () => {
    const device = createDevice({}, { target_power_mode: 'homey', target_power: 0 });
    device.targetPowerModeState = 'homey';
    device.powerLimits = { charge: 4600, discharge: 4600, source: 'inverter' };

    await applyChange(device, { target_power: 20000 });

    expect(device.client.setSetpoint).toHaveBeenCalledWith('charge', 4600);
    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_power', 4600);
  });

  it('recognizes an echo of the last written state as a no-op', async () => {
    const device = createDevice({}, { target_power_mode: 'homey', target_power: 2000 });
    device.targetPowerModeState = 'homey';
    device.lastWrittenTargetPowerState = { power: 2000, mode: 'homey' };

    await applyChange(device, { target_power: 2000 });

    expect(device.client.setSetpoint).not.toHaveBeenCalled();
    expect(device.setCapabilityValue).not.toHaveBeenCalled();
  });

  it('resets the stored power when leaving Homey control to a device mode', async () => {
    const device = createDevice({}, { target_power_mode: 'homey', target_power: 4200 });
    device.targetPowerModeState = 'homey';

    await applyChange(device, { target_power_mode: 'self_consumption' });

    expect(device.client.setOperatingMode).toHaveBeenCalledWith('2');
    expect(device.client.setSetpoint).not.toHaveBeenCalled();
    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_power', 0);
    expect(device.targetPowerModeState).toBe('self_consumption');
  });
});

describe('target power verification heal', () => {
  it('re-writes the clamped value when Homey left the raw value in place', async () => {
    const device = createDevice({}, { target_power: 20000 }); // raw value survived
    device.targetPowerModeState = 'homey';

    await device.verifyTargetPowerWrittenState(4600, 20000);

    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_power', 4600);
  });

  it('leaves legitimate external writes alone', async () => {
    const device = createDevice({}, { target_power: 1500 }); // neither raw nor expected
    device.targetPowerModeState = 'homey';

    await device.verifyTargetPowerWrittenState(4600, 20000);

    expect(device.setCapabilityValue).not.toHaveBeenCalled();
  });
});

describe('refreshPowerLimits', () => {
  it('resolves site limits and re-ranges the slider', async () => {
    const device = createDevice({}, { target_power: 0 });
    device.client.getSiteLimits = jest.fn(async () => ({
      p_bess_inv_max_import_limit: 5000,
      p_bess_inv_max_export_limit: 4000,
    }));

    await device.refreshPowerLimits({});

    expect(device.setCapabilityOptions).toHaveBeenCalledWith('target_power', { min: -4000, max: 5000 });
    expect(device.powerLimits).toEqual({ charge: 5000, discharge: 4000, source: 'site' });
  });

  it('falls back to the inverter power limit on empty site limits', async () => {
    const device = createDevice({}, { target_power: 0 });
    device.siteLimitsCache = { data: null, fetchedAt: Date.now() };

    await device.refreshPowerLimits({ IC_InverterMaxPower_w: '4600' });

    expect(device.setCapabilityOptions).toHaveBeenCalledWith('target_power', { min: -4600, max: 4600 });
    expect(device.powerLimits).toEqual({ charge: 4600, discharge: 4600, source: 'inverter' });
  });

  it('does not re-range when the resolved limits are unchanged', async () => {
    const device = createDevice({}, { target_power: 0 });
    device.siteLimitsCache = { data: null, fetchedAt: Date.now() };
    device.powerLimits = { charge: 4600, discharge: 4600, source: 'inverter' };

    await device.refreshPowerLimits({ IC_InverterMaxPower_w: '4600' });

    expect(device.setCapabilityOptions).not.toHaveBeenCalled();
  });
});
