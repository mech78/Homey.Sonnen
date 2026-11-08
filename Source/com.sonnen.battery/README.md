# Sonnen

Adds support for Sonnen Batterie - Time of Use (ToU), Prognosis Charging and much more

## Homey Energy: target_power / target_power_mode (Homey >= 12.13.0)

The battery device supports Homey's standardized energy control capabilities. They
are **hidden from the device UI** on purpose (the first tab would otherwise expose a
raw power slider to every user); control happens via Flows (the auto-generated
"Set target power" card), EMS apps (e.g. PELS, Ultimate EMS) or programmatically.

- `target_power_mode`: who is in control.
  - `homey`: an EMS (Homey Energy / EMS apps) controls the battery. The battery is
    switched to operating mode "Manual", the only mode in which it holds a
    setpoint without an expiry timer.
  - `manual`, `self_consumption`, `module_extension`, `time_of_use`,
    `optimization`: the battery follows its own logic using the respective
    operating mode; a stored target power is not pushed to the battery.
    `manual` means device-side manual control (setpoints from the sonnen app);
    it shares the battery's Manual carrier mode with `homey`, but Homey does
    not intervene.
  - The capability stays in sync when the operating mode is changed externally
    (sonnen app, battery UI, other flows). The Manual carrier is sticky: an
    established `homey` or `manual` state survives polling, while an external
    switch to Manual from any other mode resolves to `manual`.
- `target_power`: signed power setpoint in watts.
  - positive = charge, negative = discharge, `0` = idle.
  - Idle is a plain 0 W setpoint: the battery holds `0 W` and stops charging or
    discharging. Manual standby is deliberately never used — its enable/disable
    round-trips force an inverter/DC re-init cycle, and setpoints arriving
    inside that startup window can leave the battery wedged in its `Init`
    state (recoverable only via power cycle).
  - Values are clamped to the device's real limits, read from the battery
    (`IC_InverterMaxPower_w`, or `site/limits` on newer systems). The battery
    silently accepts oversized setpoints, so the app enforces honest feedback:
    the clamped value is written back to the `target_power` capability.
  - Entering `homey` via a mode-only write starts from idle: the battery is
    stopped with a 0 W setpoint and a stale stored `target_power` is reset to
    `0` instead of being re-applied.
  - Leaving `homey` control resets the stored target power to `0` so switching
    back at a later time starts from idle instead of re-applying a stale
    setpoint.

Setting a target power via the flow card automatically switches
`target_power_mode` to `homey` (Homey standard behavior).

The device settings offer an opt-in **"Show target power controls"** checkbox
(default: off) in the *EMS support* section. When enabled, visible counterparts
of the two capabilities — a power slider and a mode picker — are added as their
own tabs on the device card. The change takes effect immediately; the hidden
capabilities stay present either way, so Flows and EMS apps are unaffected by
the setting on Homey Pro (Early 2023) and newer.

**Homey Pro (2019)** ignores `uiComponent` overrides for built-in capabilities,
so the target power components cannot be hidden on that platform. There the
checkbox enables or disables the target power controls entirely (off = no
control capabilities at all, clean metrics card), and the visible twins are
not used — they would only duplicate the always-visible built-ins. The
*EMS support* section renders a note explaining the behavior on your Homey.
