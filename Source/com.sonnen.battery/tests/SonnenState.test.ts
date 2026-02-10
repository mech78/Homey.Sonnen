import { SonnenState } from '../domain/SonnenState';

describe('SonnenState', () => {
  describe('Construction and Initialization', () => {
    it('should create new SonnenState with empty buffers', () => {
      const state = new SonnenState();

      expect(state.lastUpdate).toBeNull();
      expect(state.total_cycleCount).toBe(0);
      expect(state.cycleCount7DayQueue).not.toBeNull();
      expect(state.cycleCount30DayQueue).not.toBeNull();
      expect(state.cycleCount7DayQueue?.isEmpty()).toBe(true);
      expect(state.cycleCount30DayQueue?.isEmpty()).toBe(true);
    });

    it('should initialize with provided state values', () => {
      const timestamp = new Date('2026-02-09T12:00:00.000Z');
      const initialState = {
        lastUpdate: timestamp,
        total_cycleCount: 430,
        todayMaxConsumption_Wh: 5000
      };

      const state = new SonnenState(initialState);

      expect(state.lastUpdate).toEqual(timestamp);
      expect(state.total_cycleCount).toBe(430);
      expect(state.todayMaxConsumption_Wh).toBe(5000);
    });

    it('should create new buffers if provided state has non-CircularFifoQueue buffers', () => {
      const state = new SonnenState({
        cycleCount7DayQueue: null,
        cycleCount30DayQueue: null
      });

      expect(state.cycleCount7DayQueue).not.toBeNull();
      expect(state.cycleCount30DayQueue).not.toBeNull();
      expect(state.cycleCount7DayQueue?.isEmpty()).toBe(true);
      expect(state.cycleCount30DayQueue?.isEmpty()).toBe(true);
    });

    it('should reuse existing CircularFifoQueue instances', () => {
      const { CircularFifoQueue } = require('../domain/CircularFifoQueue');
      const existingBuffer = new CircularFifoQueue(168);
      existingBuffer.add({ timestamp: new Date(), cycleCount: 100 });

      const state = new SonnenState({
        cycleCount7DayQueue: existingBuffer
      });

      expect(state.cycleCount7DayQueue).toBe(existingBuffer);
      expect(state.cycleCount7DayQueue?.getLength()).toBe(1);
    });
  });

  describe('fromObject Deserialization', () => {
    it('should create state from plain object with Date string', () => {
      const plainObj = {
        lastUpdate: '2026-02-09T12:00:00.000Z',
        total_cycleCount: 430,
        totalConsumption_Wh: 10000
      };

      const state = SonnenState.fromObject(plainObj);

      expect(state.lastUpdate).toEqual(new Date('2026-02-09T12:00:00.000Z'));
      expect(state.total_cycleCount).toBe(430);
      expect(state.totalConsumption_Wh).toBe(10000);
    });

    it('should create empty state from null or undefined', () => {
      const state1 = SonnenState.fromObject(null);
      const state2 = SonnenState.fromObject(undefined);

      expect(state1.cycleCount7DayQueue).not.toBeNull();
      expect(state2.cycleCount30DayQueue).not.toBeNull();
    });

    it('should handle null buffers by creating new ones', () => {
      const state = SonnenState.fromObject({
        cycleCount7DayQueue: null,
        cycleCount30DayQueue: null
      });

      expect(state.cycleCount7DayQueue).not.toBeNull();
      expect(state.cycleCount30DayQueue).not.toBeNull();
      expect(state.cycleCount7DayQueue?.isEmpty()).toBe(true);
    });

    it('should deserialize CircularFifoQueue with CycleCountSnapshot', () => {
      const plainObj = {
        cycleCount7DayQueue: {
          capacity: 3,
          buffer: [
            { timestamp: '2026-02-09T12:00:00.000Z', cycleCount: 428 },
            { timestamp: '2026-02-09T13:00:00.000Z', cycleCount: 429 },
            null
          ],
          head: 0,
          tail: 2,
          count: 2
        }
      };

      const state = SonnenState.fromObject(plainObj);

      expect(state.cycleCount7DayQueue).not.toBeNull();
      expect(state.cycleCount7DayQueue?.getLength()).toBe(2);
      const items = state.cycleCount7DayQueue?.toArray();
      expect(items?.[0].timestamp).toEqual(new Date('2026-02-09T12:00:00.000Z'));
      expect(items?.[0].cycleCount).toBe(428);
    });

    it('should handle invalid date strings in buffer gracefully', () => {
      const plainObj = {
        cycleCount7DayQueue: {
          capacity: 3,
          buffer: [
            { timestamp: 'invalid-date', cycleCount: 428 },
            { timestamp: '2026-02-09T13:00:00.000Z', cycleCount: 429 },
            null
          ],
          head: 0,
          tail: 2,
          count: 2
        }
      };

      const state = SonnenState.fromObject(plainObj);

      expect(state.cycleCount7DayQueue).not.toBeNull();
      expect(state.cycleCount7DayQueue?.getLength()).toBe(1);
    });

    it('should filter out unknown properties', () => {
      const plainObj: any = {
        lastUpdate: '2026-02-09T12:00:00.000Z',
        total_cycleCount: 430,
        unknownProperty: 'should be ignored',
        anotherUnknown: 123
      };

      const state = SonnenState.fromObject(plainObj);

      expect(state.total_cycleCount).toBe(430);
      expect((state as any).unknownProperty).toBeUndefined();
      expect((state as any).anotherUnknown).toBeUndefined();
    });

    it('should not restore lastBatteryDataUpdate (transient property)', () => {
      const plainObj: any = {
        lastBatteryDataUpdate: '2026-02-09T12:00:00.000Z'
      };

      const state = SonnenState.fromObject(plainObj);

      expect(state.lastBatteryDataUpdate).toBeNull();
    });
  });

  describe('addCycleCountSnapshot', () => {
    it('should add snapshot to both buffers', () => {
      const state = new SonnenState();
      const timestamp = new Date('2026-02-09T12:00:00.000Z');

      state.addCycleCountSnapshot(timestamp, 430);

      expect(state.cycleCount7DayQueue?.getLength()).toBe(1);
      expect(state.cycleCount30DayQueue?.getLength()).toBe(1);
      expect(state.cycleCount7DayQueue?.getFirst()).toEqual({ timestamp, cycleCount: 430 });
    });

    it('should add multiple snapshots sequentially', () => {
      const state = new SonnenState();

      for (let i = 0; i < 5; i++) {
        const timestamp = new Date(`2026-02-09T${12 + i}:00:00.000Z`);
        state.addCycleCountSnapshot(timestamp, 428 + i);
      }

      expect(state.cycleCount7DayQueue?.getLength()).toBe(5);
      expect(state.cycleCount30DayQueue?.getLength()).toBe(5);
    });
  });

  describe('calculateAverageCycleCountRate', () => {
    it('should return null for empty buffer', () => {
      const state = new SonnenState();

      expect(state.get7DayAverageCycleCountRate()).toBeNull();
      expect(state.get30DayAverageCycleCountRate()).toBeNull();
    });

    it('should return null for buffer with less than 2 snapshots', () => {
      const state = new SonnenState();
      state.addCycleCountSnapshot(new Date('2026-02-09T12:00:00.000Z'), 430);

      expect(state.get7DayAverageCycleCountRate()).toBeNull();
    });

    it('should calculate correct average rate', () => {
      const state = new SonnenState();
      const startTime = new Date('2026-02-01T00:00:00.000Z');
      const endTime = new Date('2026-02-08T00:00:00.000Z');

      state.addCycleCountSnapshot(startTime, 400);
      state.addCycleCountSnapshot(endTime, 420);

      const rate = state.get7DayAverageCycleCountRate();

      expect(rate).not.toBeNull();
      expect(rate).toBeCloseTo(2.857, 2);
    });

    it('should return null if oldest snapshot has invalid date', () => {
      const state = SonnenState.fromObject({
        cycleCount7DayQueue: {
          capacity: 2,
          buffer: [
            { timestamp: 'invalid-date', cycleCount: 400 },
            { timestamp: '2026-02-08T00:00:00.000Z', cycleCount: 420 }
          ],
          head: 0,
          tail: 0,
          count: 0
        }
      });

      expect(state.get7DayAverageCycleCountRate()).toBeNull();
    });
  });

  describe('resetCycleCountQueues', () => {
    it('should clear both buffers', () => {
      const state = new SonnenState();
      state.addCycleCountSnapshot(new Date('2026-02-09T12:00:00.000Z'), 430);
      state.addCycleCountSnapshot(new Date('2026-02-09T13:00:00.000Z'), 431);

      expect(state.cycleCount7DayQueue?.getLength()).toBe(2);

      state.resetCycleCountQueues();

      expect(state.cycleCount7DayQueue?.isEmpty()).toBe(true);
      expect(state.cycleCount30DayQueue?.isEmpty()).toBe(true);
    });

    it('should create new buffer instances', () => {
      const state = new SonnenState();
      state.addCycleCountSnapshot(new Date('2026-02-09T12:00:00.000Z'), 430);

      const oldBuffer7Day = state.cycleCount7DayQueue;
      const oldBuffer30Day = state.cycleCount30DayQueue;

      state.resetCycleCountQueues();

      expect(state.cycleCount7DayQueue).not.toBe(oldBuffer7Day);
      expect(state.cycleCount30DayQueue).not.toBe(oldBuffer30Day);
    });
  });

  describe('updateState', () => {
    it('should update multiple properties', () => {
      const state = new SonnenState();

      state.updateState({
        total_cycleCount: 500,
        totalConsumption_Wh: 25000,
        todayMaxConsumption_Wh: 3000
      });

      expect(state.total_cycleCount).toBe(500);
      expect(state.totalConsumption_Wh).toBe(25000);
      expect(state.todayMaxConsumption_Wh).toBe(3000);
    });
  });

  describe('Buffer Overflow', () => {
    it('should handle overflow in 7-day buffer correctly', () => {
      const state = new SonnenState();

      for (let i = 0; i < 170; i++) {
        const timestamp = new Date(`2026-02-${(i % 28 + 1).toString().padStart(2, '0')}T00:00:00.000Z`);
        state.addCycleCountSnapshot(timestamp, i);
      }

      expect(state.cycleCount7DayQueue?.getLength()).toBe(168);
      expect(state.cycleCount30DayQueue?.getLength()).toBe(170);
    });
  });
});