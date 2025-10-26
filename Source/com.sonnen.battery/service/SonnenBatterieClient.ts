import axios from "axios";
import { SonnenBatteries } from "../domain/SonnenBatteryDevices";
import { TimeOfUseSchedule } from "../domain/TimeOfUse";
import { SonnenCommandResult } from "../domain/SonnenCommandResult";

export class SonnenBatterieClient {

  config: { headers: { [key: string]: string } };

  constructor(private authToken: string, private ipAddress: string) {
      const headers = {
        "Auth-Token": `${this.authToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      }
      this.config = {
        headers: headers
      };
  }

  public async setSchedule(schedule: TimeOfUseSchedule): Promise<SonnenCommandResult> {
    try {
      const response = await axios.put(`${this.getBaseUrl()}/api/v2/configurations`, { EM_ToU_Schedule: `${schedule.toJSONString()}` }, this.config);
      return new SonnenCommandResult(false, SonnenBatterieClient.safeToString(response.data?.EM_ToU_Schedule), response?.status); // e.g. data: { EM_ToU_Schedule: '[{"start":"09:00","stop":"12:00","threshold_p_max":1234}]' }
    } catch (error) {
      if (SonnenBatterieClient.isAxiosError(error)) {
        if (error.response?.data != null) {
          const responseData = error.response.data as { details: { EM_ToU_Schedule?: string }, error: string };
          
          let i18nKey;
          if (error.response.status === 400 && responseData.error === 'validation failed') {
            i18nKey = "error.validation.ToU." + (responseData?.details?.EM_ToU_Schedule ?? "error.validation.failed");
          }

          return new SonnenCommandResult(
            true, 
            responseData.details?.EM_ToU_Schedule ?? responseData.error, 
            error.response.status, // e.g. for HTTP 400 Bad Request data: { details: { EM_ToU_Schedule: 'invalid threshold' }, error: 'validation failed'}
            i18nKey,
          ); 
        }
      }
      return new SonnenCommandResult(true, (error as Error).message);
    }

  }

  public async setScheduleEntry(timeStart: string, timeEnd: string, max_power: number) {
    return this.setSchedule(new TimeOfUseSchedule({ start: timeStart, stop: timeEnd, threshold_p_max: max_power }));
  }

  public async clearSchedule() {
    return this.setSchedule(new TimeOfUseSchedule([]));
  }

  public async setOperatingMode(mode: string): Promise<SonnenCommandResult> {
    try {
      const response = await axios.put(`${this.getBaseUrl()}/api/v2/configurations`, { "EM_OperatingMode": mode }, this.config);
      return new SonnenCommandResult(false, SonnenBatterieClient.safeToString(response.data), response.status);
    } catch (error) {
      if (SonnenBatterieClient.isAxiosError(error)) {
        return new SonnenCommandResult(true, error.message, error.response?.status);
      }
      return new SonnenCommandResult(true, (error as Error).message);
    }
  }

  public async setPrognosisCharging(active: boolean): Promise<SonnenCommandResult> {
    const prognosis_charging = active ? 1 : 0;
    try {
      const response = await axios.put(`${this.getBaseUrl()}/api/v2/configurations`, { "EM_Prognosis_Charging": prognosis_charging }, this.config);
      return new SonnenCommandResult(false, SonnenBatterieClient.safeToString(response.data), response.status);
    } catch (error) {
      if (SonnenBatterieClient.isAxiosError(error)) {
        return new SonnenCommandResult(true, error.message, error.response?.status);
      }
      return new SonnenCommandResult(true, (error as Error).message);
    }
  }

  public async setSetpoint(direction: 'charge' | 'discharge', watts: number): Promise<SonnenCommandResult> {
    try {
      const response = await axios.post(`${this.getBaseUrl()}/api/v2/setpoint/${direction}/${watts}`, {}, this.config);
      return new SonnenCommandResult(false, SonnenBatterieClient.safeToString(response.data), response.status);
    } catch (error) {
      if (SonnenBatterieClient.isAxiosError(error)) {
        if (error.response?.status === 403) {
          return new SonnenCommandResult(true, error.message, error.response.status, "error.vpp_priority");
        }
        return new SonnenCommandResult(true, error.message, error.response?.status);
      }
      return new SonnenCommandResult(true, (error as Error).message);
    }
  }

  public async getLatestData() {
    const response = await axios.get(`${this.getBaseUrl()}/api/v2/latestdata`, this.config);
    return response.data;
  }

  public async getStatus() {
    const response = await axios.get(`${this.getBaseUrl()}/api/v2/status`, this.config);
    return response.data;
  }

  public async getConfigurations(){
    const response = await axios.get(`${this.getBaseUrl()}/api/v2/configurations`, this.config);
    return response.data;
  }

  public static async discoverBatteries(): Promise<SonnenCommandResult> {
    try {
      const response = await axios.get('https://find-my.sonnen-batterie.com/find');
      const commandResult = new SonnenCommandResult(false, SonnenBatterieClient.safeToString(response.data), response.status); 
      commandResult.payload = response.data as SonnenBatteries;
      return commandResult
    } catch (error) {
      if (SonnenBatterieClient.isAxiosError(error)) {
        return new SonnenCommandResult(true, error.message, error.response?.status);
      }
      return new SonnenCommandResult(true, (error as Error).message);
    }
  }

  public static async findBatteryIP(homeyDeviceId: string): Promise<string | null> {
    const result = await SonnenBatterieClient.discoverBatteries(); // TODO: handle errors passed in SonnenCommandResult
    const batteries: SonnenBatteries = result.payload as SonnenBatteries;
    if (batteries) {
      for (const battery of batteries) {
        if (SonnenBatterieClient.isSameDevice(battery.device, homeyDeviceId)) {
          return battery.lanip;
        }
      }
    }
    return null;
  }

  /**
   * onPairListDevices() used the serial number of the sonnenBatterie as prefix part for the unique device ID
   */
  public static isSameDevice(device: number, homeyDeviceId: string): boolean {
    const batterySerialNumber = "" + device;
    return homeyDeviceId.startsWith(batterySerialNumber);
  }

  private getBaseUrl(): string {
    return `http://${this.ipAddress}:80`;
  }

  public static isAxiosError<T>(error: unknown): error is axios.AxiosError<T> {
    return (error as axios.AxiosError<T>).isAxiosError === true;
  }

  private static safeToString(value: unknown): string {
    if (typeof value === "string") { return value; }
    if (value instanceof Error) { return value.message; }
    if (typeof value === "object" && value !== null) { return JSON.stringify(value); }
    return String(value);
  }
}
