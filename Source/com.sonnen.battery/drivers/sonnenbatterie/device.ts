import Homey from 'homey';
import axios from 'axios';
import _ from 'underscore';
import { SonnenBatterieClient } from '../../Service/SonnenBatterieClient';

class BatteryDevice extends Homey.Device {
  state: any;

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('BatteryDevice has been initialized');

    
    //await this.setEnergy({ homeBattery: true });
    this.log("Setting up", this.getEnergy());

    await this.gracefullyAddOrRemoveCapabilities();
    this.registerResetMetersButton();

    var batteryAuthToken = this.homey.settings.get('BatteryAuthToken');
    var batteryPullInterval = +(
      this.homey.settings.get('BatteryPullInterval') || '30'
    );

    // re-initialize from capability values
    this.state = {
      lastUpdate: this.getLocalNow(),
      totalProduction_Wh: +this.getCapabilityValue('meter_power') * 1000,
      totalConsumption_Wh:
        +this.getCapabilityValue('consumption_daily_capability') * 1000,
      totalGridFeedIn_Wh:
        +this.getCapabilityValue('grid_feed_in_daily_capability') * 1000,
      totalGridConsumption_Wh:
        +this.getCapabilityValue('grid_consumption_daily_capability') * 1000,
    };

    // Get latest state:
    this.state = await this.loadLatestState(
      batteryAuthToken,
      this.state,
      this.getStore().autodiscovery ?? true
    );

    // Pull battery status
    this.homey.setInterval(async () => {
      this.state = await this.loadLatestState(
        batteryAuthToken,
        this.state,
        this.getStore().autodiscovery ?? true
      );
    }, batteryPullInterval * 1000);
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
      this.setCapabilityValue('meter_power', +0);
      this.setCapabilityValue('consumption_daily_capability', +0);
      this.setCapabilityValue('grid_feed_in_daily_capability', +0);
      this.setCapabilityValue('grid_consumption_daily_capability', +0);
      this.setCapabilityValue('self_consumption_capability', +0);
      this.setCapabilityValue('autarky_capability', +0);
      this.state = {
        lastUpdate: this.getLocalNow(),
        totalProduction_Wh: 0,
        totalConsumption_Wh: 0,
        totalGridFeedIn_Wh: 0,
        totalGridConsumption_Wh: 0,
      };
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

    // v1.4.0
    this.log("Homey version:", this.homey.version); // software version won't help
    this.log("Homey plattform: ", this.homey.platformVersion); // Homey 2019 = 1...
    
    //"cumulativeImportedCapability": "meter_power.imported",
    //"cumulativeExportedCapability": "meter_power.exported"

   // "meter_power.imported": {
   //   "uiComponent": null
   // },
   // "meter_power.exported": {
   //   "uiComponent": null
   // }

   // Homey Pro (early 2019) emits this, so need to dynamically apply the energy settings
   // Warning: drivers.sonnenbatterie has energy.cumulative set to true, but is missing 'cumulativeImportedCapability'. Disregard this warning if the driver does not have `meter_power` capabilities.
   // Warning: drivers.sonnenbatterie has energy.cumulative set to true, but is missing 'cumulativeExportedCapability'. Disregard this warning if the driver does not have `meter_power` capabilities.


    if (this.hasCapability('meter_power.imported') === false) {
      await this.addCapability('meter_power.imported');
    
    }
    await this.setCapabilityOptions("meter_power.imported", { "uiComponent": null });
    if (this.hasCapability('meter_power.exported') === false) {
      await this.addCapability('meter_power.exported');
      
    }
    await this.setCapabilityOptions("meter_power.exported", { "uiComponent": null });
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('BatteryDevice has been added');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null; };
    newSettings: { [key: string]: boolean | string | number | undefined | null; };
    changedKeys: string[];
  }): Promise<string | void> {
    this.log('BatteryDevice settings where changed');

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

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    this.log('BatteryDevice was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log('BatteryDevice has been deleted');
  }

  private async loadLatestState(
    authKey: string,
    lastState: any,
    retryOnError = true
  ): Promise<any> {
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

      this.log('INVOKE', 'loadLatestState', `${baseUrl}/api/v2/latestdata`);

      var response = await axios
        .get(`${baseUrl}/api/v2/latestdata`, options)
        .then();

      var statusResponse = await axios
        .get(`${baseUrl}/api/v2/status`, options)
        .then();

      var latestStateJson = response.data;
      var statusJson = statusResponse.data;

      // update device's batteries to actual number of internal batteries
      var numberBatteries = +latestStateJson.ic_status.nrbatterymodules;
      var actualBatteries = new Array(numberBatteries).fill('INTERNAL');
      var energy = (await this.getEnergy()) || { homeBattery: true, batteries: [] };

      if (!_.isEqual(energy.batteries, actualBatteries)) {
        energy.batteries = actualBatteries;
        this.log("Energy", "SetEnergy", energy);
        await this.setEnergy(energy);
      }

      var currentUpdate = new Date(latestStateJson.Timestamp);
      var grid_feed_in_W =
        +statusJson.GridFeedIn_W > 0 ? +statusJson.GridFeedIn_W : 0;
      var grid_consumption_W =
        +statusJson.GridFeedIn_W < 0 ? -1 * statusJson.GridFeedIn_W : 0;

      var currentState = {
        lastUpdate: currentUpdate,
        totalProduction_Wh: this.aggregateDailyTotal(
          lastState.totalProduction_Wh,
          statusJson.Production_W,
          lastState.lastUpdate,
          currentUpdate
        ),
        totalConsumption_Wh: this.aggregateDailyTotal(
          lastState.totalConsumption_Wh,
          statusJson.Consumption_W,
          lastState.lastUpdate,
          currentUpdate
        ),
        totalGridFeedIn_Wh: this.aggregateDailyTotal(
          lastState.totalGridFeedIn_Wh,
          grid_feed_in_W,
          lastState.lastUpdate,
          currentUpdate
        ),
        totalGridConsumption_Wh: this.aggregateDailyTotal(
          lastState.totalGridConsumption_Wh,
          grid_consumption_W,
          lastState.lastUpdate,
          currentUpdate
        ),
      };

      this.setCapabilityValue(
        'meter_power',
        +currentState.totalProduction_Wh / 1000
      ); // kWh
      this.setCapabilityValue('measure_battery', +statusJson.USOC); // Percentage on battery
      this.setCapabilityValue(
        'production_capability',
        +statusJson.Production_W / 1000
      );
      this.setCapabilityValue(
        'capacity_capability',
        `${+latestStateJson.FullChargeCapacity / 1000} kWh`
      );

      // meter: Wh, measure: W - default units would be kWh in the UI
      // but disabled both as using grid_feed_in_daily_capability and grid_consumption_daily_capability already.
      this.setCapabilityValue('meter_power.exported', currentState.totalGridFeedIn_Wh / 1000);
      this.setCapabilityValue('meter_power.imported', currentState.totalGridConsumption_Wh /1000);

      this.setCapabilityValue('grid_feed_in_capability', grid_feed_in_W / 1000); // GridFeedIn_W positive: to grid
      this.setCapabilityValue('grid_consumption_capability', grid_consumption_W / 1000); // GridFeedIn_W negative: from grid
      this.setCapabilityValue(
        'consumption_capability',
        +statusJson.Consumption_W / 1000
      ); // Consumption_W : consumption
      this.setCapabilityValue('measure_power', +statusJson.Consumption_W);
      this.setCapabilityValue('number_battery_capability', numberBatteries);
      this.setCapabilityValue(
        'eclipse_capability',
        this.resolveCircleColor(latestStateJson.ic_status['Eclipse Led'])
      );
      this.setCapabilityValue(
        'state_bms_capability',
        this.homey.__(
          'stateBms.' + latestStateJson.ic_status.statebms.replaceAll(' ', '')
        )
      ) ?? latestStateJson.ic_status.statebms;
      this.setCapabilityValue(
        'state_inverter_capability',
        this.homey.__(
          'stateInverter.' +
            latestStateJson.ic_status.statecorecontrolmodule.replaceAll(' ', '')
        ) ?? latestStateJson.ic_status.statecorecontrolmodule
      );
      this.setCapabilityValue(
        'online_capability',
        !latestStateJson.ic_status['DC Shutdown Reason'].HW_Shutdown
      );
      this.setCapabilityValue(
        'alarm_generic',
        latestStateJson.ic_status['Eclipse Led']['Solid Red']
      );

      this.setCapabilityValue(
        'from_battery_capability',
        (statusJson.Pac_total_W ?? 0) > 0 ? statusJson.Pac_total_W : 0
      );
      this.setCapabilityValue(
        'to_battery_capability',
        (statusJson.Pac_total_W ?? 0) < 0 ? -1 * statusJson.Pac_total_W : 0
      );
      this.setCapabilityValue(
        'consumption_daily_capability',
        currentState.totalConsumption_Wh / 1000
      );
      this.setCapabilityValue(
        'grid_feed_in_daily_capability',
        currentState.totalGridFeedIn_Wh / 1000
      );
      this.setCapabilityValue(
        'grid_consumption_daily_capability',
        currentState.totalGridConsumption_Wh / 1000
      );

      var percentageGridConsumption =
        (currentState.totalGridConsumption_Wh /
          currentState.totalConsumption_Wh) *
        100;
      var percentageSelfProduction = 100 - percentageGridConsumption;
      this.setCapabilityValue('autarky_capability', +percentageSelfProduction);

      var percentageGridFeedIn =
        (currentState.totalGridFeedIn_Wh / currentState.totalProduction_Wh) *
        100;
      var percentageSelfConsumption = 100 - percentageGridFeedIn;
      this.setCapabilityValue(
        'self_consumption_capability',
        +percentageSelfConsumption
      );

      /*
      if (Math.random() < 0.5) {
        throw new Error("random");
      }
      */

      return currentState;
    } catch (e: any) {
      this.error('Error occured', e)
      this.log('INVOKE', 'loadLatestState', 'ERROR CATCH', retryOnError);
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

  private aggregateDailyTotal(
    totalEnergyDaily_Wh: number,
    currentPower_W: number,
    lastUpdate: Date,
    currentUpdate: Date
  ): number {
    var totalEnergyDailyResult_Wh =
      currentUpdate.getDay() !== lastUpdate.getDay() ? 0 : totalEnergyDaily_Wh; // reset daily total at local midnight
    var sampleIntervalMillis = currentUpdate.getTime() - lastUpdate.getTime(); // should be ~30000ms resp. polling frequency
    var sampleEnergy_Wh =
      currentPower_W * (sampleIntervalMillis / 60 / 60 / 1000); // Wh
    totalEnergyDailyResult_Wh += sampleEnergy_Wh;
    return totalEnergyDailyResult_Wh;
  }

  private resolveDeviceNameWithFallback(): string {
    var name = this.getName() || 'sonnenBatterie';
    return String(name).charAt(0).toLowerCase() + String(name).slice(1);
  }

}

module.exports = BatteryDevice;
