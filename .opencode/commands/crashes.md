---
description: Fetch and summarize Homey app crash reports (read-only)
---
Load the `homey-crashes` skill and fetch crash reports for $ARGUMENTS
(appId and/or buildId; defaults apply as documented in the skill).
Summarize the crash groups and map the stack frames to files in this repo.
Strictly read-only: no write operations against the Athom apps API.
