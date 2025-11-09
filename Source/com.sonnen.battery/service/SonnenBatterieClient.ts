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
            throw new LocalizedError(i18nKey, undefined, responseData.details?.EM_ToU_Schedule ?? responseData.error);
          }
          
          // Handle specific HTTP status codes
          if (error.response.status === 401) {
            throw new LocalizedError("error.http.401");
          }
          
          if (error.response.status === 403) {
            throw new LocalizedError("error.http.403");
          }
          
          if (error.response.status === 400) {
            throw new LocalizedError("error.http.400");
          }
        }
        
        // Generic error handling for other HTTP errors
        throw new LocalizedError("error.http.other", { "statusCode": error.response?.status?.toString() ?? "unknown" });
      }
      
      // Fallback for non-Axios errors
      throw new LocalizedError("error.unknown", { "error": (error as Error).message });
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
      if (SonnenBatterieClient.isAxiosError(error)) {
        // Handle specific HTTP status codes
        if (error.response?.status === 401) {
          throw new LocalizedError("error.http.401");
        }
        
        if (error.response?.status === 403) {
          throw new LocalizedError("error.http.403");
        }
        
        if (error.response?.status === 400) {
          throw new LocalizedError("error.http.400");
        }
        
        // Generic error handling for other HTTP errors
        throw new LocalizedError("error.http.other", { "statusCode": error.response?.status?.toString() ?? "unknown" });
      }
      
      // Fallback for non-Axios errors
      throw new LocalizedError("error.unknown", { "error": (error as Error).message });
    }
  }

  public async setPrognosisCharging(active: boolean): Promise<void> {
    const prognosis_charging = active ? 1 : 0;
    try {
      await axios.put(`${this.getBaseUrl()}/api/v2/configurations`, { "EM_Prognosis_Charging": prognosis_charging }, this.config);
    } catch (error) {
      if (SonnenBatterieClient.isAxiosError(error)) {
        // Handle specific HTTP status codes
        if (error.response?.status === 401) {
          throw new LocalizedError("error.http.401");
        }
        
        if (error.response?.status === 403) {
          throw new LocalizedError("error.http.403");
        }
        
        if (error.response?.status === 400) {
          throw new LocalizedError("error.http.400");
        }
        
        // Generic error handling for other HTTP errors
        throw new LocalizedError("error.http.other", { "statusCode": error.response?.status?.toString() ?? "unknown" });
      }
      
      // Fallback for non-Axios errors
      throw new LocalizedError("error.unknown", { "error": (error as Error).message });
      }
  }

  public async setSetpoint(direction: 'charge' | 'discharge', watts: number): Promise<void> {
    try {
      await axios.post(`${this.getBaseUrl()}/api/v2/setpoint/${direction}/${watts}`, {}, this.config);
    } catch (error) {
      if (SonnenBatterieClient.isAxiosError(error)) {
        // Handle specific error for VPP priority
        if (error.response?.status === 403) {
          throw new LocalizedError("error.vpp_priority");
        }
        
        // Handle specific HTTP status codes
        if (error.response?.status === 401) {
          throw new LocalizedError("error.http.401");
        }
        
        if (error.response?.status === 400) {
          throw new LocalizedError("error.http.400");
        }
        
        // Generic error handling for other HTTP errors
        throw new LocalizedError("error.http.other", { "statusCode": error.response?.status?.toString() ?? "unknown" });
      }
      
      // Fallback for non-Axios errors
      throw new LocalizedError("error.unknown", { "error": (error as Error).message });
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

  public static async discoverBatteries(): Promise<SonnenBatteries> {
    try {
      const response = await axios.get('https://find-my.sonnen-batterie.com/find');
      return response.data as SonnenBatteries;
    } catch (error) {
      if (SonnenBatterieClient.isAxiosError(error)) {
        // Handle specific HTTP status codes
        if (error.response?.status === 401) {
          throw new LocalizedError("error.http.401");
        }
        
        if (error.response?.status === 403) {
          throw new LocalizedError("error.http.403");
        }
        
        if (error.response?.status === 400) {
          throw new LocalizedError("error.http.400");
        }
        
        // Generic error handling for other HTTP errors
        throw new LocalizedError("error.http.other", { "statusCode": error.response?.status?.toString() ?? "unknown" });
      }
      
      // Fallback for non-Axios errors
      throw new LocalizedError("error.unknown", { "error": (error as Error).message });
    }
  }

  public static async findBatteryIP(homeyDeviceId: string): Promise<string | null> {
    try {
      const batteries: SonnenBatteries = await SonnenBatterieClient.discoverBatteries();
      if (batteries) {
        for (const battery of batteries) {
          if (SonnenBatterieClient.isSameDevice(battery.device, homeyDeviceId)) {
            return battery.lanip;
          }
        }
      }
      return null;
    } catch (error) {
      // Re-throw the error as this method is expected to propagate errors
      throw error;
    }
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
