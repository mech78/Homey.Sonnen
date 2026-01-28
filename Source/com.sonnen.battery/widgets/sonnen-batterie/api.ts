class WidgetData {
  production?: number;
  consumption?: number;
  from_grid?: number;
  battery?: number;
  percentage?: number;
}

module.exports = {
  async getSonnenbatterieWidgetData({ homey }: { homey: any }): Promise<WidgetData> {
    const drivers = homey.drivers.getDrivers();
    const data: WidgetData = new WidgetData();
    try {
      for (const id in drivers) {
        homey.log('driver', id);
        const devices = drivers[id].getDevices();
        const device = devices[0];

        if (device) {
          const state = device.getState();
          if (id === 'sonnenbatterie') {
            data.percentage = state.measure_battery;
            data.battery = state.from_battery_capability;
          }
          if (id === 'sonnenbatterie_gridmeter') {
            data.from_grid = state.grid_consumption_current_capability;
          }
          if (id === 'sonnenbatterie_householdmeter') {
            data.consumption = state.consumption_current_capability;
          }
          if (id === 'sonnenbatterie_solarpanel') {
            data.production = state.production_current_capability;
          }
        }
      }
      return data;
    } catch (e) {
      homey.log('Error', '####', e);
      return data;
    }
  },
};
