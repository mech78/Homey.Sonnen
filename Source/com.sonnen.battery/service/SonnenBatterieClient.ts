import axios from "axios";
import { SonnenCommandResult } from "../domain/SonnenCommandResult";

export class SonnenBatterieClient {
  constructor(public authToken: string) {}

  public async SetSchedule(
    batteryBaseUrl: string,
    timeStart: string,
    timeEnd: string,
    maxPower: number
  ): Promise<SonnenCommandResult> {
    var options = {
      method: "put",
      headers: {
        "Auth-Token": `${this.authToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };

    var body = {
      EM_ToU_Schedule: `[{\"start\":\"${timeStart}\",\"stop\":\"${timeEnd}\",\"threshold_p_max\":${maxPower}}]`,
    };

    // Act
    var response = await axios
      .put(`${batteryBaseUrl}/api/v2/configurations`, body, options)
      .then();

    if (response == null) {
      return new SonnenCommandResult(true, "No valid response received.");
    }

    var responseData = response.data;
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

  public async ClearSchedule(
    batteryBaseUrl: string
  ): Promise<SonnenCommandResult> {
    var options = {
      method: "put",
      headers: {
        "Auth-Token": `${this.authToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };

    var body = {
      EM_ToU_Schedule: `[]`,
    };

    // Act
    var response = await axios
      .put(`${batteryBaseUrl}/api/v2/configurations`, body, options)
      .then();

    if (response == null) {
      return new SonnenCommandResult(true, "No valid response received.");
    }

    var responseData = response.data;
    if (responseData.error != null)
      return new SonnenCommandResult(true, responseData.error);

    return new SonnenCommandResult(false, "-");
  }

  public static GetBaseUrl(ipAddress: string): string {
    return `http://${ipAddress}:80`;
  }
}
