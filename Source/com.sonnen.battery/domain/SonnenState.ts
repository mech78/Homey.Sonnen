import { RingBuffer } from 'ring-buffer-ts';

interface CycleCountSnapshot {
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
  cycleCount7DayBuffer : RingBuffer<CycleCountSnapshot> | null;
  cycleCount30DayBuffer : RingBuffer<CycleCountSnapshot> | null;

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
    this.cycleCount7DayBuffer = (initialState?.cycleCount7DayBuffer instanceof RingBuffer) ? initialState?.cycleCount7DayBuffer : new RingBuffer<CycleCountSnapshot>(168);
    this.cycleCount30DayBuffer = (initialState?.cycleCount30DayBuffer instanceof RingBuffer) ? initialState?.cycleCount30DayBuffer : new RingBuffer<CycleCountSnapshot>(720);
  }

   /**
   * Create a SonnenState instance from a plain object, properly deserializing Date objects and RingBuffer instances
   * @param deserializedState Plain object with potential string dates and serialized RingBuffer data
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

    deserializedState.cycleCount7DayBuffer = SonnenState.reconstructRingBuffer(deserializedState.cycleCount7DayBuffer);
    deserializedState.cycleCount30DayBuffer = SonnenState.reconstructRingBuffer(deserializedState.cycleCount30DayBuffer);
    
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
   * @param serializedBuffer Serialized RingBuffer data
   * @returns Reconstructed RingBuffer instance or null if reconstruction fails
   */
  private static reconstructRingBuffer(serializedBuffer: any): RingBuffer<CycleCountSnapshot> | null {
    if (!serializedBuffer || typeof serializedBuffer !== 'object' ||
      !serializedBuffer.buffer || !Array.isArray(serializedBuffer.buffer) ||
      typeof serializedBuffer.size !== 'number') {
      return null;
    }

    const buffer = new RingBuffer<CycleCountSnapshot>(serializedBuffer.size);
    const pos = typeof serializedBuffer.pos === 'number' ? serializedBuffer.pos : 0;
    const buf = serializedBuffer.buffer;

    for (let i = pos; i < buf.length; i++) {
      SonnenState.addSnapshot(buf[i], buffer);
    }
    for (let i = 0; i < pos; i++) {
      SonnenState.addSnapshot(buf[i], buffer);
    }

    return buffer;
  }

  private static addSnapshot(snapshot: any, buffer: RingBuffer<CycleCountSnapshot>): void {
    if (snapshot && typeof snapshot.timestamp === 'string' && typeof snapshot.cycleCount === 'number') {
      const timestamp = new Date(snapshot.timestamp);
      if (!isNaN(timestamp.getTime())) {
        buffer.add({ timestamp, cycleCount: snapshot.cycleCount });
      }
    }
  }

  updateState(newState: Partial<SonnenState>) {
    Object.assign(this, newState); 
  }

  addCycleCountSnapshot(timestamp: Date, cycleCount: number): void {
    const snapshot: CycleCountSnapshot = { timestamp, cycleCount };
    this.cycleCount7DayBuffer?.add(snapshot);
    this.cycleCount30DayBuffer?.add(snapshot);
  }

  get7DayAverageCycleCountRate(): number | null {
    return this.calculateAverageCycleCountRate(this.cycleCount7DayBuffer);
  }

  get30DayAverageCycleCountRate(): number | null {
    return this.calculateAverageCycleCountRate(this.cycleCount30DayBuffer);
  }

  private calculateAverageCycleCountRate(buffer: RingBuffer<CycleCountSnapshot>|null): number | null {
    if (!buffer || buffer.getBufferLength() < 2) {
      return null;
    }
    
    const oldestSnapshot = buffer.getFirst();
    const newestSnapshot = buffer.getLast();
    
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
}