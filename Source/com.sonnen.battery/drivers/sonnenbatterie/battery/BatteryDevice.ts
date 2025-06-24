import _ from 'underscore';
import { SonnenDevice } from '../../../lib/SonnenDevice';
module.exports = class BatteryDevice extends SonnenDevice {

  private readonly handleUpdateEvent = (currentState: any, statusJson: any, latestDataJson: any): void => {
    this.log("Received currentState: " + JSON.stringify(currentState, null, 2));
    this.log("Received statusJson:   " + JSON.stringify(statusJson, null, 2));
    this.log("Received dataJson:     " + JSON.stringify(latestDataJson, null, 2));

    // update device's batteries to actual number of internal batteries
    var numberBatteries = +latestDataJson.ic_status.nrbatterymodules;
    var actualBatteries = new Array(numberBatteries).fill('INTERNAL');
    var energy = (this.getEnergy()) || {
      homeBattery: true,
      batteries: [],
      "meterPowerImportedCapability": "meter_power.charged",
      "meterPowerExportedCapability": "meter_power.discharged"
    };

    if (!_.isEqual(energy.batteries, actualBatteries)) {
      energy.batteries = actualBatteries;
      this.log("Update batteries (once): ", energy);
      this.setEnergy(energy);
    }

    var toBattery_W = (statusJson.Pac_total_W ?? 0) < 0 ? -1 * statusJson.Pac_total_W : 0;
    var fromBattery_W = (statusJson.Pac_total_W ?? 0) > 0 ? statusJson.Pac_total_W : 0;

    this.setCapabilityValue('measure_battery', +statusJson.USOC); // Percentage on battery
    this.setCapabilityValue('measure_power', -statusJson.Pac_total_W); // inverted to match the Homey Energy (positive = charging, negative = discharging)
    if (this.isEnergyFullySupported()) {
      this.setCapabilityValue('meter_power.charged', currentState.totalToBattery_Wh / 1000);
      this.setCapabilityValue('meter_power.discharged', currentState.totalFromBattery_Wh / 1000);
    }

    this.setCapabilityValue('to_battery_capability', toBattery_W);
    this.setCapabilityValue('from_battery_capability', fromBattery_W);
    this.setCapabilityValue('to_battery_daily_capability', currentState.totalDailyToBattery_Wh / 1000);
    this.setCapabilityValue('from_battery_daily_capability', currentState.totalDailyFromBattery_Wh / 1000);
    this.setCapabilityValue('to_battery_total_capability', currentState.totalToBattery_Wh / 1000);
    this.setCapabilityValue('from_battery_total_capability', currentState.totalFromBattery_Wh / 1000);

    var remaining_energy_Wh = +latestDataJson.FullChargeCapacity * (statusJson.USOC / 100);
    this.setCapabilityValue('capacity_remaining_capability', remaining_energy_Wh / 1000);
    this.setCapabilityValue('capacity_capability', +latestDataJson.FullChargeCapacity / 1000);

    var chargingState;
    if (statusJson.Pac_total_W < 0) {
      chargingState = 'charging';
    } else if (statusJson.Pac_total_W > 0) {
      chargingState = 'discharging';
    } else {
      chargingState = 'idle';
    }
    this.setCapabilityValue('battery_charging_state', chargingState);

    this.setCapabilityValue('number_battery_capability', numberBatteries);
    this.setCapabilityValue('eclipse_capability', this.resolveCircleColor(latestDataJson.ic_status['Eclipse Led']));
    this.setCapabilityValue('state_bms_capability', this.homey.__('stateBms.' + latestDataJson.ic_status.statebms.replaceAll(' ', ''))) ?? latestDataJson.ic_status.statebms;
    this.setCapabilityValue('state_inverter_capability', this.homey.__('stateInverter.' + latestDataJson.ic_status.statecorecontrolmodule.replaceAll(' ', '')) ?? latestDataJson.ic_status.statecorecontrolmodule);
    this.setCapabilityValue('online_capability', !latestDataJson.ic_status['DC Shutdown Reason'].HW_Shutdown);
    this.setCapabilityValue('alarm_generic', latestDataJson.ic_status['Eclipse Led']['Solid Red']);

  }

  async onInit() {
    this.homey.on('sonnenBatterieUpdate', this.handleUpdateEvent);
    await this.gracefullyAddOrRemoveCapabilities();
    super.onInit();
  }

  async onDeleted() {
    this.homey.removeListener('sonnenBatterieUpdate', this.handleUpdateEvent);
    super.onDeleted();
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

  private async gracefullyAddOrRemoveCapabilities() {
    // https://apps.developer.homey.app/guides/how-to-breaking-changes

    // Baseline version 1.3.1
    var toAddAfter1_3_1 = [    
      'to_battery_capability',
      'from_battery_capability',
      'to_battery_daily_capability',
      'from_battery_daily_capability',
      'to_battery_total_capability',
      'from_battery_total_capability',
      'capacity_remaining_capability'
    ];

    if (this.isEnergyFullySupported()) {
      toAddAfter1_3_1 = [
        ...toAddAfter1_3_1,
        'meter_power.charged',
        'meter_power.discharged'
      ];
    }

    var toRemoveAfter1_3_1 = [
      'meter_power',
      'production_capability',
      'consumption_capability',
      'consumption_daily_capability',
      'grid_feed_in_capability',
      'grid_feed_in_daily_capability',
      'grid_consumption_capability',
      'grid_consumption_daily_capability',
      'autarky_capability',
      'self_consumption_capability'
    ];

    if (!this.isEnergyFullySupported()) {
      toRemoveAfter1_3_1 = [
        ...toRemoveAfter1_3_1,
        'meter_power.charged',
        'meter_power.discharged'
      ];
    }

    for (const capability of toAddAfter1_3_1) {
      if (!this.hasCapability(capability)) {
        await this.addCapability(capability);
      }
    }

    for (const capability of toRemoveAfter1_3_1) {
      if (this.hasCapability(capability)) {
        await this.removeCapability(capability);
      }
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

}