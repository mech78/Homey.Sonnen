'use strict';

module.exports = {
  async getData({ homey }) {
    const drivers = homey.drivers.getDrivers();
    try {
      const data = {};
      for (const id in drivers) {
        console.log('driver', id);
        const devices = drivers[id].getDevices();
        const device = devices[0];

        if (device) {
          const state = device.getState();
          if (id === 'sonnenbatterie') {
            data['percentage'] = state.measure_battery;
            data['batterie'] = state.from_battery_capability;
          }
          if (id === 'sonnenbatterie_gridmeter') {
            data['from_grid'] = state.grid_consumption_current_capability;
          }
          if (id === 'sonnenbatterie_householdmeter') {
            data['consumption'] = state.consumption_current_capability;
          }       
          if (id === 'sonnenbatterie_solarpanel') {
            data['production'] = state.production_current_capability;
          }
        }
      }
      return data;
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
