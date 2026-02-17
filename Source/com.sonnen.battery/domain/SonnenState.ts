import { CircularFifoQueue } from './CircularFifoQueue';

export interface CycleCountSnapshot {
  timestamp: Date;
  cycleCount: number;
}

export class SonnenState {
  lastUpdate: Date | null;
  lastBatteryDataUpdate: Date | null;
  totalDailyToBattery_Wh: number;
  totalDailyFromBattery_Wh: number;
  totalDailyProduction_Wh: number;
  totalDailyConsumption_Wh: number;
  totalDailyGridFeedIn_Wh: number;
  totalDailyGridConsumption_Wh: number;
  totalToBattery_Wh: number;
  totalFromBattery_Wh: number;
  totalProduction_Wh: number;
  totalConsumption_Wh: number;
  totalGridFeedIn_Wh: number;
  totalGridConsumption_Wh: number;
  todayMaxConsumption_Wh: number;
  todayMinConsumption_Wh: number;
  todayMaxGridFeedIn_Wh: number;
  todayMaxGridConsumption_Wh: number;
  todayMaxProduction_Wh: number;
  total_cycleCount: number;
  cycleCount7DayQueue: CircularFifoQueue<CycleCountSnapshot> | null;
  cycleCount30DayQueue: CircularFifoQueue<CycleCountSnapshot> | null;

  constructor(initialState?: Partial<SonnenState>) {
    this.lastUpdate = initialState?.lastUpdate || null;
    this.lastBatteryDataUpdate = initialState?.lastBatteryDataUpdate || null;
    this.totalDailyToBattery_Wh = initialState?.totalDailyToBattery_Wh || 0;
    this.totalDailyFromBattery_Wh = initialState?.totalDailyFromBattery_Wh || 0;
    this.totalDailyProduction_Wh = initialState?.totalDailyProduction_Wh || 0;
    this.totalDailyConsumption_Wh = initialState?.totalDailyConsumption_Wh || 0;
    this.totalDailyGridFeedIn_Wh = initialState?.totalDailyGridFeedIn_Wh || 0;
    this.totalDailyGridConsumption_Wh = initialState?.totalDailyGridConsumption_Wh || 0;
    this.totalToBattery_Wh = initialState?.totalToBattery_Wh || 0;
    this.totalFromBattery_Wh = initialState?.totalFromBattery_Wh || 0;
    this.totalProduction_Wh = initialState?.totalProduction_Wh || 0;
    this.totalConsumption_Wh = initialState?.totalConsumption_Wh || 0;
    this.totalGridFeedIn_Wh = initialState?.totalGridFeedIn_Wh || 0;
    this.totalGridConsumption_Wh = initialState?.totalGridConsumption_Wh || 0;
    this.todayMaxConsumption_Wh = initialState?.todayMaxConsumption_Wh || 0;
    this.todayMinConsumption_Wh = initialState?.todayMinConsumption_Wh || Number.MAX_SAFE_INTEGER;
    this.todayMaxGridFeedIn_Wh = initialState?.todayMaxGridFeedIn_Wh || 0;
    this.todayMaxGridConsumption_Wh = initialState?.todayMaxGridConsumption_Wh || 0;
    this.todayMaxProduction_Wh = initialState?.todayMaxProduction_Wh || 0;
    this.total_cycleCount = initialState?.total_cycleCount || 0;
    this.cycleCount7DayQueue = (initialState?.cycleCount7DayQueue instanceof CircularFifoQueue) ? initialState?.cycleCount7DayQueue : SonnenState.createCycleCount7DayQueue();
    this.cycleCount30DayQueue = (initialState?.cycleCount30DayQueue instanceof CircularFifoQueue) ? initialState?.cycleCount30DayQueue : SonnenState.createCycleCount30DayQueue();
  }

  /**
   * Create a SonnenState instance from a plain object, properly deserializing Date objects and CircularFifoQueue instances
   * @param deserializedState Plain object with potential string dates and serialized CircularFifoQueue data
   * @returns Properly deserialized SonnenState instance
   */
  static fromObject(deserializedState: any): SonnenState {
    if (!deserializedState) {
      return new SonnenState();
    }

    deserializedState = SonnenState.filterCurrentProperties(deserializedState);

    if (deserializedState.lastUpdate && typeof deserializedState.lastUpdate === 'string') {
      deserializedState.lastUpdate = new Date(deserializedState.lastUpdate);
    }

    deserializedState.lastBatteryDataUpdate = null; // transient property, do not restore

    deserializedState.cycleCount7DayQueue = SonnenState.reconstructQueue(deserializedState.cycleCount7DayQueue);
    deserializedState.cycleCount30DayQueue = SonnenState.reconstructQueue(deserializedState.cycleCount30DayQueue);

    return new SonnenState(deserializedState);
  }

  private static filterCurrentProperties(obj: any) {
    const filteredObj: any = {};
    for (const key of Object.getOwnPropertyNames(new SonnenState())) {
      if (obj.hasOwnProperty(key)) {
        filteredObj[key] = obj[key];
      }
    }
    return filteredObj;
  }

/**
    * @param serializedQueue Serialized CircularFifoQueue data
    * @returns Reconstructed CircularFifoQueue instance or null if reconstruction fails
    */
  private static reconstructQueue(serializedQueue: any): CircularFifoQueue<CycleCountSnapshot> | null {
    try {
      if (!serializedQueue || typeof serializedQueue !== 'object') {
        return null;
      }

      const capacity = serializedQueue.capacity;
      if (typeof capacity !== 'number' || capacity < 0) {
        return null;
      }

      if (!Array.isArray(serializedQueue.buffer)) {
        return null;
      }

      const queue = new CircularFifoQueue<CycleCountSnapshot>(capacity);
      const bufferItems = serializedQueue.buffer;

      const restoredBuffer = bufferItems.map((item: any): CycleCountSnapshot => {
        const timestamp = new Date(item.timestamp);
        return { timestamp, cycleCount: item.cycleCount };
      });

      const head = (typeof serializedQueue.head === 'number') ? serializedQueue.head : 0;
      const tail = (typeof serializedQueue.tail === 'number') ? serializedQueue.tail : 0;
      const count = (typeof serializedQueue.count === 'number') ? serializedQueue.count : 0;

      queue.restoreFromSerialized(restoredBuffer, head, tail, count);

      return queue;
    } catch {
      return null;
    }
  }

  updateState(newState: Partial<SonnenState>) {
    Object.assign(this, newState);
  }

  addCycleCountSnapshot(timestamp: Date, cycleCount: number): void {
    const snapshot: CycleCountSnapshot = { timestamp, cycleCount };
    this.cycleCount7DayQueue?.add(snapshot);
    this.cycleCount30DayQueue?.add(snapshot);
  }

  get7DayAverageCycleCountRate(): number | null {
    return this.calculateAverageCycleCountRate(this.cycleCount7DayQueue);
  }

  get30DayAverageCycleCountRate(): number | null {
    return this.calculateAverageCycleCountRate(this.cycleCount30DayQueue);
  }

  private calculateAverageCycleCountRate(queue: CircularFifoQueue<CycleCountSnapshot> | null): number | null {
    if (!queue || queue.getLength() < 2) {
      return null;
    }

    const oldestSnapshot = queue.getFirst();
    const newestSnapshot = queue.getLast();

    if (!oldestSnapshot || !newestSnapshot) {
      return null;
    }

    const timeDiffMs = newestSnapshot.timestamp.getTime() - oldestSnapshot.timestamp.getTime();
    const timeDiffDays = timeDiffMs / (1000 * 60 * 60 * 24);

    if (timeDiffDays <= 0) {
      return null;
    }

    // Calculate rate (cycles per day)
    const cycleDiff = newestSnapshot.cycleCount - oldestSnapshot.cycleCount;
    return cycleDiff / timeDiffDays;
  }

  resetCycleCountQueues(): void {
    this.cycleCount7DayQueue = SonnenState.createCycleCount7DayQueue();
    this.cycleCount30DayQueue = SonnenState.createCycleCount30DayQueue();
  }

  private static createCycleCount7DayQueue(): CircularFifoQueue<CycleCountSnapshot> {
    return new CircularFifoQueue<CycleCountSnapshot>(168);
  }

  private static createCycleCount30DayQueue(): CircularFifoQueue<CycleCountSnapshot> {
    return new CircularFifoQueue<CycleCountSnapshot>(720);
  }
}