import axios from "axios";
import { SonnenBatteries } from "../domain/SonnenBatteryDevices";
import { TimeOfUseSchedule } from "../domain/TimeOfUse";
import { LocalizedError } from "../domain/LocalizedError";

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

  public async setSchedule(schedule: TimeOfUseSchedule): Promise<void> {
    try {
      await axios.put(`${this.getBaseUrl()}/api/v2/configurations`, { EM_ToU_Schedule: `${schedule.toJSONString()}` }, this.config);
    } catch (error) {
      if (SonnenBatterieClient.isAxiosError(error)) {
        if (error.response?.data != null) {
          const responseData = error.response.data as { details: { EM_ToU_Schedule?: string }, error: string };

          if (error.response.status === 400 && responseData.error === 'validation failed') {
            const i18nKey = "error.validation.ToU." + (responseData?.details?.EM_ToU_Schedule ?? "error.validation.failed");
            throw new LocalizedError(i18nKey, { error: responseData.details?.EM_ToU_Schedule ?? responseData.error });
          }
        }
      }
      throw SonnenBatterieClient.getLocalizedError(error);
    }
  }

  public async setScheduleEntry(timeStart: string, timeEnd: string, max_power: number): Promise<void> {
    return this.setSchedule(new TimeOfUseSchedule({ start: timeStart, stop: timeEnd, threshold_p_max: max_power }));
  }

  public async clearSchedule(): Promise<void> {
    return this.setSchedule(new TimeOfUseSchedule([]));
  }

  public async setOperatingMode(mode: string): Promise<void> {
    try {
      await axios.put(`${this.getBaseUrl()}/api/v2/configurations`, { "EM_OperatingMode": mode }, this.config);
    } catch (error) {
      throw SonnenBatterieClient.getLocalizedError(error);
    }
  }

  public async setPrognosisCharging(active: boolean): Promise<void> {
    const prognosis_charging = active ? 1 : 0;
    try {
      await axios.put(`${this.getBaseUrl()}/api/v2/configurations`, { "EM_Prognosis_Charging": prognosis_charging }, this.config);
    } catch (error) {
      throw SonnenBatterieClient.getLocalizedError(error);
    }
  }

  public async setSetpoint(direction: 'charge' | 'discharge', watts: number): Promise<void> {
    try {
      await axios.post(`${this.getBaseUrl()}/api/v2/setpoint/${direction}/${watts}`, {}, this.config);
    } catch (error) {
      if (SonnenBatterieClient.isAxiosError(error) && error.response?.status === 403) {
        throw new LocalizedError("error.vpp_priority");
      }
      throw SonnenBatterieClient.getLocalizedError(error);
    }
  }

  public async getLatestData(): Promise<any> {
    const response = await axios.get(`${this.getBaseUrl()}/api/v2/latestdata`, this.config);
    return response.data;
  }

  public async getStatus(): Promise<any> {
    const response = await axios.get(`${this.getBaseUrl()}/api/v2/status`, this.config);
    return response.data;
  }

  public async getConfigurations(): Promise<any> {
    const response = await axios.get(`${this.getBaseUrl()}/api/v2/configurations`, this.config);
    return response.data;
  }

  public async getBattery(): Promise<any> {
    const response = await axios.get(`${this.getBaseUrl()}/api/v2/battery`, this.config);
    return response.data;
  }

  public static async discoverBatteries(): Promise<SonnenBatteries> {
    try {
      const response = await axios.get('https://find-my.sonnen-batterie.com/find');
      return response.data as SonnenBatteries;
    } catch (error) {
      throw SonnenBatterieClient.getLocalizedError(error);
    }
  }

  public static async findBatteryIP(homeyDeviceId: string): Promise<string | null> {
    const batteries: SonnenBatteries = await SonnenBatterieClient.discoverBatteries();
    if (batteries) {
      for (const battery of batteries) {
        if (SonnenBatterieClient.isSameDevice(battery.device, homeyDeviceId)) {
          return battery.lanip;
        }
      }
    }
    return null;
  }

  private static getLocalizedHttpError(error: unknown): LocalizedError | null {
    if (SonnenBatterieClient.isAxiosError(error)) {
      const httpStatus = error.response?.status;
      const localizedHttpErrors = [400, 401, 403];
      if (httpStatus !== undefined && localizedHttpErrors.includes(httpStatus)) {
        return new LocalizedError("error.http." + httpStatus.toString());
      }

      // Generic error handling for not localized HTTP errors
      return new LocalizedError("error.http.other", { "statusCode": httpStatus?.toString() ?? "unknown" });
    }
    return null;
  }

  private static getLocalizedError(error: unknown): LocalizedError {
    return SonnenBatterieClient.getLocalizedHttpError(error) ?? new LocalizedError("error.unknown", { "error": (error as Error).message }); // Fallback for non-Axios errors    
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

}
