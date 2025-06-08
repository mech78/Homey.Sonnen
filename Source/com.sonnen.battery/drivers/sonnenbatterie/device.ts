import axios from 'axios';
import _ from 'underscore';
import { SonnenBatterieClient } from '../../service/SonnenBatterieClient';
import { SonnenDevice } from '../../lib/SonnenDevice';
import { SonnenState } from '../../domain/SonnenState';
module.exports = class BatteryDevice extends SonnenDevice {
  private state: SonnenState = new SonnenState({ lastUpdate: this.getLocalNow() });
  private updateIntervalId: NodeJS.Timeout | undefined;

  async onInit() {
    super.onInit();
    
    await this.gracefullyAddOrRemoveCapabilities();
    this.registerResetMetersButton();
    
    var batteryAuthToken = this.homey.settings.get('BatteryAuthToken');
    var batteryPullInterval = +(this.homey.settings.get('BatteryPullInterval') || '30');
    
    // Retrieve stored state
    this.state.updateState(this.homey.settings.get('deviceState') || { lastUpdate: this.getLocalNow() });
    this.state.lastUpdate = new Date(this.state.lastUpdate); // fixes lastUpdate being restored as string, not Date
    this.log('Retrieved stored state: ' + JSON.stringify(this.state, null, 2));

    // Get latest state:
    this.state.updateState(await this.loadLatestState(batteryAuthToken, this.state, this.getStore().autodiscovery ?? true));

    // Pull battery status
    this.updateIntervalId = this.homey.setInterval(async () => {
      this.state.updateState(await this.loadLatestState(batteryAuthToken, this.state, this.getStore().autodiscovery ?? true));
    }, batteryPullInterval * 1000);
  }

  async onDeleted() {
    if (this.updateIntervalId) {
      this.homey.clearInterval(this.updateIntervalId);
    }
    // Store updated state
    this.homey.settings.set('deviceState', this.state);
    super.onDeleted();
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
    
    if (_.contains(changedKeys, "device-ip")){
      var newDeviceIp = newSettings["device-ip"];
      this.log("Settings", "IP", newDeviceIp);
      this.setStoreValue('lanip', newDeviceIp);
    };
  
    if (_.contains(changedKeys, "device-discovery")){
      var blnUseAutoDisovery = newSettings["device-discovery"];
      this.log("Settings", "AutoDiscovery", blnUseAutoDisovery);
      this.setStoreValue('autodiscovery', blnUseAutoDisovery);
    };
  }
  
  async onUninit() {
    // Store updated state
    this.homey.settings.set('deviceState', this.state);
    super.onUninit();
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

  private async gracefullyAddOrRemoveCapabilities() {
    // https://apps.developer.homey.app/guides/how-to-breaking-changes

    // since 1.0.5, so probably up-to-date anyway, if devices were repaired after updating meanwhile.
    // but if not, they would show up with the next update now and then could remove them one release after.
    if (this.hasCapability('from_battery_capability') === false) {
      await this.addCapability('from_battery_capability');
    }
    if (this.hasCapability('to_battery_capability') === false) {
      await this.addCapability('to_battery_capability');
    }

    // added/altered after 1.0.11
    // TODO: how to achieve the same UI ordering as it would happen for fresh devices as ordered in driver.compose.json?
    // Upgrading works, but all new capability icons are appended to the bottom just in the order below.
    if (this.hasCapability('feed_grid_capability') === true) {
      // as renamed to "grid_feed_in_capability" when adding grid_consumption_capability.
      // removing it completely as GridFeedIn_W had problems before 1.0.11 anyway; not worth keeping flows alive.
      await this.removeCapability('feed_grid_capability');
    }
    if (this.hasCapability('consumption_daily_capability') === false) {
      await this.addCapability('consumption_daily_capability');
    }
    if (this.hasCapability('grid_feed_in_capability') === false) {
      await this.addCapability('grid_feed_in_capability');
    }
    if (this.hasCapability('grid_feed_in_daily_capability') === false) {
      await this.addCapability('grid_feed_in_daily_capability');
    }
    if (this.hasCapability('grid_consumption_capability') === false) {
      await this.addCapability('grid_consumption_capability');
    }
    if (this.hasCapability('grid_consumption_daily_capability') === false) {
      await this.addCapability('grid_consumption_daily_capability');
    }
    if (this.hasCapability('button.reset_meter') === false) {
      await this.addCapability('button.reset_meter');
    }
    if (this.hasCapability('self_consumption_capability') === false) {
      await this.addCapability('self_consumption_capability');
    }
    if (this.hasCapability('autarky_capability') === false) {
      await this.addCapability('autarky_capability');
    }

    if (this.hasCapability('battery_charging_state') === false) {
      await this.addCapability('battery_charging_state');
    }
    // add with 1.5
    if (this.hasCapability('production_daily_capability') === false) {
      await this.addCapability('production_daily_capability');
    }
    if (this.hasCapability('meter_power.charged') === false) {
      await this.addCapability('meter_power.charged');
    }
    if (this.hasCapability('meter_power.discharged') === false) {
      await this.addCapability('meter_power.discharged');
    }
    // add with 1.6
    if (this.hasCapability('meter_power') === false) {
      await this.addCapability('meter_power');
    }

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

    try {
      // Act
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

      // update device's batteries to actual number of internal batteries
      var numberBatteries = +latestDataJson.ic_status.nrbatterymodules;
      var actualBatteries = new Array(numberBatteries).fill('INTERNAL');
      var energy = (await this.getEnergy()) || { homeBattery: true, batteries: [] };

      if (!_.isEqual(energy.batteries, actualBatteries)) {
        energy.batteries = actualBatteries;
        this.log("Update batteries (once): ", energy);
        await this.setEnergy(energy);
      }

      var currentUpdate = new Date(latestDataJson.Timestamp);
      this.log('Fetched at ' + currentUpdate.toISOString() + ' compute changes since ' + lastState.lastUpdate.toISOString());
     
      var grid_feed_in_W     = +statusJson.GridFeedIn_W > 0 ? +statusJson.GridFeedIn_W : 0;
      var grid_consumption_W = +statusJson.GridFeedIn_W < 0 ? -1 * statusJson.GridFeedIn_W : 0;
      var toBattery_W =   (statusJson.Pac_total_W ?? 0) < 0 ? -1 * statusJson.Pac_total_W : 0;
      var fromBattery_W = (statusJson.Pac_total_W ?? 0) > 0 ? statusJson.Pac_total_W : 0;
    
      var currentState = new SonnenState({
        lastUpdate: currentUpdate, 
        totalDailyProduction_Wh:      this.aggregateDailyTotal(lastState.totalDailyProduction_Wh,      statusJson.Production_W,  lastState.lastUpdate, currentUpdate),
        totalDailyConsumption_Wh:     this.aggregateDailyTotal(lastState.totalDailyConsumption_Wh,     statusJson.Consumption_W, lastState.lastUpdate, currentUpdate),
        totalProduction_Wh:           this.aggregateDailyTotal(lastState.totalProduction_Wh,           statusJson.Production_W,  lastState.lastUpdate, currentUpdate),
        totalConsumption_Wh:          this.aggregateTotal(lastState.totalConsumption_Wh,               statusJson.Consumption_W, lastState.lastUpdate, currentUpdate),
        totalDailyGridFeedIn_Wh:      this.aggregateDailyTotal(lastState.totalDailyGridFeedIn_Wh,      grid_feed_in_W,           lastState.lastUpdate, currentUpdate),
        totalDailyGridConsumption_Wh: this.aggregateDailyTotal(lastState.totalDailyGridConsumption_Wh, grid_consumption_W,       lastState.lastUpdate, currentUpdate),
        totalGridFeedIn_Wh:           this.aggregateTotal(lastState.totalGridFeedIn_Wh,                grid_feed_in_W,           lastState.lastUpdate, currentUpdate),
        totalGridConsumption_Wh:      this.aggregateTotal(lastState.totalGridConsumption_Wh,           grid_consumption_W,       lastState.lastUpdate, currentUpdate),
        totalToBattery_Wh:            this.aggregateTotal(lastState.totalToBattery_Wh,                 toBattery_W,              lastState.lastUpdate, currentUpdate),
        totalFromBattery_Wh:          this.aggregateTotal(lastState.totalFromBattery_Wh,               fromBattery_W,            lastState.lastUpdate, currentUpdate),
      });

      this.log("Emitting data update for other devices...");
      this.homey.emit('sonnenBatterieUpdate', currentState, statusJson);

      // FIXME: remove non battery-related capabilities as these are now in the other devices
      // e.g. production (to panel device) and consumption (to household device) should disappear, as well as feed-in and feed-out (both to grid device). Autarky and self-consumption would als fit better elsewhere, probably household meter as not to crowded.
      this.setCapabilityValue('measure_battery', +statusJson.USOC); // Percentage on battery
      this.setCapabilityValue('meter_power', +(latestDataJson.FullChargeCapacity / 1000) * (statusJson.USOC/ 100)); 
      this.setCapabilityValue('production_capability', +statusJson.Production_W / 1000);
      this.setCapabilityValue('production_daily_capability', currentState.totalDailyProduction_Wh / 1000);
      this.setCapabilityValue('capacity_capability', +latestDataJson.FullChargeCapacity / 1000);

      this.setCapabilityValue('measure_power', -statusJson.Pac_total_W); // inverted to match the Homey Energy (positive = charging, negative = discharging)

      var chargingState;
      if (statusJson.Pac_total_W < 0) {
        chargingState = 'charging';
      } else if (statusJson.Pac_total_W > 0) {
        chargingState = 'discharging';
      } else {
        chargingState = 'idle';
      }
      this.setCapabilityValue('battery_charging_state', chargingState); 

      if (this.hasCapability('meter_power.charged')) {
        this.setCapabilityValue('meter_power.charged', currentState.totalToBattery_Wh / 1000);
      }
      if (this.hasCapability('meter_power.discharged')) {
        this.setCapabilityValue('meter_power.discharged', currentState.totalFromBattery_Wh / 1000);
      }

      this.setCapabilityValue('to_battery_capability', toBattery_W);
      this.setCapabilityValue('from_battery_capability', fromBattery_W);
      
      this.setCapabilityValue('grid_feed_in_capability', grid_feed_in_W / 1000); // GridFeedIn_W positive: to grid
      this.setCapabilityValue('grid_consumption_capability', grid_consumption_W / 1000); // GridFeedIn_W negative: from grid
      
      this.setCapabilityValue('consumption_capability', +statusJson.Consumption_W / 1000); // Consumption_W : consumption
    
      this.setCapabilityValue('number_battery_capability', numberBatteries);
      this.setCapabilityValue('eclipse_capability', this.resolveCircleColor(latestDataJson.ic_status['Eclipse Led']));
      this.setCapabilityValue('state_bms_capability', this.homey.__('stateBms.' + latestDataJson.ic_status.statebms.replaceAll(' ', ''))) ?? latestDataJson.ic_status.statebms;
      this.setCapabilityValue('state_inverter_capability', this.homey.__('stateInverter.' + latestDataJson.ic_status.statecorecontrolmodule.replaceAll(' ', '')) ?? latestDataJson.ic_status.statecorecontrolmodule);
      this.setCapabilityValue('online_capability', !latestDataJson.ic_status['DC Shutdown Reason'].HW_Shutdown);
      this.setCapabilityValue('alarm_generic', latestDataJson.ic_status['Eclipse Led']['Solid Red']);

      this.setCapabilityValue('consumption_daily_capability', currentState.totalDailyConsumption_Wh / 1000);
      this.setCapabilityValue('grid_feed_in_daily_capability', currentState.totalDailyGridFeedIn_Wh / 1000);
      this.setCapabilityValue('grid_consumption_daily_capability', currentState.totalDailyGridConsumption_Wh / 1000);

      var percentageGridConsumption = (currentState.totalDailyGridConsumption_Wh / currentState.totalDailyConsumption_Wh) * 100;
      var percentageSelfProduction = 100 - percentageGridConsumption;
      this.setCapabilityValue('autarky_capability', +percentageSelfProduction);

      var percentageGridFeedIn = (currentState.totalDailyGridFeedIn_Wh / currentState.totalDailyProduction_Wh) * 100;
      var percentageSelfConsumption = 100 - percentageGridFeedIn;
      this.setCapabilityValue('self_consumption_capability', +percentageSelfConsumption);

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

                    await this.homey.notifications.createNotification({ excerpt: `Sonnen Batterie: Change of IP address detected. Resolved new IP: ${e.lanip}`});

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

  private resolveCircleColor(eclipseLed: any): string {
    for (var key of Object.keys(eclipseLed)) {
      if (eclipseLed[key] === true) {
        return this.homey.__('eclipseLed.' + key.replaceAll(' ', '')) ?? key;
      }
    }
    return this.homey.__('eclipseLed.Unknown');
  }

  private aggregateDailyTotal(totalEnergyDaily_Wh: number, currentPower_W: number, lastUpdate: Date, currentUpdate: Date): number {
    var totalEnergyDailyResult_Wh = currentUpdate.getDay() !== lastUpdate.getDay() ? 0 : (totalEnergyDaily_Wh ?? 0); // reset daily total at local midnight
    var sampleIntervalMillis = currentUpdate.getTime() - lastUpdate.getTime(); // should be ~30000ms resp. polling frequency
    var sampleEnergy_Wh = (currentPower_W ?? 0) * (sampleIntervalMillis / 60 / 60 / 1000); // Wh
    totalEnergyDailyResult_Wh += sampleEnergy_Wh;
    return totalEnergyDailyResult_Wh;
  }

  // TODO: refactor to aggregate with and without
  private aggregateTotal(totalEnergy_Wh: number, currentPower_W: number, lastUpdate: Date, currentUpdate: Date): number {
    var totalEnergyResult_Wh = totalEnergy_Wh ?? 0;
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