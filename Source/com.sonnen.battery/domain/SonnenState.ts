export class SonnenState {
  lastUpdate: Date | null;
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

  constructor(initialState?: Partial<SonnenState>) {
    this.lastUpdate = initialState?.lastUpdate || null;
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
  }

  updateState(newState: Partial<SonnenState>) {
    Object.assign(this, newState);
  }
}