import { SonnenBatterieClient } from '../service/SonnenBatterieClient';
import { LocalizedError } from '../domain/LocalizedError';

const client = new SonnenBatterieClient('test-token', '192.168.1.50');

describe('setBackupBuffer', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockReset();
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  function respondWith(status: number, body: Record<string, unknown> = {}): void {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }));
  }

  it('PUTs the value as the string-encoded EM_USOC key', async () => {
    respondWith(200, { EM_USOC: '10' });

    await client.setBackupBuffer(10);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://192.168.1.50:80/api/v2/configurations');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ EM_USOC: '10' });
    const headers = new Headers(init.headers);
    expect(headers.get('Auth-Token')).toBe('test-token');
  });

  it('encodes the disabled state as "0"', async () => {
    respondWith(200, { EM_USOC: '0' });

    await client.setBackupBuffer(0);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ EM_USOC: '0' });
  });

  it('rejects values the battery would reject without a network round-trip', async () => {
    for (const invalid of [1, 2, 3, 4, -5, 101, 12.5]) {
      await expect(client.setBackupBuffer(invalid)).rejects.toMatchObject({
        i18nKey: 'error.validation.backupBuffer',
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns battery rejections into a LocalizedError', async () => {
    respondWith(400, { error: 'Invalid value for EM_USOC' });

    // The client validates 1-4 itself, but the battery could still reject
    // other values; whatever the reason, the caller must receive a
    // LocalizedError, not a raw fetch error.
    await expect(client.setBackupBuffer(50)).rejects.toBeInstanceOf(LocalizedError);
  });

  it('turns network failures into a LocalizedError', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(client.setBackupBuffer(10)).rejects.toMatchObject({
      i18nKey: 'error.unknown',
    });
  });
});
