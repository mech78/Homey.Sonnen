import Homey from 'homey';
import axios from 'axios';
import _ from 'underscore';

class BatteryDevice extends Homey.Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('BatteryDevice has been initialized');


    var batteryBaseUrl   = this.homey.settings.get("BatteryBaseUrl");
    var batteryAuthToken = this.homey.settings.get("BatteryAuthToken");
    var batteryPullInterval = +(this.homey.settings.get("BatteryPullInterval") || '30');

    // Get latest state:
    await this.loadLatestState(batteryBaseUrl, batteryAuthToken);
    
    // Pull battery status 
    await this.homey.setInterval(async () => {
      await this.loadLatestState(batteryBaseUrl, batteryAuthToken);
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

  public async loadLatestState(baseUrl: string, authKey: string) {
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
        // .then((response) => {
        //   var batteryJson = response.data;
        //   //console.log("RESPONSE", batteryJson);
        //   //USOC
        //   this.setCapabilityValue("measure_battery", +batteryJson.USOC);
  
        // })
        // .catch((error) => {
        //   this.log("ERROR", error);
        // })
        // .finally(() => {
        //   // always executed
        // });
        var latestStateJson = response.data;
        this.log("DATA½", latestStateJson);

      
        
      this.setCapabilityValue("measure_battery", +latestStateJson.USOC); // Percentage on battery
      this.setCapabilityValue("production_capability", +latestStateJson.Production_W / 100);
      this.setCapabilityValue("capacity_capability", `${(+latestStateJson.FullChargeCapacity)/1000} kWh` );
      this.setCapabilityValue("feed_grid_capability", -1 * (+latestStateJson.GridFeedIn_W / 1000)); // GridFeedIn_W  : from grid
      this.setCapabilityValue("consumption_capability", +latestStateJson.Consumption_W / 1000); // Consumption_W : consumption
      this.setCapabilityValue("measure_power", +latestStateJson.Consumption_W);
      this.setCapabilityValue("number_battery_capability", +latestStateJson.ic_status.nrbatterymodules);
      this.setCapabilityValue("eclipse_capability", this.ResolveCircleColor(latestStateJson.ic_status["Eclipse Led"]));
      this.setCapabilityValue("state_bms_capability", latestStateJson.ic_status.statebms);
      this.setCapabilityValue("state_inverter_capability", latestStateJson.ic_status.statecorecontrolmodule);
      this.setCapabilityValue("online_capability", !latestStateJson.ic_status["DC Shutdown Reason"].HW_Shutdown);



    } catch (e:any) {
      
      
      this.error("Error occured", e);
    }
    
    
  }
  
  private ResolveCircleColor = (eclipseLed:any) :string => {
    if (eclipseLed["Blinking Red"])
      return "Blinking Red";

      if (eclipseLed["Pulsing Green"])
      return "Pulsing Green";

      if (eclipseLed["Pulsing Orange"])
      return "Pulsing Orange";

      if (eclipseLed["Pulsing White"])
      return "Pulsing White";

      if (eclipseLed["Solid Red"])
      return "Solid Red";

      return "Unknown";
    
  }

}

module.exports = BatteryDevice;
