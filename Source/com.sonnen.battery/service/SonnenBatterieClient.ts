import axios from "axios";
import { SonnenCommandResult } from "../domain/SonnenCommandResult";

export class SonnenBatterieClient {
  constructor(private authToken: string) {}

  public async setSchedule(
    batteryBaseUrl: string,
    timeStart: string,
    timeEnd: string,
    maxPower: number
  ): Promise<SonnenCommandResult> {
    const options = {
      method: "put",
      headers: {
        "Auth-Token": `${this.authToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };

    const body = {
      EM_ToU_Schedule: `[{\"start\":\"${timeStart}\",\"stop\":\"${timeEnd}\",\"threshold_p_max\":${maxPower}}]`,
    };

    // Act
    const response = await axios
      .put(`${batteryBaseUrl}/api/v2/configurations`, body, options)
      .then();

    if (response === null) {
      return new SonnenCommandResult(true, "No valid response received.");
    }

    const responseData = response.data;
    if (responseData.error !== null) {
      return new SonnenCommandResult(
        true,
        responseData.details !== null
          ? responseData.details.EM_ToU_Schedule ?? responseData.error
          : responseData.error
      );
    }

    return new SonnenCommandResult(false, "-");
  }

  public async clearSchedule(
    batteryBaseUrl: string
  ): Promise<SonnenCommandResult> {
    const options = {
      method: "put",
      headers: {
        "Auth-Token": `${this.authToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };

    const body = {
      EM_ToU_Schedule: `[]`,
    };

    // Act
    const response = await axios
      .put(`${batteryBaseUrl}/api/v2/configurations`, body, options)
      .then();

    if (response === null) {
      return new SonnenCommandResult(true, "No valid response received.");
    }

    const responseData = response.data;
    if (responseData.error !== null) {
      return new SonnenCommandResult(true, responseData.error);
    }

    return new SonnenCommandResult(false, "-");
  }

  public static getBaseUrl(ipAddress: string): string {
    return `http://${ipAddress}:80`;
  }

  public async getLatestData(batteryBaseUrl: string): Promise<any> {
    const options = {
      method: "get",
      headers: {
        "Auth-Token": `${this.authToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };

    const response = await axios
      .get(`${batteryBaseUrl}/api/v2/latestdata`, options)
      .then();

    return response.data;
  }

  public async getStatus(batteryBaseUrl: string): Promise<any> {
    const options = {
      method: "get",
      headers: {
        "Auth-Token": `${this.authToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };

    const response = await axios
      .get(`${batteryBaseUrl}/api/v2/status`, options)
      .then();

    return response.data;
  }

  public async getConfigurations(batteryBaseUrl: string): Promise<any> {
    const options = {
      method: "get",
      headers: {
        "Auth-Token": `${this.authToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };

    const response = await axios
      .get(`${batteryBaseUrl}/api/v2/configurations`, options)
      .then();

    return response.data;
  }

  public static async discoverDevices(): Promise<any> {
    const response = await axios
      .get('https://find-my.sonnen-batterie.com/find')
      .then();

    return response.data;
  }
}
