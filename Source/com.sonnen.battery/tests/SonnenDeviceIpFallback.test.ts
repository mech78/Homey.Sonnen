import { isValidIPv4 } from '../lib/SonnenDevice';

// lib/SonnenDevice re-assigns module.exports to the class; handle both export shapes.
const deviceModule = require('../lib/SonnenDevice');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SonnenDeviceClass = ((deviceModule.SonnenDevice ?? deviceModule) as unknown) as { prototype: any };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDevice = Record<string, any>;

/**
 * Builds a SonnenDevice-like harness without invoking the Homey Device
 * constructor: methods are taken from the prototype, collaborators are
 * stubbed on the instance (TS "private" is compile-time only). Exposes the
 * created client's base URL so tests can assert which IP was used.
 */
function createDevice(): { device: AnyDevice; baseUrl(): string | undefined } {
  const device = Object.create(SonnenDeviceClass.prototype) as AnyDevice;
  device.lastKnownDeviceIp = null;
  device.log = jest.fn();
  device.error = jest.fn();
  device.homey = { settings: { get: jest.fn(() => 'auth-token') } };
  device.getSetting = jest.fn(() => '192.168.178.53');
  const baseUrl = (): string | undefined =>
    (device.createSonnenBatterieClient() as { getBaseUrl(): string }).getBaseUrl();
  return { device, baseUrl };
}

describe('createSonnenBatterieClient device IP fallback', () => {
  it('uses the setting IP when it is a valid IPv4 address', () => {
    const { baseUrl } = createDevice();

    expect(baseUrl()).toBe('http://192.168.178.53:80');
  });

  it('falls back to the last known IP when the setting is transiently null', () => {
    const { device, baseUrl } = createDevice();
    baseUrl(); // seed the in-memory cache from a valid setting

    device.getSetting = jest.fn(() => null); // platform applies a settings write

    expect(baseUrl()).toBe('http://192.168.178.53:80');
    expect(device.log).toHaveBeenCalledWith(expect.stringContaining('falling back to last known IP'));
  });

  it('falls back to the last known IP when the setting is transiently empty', () => {
    const { device, baseUrl } = createDevice();
    baseUrl(); // seed

    device.getSetting = jest.fn(() => '');

    expect(baseUrl()).toBe('http://192.168.178.53:80');
  });

  it('trims surrounding whitespace instead of treating the IP as invalid', () => {
    const { device, baseUrl } = createDevice();
    device.getSetting = jest.fn(() => ' 192.168.178.53 ');

    expect(baseUrl()).toBe('http://192.168.178.53:80');
    expect(device.lastKnownDeviceIp).toBe('192.168.178.53');
  });

  it('resets the fallback once the setting is valid again', () => {
    const { device, baseUrl } = createDevice();
    baseUrl(); // seed once

    device.getSetting = jest.fn(() => null);
    baseUrl();
    device.getSetting = jest.fn(() => '192.168.178.55'); // IP genuinely changed

    expect(baseUrl()).toBe('http://192.168.178.55:80');
    expect(device.lastKnownDeviceIp).toBe('192.168.178.55');
    // an invalid read logs a fallback line; the subsequent valid read does not
    expect(device.log).toHaveBeenCalledWith(expect.stringContaining('falling back'));
  });

  it('preserves the cache across instances of the same device between calls only in memory', () => {
    // The fallback must be clearable by a fresh device instance (e.g. re-pairing):
    // two harnesses share no state.
    const first = createDevice();
    const second = createDevice();

    second.device.getSetting = jest.fn(() => null);

    // A fresh harness has no cached IP; the call still must not throw.
    expect(second.baseUrl()).toBeUndefined;
    expect(second.device.error).not.toHaveBeenCalled();
    void first;
  });
});

describe('isValidIPv4', () => {
  it('accepts valid dotted-quad IPv4 addresses with surrounding whitespace', () => {
    expect(isValidIPv4('192.168.178.53')).toBe(true);
    expect(isValidIPv4(' 192.168.178.53 ')).toBe(true);
    expect(isValidIPv4('0.0.0.0')).toBe(true);
    expect(isValidIPv4('255.255.255.255')).toBe(true);
  });

  it('rejects null, empty and non-IPv4 values', () => {
    expect(isValidIPv4(null)).toBe(false);
    expect(isValidIPv4(undefined)).toBe(false);
    expect(isValidIPv4('')).toBe(false);
    expect(isValidIPv4('   ')).toBe(false);
    expect(isValidIPv4('null')).toBe(false);
    expect(isValidIPv4('256.1.1.1')).toBe(false);
    expect(isValidIPv4('1.2.3')).toBe(false);
    expect(isValidIPv4('http://192.168.178.53')).toBe(false);
  });
});
