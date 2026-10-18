import { SonnenBatterieClient } from '../service/SonnenBatterieClient';
import { LocalizedError } from '../domain/LocalizedError';

/**
 * Unit tests for the client-side logic of the target power feature.
 * HTTP interactions are covered via a mocked global fetch; the validation
 * tests intentionally run without any fetch being called.
 */
describe('SonnenBatterieClient (target power)', () => {
  const createClient = () => new SonnenBatterieClient('test-token', '192.168.1.50');

  const mockFetch = (status: number, body: unknown) => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('setSetpoint validation', () => {
    it('should reject fractional watts without any network call', async () => {
      const fetchMock = mockFetch(201, { status: 'ok' });

      await expect(createClient().setSetpoint('charge', 100.5)).rejects.toThrow(LocalizedError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should reject negative watts without any network call', async () => {
      const fetchMock = mockFetch(201, { status: 'ok' });

      await expect(createClient().setSetpoint('discharge', -100)).rejects.toThrow(LocalizedError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should accept zero watts (stop) and call the charge endpoint', async () => {
      const fetchMock = mockFetch(201, { status: 'ok' });

      await expect(createClient().setSetpoint('charge', 0)).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledWith(
        'http://192.168.1.50:80/api/v2/setpoint/charge/0',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should map a 403 response to the localized VPP priority error', async () => {
      mockFetch(403, { error: 'forbidden' });

      await expect(createClient().setSetpoint('charge', 1000)).rejects.toThrow(LocalizedError);
      try {
        await createClient().setSetpoint('charge', 1000);
      } catch (error) {
        expect((error as LocalizedError).i18nKey).toBe('error.vpp_priority');
      }
    });
  });

  describe('setStandby', () => {
    it('should POST the enabled flag as JSON to the standby endpoint', async () => {
      const fetchMock = mockFetch(201, { status: 'ok' });

      await expect(createClient().setStandby(true)).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledWith(
        'http://192.168.1.50:80/api/v2/standby',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ enabled: true }),
        })
      );
    });

    it('should map the "not supported" 400 to a localized error', async () => {
      mockFetch(400, { error: 'Standby is not supported' });

      await expect(createClient().setStandby(true)).rejects.toThrow(LocalizedError);
      try {
        await createClient().setStandby(false);
      } catch (error) {
        expect((error as LocalizedError).i18nKey).toBe('error.standby.not_supported');
      }
    });

    it('should propagate VPP priority 403s as localized errors', async () => {
      mockFetch(403, { error: 'forbidden' });

      await expect(createClient().setStandby(true)).rejects.toThrow(LocalizedError);
    });
  });

  describe('stopPowerControl', () => {
    it('should disable standby (standby endpoint with enabled=false)', async () => {
      const fetchMock = mockFetch(201, { status: 'ok' });

      await expect(createClient().stopPowerControl()).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledWith(
        'http://192.168.1.50:80/api/v2/standby',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ enabled: false }),
        })
      );
    });
  });
});
