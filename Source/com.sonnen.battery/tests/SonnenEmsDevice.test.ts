// device.ts re-assigns module.exports to the class; handle both export shapes.
const deviceModule = require('../drivers/sonnenbatterie_ems/device');
const EmsControlDevice = (deviceModule.SonnenEmsControlDevice ?? deviceModule) as unknown as {
  prototype: object;
};

// The harness deliberately treats the device as a loose bag of members:
// methods are taken from the prototype and collaborators are stubbed on it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDevice = Record<string, any>;

/**
 * Builds an EmsControlDevice-like harness without invoking the Homey Device
 * constructor: methods are taken from the prototype, collaborators are
 * stubbed on the instance (TS "private" is compile-time only).
 */
function createDevice(capabilities: Record<string, unknown> = {}): AnyDevice {
  const device = Object.create(EmsControlDevice.prototype) as AnyDevice;
  device.log = jest.fn();
  device.error = jest.fn();
  device.getCapabilityValue = jest.fn((capability: string) => capabilities[capability] ?? null);
  device.setCapabilityValue = jest.fn(async (capability: string, value: unknown) => {
    capabilities[capability] = value;
  });
  device.setCapabilityOptions = jest.fn();
  device.registerMultipleCapabilityListener = jest.fn();
  device.homey = {
    on: jest.fn(),
    removeListener: jest.fn(),
  };
  device.createSonnenBatterieClient = jest.fn(() => device.client);
  device.client = {
    setOperatingMode: jest.fn(async () => undefined),
    setSetpoint: jest.fn(async () => undefined),
    getSiteLimits: jest.fn(async () => ({})),
    getConfigurations: jest.fn(async () => ({ IC_InverterMaxPower_w: '4600' })),
  };
  device.siteLimitsCache = null;
  device.siteLimitsCacheTtlMillis = 60 * 60 * 1000;
  device.controlQueueWorker = Promise.resolve();
  device.targetPowerModeState = null;
  device.powerLimits = { charge: 46000, discharge: 46000, source: 'default' };
  return device;
  // Class-field instance members (bound handlers) must be copied onto the
  // instance manually: the prototype-only harness does not run field initializers.
  device.controlQueueWorker = Promise.resolve();
  device.targetPowerModeState = null;
}

async function applyChange(device: AnyDevice, values: Record<string, unknown>): Promise<void> {
  device.handleTargetPowerChange(values);
  await device.controlQueueWorker;
}

describe('SonnenEmsControlDevice target power handling', () => {
  it('applies a power write in homey mode: Manual carrier mode plus setpoint', async () => {
    const device = createDevice({ target_power_mode: 'homey', target_power: 0 });
    device.targetPowerModeState = 'homey';

    await applyChange(device, { target_power: 2000 });

    expect(device.client.setOperatingMode).not.toHaveBeenCalled(); // mode unchanged (stays 1)
    expect(device.client.setSetpoint).toHaveBeenCalledWith('charge', 2000);
    expect(device.setCapabilityValue).not.toHaveBeenCalled(); // platform stored the value already
  });

  it('plans a mode-only entry into homey from idle', async () => {
    const device = createDevice({ target_power_mode: 'self_consumption', target_power: 0 });
    device.targetPowerModeState = 'self_consumption';

    await applyChange(device, { target_power_mode: 'homey' });

    expect(device.client.setOperatingMode).toHaveBeenCalledWith('1'); // Manual carries the setpoint
    expect(device.client.setSetpoint).toHaveBeenCalledWith('charge', 0); // idle start
    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_power_mode', 'homey');
    expect(device.targetPowerModeState).toBe('homey');
  });

  it('writes the implied homey mode back when the slider is dragged', async () => {
    const device = createDevice({ target_power_mode: 'self_consumption', target_power: 0 });
    device.targetPowerModeState = 'self_consumption';

    await applyChange(device, { target_power: 2000 });

    // Homey Energy semantics: writing target_power hands control to Homey.
    expect(device.client.setOperatingMode).toHaveBeenCalledWith('1'); // Manual carries the setpoint
    expect(device.client.setSetpoint).toHaveBeenCalledWith('charge', 2000);
    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_power_mode', 'homey');
    expect(device.targetPowerModeState).toBe('homey');
  });

  it('does not write the mode capability back when the mode is unchanged', async () => {
    const device = createDevice({ target_power_mode: 'homey', target_power: 0 });
    device.targetPowerModeState = 'homey';
    // The plan resolved a request...

    device.handleTargetPowerChange({ target_power: 2000 });
    await device.controlQueueWorker;

    expect(device.setCapabilityValue).not.toHaveBeenCalled();
  });

  it('resets the stored power when leaving Homey control to a device mode', async () => {
    const device = createDevice({ target_power_mode: 'homey', target_power: 4200 });
    device.targetPowerModeState = 'homey';

    await applyChange(device, { target_power_mode: 'self_consumption' });

    expect(device.client.setOperatingMode).toHaveBeenCalledWith('2'); // Self consumption
    expect(device.client.setSetpoint).not.toHaveBeenCalled();
    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_power', 0);
    expect(device.targetPowerModeState).toBe('self_consumption');
  });

  it('syncs the mode from the update bus when the battery switched externally', async () => {
    const device = createDevice({ target_power_mode: 'homey', target_power: 0 });
    device.targetPowerModeState = 'homey';

    await device.handleControlUpdateEvent('6'); // Module extension

    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_power_mode', 'module_extension');
    expect(device.targetPowerModeState).toBe('module_extension');
  });

  it('keeps an established homey/manual state sticky on a battery mode 1 read', async () => {
    const device = createDevice({ target_power_mode: 'manual', target_power: 0 });
    device.targetPowerModeState = 'manual';

    await device.handleControlUpdateEvent('1'); // Manual (ambiguity: homey or manual)

    expect(device.setCapabilityValue).not.toHaveBeenCalled();
    expect(device.targetPowerModeState).toBe('manual');
  });

  it('re-ranges the target_power slider to the resolved site limits', async () => {
    const device = createDevice();
    device.client.getSiteLimits = jest.fn(async () => ({
      p_bess_inv_max_import_limit: 5000,
      p_bess_inv_max_export_limit: 4000,
    }));

    await device.refreshPowerLimits();

    expect(device.setCapabilityOptions).toHaveBeenCalledWith('target_power', { min: -4000, max: 5000 });
    expect(device.powerLimits).toEqual({ charge: 5000, discharge: 4000, source: 'site' });
  });

  it('falls back to the inverter power limit when site limits are unavailable', async () => {
    const device = createDevice();
    device.siteLimitsCache = { data: null, fetchedAt: Date.now() }; // older system: endpoint unsupported / empty

    await device.refreshPowerLimits();

    expect(device.setCapabilityOptions).toHaveBeenCalledWith('target_power', { min: -4600, max: 4600 });
    expect(device.powerLimits).toEqual({ charge: 4600, discharge: 4600, source: 'inverter' });
  });

  it('re-ranges the slider when the bus delivers changed power limits', async () => {
    const device = createDevice();
    device.powerLimits = { charge: 4600, discharge: 4600, source: 'default' };

    await device.handleLimitsUpdateEvent({ charge: 5000, discharge: 4000, source: 'site' });

    expect(device.setCapabilityOptions).toHaveBeenCalledWith('target_power', { min: -4000, max: 5000 });
    expect(device.powerLimits).toEqual({ charge: 5000, discharge: 4000, source: 'site' });
  });

  it('ignores an unchanged limits event from the bus', async () => {
    const device = createDevice();
    device.powerLimits = { charge: 4600, discharge: 4600, source: 'default' };

    await device.handleLimitsUpdateEvent({ charge: 4600, discharge: 4600, source: 'inverter' });

    expect(device.setCapabilityOptions).not.toHaveBeenCalled();
  });
});
