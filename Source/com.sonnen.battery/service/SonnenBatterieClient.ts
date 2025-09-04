import axios from "axios";
import { SonnenCommandResult } from "../domain/SonnenCommandResult";
import { SonnenBatteryDevices } from "../domain/SonnenBatteryDevices";

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

  public async setSchedule(
    timeStart: string,
    timeEnd: string,
    maxPower: number
  ): Promise<SonnenCommandResult> {

    const body = {
      EM_ToU_Schedule: `[{\"start\":\"${timeStart}\",\"stop\":\"${timeEnd}\",\"threshold_p_max\":${maxPower}}]`,
    };
    
    // Act
    const response = await axios
      .put(`${this.getBaseUrl()}/api/v2/configurations`, body, this.optionsPut)
      .then();

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

  public async clearSchedule(
  ): Promise<SonnenCommandResult> {

    const body = {
      EM_ToU_Schedule: `[]`,
    };

    // Act
    const response = await axios
      .put(`${this.getBaseUrl()}/api/v2/configurations`, body, this.optionsPut)
      .then();

    if (response == null) {
      return new SonnenCommandResult(true, "No valid response received.");
    }

    const responseData = response.data;
    if (responseData.error != null) {
      return new SonnenCommandResult(true, responseData.error);
    }

    return new SonnenCommandResult(false, "-");
  }

  public async getLatestData(): Promise<any> {

    const response = await axios
      .get(`${this.getBaseUrl()}/api/v2/latestdata`, this.optionsGet)
      .then();

    return response.data;
  }

  public async getStatus(): Promise<any> {
   
    const response = await axios
      .get(`${this.getBaseUrl()}/api/v2/status`, this.optionsGet)
      .then();

    return response.data;
  }

  public async getConfigurations(): Promise<any> {
    const response = await axios
      .get(`${this.getBaseUrl()}/api/v2/configurations`, this.optionsGet)
      .then();

    return response.data;
  }

  public static async discoverDevices(): Promise<SonnenBatteryDevices> {
    const response = await axios
      .get('https://find-my.sonnen-batterie.com/find')
      .then();

    return response.data;
  }

  private getBaseUrl(): string {
    return `http://${this.ipAddress}:80`;
  }
}
