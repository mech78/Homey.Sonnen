// device.ts re-assigns module.exports to the class; handle both export shapes.
const deviceModule = require('../drivers/sonnenbatterie/device');
const BatteryDevice = (deviceModule.BatteryDevice ?? deviceModule) as unknown as { prototype: object };

// The harness deliberately treats the device as a loose bag of members:
// methods are taken from the prototype and collaborators are stubbed on it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDevice = Record<string, any>;

/**
 * Builds a BatteryDevice-like harness without invoking the Homey Device
 * constructor: methods are taken from the prototype, collaborators are stubbed
 * on the instance (TS "private" is compile-time only).
 */
function createDevice(): AnyDevice {
  const device = Object.create(BatteryDevice.prototype) as AnyDevice;
  device.missingCapabilitiesWarned = new Set<string>();
  device.lastReportedOperatingMode = null;
  device.log = jest.fn();
  device.error = jest.fn();
  device.hasCapability = jest.fn(() => true);
  device.setCapabilityValue = jest.fn();
  device.setSettings = jest.fn();
  return device;
}

describe('setCapabilityValueSafe', () => {
  it('sets the value when the capability is present', async () => {
    const device = createDevice();

    await device.setCapabilityValueSafe('measure_power', 42);

    expect(device.setCapabilityValue).toHaveBeenCalledWith('measure_power', 42);
    expect(device.error).not.toHaveBeenCalled();
  });

  it('skips a missing capability and warns only once', async () => {
    const device = createDevice();
    device.hasCapability = jest.fn(() => false);

    await device.setCapabilityValueSafe('measure_power', 42);
    await device.setCapabilityValueSafe('measure_power', 43);

    expect(device.setCapabilityValue).not.toHaveBeenCalled();
    expect(device.error).toHaveBeenCalledTimes(1);
    expect(device.error).toHaveBeenCalledWith(expect.stringContaining('measure_power'));
  });

  it('contains rejections from setCapabilityValue instead of propagating them', async () => {
    const device = createDevice();
    device.setCapabilityValue = jest.fn().mockRejectedValue(new Error('device unavailable'));

    await expect(device.setCapabilityValueSafe('measure_power', 42)).resolves.toBeUndefined();

    expect(device.error).toHaveBeenCalledWith(expect.stringContaining('measure_power'), expect.any(Error));
  });
});

describe('setSettingsSafe', () => {
  it('writes the settings when Homey accepts them', async () => {
    const device = createDevice();

    await device.setSettingsSafe({ prognosis_charging: true });

    expect(device.setSettings).toHaveBeenCalledWith({ prognosis_charging: true });
    expect(device.error).not.toHaveBeenCalled();
  });

  it('contains rejections from setSettings instead of propagating them', async () => {
    const device = createDevice();
    device.setSettings = jest.fn().mockRejectedValue(new Error('onSettings still pending'));

    await expect(device.setSettingsSafe({ prognosis_charging: true })).resolves.toBeUndefined();

    expect(device.error).toHaveBeenCalledWith(expect.stringContaining('prognosis_charging'), expect.any(Error));
  });
});

describe('gracefullyAddOrRemoveCapabilities (self-healing)', () => {
  function createSelfHealDevice(energyFullySupported: boolean): AnyDevice {
    const device = createDevice();
    device.driver = {
      manifest: {
        capabilities: [
          'measure_battery',
          'measure_power',
          'meter_power.charged',
          'meter_power.discharged',
          'some_missing_capability',
        ],
      },
    };
    device.isEnergyFullySupported = jest.fn(() => energyFullySupported);
    // Everything already exists except "some_missing_capability"
    device.hasCapability = jest.fn((capability: string) => capability !== 'some_missing_capability');
    device.addCapability = jest.fn();
    device.removeCapability = jest.fn();
    return device;
  }

  it('adds missing manifest capabilities', async () => {
    const device = createSelfHealDevice(true);

    await device.gracefullyAddOrRemoveCapabilities();

    expect(device.addCapability).toHaveBeenCalledWith('some_missing_capability');
    expect(device.addCapability).toHaveBeenCalledTimes(1);
  });

  it('does not re-add conditionally removed energy sub-capabilities', async () => {
    const device = createSelfHealDevice(false);

    await device.gracefullyAddOrRemoveCapabilities();

    expect(device.addCapability).toHaveBeenCalledWith('some_missing_capability');
    expect(device.addCapability).not.toHaveBeenCalledWith('meter_power.charged');
    expect(device.addCapability).not.toHaveBeenCalledWith('meter_power.discharged');
  });

  it('adds energy sub-capabilities when energy is fully supported', async () => {
    const device = createSelfHealDevice(true);
    device.hasCapability = jest.fn(() => false); // nothing exists yet

    await device.gracefullyAddOrRemoveCapabilities();

    expect(device.addCapability).toHaveBeenCalledWith('meter_power.charged');
    expect(device.addCapability).toHaveBeenCalledWith('meter_power.discharged');
    expect(device.addCapability).toHaveBeenCalledWith('some_missing_capability');
  });

  it('never removes capabilities that are part of the manifest', async () => {
    const device = createSelfHealDevice(true);

    await device.gracefullyAddOrRemoveCapabilities();

    // Legacy migration lists may still remove capabilities from very old devices,
    // but nothing that the current manifest declares may ever be removed.
    const manifestCapabilities = device.driver.manifest.capabilities as string[];
    const removed = (device.removeCapability.mock.calls as unknown[][]).map((call) => call[0]);
    for (const capability of removed) {
      expect(manifestCapabilities).not.toContain(capability);
    }
  });
});
