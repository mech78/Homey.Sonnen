import axios from "axios";
import { SonnenCommandResult } from "../domain/SonnenCommandResult";
import { SonnenBatteries } from "../domain/SonnenBatteryDevices";
import { TimeOfUseSchedule } from "../domain/TimeOfUse";

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

    const response = await axios.put(`${this.getBaseUrl()}/api/v2/configurations`, body, this.optionsPut);

    if (response == null) {
      return new SonnenCommandResult(true, "No valid response received.");
    }

    const responseData = response.data;
    if (responseData.error != null) {
      return new SonnenCommandResult(
        true,
        responseData.details != null
          ? responseData.details.EM_ToU_Schedule ?? responseData.error
          : responseData.error
      );
    }

    return new SonnenCommandResult(false, "-");
  }

  public async setScheduleEntry(timeStart: string, timeEnd: string, maxPower: number): Promise<SonnenCommandResult> {
    // TODO: add error handling or change to TimeOfUseEntry
    return this.setSchedule(new TimeOfUseSchedule({ start: timeStart, stop: timeEnd, threshold_p_max: maxPower }));
  }

  public async clearSchedule(): Promise<SonnenCommandResult> {
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
