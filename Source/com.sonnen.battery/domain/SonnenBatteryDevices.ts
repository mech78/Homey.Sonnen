export interface SonnenBattery {
  lanip: string; // the local IP address of the SonnenBatterie device
  ca20: boolean;
  info: string; // e.g. "sonnenBatterie"
  device: number; // serial number of this device. By default the hostname is "sb-<device>"
}

export type SonnenBatteries = SonnenBattery[];