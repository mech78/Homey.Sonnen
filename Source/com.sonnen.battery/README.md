# Sonnen

Adds support for Sonnen Batterie - Time of Use (ToU), Prognosis Charging and much more

## Homey Energy: target_power / target_power_mode (Homey >= 12.13.0)

The battery device supports Homey's standardized energy control capabilities. They
are **hidden from the device UI** on purpose (the first tab would otherwise expose a
raw power slider to every user); control happens via Flows (the auto-generated
"Set target power" card), EMS apps (e.g. PELS, Ultimate EMS) or programmatically.

- `target_power_mode`: who is in control.
  - `homey`: Homey controls the battery. The battery is switched to operating mode
    "Manual", the only mode in which it holds a setpoint without an expiry timer.
  - `self_consumption` / `time_of_use`: the battery follows its own logic using the
    respective operating mode; a stored target power is not pushed to the battery.
  - The capability stays in sync when the operating mode is changed externally
    (sonnen app, battery UI, other flows).
- `target_power`: signed power setpoint in watts.
  - positive = charge, negative = discharge, `0` = idle.
  - Idle is implemented via the battery's persistent *manual standby* (not a
    transient 0 W setpoint, which would expire outside Manual mode).
  - Values are clamped to the device's real limits, read from the battery
    (`IC_InverterMaxPower_w`, or `site/limits` on newer systems). The battery
    silently accepts oversized setpoints, so the app enforces honest feedback.

Setting a target power via the flow card automatically switches
`target_power_mode` to `homey` (Homey standard behavior).