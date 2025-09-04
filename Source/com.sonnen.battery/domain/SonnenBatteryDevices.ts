export interface SonnenBatteryDevice {
  lanip: string;
  ca20: boolean;
  info: string;
  device: number;
}

export type SonnenBatteryDevices = SonnenBatteryDevice[];