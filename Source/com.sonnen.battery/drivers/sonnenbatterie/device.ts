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

    var lastUpdateUtc = new Date(); // UTC

    // Get latest state:
    lastUpdateUtc = await this.loadLatestState(batteryBaseUrl, batteryAuthToken, lastUpdateUtc);
    
    // Pull battery status 
    await this.homey.setInterval(async () => {
      lastUpdateUtc = await this.loadLatestState(batteryBaseUrl, batteryAuthToken, lastUpdateUtc);
    }, batteryPullInterval * 1000 /* pull quarter hour */);

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

  public async loadLatestState(baseUrl: string, authKey: string, lastUpdateUtc: Date) : Promise<Date> {
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

<<<<<<< HEAD
      var statusResponse = await axios.get(`${baseUrl}/api/v2/status`, options).then();

      var latestStateJson = response.data;
      var statusJson = statusResponse.data;

=======
>>>>>>> a80e6c6bf74359a5802e8f4ae0511d015acbb380
      var [totalDailyProduction_kWh, currentUpdateUtc] = this.aggregateDailyTotal(+this.getCapabilityValue("meter_power") ?? 0, latestStateJson.Production_W, lastUpdateUtc, latestStateJson.Timestamp, latestStateJson.UTC_Offet); 

      this.setCapabilityValue("meter_power", +totalDailyProduction_kWh);
      this.setCapabilityValue("measure_battery", +latestStateJson.USOC); // Percentage on battery
      this.setCapabilityValue("production_capability", +latestStateJson.Production_W / 1000);
      this.setCapabilityValue("capacity_capability", `${(+latestStateJson.FullChargeCapacity) / 1000} kWh`);
      this.setCapabilityValue("feed_grid_capability", -1 * (+statusJson.GridFeedIn_W / 1000)); // GridFeedIn_W  : from grid
      this.setCapabilityValue("consumption_capability", +latestStateJson.Consumption_W / 1000); // Consumption_W : consumption
      this.setCapabilityValue("measure_power", +latestStateJson.Consumption_W);
      this.setCapabilityValue("number_battery_capability", +latestStateJson.ic_status.nrbatterymodules);
      this.setCapabilityValue("eclipse_capability", this.ResolveCircleColor(latestStateJson.ic_status["Eclipse Led"]));
      this.setCapabilityValue("state_bms_capability", this.homey.__("stateBms." + latestStateJson.ic_status.statebms.replaceAll(' ', ''))) ?? latestStateJson.ic_status.statebms;
      this.setCapabilityValue("state_inverter_capability", this.homey.__("stateInverter." + latestStateJson.ic_status.statecorecontrolmodule.replaceAll(' ', '')) ?? latestStateJson.ic_status.statecorecontrolmodule);
      this.setCapabilityValue("online_capability", !latestStateJson.ic_status["DC Shutdown Reason"].HW_Shutdown);
      this.setCapabilityValue("alarm_generic", (latestStateJson.ic_status["Eclipse Led"])["Solid Red"]);

      try {
        this.setCapabilityValue("from_battery_capability", (latestStateJson.Pac_total_W ?? 0) > 0 ? latestStateJson.Pac_total_W : 0);
        this.setCapabilityValue("to_battery_capability", (latestStateJson.Pac_total_W ?? 0) < 0 ? -1 * latestStateJson.Pac_total_W : 0);
      } catch (error) {
        await this.homey.notifications.createNotification({ excerpt: `Warning: New capabilities not supported. Replace remove and add SonnenBatterie to support new capabilities..` });
      }

      return currentUpdateUtc;
<<<<<<< HEAD
    } catch (e: any) {
=======
    } catch (e:any) {
>>>>>>> a80e6c6bf74359a5802e8f4ae0511d015acbb380
      this.error("Error occured", e);
      return lastUpdateUtc;
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

  private aggregateDailyTotal(totalEnergyDaily_kWh: number, power_W: number, lastUpdateUtc: Date, timestampLocal: Date, utcOffset: number): [number, Date] {
    var currentUpdateUtc = new Date(new Date(timestampLocal).getTime() - utcOffset * 60 * 60 * 1000); // to UTC
    
    var totalEnergyDailyResult_kWh = (currentUpdateUtc.getUTCDay() !== lastUpdateUtc.getUTCDay()) ? 0 : totalEnergyDaily_kWh;  // reset daily total around midnight   
    var sampleIntervalMillis = (currentUpdateUtc.getTime() - lastUpdateUtc.getTime()); // should be ~30000ms resp. polling frequency
    var sampleEnergy_kWh = (power_W / 1000) * (sampleIntervalMillis / 60 / 60 / 1000); // kWh
    totalEnergyDailyResult_kWh += sampleEnergy_kWh;
    return [totalEnergyDailyResult_kWh, currentUpdateUtc];
  }
}

module.exports = BatteryDevice;
