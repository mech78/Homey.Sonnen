import { SonnenState } from '../domain/SonnenState';

describe('SonnenState RingBuffer Serialization/Deserialization', () => {
  describe('7-day buffer tests', () => {
    it('should correctly deserialize wrapped buffer with realistic data', () => {
      const serializedState = {
        lastUpdate: "2026-02-08T23:59:59.000Z",
        total_cycleCount: 430,
        cycleCount7DayBuffer: {
          buffer: [
            { timestamp: "2026-02-05T04:29:38.000Z", cycleCount: 429 },
            { timestamp: "2026-02-05T05:29:44.000Z", cycleCount: 429 },
            { timestamp: "2026-02-06T04:32:01.000Z", cycleCount: 429 },
            { timestamp: "2026-02-07T04:34:23.000Z", cycleCount: 430 },
            { timestamp: "2026-02-08T04:36:45.000Z", cycleCount: 430 },
            { timestamp: "2026-01-31T09:53:53.000Z", cycleCount: 427 },
            { timestamp: "2026-02-01T04:55:53.000Z", cycleCount: 428 },
            { timestamp: "2026-02-02T04:58:25.000Z", cycleCount: 428 },
            { timestamp: "2026-02-03T05:01:03.000Z", cycleCount: 428 },
            { timestamp: "2026-02-04T04:03:31.000Z", cycleCount: 429 }
          ],
          pos: 5,
          size: 168
        }
      };

      const state = SonnenState.fromObject(serializedState);
      const buffer = state.cycleCount7DayBuffer;

      expect(buffer).not.toBeNull();
      if (buffer) {
        const allSnapshots = buffer.toArray();

        expect(allSnapshots.length).toBe(10);

        for (let i = 1; i < allSnapshots.length; i++) {
          expect(allSnapshots[i].timestamp.getTime()).toBeGreaterThanOrEqual(
            allSnapshots[i - 1].timestamp.getTime()
          );
        }

        expect(allSnapshots[0].timestamp.toISOString()).toBe("2026-01-31T09:53:53.000Z");
        expect(allSnapshots[4].timestamp.toISOString()).toBe("2026-02-04T04:03:31.000Z");
        expect(allSnapshots[5].timestamp.toISOString()).toBe("2026-02-05T04:29:38.000Z");
        expect(allSnapshots[9].timestamp.toISOString()).toBe("2026-02-08T04:36:45.000Z");
      }
    });

    it('should correctly deserialize buffer with pos reset to 0 after app restart', () => {
      const serializedState = {
        lastUpdate: "2026-02-09T12:28:27.000Z",
        total_cycleCount: 430,
        cycleCount7DayBuffer: {
          buffer: [
            { timestamp: "2026-02-09T12:18:56.000Z", cycleCount: 430 },
            { timestamp: "2026-02-05T05:29:44.000Z", cycleCount: 429 },
            { timestamp: "2026-02-05T06:29:50.000Z", cycleCount: 429 },
            { timestamp: "2026-02-06T04:32:01.000Z", cycleCount: 429 }
          ],
          pos: 1,
          size: 168
        }
      };

      const state = SonnenState.fromObject(serializedState);
      const buffer = state.cycleCount7DayBuffer;

      expect(buffer).not.toBeNull();
      if (buffer) {
        const allSnapshots = buffer.toArray();

        expect(allSnapshots.length).toBe(4);

        for (let i = 1; i < allSnapshots.length; i++) {
          expect(allSnapshots[i].timestamp.getTime()).toBeGreaterThanOrEqual(
            allSnapshots[i - 1].timestamp.getTime()
          );
        }

        expect(allSnapshots[0].timestamp.toISOString()).toBe("2026-02-05T05:29:44.000Z");
        expect(allSnapshots[3].timestamp.toISOString()).toBe("2026-02-09T12:18:56.000Z");
      }
    });

    it('should correctly deserialize buffer with pos = 0 (no wrap)', () => {
      const serializedState = {
        lastUpdate: "2026-02-09T12:28:27.000Z",
        total_cycleCount: 430,
        cycleCount7DayBuffer: {
          buffer: [
            { timestamp: "2026-02-07T12:35:10.000Z", cycleCount: 430 },
            { timestamp: "2026-02-08T12:37:33.000Z", cycleCount: 430 },
            { timestamp: "2026-02-09T12:18:56.000Z", cycleCount: 430 }
          ],
          pos: 0,
          size: 168
        }
      };

      const state = SonnenState.fromObject(serializedState);
      const buffer = state.cycleCount7DayBuffer;

      expect(buffer).not.toBeNull();
      if (buffer) {
        const allSnapshots = buffer.toArray();

        expect(allSnapshots.length).toBe(3);

        for (let i = 1; i < allSnapshots.length; i++) {
          expect(allSnapshots[i].timestamp.getTime()).toBeGreaterThanOrEqual(
            allSnapshots[i - 1].timestamp.getTime()
          );
        }

        expect(allSnapshots[0].timestamp.toISOString()).toBe("2026-02-07T12:35:10.000Z");
        expect(allSnapshots[2].timestamp.toISOString()).toBe("2026-02-09T12:18:56.000Z");
      }
    });
  });

  describe('30-day buffer tests', () => {
    it('should correctly deserialize wrapped 30-day buffer', () => {
      const serializedState = {
        total_cycleCount: 430,
        cycleCount30DayBuffer: {
          buffer: [
            { timestamp: "2026-02-09T04:36:00.000Z", cycleCount: 431 },
            { timestamp: "2026-02-10T04:36:00.000Z", cycleCount: 432 },
            { timestamp: "2026-02-11T04:36:00.000Z", cycleCount: 433 },
            { timestamp: "2026-01-31T04:36:00.000Z", cycleCount: 427 },
            { timestamp: "2026-02-01T04:36:00.000Z", cycleCount: 428 },
            { timestamp: "2026-02-02T04:36:00.000Z", cycleCount: 428 },
            { timestamp: "2026-02-03T04:36:00.000Z", cycleCount: 428 }
          ],
          pos: 3,
          size: 720
        }
      };

      const state = SonnenState.fromObject(serializedState);
      const buffer = state.cycleCount30DayBuffer;

      expect(buffer).not.toBeNull();
      if (buffer) {
        const allSnapshots = buffer.toArray();

        expect(allSnapshots.length).toBe(7);

        for (let i = 1; i < allSnapshots.length; i++) {
          expect(allSnapshots[i].timestamp.getTime()).toBeGreaterThanOrEqual(
            allSnapshots[i - 1].timestamp.getTime()
          );
        }

        expect(allSnapshots[0].timestamp.toISOString()).toBe("2026-01-31T04:36:00.000Z");
        expect(allSnapshots[2].timestamp.toISOString()).toBe("2026-02-02T04:36:00.000Z");
        expect(allSnapshots[3].timestamp.toISOString()).toBe("2026-02-03T04:36:00.000Z");
        expect(allSnapshots[6].timestamp.toISOString()).toBe("2026-02-11T04:36:00.000Z");
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle null or invalid buffer data', () => {
      const state1 = SonnenState.fromObject({ cycleCount7DayBuffer: null });
      expect(state1.cycleCount7DayBuffer).not.toBeNull();

      const state2 = SonnenState.fromObject({ cycleCount7DayBuffer: {} });
      expect(state2.cycleCount7DayBuffer).not.toBeNull();

      const state3 = SonnenState.fromObject({ cycleCount7DayBuffer: { buffer: [], pos: 0, size: 168 } });
      expect(state3.cycleCount7DayBuffer).not.toBeNull();
      if (state3.cycleCount7DayBuffer) {
        expect(state3.cycleCount7DayBuffer.getBufferLength()).toBe(0);
      }
    });

    it('should handle invalid timestamps gracefully', () => {
      const serializedState = {
        cycleCount7DayBuffer: {
          buffer: [
            { timestamp: "2026-02-09T12:18:56.000Z", cycleCount: 430 },
            { timestamp: "invalid-date", cycleCount: 429 }
          ],
          pos: 0,
          size: 168
        }
      };

      const state = SonnenState.fromObject(serializedState);
      const buffer = state.cycleCount7DayBuffer;

      expect(buffer).not.toBeNull();
      if (buffer) {
        expect(buffer.getBufferLength()).toBe(1);
        const snapshot = buffer.getFirst();
        expect(snapshot?.timestamp.toISOString()).toBe("2026-02-09T12:18:56.000Z");
      }
    });

    it('should preserve chronological order after adding snapshots', () => {
      const originalDate = new Date("2026-02-01T00:00:00.000Z");

      const initialState = new SonnenState();
      for (let i = 0; i < 10; i++) {
        const date = new Date(originalDate.getTime() + i * 3600000);
        initialState.addCycleCountSnapshot(date, 400 + i);
      }

      const allSnapshots = initialState.cycleCount7DayBuffer?.toArray();
      expect(allSnapshots).toBeDefined();
      expect(allSnapshots?.length).toBe(10);

      for (let i = 1; i < (allSnapshots?.length || 0); i++) {
        expect(allSnapshots![i].timestamp.getTime()).toBeGreaterThanOrEqual(
          allSnapshots![i - 1].timestamp.getTime()
        );
      }
    });
  });
});