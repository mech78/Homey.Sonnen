import axios from 'axios';
import _ from 'underscore';
import { SonnenBatterieClient } from '../../service/SonnenBatterieClient';
import { SonnenDevice } from '../../lib/SonnenDevice';
import { SonnenState } from '../../domain/SonnenState';
module.exports = class SonnenBatteryDevice extends SonnenDevice {
  private state: SonnenState = new SonnenState({ lastUpdate: this.getLocalNow() });
  private updateIntervalId: NodeJS.Timeout | undefined;

  async onInit() {
    super.onInit();

    this.registerResetMetersButton();

    var batteryAuthToken = this.homey.settings.get('BatteryAuthToken');
    var batteryPullInterval = +(this.homey.settings.get('BatteryPullInterval') || '30');

    var storedState: SonnenState;
    try {
      this.log('Retrieving stored state...');
      storedState = this.homey.settings.get('deviceState') || this.state;
    } catch (e) {
      this.log('Failed to retrieve stored state, use new state', e);
      storedState = this.state;
    }
    this.state.updateState(storedState); // apply stored state to current state
    this.log('Retrieved stored state: ' + JSON.stringify(this.state, null, 2));

    // Pull battery status
    this.updateIntervalId = this.homey.setInterval(async () => {
      this.state.updateState(await this.loadLatestState(batteryAuthToken, this.state, this.getStore().autodiscovery ?? true));
    }, batteryPullInterval * 1000);
  }

  async onDeleted() {
    if (this.updateIntervalId) {
      this.homey.clearInterval(this.updateIntervalId);
    }
    // Store current state
    this.homey.settings.set('deviceState', this.state);

    super.onDeleted();
  }

  async onUninit() {
    // Store current state
    this.homey.settings.set('deviceState', this.state);

    super.onUninit();
  }

  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null; };
    newSettings: { [key: string]: boolean | string | number | undefined | null; };
    changedKeys: string[];
  }): Promise<string | void> {
    super.onSettings({ oldSettings, newSettings, changedKeys });

    if (_.contains(changedKeys, "device-ip")) {
      var newDeviceIp = newSettings["device-ip"];
      this.log("Settings", "IP", newDeviceIp);
      this.setStoreValue('lanip', newDeviceIp);
    };

    if (_.contains(changedKeys, "device-discovery")) {
      var blnUseAutoDisovery = newSettings["device-discovery"];
      this.log("Settings", "AutoDiscovery", blnUseAutoDisovery);
      this.setStoreValue('autodiscovery', blnUseAutoDisovery);
    };
  }

  /**
   * Homey SDK3's new Date() is always in UTC but SonnenBatterie timestamps are local,
   * so match with Homey's local timezone
   * @returns {Date}
   */
  private getLocalNow(): Date {
    var timezone = this.homey.clock.getTimezone();
    return new Date(
      new Date().toLocaleString('en-US', { hour12: false, timeZone: timezone })
    );
  }

  private registerResetMetersButton() {
    this.registerCapabilityListener('button.reset_meter', async () => {
      this.state = new SonnenState({ lastUpdate: this.getLocalNow() }); // TODO: currently deletes all sums, not just daily sums. Might want to split into two buttons, one for daily reset and one for total reset.
    });
  }

  private async loadLatestState(
    authKey: string,
    lastState: SonnenState,
    retryOnError = true
  ): Promise<SonnenState> {
    // Arrange
    var options = {
      method: 'get',
      headers: {
        'Auth-Token': `${authKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };

    this.log('Updating: ' + this.getName(), this.getClass(), this.getData()['id']);

    try {
      var baseUrl = SonnenBatterieClient.GetBaseUrl(this.getStore().lanip); // This may change/update at runtime.

      this.log(`Fetching data from ${baseUrl}/api/v2/latestdata and ${baseUrl}/api/v2/status`);

      var response = await axios
        .get(`${baseUrl}/api/v2/latestdata`, options)
        .then();

      var statusResponse = await axios
        .get(`${baseUrl}/api/v2/status`, options)
        .then();

      var latestDataJson = response.data;
      var statusJson = statusResponse.data;

      var currentUpdate = new Date(latestDataJson.Timestamp);
      this.log('Fetched at ' + currentUpdate.toISOString() + ' compute changes since ' + lastState.lastUpdate.toISOString());

      var grid_feed_in_W = +statusJson.GridFeedIn_W > 0 ? +statusJson.GridFeedIn_W : 0;
      var grid_consumption_W = +statusJson.GridFeedIn_W < 0 ? -1 * statusJson.GridFeedIn_W : 0;
      var toBattery_W = (statusJson.Pac_total_W ?? 0) < 0 ? -1 * statusJson.Pac_total_W : 0;
      var fromBattery_W = (statusJson.Pac_total_W ?? 0) > 0 ? statusJson.Pac_total_W : 0;

      var currentState = new SonnenState({
        lastUpdate: currentUpdate,

        totalDailyToBattery_Wh: this.aggregateTotal(lastState.totalDailyToBattery_Wh, toBattery_W, lastState.lastUpdate, currentUpdate, true),
        totalDailyFromBattery_Wh: this.aggregateTotal(lastState.totalDailyFromBattery_Wh, fromBattery_W, lastState.lastUpdate, currentUpdate, true),
        totalDailyProduction_Wh: this.aggregateTotal(lastState.totalDailyProduction_Wh, statusJson.Production_W, lastState.lastUpdate, currentUpdate, true),
        totalDailyConsumption_Wh: this.aggregateTotal(lastState.totalDailyConsumption_Wh, statusJson.Consumption_W, lastState.lastUpdate, currentUpdate, true),
        totalDailyGridFeedIn_Wh: this.aggregateTotal(lastState.totalDailyGridFeedIn_Wh, grid_feed_in_W, lastState.lastUpdate, currentUpdate, true),
        totalDailyGridConsumption_Wh: this.aggregateTotal(lastState.totalDailyGridConsumption_Wh, grid_consumption_W, lastState.lastUpdate, currentUpdate, true),

        totalToBattery_Wh: this.aggregateTotal(lastState.totalToBattery_Wh, toBattery_W, lastState.lastUpdate, currentUpdate),
        totalFromBattery_Wh: this.aggregateTotal(lastState.totalFromBattery_Wh, fromBattery_W, lastState.lastUpdate, currentUpdate),
        totalProduction_Wh: this.aggregateTotal(lastState.totalProduction_Wh, statusJson.Production_W, lastState.lastUpdate, currentUpdate),
        totalConsumption_Wh: this.aggregateTotal(lastState.totalConsumption_Wh, statusJson.Consumption_W, lastState.lastUpdate, currentUpdate),
        totalGridFeedIn_Wh: this.aggregateTotal(lastState.totalGridFeedIn_Wh, grid_feed_in_W, lastState.lastUpdate, currentUpdate),
        totalGridConsumption_Wh: this.aggregateTotal(lastState.totalGridConsumption_Wh, grid_consumption_W, lastState.lastUpdate, currentUpdate),
      });

      this.log("Emitting data update for other devices...");
      this.homey.emit('sonnenBatterieUpdate', currentState, statusJson, latestDataJson);

      /*
      if (Math.random() < 0.5) {
        throw new Error("random");
      }
      */

      return currentState;
    } catch (e: any) {
      this.error('Error occured fetching data. Retry: ' + retryOnError, e)
      if (retryOnError) {
        // Maybe IP has changed, lets try and fix this...
        await axios
          .get('https://find-my.sonnen-batterie.com/find')
          .then(async (res) => {
            if (res.data) {
              for (const e of res.data) {
                if (this.resolveDeviceNameWithFallback() === e.info) {
                  this.log(`Found device ${e.device} with IP ${e.lanip}`);
                  const currentIP = this.getStoreValue('lanip');
                  if (currentIP !== e.lanip) {
                    this.log(`Device: ${e.device} changed IP from ${currentIP} to ${e.lanip}. Retrying...`);
                    this.setStoreValue('lanip', e.lanip);

                    await this.homey.notifications.createNotification({ excerpt: `Sonnen Batterie: Change of IP address detected. Resolved new IP: ${e.lanip}` });

                    // Try and reload data
                    return await this.loadLatestState(
                      authKey,
                      lastState,
                      false
                    );
                  }
                }
              }
            }
          })
          .catch((err) => this.log('Failed to find sonnen batteries', err));
      }
      return lastState; // always return some valid state 
    }
  }

  private aggregateTotal(totalEnergy_Wh: number, currentPower_W: number, lastUpdate: Date, currentUpdate: Date, resetDaily: boolean = false): number {
      var totalEnergyResult_Wh = resetDaily && currentUpdate.getDay() !== lastUpdate.getDay() ? 0 : (totalEnergy_Wh ?? 0);
      var sampleIntervalMillis = currentUpdate.getTime() - lastUpdate.getTime(); // should be ~30000ms resp. polling frequency
      var sampleEnergy_Wh = (currentPower_W ?? 0) * (sampleIntervalMillis / 60 / 60 / 1000); // Wh
      totalEnergyResult_Wh += sampleEnergy_Wh;
      return totalEnergyResult_Wh;
  }

  private resolveDeviceNameWithFallback(): string {
    var name = this.getName() || 'sonnenBatterie';
    return String(name).charAt(0).toLowerCase() + String(name).slice(1);
  }

}