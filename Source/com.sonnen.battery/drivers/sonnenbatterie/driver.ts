import Homey from 'homey';
import axios from 'axios';
import _ from 'underscore';

class SonnenBatterieDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
  */
 async onInit() {
   this.log('SonnenBatterieDriver has been initialized');
   
   const setToC_card   = this.homey.flow.getActionCard("set-time-of-use");
   const setToCHours_card   = this.homey.flow.getActionCard("set-time-of-use-hours");
   const resetToC_card = this.homey.flow.getActionCard("reset-time-of-use");
   const pauseToC_card = this.homey.flow.getActionCard("pause-time-of-use");
   const zeroPad = (num:any, places:any) => String(num).padStart(places, '0');
   
    
    var batteryBaseUrl   = this.homey.settings.get("BatteryBaseUrl");
    var batteryAuthToken = this.homey.settings.get("BatteryAuthToken");


    setToC_card.registerRunListener(async (args) => {
      var timeStart = args.Start;
      var timeEnd   = args.End;
      var maxPower  = args.MaxPower;
      
      this.log("args", timeStart, timeEnd, maxPower);

      var options = {
        method: 'put',
        headers: {
          'Auth-Token': `${batteryAuthToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      };

      var body = {
        "EM_ToU_Schedule": `[{\"start\":\"${timeStart}\",\"stop\":\"${timeEnd}\",\"threshold_p_max\":${maxPower}}]`
      }
  
      this.log("SCHEDULE", body);

      // Act
      axios.put(`${batteryBaseUrl}/api/v2/configurations`, body, options)
        .then((response) => {
          var batteryJson = response.data;
          console.log("RESPONSE", batteryJson);
          
        })
        .catch((error) => {
          console.log("ERROR", error);
        })
        .finally(() => {
          // always executed
        });
      


    });

    setToCHours_card.registerRunListener(async (args) => {
      var timeStart = args.Start;
      var hours     = args.Hours;
      var maxPower  = args.MaxPower;

      // Calculate end from timeStart and hours.
      var timeStartHours    = +timeStart.split(":", 1)[0];
      var timeStartMinutes  =  timeStart.split(":", 2)[1];
      var timeEndHours = (timeStartHours + hours)%24; // Handle overflow.
      var timeEndHoursFormatted = zeroPad(timeEndHours, 2);

      var timeEnd = `${timeEndHoursFormatted}:${timeStartMinutes}`;

      this.log("args", timeStart, hours, maxPower, timeEndHoursFormatted, "calculated endtime", timeEnd);

      var options = {
        method: 'put',
        headers: {
          'Auth-Token': `${batteryAuthToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      };

      var body = {
        "EM_ToU_Schedule": `[{\"start\":\"${timeStart}\",\"stop\":\"${timeEnd}\",\"threshold_p_max\":${maxPower}}]`
      }

      this.log("SCHEDULE", body);
  
      // Act
      axios.put(`${batteryBaseUrl}/api/v2/configurations`, body, options)
        .then((response) => {
          var batteryJson = response.data;
          console.log("RESPONSE", batteryJson);
          
        })
        .catch((error) => {
          console.log("ERROR", error);
        })
        .finally(() => {
          // always executed
        });
      


    });

    resetToC_card.registerRunListener(async () => {
      var options = {
        method: 'put',
        headers: {
          'Auth-Token': `${batteryAuthToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      };

      var body = {
        "EM_ToU_Schedule": `[]`
      }

      this.log("SCHEDULE", body);
  
      // Act
      axios.put(`${batteryBaseUrl}/api/v2/configurations`, body, options)
        .then((response) => {
          var batteryJson = response.data;
          console.log("RESPONSE", batteryJson);
          
        })
        .catch((error) => {
          console.log("ERROR", error);
        })
        .finally(() => {
          // always executed
        });


    });

    pauseToC_card.registerRunListener(async (args) => {
      var timeStart = args.Start;
      var timeEnd   = args.End;
      
      this.log("args", timeStart, timeEnd);

      var options = {
        method: 'put',
        headers: {
          'Auth-Token': `${batteryAuthToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      };

      var body = {
        "EM_ToU_Schedule": `[{\"start\":\"${timeStart}\",\"stop\":\"${timeEnd}\",\"threshold_p_max\":0}]`
      }
  
      this.log("SCHEDULE", body);

      // Act
      axios.put(`${batteryBaseUrl}/api/v2/configurations`, body, options)
        .then((response) => {
          var batteryJson = response.data;
          console.log("RESPONSE", batteryJson);
          
        })
        .catch((error) => {
          console.log("ERROR", error);
        })
        .finally(() => {
          // always executed
        });
      


    });

    
  }

  /**
   * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    return [      
      {
        "name": 'SonnenBatterie',
        "data": {
          "id": 'sonnenBatterie',
        }
      }
    ];
  }

}

module.exports = SonnenBatterieDriver;
