import Homey from 'homey';
import axios from 'axios';
import _ from 'underscore';

class BatteryDevice extends Homey.Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('BatteryDevice has been initialized');


    var batteryBaseUrl = this.homey.settings.get("BatteryBaseUrl");
    var batteryAuthToken = this.homey.settings.get("BatteryAuthToken");
    var batteryPullInterval = +(this.homey.settings.get("BatteryPullInterval") || '30');

  
    // Homey SDK3's new Date() is always in UTC but SonnenBatterie timestamps are local, so match with Homey's local timezone
    var timezone = this.homey.clock.getTimezone();
    var lastUpdateLocal = new Date(new Date().toLocaleString('en-US', { hour12: false, timeZone: timezone})); 
  
    // Get latest state:
    lastUpdateLocal = await this.loadLatestState(batteryBaseUrl, batteryAuthToken, lastUpdateLocal);
    
    // Pull battery status 
    await this.homey.setInterval(async () => {
      lastUpdateLocal = await this.loadLatestState(batteryBaseUrl, batteryAuthToken, lastUpdateLocal);
    }, batteryPullInterval * 1000 /* pull quarter hour */);

    this.registerResetMetersButton();
    await this.gracefullyAddOrRemoveCapabilities();
  }

  private registerResetMetersButton() {
    this.registerCapabilityListener('button.reset_meter', async () => {
      this.setCapabilityValue("meter_power", +0);
      this.setCapabilityValue("consumption_daily_capability", +0);
      this.setCapabilityValue("grid_feed_in_daily_capability", +0);
      this.setCapabilityValue("grid_consumption_daily_capability", +0);
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
    if (this.hasCapability('consumption_daily_capability') === false) {
      await this.addCapability('consumption_daily_capability');
    }
    if (this.hasCapability('grid_feed_in_daily_capability') === false) {
      await this.addCapability('grid_feed_in_daily_capability');
    }
    if (this.hasCapability('grid_consumption_daily_capability') === false) {
      await this.addCapability('grid_consumption_daily_capability');
    }
    if (this.hasCapability('grid_feed_capability')) {
      // as renamed to "grid_feed_in_capability" when adding grid_consumption_capability.
      // removing it completely as GridFeedIn_W had problems before 1.0.11 anyway; not worth keeping flows alive.
      await this.removeCapability('grid_feed_capability'); 
    }
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
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
    this.log("BatteryDevice settings where changed");
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

  public async loadLatestState(baseUrl: string, authKey: string, lastUpdateLocal: Date) : Promise<Date> {
    // Arrange
    var options = {
      method: 'get',
      headers: {
        'Auth-Token': `${authKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    try {
      // Act
      var response = await axios.get(`${baseUrl}/api/v2/latestdata`, options).then();

      var statusResponse = await axios.get(`${baseUrl}/api/v2/status`, options).then();

      var latestStateJson = response.data;
      var statusJson = statusResponse.data;

      var [totalDailyProduction_kWh, currentUpdateLocal] = this.aggregateDailyTotal(+this.getCapabilityValue("meter_power") ?? 0, statusJson.Production_W, lastUpdateLocal, new Date(latestStateJson.Timestamp)); 
      
      var [totalDailyConsumption_kWh, currentUpdateLocal] = this.aggregateDailyTotal(+this.getCapabilityValue("consumption_daily_capability") ?? 0, statusJson.Consumption_W, lastUpdateLocal, new Date(latestStateJson.Timestamp)); 
      
      var grid_feed_in = (+statusJson.GridFeedIn_W > 0) ? (+statusJson.GridFeedIn_W / 1000) : 0;
      var [totalDailyGridFeedIn_kWh, currentUpdateLocal] = this.aggregateDailyTotal(+this.getCapabilityValue("grid_feed_in_daily_capability") ?? 0, grid_feed_in, lastUpdateLocal, new Date(latestStateJson.Timestamp)); 
      
      var grid_consumption = (+statusJson.GridFeedIn_W < 0) ? -1 * (+statusJson.GridFeedIn_W / 1000) : 0;
      var [totalDailyGridConsumption_kWh, currentUpdateLocal] = this.aggregateDailyTotal(+this.getCapabilityValue("grid_consumption_daily_capability") ?? 0, grid_consumption, lastUpdateLocal, new Date(latestStateJson.Timestamp)); 

      this.setCapabilityValue("meter_power", +totalDailyProduction_kWh);
      this.setCapabilityValue("measure_battery", +statusJson.USOC); // Percentage on battery
      this.setCapabilityValue("production_capability", +statusJson.Production_W / 1000);
      this.setCapabilityValue("capacity_capability", `${(+latestStateJson.FullChargeCapacity) / 1000} kWh`);
      this.setCapabilityValue("grid_feed_in_capability", grid_feed_in); // GridFeedIn_W positive: to grid
      this.setCapabilityValue("grid_consumption_capability", grid_consumption); // GridFeedIn_W negative: from grid
      this.setCapabilityValue("consumption_capability", +statusJson.Consumption_W / 1000); // Consumption_W : consumption
      this.setCapabilityValue("measure_power", +statusJson.Consumption_W);
      this.setCapabilityValue("number_battery_capability", +latestStateJson.ic_status.nrbatterymodules);
      this.setCapabilityValue("eclipse_capability", this.ResolveCircleColor(latestStateJson.ic_status["Eclipse Led"]));
      this.setCapabilityValue("state_bms_capability", this.homey.__("stateBms." + latestStateJson.ic_status.statebms.replaceAll(' ', ''))) ?? latestStateJson.ic_status.statebms;
      this.setCapabilityValue("state_inverter_capability", this.homey.__("stateInverter." + latestStateJson.ic_status.statecorecontrolmodule.replaceAll(' ', '')) ?? latestStateJson.ic_status.statecorecontrolmodule);
      this.setCapabilityValue("online_capability", !latestStateJson.ic_status["DC Shutdown Reason"].HW_Shutdown);
      this.setCapabilityValue("alarm_generic", (latestStateJson.ic_status["Eclipse Led"])["Solid Red"]);

      this.setCapabilityValue("from_battery_capability", (statusJson.Pac_total_W ?? 0) > 0 ? statusJson.Pac_total_W : 0);
      this.setCapabilityValue("to_battery_capability", (statusJson.Pac_total_W ?? 0) < 0 ? -1 * statusJson.Pac_total_W : 0);
      this.setCapabilityValue("consumption_daily_capability", totalDailyConsumption_kWh);
      this.setCapabilityValue("grid_feed_in_daily_capability", totalDailyGridFeedIn_kWh);
      this.setCapabilityValue("grid_consumption_daily_capability", totalDailyGridConsumption_kWh);

      return currentUpdateLocal;
    } catch (e: any) {
      this.error("Error occured", e);
      return lastUpdateLocal;
    }
    
  }

  private ResolveCircleColor = (eclipseLed: any): string => {
    for (var key of Object.keys(eclipseLed)) {
      if (eclipseLed[key] === true) {
        return this.homey.__("eclipseLed." + key.replaceAll(' ', '')) ?? key;
      }
    }
    return this.homey.__("eclipseLed.Unknown");
  }

  private aggregateDailyTotal(totalEnergyDaily_kWh: number, power_W: number, lastUpdateLocal: Date, timestampLocal: Date): [number, Date] {   
    var totalEnergyDailyResult_kWh = (timestampLocal.getDay() !== lastUpdateLocal.getDay()) ? 0 : totalEnergyDaily_kWh;  // reset daily total at local midnight   
    var sampleIntervalMillis = (timestampLocal.getTime() - lastUpdateLocal.getTime()); // should be ~30000ms resp. polling frequency
    var sampleEnergy_kWh = (power_W / 1000) * (sampleIntervalMillis / 60 / 60 / 1000); // kWh
    totalEnergyDailyResult_kWh += sampleEnergy_kWh;
    //this.log("last: " + lastUpdateLocal + ", now: "+ timestampLocal + ": " + sampleEnergy_kWh + "kWh during: " + sampleIntervalMillis +"ms, total: " + totalEnergyDailyResult_kWh + "kWh");
    return [totalEnergyDailyResult_kWh, timestampLocal];
  }
}

module.exports = BatteryDevice;
