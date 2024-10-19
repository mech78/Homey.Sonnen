'use strict';
import axios from 'axios';

module.exports = {
  async getData({ homey, query }) {
    //console.log("DO YOU SEE?");
    
    var baseUrl   = homey.settings.get("BatteryBaseUrl");
    var authToken = homey.settings.get("BatteryAuthToken");
    // Arrange
    var options = {
      method: 'get',
      headers: {
        'Auth-Token': `${authToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };
    
    try {
      var statusResponse = await axios.get(`${baseUrl}/api/v2/status`, options).then();
      var statusJson = statusResponse.data;

      // return {
      //   "production" : 22,
      //   "consumption": 45,
      //   "from_grid"  : 22222,
      //   "percentage" : 15
      // };

      var dataModel = {
        "production" : +statusJson.Production_W  / 1000,
        "consumption": +statusJson.Consumption_W / 1000,
        "from_grid"  : +statusJson.GridFeedIn_W  / 1000,
        "batterie"   : +statusJson.Pac_total_W   / 1000,
        "percentage" : +statusJson.USOC
      };
      
      homey.log("Model", dataModel);
      return dataModel;

    } catch (e) {
      //this.error("Error occured", e);      
      homey.log("Error", "####", e);
      return {
        "production" : 0,
        "consumption": 0,
        "from_grid"  : 0,
        "batterie"   : 0,
        "percentage" : 0
      };
    }
  }
};
