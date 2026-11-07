// device.ts re-assigns module.exports to the class; handle both export shapes.
const deviceModule = require('../drivers/sonnenbatterie/device');
const BatteryDevice = (deviceModule.BatteryDevice ?? deviceModule) as unknown as {
  prototype: object;
  readControlRequest: (values: Record<string, unknown>) => unknown;
};

// The harness deliberately treats the device as a loose bag of members:
// methods are taken from the prototype and collaborators are stubbed on it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDevice = Record<string, any>;

const TARGET_POWER_TWINS = ['target_power_visible_capability', 'target_power_mode_visible_capability'];

/**
 * Builds a BatteryDevice-like harness without invoking the Homey Device
 * constructor: methods are taken from the prototype, collaborators are
 * stubbed on the instance (TS "private" is compile-time only).
 */
function createDevice(): AnyDevice {
  const device = Object.create(BatteryDevice.prototype) as AnyDevice;
  device.missingCapabilitiesWarned = new Set<string>();
  device.log = jest.fn();
  device.error = jest.fn();
  device.hasCapability = jest.fn(() => true);
  device.getCapabilityValue = jest.fn(() => null);
  device.setCapabilityValue = jest.fn();
  device.addCapability = jest.fn();
  device.removeCapability = jest.fn();
  device.registerMultipleCapabilityListener = jest.fn();
  device.targetPowerVisibleControlsRegistered = false;
  return device;
}

describe('readControlRequest', () => {
  it('prefers a write on the visible twin over the hidden built-in', () => {
    const request = BatteryDevice.readControlRequest({
      target_power_visible_capability: 1500,
      target_power: 0,
    }) as { targetPower: number | null; targetPowerMode: string | null };

    expect(request.targetPower).toBe(1500);
  });

  it('falls back to the hidden built-in when the twin is absent', () => {
    const request = BatteryDevice.readControlRequest({
      target_power: -2000,
      target_power_mode: 'homey',
    }) as { targetPower: number | null; targetPowerMode: string | null };

    expect(request.targetPower).toBe(-2000);
    expect(request.targetPowerMode).toBe('homey');
  });

  it('keeps a legitimate zero written on the twin', () => {
    const request = BatteryDevice.readControlRequest({
      target_power_visible_capability: 0,
    }) as { targetPower: number | null; targetPowerMode: string | null };

    expect(request.targetPower).toBe(0);
  });

  it('reports null when neither surface changed', () => {
    const request = BatteryDevice.readControlRequest({}) as { targetPower: number | null; targetPowerMode: string | null };

    expect(request.targetPower).toBeNull();
    expect(request.targetPowerMode).toBeNull();
  });
});

describe('syncTargetPowerVisibleCapabilities', () => {
  it('adds and seeds both twins when the setting is enabled', async () => {
    const device = createDevice();
    const added = new Set<string>();
    device.addCapability = jest.fn((capability: string) => { added.add(capability); });
    device.hasCapability = jest.fn((capability: string) => {
      return TARGET_POWER_TWINS.includes(capability) ? added.has(capability) : true;
    });
    device.getCapabilityValue = jest.fn((capability: string) => {
      if (capability === 'target_power') {
        return 1200;
      }
      if (capability === 'target_power_mode') {
        return 'homey';
      }
      return null;
    });
    device.targetPowerModeState = 'homey';

    await device.syncTargetPowerVisibleCapabilities(true);

    expect(device.addCapability).toHaveBeenCalledWith('target_power_visible_capability');
    expect(device.addCapability).toHaveBeenCalledWith('target_power_mode_visible_capability');
    expect(device.removeCapability).not.toHaveBeenCalled();
    // Seeded from the hidden built-in capabilities
    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_power_visible_capability', 1200);
    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_power_mode_visible_capability', 'homey');
    // The listener for the twins is registered exactly once
    expect(device.registerMultipleCapabilityListener).toHaveBeenCalledTimes(1);
  });

  it('seeds defaults when the built-in capabilities have no value yet', async () => {
    const device = createDevice();
    const added = new Set<string>();
    device.addCapability = jest.fn((capability: string) => { added.add(capability); });
    device.hasCapability = jest.fn((capability: string) => added.has(capability));
    device.getCapabilityValue = jest.fn(() => null);
    device.targetPowerModeState = null;

    await device.syncTargetPowerVisibleCapabilities(true);

    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_power_visible_capability', 0);
    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_power_mode_visible_capability', 'self_consumption');
  });

  it('removes both twins when the setting is disabled', async () => {
    const device = createDevice();
    device.hasCapability = jest.fn((capability: string) => TARGET_POWER_TWINS.includes(capability));

    await device.syncTargetPowerVisibleCapabilities(false);

    expect(device.removeCapability).toHaveBeenCalledWith('target_power_visible_capability');
    expect(device.removeCapability).toHaveBeenCalledWith('target_power_mode_visible_capability');
    expect(device.addCapability).not.toHaveBeenCalled();
    expect(device.setCapabilityValue).not.toHaveBeenCalled();
  });

  it('is a no-op when the device is already in the desired state', async () => {
    const device = createDevice();
    // Twins absent, setting disabled: nothing may happen
    device.hasCapability = jest.fn(() => false);

    await device.syncTargetPowerVisibleCapabilities(false);

    expect(device.addCapability).not.toHaveBeenCalled();
    expect(device.removeCapability).not.toHaveBeenCalled();

    // Twins present, setting enabled: nothing may happen
    device.hasCapability = jest.fn(() => true);
    device.registerMultipleCapabilityListener = jest.fn();
    device.targetPowerVisibleControlsRegistered = true;

    await device.syncTargetPowerVisibleCapabilities(true);

    expect(device.addCapability).not.toHaveBeenCalled();
    expect(device.removeCapability).not.toHaveBeenCalled();
    expect(device.registerMultipleCapabilityListener).not.toHaveBeenCalled();
  });

  it('does not register a second listener when toggled repeatedly', async () => {
    const device = createDevice();

    await device.syncTargetPowerVisibleCapabilities(true);
    await device.syncTargetPowerVisibleCapabilities(false);
    await device.syncTargetPowerVisibleCapabilities(true);

    expect(device.registerMultipleCapabilityListener).toHaveBeenCalledTimes(1);
  });
});

describe('setTargetPowerTwinValueIfPresent', () => {
  it('writes the value when the twin exists', async () => {
    const device = createDevice();
    device.hasCapability = jest.fn(() => true);

    await device.setTargetPowerTwinValueIfPresent('target_power_visible_capability', 500);

    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_power_visible_capability', 500);
  });

  it('stays silent when the twin is absent (opt-out users)', async () => {
    const device = createDevice();
    device.hasCapability = jest.fn(() => false);

    await device.setTargetPowerTwinValueIfPresent('target_power_visible_capability', 500);

    expect(device.setCapabilityValue).not.toHaveBeenCalled();
    expect(device.error).not.toHaveBeenCalled();
  });
});

describe('syncTargetPowerControls (platform-adaptive EMS toggle)', () => {
  function createPlatformDevice(energyFullySupported: boolean): AnyDevice {
    const device = createDevice();
    device.isEnergyFullySupported = jest.fn(() => energyFullySupported);
    device.getSetting = jest.fn(() => undefined);
    device.getCapabilityValue = jest.fn(() => null);
    device.targetPowerModeState = null;
    device.targetPowerControlsRegistered = false;
    device.powerLimits = { charge: 46000, discharge: 46000, source: 'default' };
    return device;
  }

  it('on Homey Pro 2019 with the toggle off, removes the built-ins and never registers listeners', async () => {
    const device = createPlatformDevice(false);
    device.hasCapability = jest.fn(() => true);

    await device.syncTargetPowerControls(false);

    expect(device.removeCapability).toHaveBeenCalledWith('target_power');
    expect(device.removeCapability).toHaveBeenCalledWith('target_power_mode');
    expect(device.addCapability).not.toHaveBeenCalled();
    expect(device.registerMultipleCapabilityListener).not.toHaveBeenCalled();
  });

  it('on Homey Pro 2019 with the toggle on, adds the built-ins but never the twins', async () => {
    const device = createPlatformDevice(false);
    const added = new Set<string>();
    device.addCapability = jest.fn((capability: string) => { added.add(capability); });
    device.hasCapability = jest.fn((capability: string) => added.has(capability));

    await device.syncTargetPowerControls(true);

    expect(device.addCapability).toHaveBeenCalledWith('target_power');
    expect(device.addCapability).toHaveBeenCalledWith('target_power_mode');
    expect(device.removeCapability).not.toHaveBeenCalled();
    expect(device.addCapability).not.toHaveBeenCalledWith('target_power_visible_capability');
    expect(device.addCapability).not.toHaveBeenCalledWith('target_power_mode_visible_capability');
    expect(device.registerMultipleCapabilityListener).toHaveBeenCalledWith(
      ['target_power', 'target_power_mode'], expect.any(Function), 500);
  });

  it('on Homey Pro 2023+, keeps the built-ins and adds the twins when toggled on', async () => {
    const device = createPlatformDevice(true);
    const added = new Set<string>();
    device.addCapability = jest.fn((capability: string) => { added.add(capability); });
    device.hasCapability = jest.fn((capability: string) => added.has(capability));

    await device.syncTargetPowerControls(true);

    expect(device.addCapability).toHaveBeenCalledWith('target_power');
    expect(device.addCapability).toHaveBeenCalledWith('target_power_mode');
    expect(device.addCapability).toHaveBeenCalledWith('target_power_visible_capability');
    expect(device.addCapability).toHaveBeenCalledWith('target_power_mode_visible_capability');
    expect(device.removeCapability).not.toHaveBeenCalled();
  });

  it('on Homey Pro 2023+ with the toggle off, removes the twins but never the built-ins', async () => {
    const device = createPlatformDevice(true);
    device.hasCapability = jest.fn(() => true);

    await device.syncTargetPowerControls(false);

    expect(device.removeCapability).toHaveBeenCalledWith('target_power_visible_capability');
    expect(device.removeCapability).toHaveBeenCalledWith('target_power_mode_visible_capability');
    expect(device.removeCapability).not.toHaveBeenCalledWith('target_power');
    expect(device.removeCapability).not.toHaveBeenCalledWith('target_power_mode');
  });

  it('registers the built-in listener only once across repeated toggles', async () => {
    const device = createPlatformDevice(false);
    const added = new Set<string>();
    device.addCapability = jest.fn((capability: string) => { added.add(capability); });
    device.hasCapability = jest.fn((capability: string) => added.has(capability));

    await device.syncTargetPowerControls(true);
    await device.syncTargetPowerControls(false);
    await device.syncTargetPowerControls(true);

    const builtInRegistrations = (device.registerMultipleCapabilityListener.mock.calls as unknown[][])
      .filter((call) => (call[0] as string[])[0] === 'target_power');
    expect(builtInRegistrations).toHaveLength(1);
  });
});

describe('updateHemsSupportNote (platform-specific settings note)', () => {
  function createNoteDevice(energyFullySupported: boolean, currentNote: string): AnyDevice {
    const device = createDevice();
    device.isEnergyFullySupported = jest.fn(() => energyFullySupported);
    device.homey = { __: jest.fn((key: string) => 'note-for:' + key) };
    device.getSetting = jest.fn(() => currentNote);
    device.setSettings = jest.fn();
    return device;
  }

  it('renders the visibility note on Homey Pro 2023+', async () => {
    const device = createNoteDevice(true, 'old note');

    await device.updateHemsSupportNote();

    expect(device.homey.__).toHaveBeenCalledWith('settings.hemsSupportNoteVisibility');
    expect(device.setSettings).toHaveBeenCalledWith({ hems_support_note: 'note-for:settings.hemsSupportNoteVisibility' });
  });

  it('renders the presence note on Homey Pro 2019', async () => {
    const device = createNoteDevice(false, 'old note');

    await device.updateHemsSupportNote();

    expect(device.homey.__).toHaveBeenCalledWith('settings.hemsSupportNotePresence');
    expect(device.setSettings).toHaveBeenCalledWith({ hems_support_note: 'note-for:settings.hemsSupportNotePresence' });
  });

  it('skips the settings write when the note is unchanged', async () => {
    const device = createNoteDevice(true, 'note-for:settings.hemsSupportNoteVisibility');

    await device.updateHemsSupportNote();

    expect(device.setSettings).not.toHaveBeenCalled();
  });
});

describe('handleTargetPowerChange (twin surfaces)', () => {
  /**
   * A device harness with the real domain planning (TargetPowerMode) wired in;
   * only the battery round-trip (applyControlActions) is stubbed.
   */
  function createControlDevice(
    currentMode: string | null,
    currentPower: number | null,
    standbyActive = false
  ): AnyDevice {
    const device = createDevice();
    device.targetPowerModeState = currentMode;
    device.manualStandbyActive = standbyActive;
    device.isApplyingTargetPowerChange = false;
    device.powerLimits = { charge: 46000, discharge: 46000, source: 'default' };
    device.getCapabilityValue = jest.fn((capability: string) =>
      capability === 'target_power' ? currentPower : null);
    device.applyControlActions = jest.fn();
    return device;
  }

  it('mirrors an accepted twin power write onto the hidden built-in capability', async () => {
    const device = createControlDevice('self_consumption', 0);

    await device.handleTargetPowerChange({ target_power_visible_capability: 1000 });

    // Control actions: hand control to Homey (mode switch to manual) + setpoint
    expect(device.applyControlActions).toHaveBeenCalledWith(expect.objectContaining({
      operatingMode: '1',
      setpoint: { direction: 'charge', watts: 1000 },
    }));
    // The hidden built-in is the canonical state for flows and EMS apps
    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_power', 1000);
    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_power_mode', 'homey');
    expect(device.targetPowerModeState).toBe('homey');
  });

  it('mirrors a mode change received via the twin onto the hidden built-in', async () => {
    const device = createControlDevice('homey', 1000);

    await device.handleTargetPowerChange({ target_power_mode_visible_capability: 'self_consumption' });

    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_power_mode', 'self_consumption');
    // Leaving Homey control resets the stored power on both surfaces
    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_power', 0);
    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_power_visible_capability', 0);
    expect(device.targetPowerModeState).toBe('self_consumption');
  });

  it('keeps clamp write-backs mirrored onto the twin', async () => {
    const device = createControlDevice('self_consumption', 0);
    device.powerLimits = { charge: 2000, discharge: 2000, source: 'inverter' };

    await device.handleTargetPowerChange({ target_power: 5000 });

    // The battery silently accepts oversized setpoints; the clamped value is
    // written back to the hidden built-in and mirrored onto the twin
    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_power', 2000);
    expect(device.setCapabilityValue).toHaveBeenCalledWith('target_power_visible_capability', 2000);
  });
});
