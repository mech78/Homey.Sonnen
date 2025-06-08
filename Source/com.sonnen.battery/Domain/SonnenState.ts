import _ from 'underscore';

export class SonnenState {
  private _lastUpdate: string;

  get lastUpdate(): Date {
    return new Date(this._lastUpdate);
  }

  set lastUpdate(value: Date) {
    this._lastUpdate = value.toISOString();
  }
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

  constructor(initialState?: Partial<SonnenState>) {
    this._lastUpdate = (initialState?.lastUpdate ? initialState.lastUpdate.toISOString() : new Date().toISOString());
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
  }

  updateState(newState: Partial<SonnenState>) {
    if (newState.lastUpdate) {
      this.lastUpdate = newState.lastUpdate;
    }
    Object.assign(this, _.omit(newState, 'lastUpdate'));
  }
}