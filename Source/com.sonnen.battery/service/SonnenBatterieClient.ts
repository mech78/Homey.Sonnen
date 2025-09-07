import axios from "axios";
import { SonnenBatteries } from "../domain/SonnenBatteryDevices";
import { TimeOfUseSchedule } from "../domain/TimeOfUse";
import { SonnenCommandResult } from "../domain/SonnenCommandResult";

export class SonnenBatterieClient {

  optionsPut: { method: string; headers: { [key: string]: string } };
  optionsGet: { method: string; headers: { [key: string]: string } };

  constructor(private authToken: string, private ipAddress: string) {
      const headers = {
        "Auth-Token": `${this.authToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      }
      this.optionsPut = {
        method: "put",
        headers: headers
      };
      this.optionsGet = {
        method: "get",
        headers: headers
      };
  }

  public async setSchedule(schedule: TimeOfUseSchedule): Promise<SonnenCommandResult> {
    const body = {
      EM_ToU_Schedule: `${schedule.toJSONString()}`,
    };

    try {
      const response = await axios.put(`${this.getBaseUrl()}/api/v2/configurations`, body, this.optionsPut);
      return new SonnenCommandResult(false, response.data.EM_ToU_Schedule, response.status); // e.g. data: { EM_ToU_Schedule: '[{"start":"09:00","stop":"12:00","threshold_p_max":1234}]' } 
    } catch (error) {
      if (SonnenBatterieClient.isAxiosError(error)) {
        if (error.response?.data != null) {
          const responseData = error.response.data as { details: { EM_ToU_Schedule?: string }, error: string };
          //console.log(responseData);
          // console.log(responseData?.error + " " + error.response.status + " " + responseData?.details?.EM_ToU_Schedule);
          
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
      /*
        console.log("Error response: ", error.response);
        console.log("Error response data: ", error.response?.data); 
      */
    }

  }

  public async setScheduleEntry(timeStart: string, timeEnd: string, maxPower: number) {
    // TODO: add error handling or change to TimeOfUseEntry
    return this.setSchedule(new TimeOfUseSchedule({ start: timeStart, stop: timeEnd, threshold_p_max: maxPower }));
  }

  public async clearSchedule() {
    return this.setSchedule(new TimeOfUseSchedule([]));
  }

  public async setOperationMode(mode: number) {
    await axios.put(`${this.getBaseUrl()}/api/v2/configurations`, { "EM_OperatingMode": mode }, this.optionsPut);
  }

  public async setPrognosisCharging(active: boolean) {
    const prognosis_charging = active ? 1 : 0;
    await axios.put(`${this.getBaseUrl()}/api/v2/configurations`, { "EM_Prognosis_Charging": prognosis_charging }, this.optionsPut);
  }

  public async getLatestData() {
    const response = await axios.get(`${this.getBaseUrl()}/api/v2/latestdata`, this.optionsGet);
    return response.data;
  }

  public async getStatus() {
    const response = await axios.get(`${this.getBaseUrl()}/api/v2/status`, this.optionsGet);
    return response.data;
  }

  public async getConfigurations(){
    const response = await axios.get(`${this.getBaseUrl()}/api/v2/configurations`, this.optionsGet);
    return response.data;
  }

  public static async discoverBatteries(): Promise<SonnenBatteries> {
    const response = await axios.get('https://find-my.sonnen-batterie.com/find');
    return response.data;
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
