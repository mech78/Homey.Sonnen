'use strict';

module.exports = {
  async getData({ homey }) {
    const drivers = homey.drivers.getDrivers();
    try {
      for (const id in drivers) {
        console.log('driver', id);
        const devices = drivers[id].getDevices();
        const device = devices[0];

        if (device) {
          const state = device.getState();
          return {
            production: state.production_capability,
            consumption: state.consumption_capability,
            from_grid: state.grid_consumption_capability,
            batterie: state.from_battery_capability,
            percentage: state.measure_battery,
          };
        }
      }
    } catch (e) {
      homey.log('Error', '####', e);
      return {
        production: 0,
        consumption: 0,
        from_grid: 0,
        batterie: 0,
        percentage: 0,
      };
    }
  },
};
