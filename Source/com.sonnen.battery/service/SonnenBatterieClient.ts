import { SonnenBatteries } from "../domain/SonnenBatteryDevices";
import { TimeOfUseSchedule } from "../domain/TimeOfUse";
import { LocalizedError } from "../domain/LocalizedError";

export class SonnenBatterieClient {

  constructor(private authToken: string, private ipAddress: string) {
  }

  private getHeaders(): Headers {
    const headers = new Headers();
    headers.set("Auth-Token", `${this.authToken}`);
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "application/json");
    return headers;
  }

  public async setSchedule(schedule: TimeOfUseSchedule): Promise<void> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/api/v2/configurations`, {
        method: "PUT",
        headers: this.getHeaders(),
        body: JSON.stringify({ EM_ToU_Schedule: `${schedule.toJSONString()}` })
      });

      if (!response.ok) {
        throw await SonnenBatterieClient.createFetchError(response);
      }
    } catch (error) {
      if (error instanceof LocalizedError) {
        throw error;
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
      const response = await fetch(`${this.getBaseUrl()}/api/v2/configurations`, {
        method: "PUT",
        headers: this.getHeaders(),
        body: JSON.stringify({ "EM_OperatingMode": mode })
      });

      if (!response.ok) {
        throw await SonnenBatterieClient.createFetchError(response);
      }
    } catch (error) {
      if (error instanceof LocalizedError) {
        throw error;
      }
      throw SonnenBatterieClient.getLocalizedError(error);
    }
  }

  public async setPrognosisCharging(active: boolean): Promise<void> {
    const prognosis_charging = active ? 1 : 0;
    try {
      const response = await fetch(`${this.getBaseUrl()}/api/v2/configurations`, {
        method: "PUT",
        headers: this.getHeaders(),
        body: JSON.stringify({ "EM_Prognosis_Charging": prognosis_charging })
      });

      if (!response.ok) {
        throw await SonnenBatterieClient.createFetchError(response);
      }
    } catch (error) {
      if (error instanceof LocalizedError) {
        throw error;
      }
      throw SonnenBatterieClient.getLocalizedError(error);
    }
  }

  /**
   * Sets a manual charge/discharge setpoint in watts.
   * The battery only accepts non-negative integers; negative or fractional values
   * are rejected by the device with an "invalid argument" error, so validate upfront.
   */
  public async setSetpoint(direction: 'charge' | 'discharge', watts: number): Promise<void> {
    if (!Number.isInteger(watts) || watts < 0) {
      throw new LocalizedError("error.validation.invalid_setpoint_power", { power: String(watts) });
    }

    try {
      const response = await fetch(`${this.getBaseUrl()}/api/v2/setpoint/${direction}/${watts}`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({})
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new LocalizedError("error.vpp_priority");
        }
        throw await SonnenBatterieClient.createFetchError(response);
      }
    } catch (error) {
      if (error instanceof LocalizedError) {
        throw error;
      }
      throw SonnenBatterieClient.getLocalizedError(error);
    }
  }

  /**
   * Enables or disables manual standby (the API equivalent of the sonnen UI
   * "Manual Standby" switch). Persistent, works independent of the operating mode
   * and does not modify the Time-of-Use schedule.
   */
  public async setStandby(enabled: boolean): Promise<void> {
    try {
      const response = await fetch(`${this.getBaseUrl()}/api/v2/standby`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ "enabled": enabled })
      });

      if (!response.ok) {
        if (response.status === 400) {
          // The spec defines 400 as "Standby is not supported" (older systems/firmware)
          throw new LocalizedError("error.standby.not_supported");
        }
        throw await SonnenBatterieClient.createFetchError(response);
      }
    } catch (error) {
      if (error instanceof LocalizedError) {
        throw error;
      }
      throw SonnenBatterieClient.getLocalizedError(error);
    }
  }

  /**
   * Convenience wrapper to leave standby and hand control back to the battery.
   */
  public async stopPowerControl(): Promise<void> {
    return this.setStandby(false);
  }

  public async getLatestData(): Promise<any> {
    const response = await fetch(`${this.getBaseUrl()}/api/v2/latestdata`, {
      headers: this.getHeaders()
    });

    if (!response.ok) {
      throw await SonnenBatterieClient.createFetchError(response);
    }

    return await response.json();
  }

  public async getStatus(): Promise<any> {
    const response = await fetch(`${this.getBaseUrl()}/api/v2/status`, {
      headers: this.getHeaders()
    });

    if (!response.ok) {
      throw await SonnenBatterieClient.createFetchError(response);
    }

    return await response.json();
  }

  public async getConfigurations(): Promise<any> {
    const response = await fetch(`${this.getBaseUrl()}/api/v2/configurations`, {
      headers: this.getHeaders()
    });

    if (!response.ok) {
      throw await SonnenBatterieClient.createFetchError(response);
    }

    return await response.json();
  }

  public async getBattery(): Promise<any> {
    const response = await fetch(`${this.getBaseUrl()}/api/v2/battery`, {
      headers: this.getHeaders()
    });

    if (!response.ok) {
      throw await SonnenBatterieClient.createFetchError(response);
    }

    return await response.json() as Record<string, unknown>;
  }

  /**
   * Reads the site power limits (max AC charge/discharge power etc.).
   * Only available on newer hybrid/AC-coupled system generations; older
   * systems return an empty object.
   */
  public async getSiteLimits(): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.getBaseUrl()}/api/v2/site/limits`, {
      headers: this.getHeaders()
    });

    if (!response.ok) {
      throw await SonnenBatterieClient.createFetchError(response);
    }

    return await response.json() as Record<string, unknown>;
  }

  public static async discoverBatteries(): Promise<SonnenBatteries> {
    try {
      const response = await fetch('https://find-my.sonnen-batterie.com/find');
      if (!response.ok) {
        throw await SonnenBatterieClient.createFetchError(response);
      }
      return await response.json() as SonnenBatteries;
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

  private static async createFetchError(response: Response): Promise<LocalizedError> {
    const httpStatus = response.status;
    const localizedHttpErrors = [400, 401, 403];

    if (httpStatus === 400) {
      try {
        const data = await response.json();
        const responseData = data as { details: { EM_ToU_Schedule?: string }, error: string };

        if (responseData.error === 'validation failed') {
          const i18nKey = "error.validation.ToU." + (responseData?.details?.EM_ToU_Schedule ?? "error.validation.failed");
          return new LocalizedError(i18nKey, { error: responseData.details?.EM_ToU_Schedule ?? responseData.error });
        }
      } catch {
        return new LocalizedError("error.validation.failed");
      }
    }

    if (localizedHttpErrors.includes(httpStatus)) {
      return new LocalizedError("error.http." + httpStatus.toString());
    }

    return new LocalizedError("error.http.other", { statusCode: httpStatus.toString() });
  }

  private static getLocalizedError(error: unknown): LocalizedError {
    return new LocalizedError("error.unknown", { error: (error as Error).message });
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

}